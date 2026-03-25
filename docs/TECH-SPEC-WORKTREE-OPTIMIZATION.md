# Tech Spec: Worktree Creation Optimization via Reflink Copies

**Version:** 1.0
**Date:** 2026-03-25
**Status:** Implemented (PR #40, Issue #39)
**Author:** Prakhar Tripathi, Claude

---

## 1. Problem

Source-verse creates isolated git worktrees for each parallel Claude Code session. On large repositories, this introduces two performance bottlenecks:

| Bottleneck | Cause | Impact |
|-----------|-------|--------|
| Slow worktree creation | `git worktree add` must check out every tracked file | 10-60s on large monorepos |
| Cold build cache | `node_modules/`, `.next/`, `target/`, etc. are gitignored and not included in worktrees | Each session reinstalls dependencies — slow startup, high CPU |
| Slow teardown | `git worktree remove` must delete all files including copied caches | 5-30s on large repos |

For small repos (<1000 files, no heavy dependencies), the current approach is fine. The optimization targets repos where session creation/teardown takes more than a few seconds.

## 2. Background: How Worktrees Work Today

```
source-verse new "fix login bug"
  1. Preflight checks (tmux, git, disk space)
  2. Generate session ID (incremented from existing worktrees)
  3. git fetch origin/main
  4. git worktree add -b sv/fix-login-bug ../repo-sv-1 origin/main
  5. Create session record in ~/.source-verse/sessions.json
  6. Spawn Claude Code in tmux window at worktree path
```

Step 4 creates a full checkout of all tracked files. Gitignored directories (build caches) are absent.

## 3. Solution: Platform-Aware Reflink Copies

### 3.1 Core Idea

After `git worktree add`, copy build cache directories from the source repo into the new worktree using **copy-on-write (reflink)** filesystem operations. This gives each session a full build cache without the time or disk cost of a real copy.

### 3.2 How Reflinks Work

A reflink (also called a "clone" or "copy-on-write copy") creates a new file that shares the same underlying disk blocks as the original. No data is physically copied. Only when one copy is modified does the filesystem allocate new blocks for the changed portions.

```
Traditional copy:   Source [blocks A,B,C] → Destination [blocks D,E,F]  (6 blocks used)
Reflink copy:       Source [blocks A,B,C] → Destination [→A,→B,→C]     (3 blocks used)
After modification: Source [blocks A,B,C] → Destination [→A,G,→C]      (4 blocks used)
```

### 3.3 Platform Support

| Platform | Filesystem | Command | Behavior |
|----------|-----------|---------|----------|
| macOS | APFS (default since High Sierra) | `cp -c -R` | Native reflink. Fails on non-APFS volumes. |
| Linux | btrfs, XFS | `cp --reflink=auto -R` | Reflink if supported, falls back to regular copy. |
| Linux | ext4 | `cp --reflink=auto -R` | Falls back to regular copy (still correct, just slower). |
| Other | — | `cp -R` | Regular recursive copy. |

### 3.4 File Descriptor Limits

macOS has a default `ulimit -n` of 256 open file descriptors. A naive parallel deep-walk of a large `node_modules` directory can exceed this. The implementation uses a **concurrency pool** (default: 4 concurrent `cp` processes) to stay well within limits.

## 4. Architecture

### 4.1 New Module: `src/platform/copy.ts`

```
┌─────────────────────────────────────────────────────┐
│ getReflinkCopyArgs()                                │
│   Detects OS → returns cp flags for reflink copy    │
├─────────────────────────────────────────────────────┤
│ reflinkCopyDir(source, destination)                 │
│   Checks if source dir exists, then runs cp         │
│   Returns true if copy performed, false if skipped  │
├─────────────────────────────────────────────────────┤
│ copyBuildCaches(srcRepo, worktree, dirs, limit)     │
│   Runs reflinkCopyDir for each dir in parallel      │
│   Bounded by concurrency limit (default: 4)         │
├─────────────────────────────────────────────────────┤
│ warmDiskCache(dirPath)                              │
│   Background find walk to prime OS disk cache       │
│   Fire-and-forget (detached, errors swallowed)      │
└─────────────────────────────────────────────────────┘
```

### 4.2 Config Extension: `WorktreeConfig`

Added to `~/.source-verse/config.json`:

```json
{
  "worktree": {
    "cacheDirs": ["node_modules", ".next", "dist", "build", "target", ".venv"],
    "warmDiskCache": true
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cacheDirs` | `string[]` | `["node_modules", ".next", "dist", "build", "target", ".venv"]` | Gitignored directories to reflink-copy into new worktrees |
| `warmDiskCache` | `boolean` | `true` | Whether to walk the worktree in the background after creation to warm OS disk cache |

Setting `cacheDirs` to `[]` disables reflink copying entirely (useful if the source repo has no relevant caches).

### 4.3 Modified Flow

```
source-verse new "fix login bug"
  1. Preflight checks
  2. Generate session ID
  3. git fetch origin/main
  4. git worktree add -b sv/fix-login-bug ../repo-sv-1 origin/main
  5. ← NEW: copyBuildCaches(repoPath, worktreePath, config.cacheDirs)
  6. ← NEW: warmDiskCache(worktreePath)  [background, non-blocking]
  7. Create session record
  8. Spawn Claude Code
```

Steps 5-6 are the new additions. Step 5 is synchronous (we want caches ready before Claude starts). Step 6 is fire-and-forget.

### 4.4 Data Flow

```
config.json ──→ loadConfig() ──→ SourceVerseConfig
                                      │
                                      ├── mergeDetection → MergeWatcher
                                      └── worktree ──→ GitManager.createWorktree()
                                                            │
                                                            ├── copyBuildCaches()
                                                            └── warmDiskCache()
```

Both entry paths (CLI `handleNew` and TUI `createSession`) load config and pass `worktreeConfig` to `createWorktree()`.

## 5. Performance Characteristics

### 5.1 Expected Improvements

| Scenario | Before | After (reflink) | Notes |
|----------|--------|-----------------|-------|
| Worktree creation (no caches) | ~1s | ~1s | No change — reflink skips missing dirs |
| Worktree creation (500MB node_modules) | ~1s worktree + 30-60s npm install | ~1s worktree + <1s reflink copy | 30-60x faster effective startup |
| Disk usage per session | Full copy of caches | Near-zero (CoW) | Until files diverge |
| Worktree teardown | ~5-30s | ~5-30s | Unchanged — reflinked files are cheap to delete |

### 5.2 Disk Cache Warmup

After worktree creation, a background `find <path> -type f > /dev/null` warms the OS page cache. This ensures the first `grep`, `git status`, or file read in the new session hits warm cache instead of cold disk. The process is detached and non-blocking.

## 6. Failure Modes

| Failure | Behavior | User Impact |
|---------|----------|-------------|
| Non-APFS volume on macOS | `cp -c` fails, catch block marks dir as `copied: false` | Session works, but without cached deps |
| Source cache dir doesn't exist | `reflinkCopyDir` returns false, skipped gracefully | No impact |
| File descriptor exhaustion | Concurrency limit (default 4) prevents this | None expected |
| Disk full during reflink | `cp` fails, catch block marks as `copied: false` | Session works, but without cached deps |
| Config has invalid `cacheDirs` | Falls back to `DEFAULT_CACHE_DIRS` | Default behavior |

All failures are non-fatal. The worktree is always created successfully; the cache copy is best-effort.

## 7. Testing

| Test | Type | File |
|------|------|------|
| `getReflinkCopyArgs` returns valid shape per platform | Unit | `src/platform/copy.test.ts` |
| `copyBuildCaches` skips non-existent directories | Unit | `src/platform/copy.test.ts` |
| `copyBuildCaches` handles empty array | Unit | `src/platform/copy.test.ts` |
| `copyBuildCaches` respects concurrency limit | Unit | `src/platform/copy.test.ts` |
| `warmDiskCache` does not throw | Unit | `src/platform/copy.test.ts` |
| Config loader reads `worktree.cacheDirs` | Integration | `src/config/loader.test.ts` |
| Config loader reads `worktree.warmDiskCache` | Integration | `src/config/loader.test.ts` |
| Config loader falls back on invalid `cacheDirs` | Integration | `src/config/loader.test.ts` |
| `createWorktree` passes config through | Unit | `src/cli/commands.test.ts` |

### Manual Testing Required

- [ ] macOS + APFS: verify `cp -c` reflink is near-instant on large `node_modules`
- [ ] macOS + APFS: verify disk usage is minimal (`du -sh` on worktree vs source)
- [ ] Linux: verify `cp --reflink=auto` works on btrfs and falls back on ext4
- [ ] Large monorepo: measure end-to-end session creation time before/after

## 8. Future Considerations

### 8.1 Incremental Improvements

- **Auto-detect cache dirs**: Scan for `package.json` → add `node_modules`, `Cargo.toml` → add `target/`, etc. instead of relying on a static default list.
- **Selective warmup**: Only warm directories that Claude Code is likely to search (e.g., `src/`, not `node_modules/.cache/`).
- **Progress reporting**: Show "Copying build caches..." in the TUI during session creation for large copies.

### 8.2 Longer-Term

- **Linux overlayfs**: For ext4 (no reflink support), use overlayfs to layer the worktree over the source repo. More complex but zero-copy.
- **Shared node_modules via symlink**: For Node.js projects, symlink `node_modules` to a shared location instead of copying. Requires careful handling of per-worktree lock files.
- **Pre-warmed worktree pool**: Maintain 1-2 pre-created worktrees ready to go, so session creation is truly instant.

## 9. References

- [X thread by @skcd42 on worktree optimization](https://x.com/skcd42/status/2036480307743039969)
- [APFS `cp -c` documentation](https://ss64.com/mac/cp.html)
- [Linux `cp --reflink` man page](https://man7.org/linux/man-pages/man1/cp.1.html)
- [reflink-copy Rust crate](https://docs.rs/reflink-copy/) (reference implementation for Rust-based tools)
- PR #40: https://github.com/prakhar30/Source-verse/pull/40
- Issue #39: https://github.com/prakhar30/Source-verse/issues/39
