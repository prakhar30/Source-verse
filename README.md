# source-verse

[![CI](https://github.com/prakhar30/Source-verse/actions/workflows/ci.yml/badge.svg)](https://github.com/prakhar30/Source-verse/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/source-verse)](https://www.npmjs.com/package/source-verse)

Run multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions in parallel from a single terminal.

Work on a bug fix, a new feature, and a refactor — all at the same time. Each session gets its own isolated git worktree and Claude Code instance. No juggling terminal windows. No duplicating repos.

## Install

```bash
# Homebrew (recommended — installs tmux automatically)
brew tap prakhar30/tap && brew install source-verse

# npm (requires tmux: brew install tmux or apt install tmux)
npm install -g source-verse
```

Requires **git** (>= 2.5) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on your PATH.

## Usage

```bash
cd my-project

# Launch the session manager
source-verse

# Or create a session directly
source-verse new "fix the login bug"
```

That's it. source-verse creates a worktree, branches off main, starts Claude Code, and drops you in.

### Session manager keybindings

| Key | Action |
|-----|--------|
| `n` | Create a new session |
| `Enter` / `1-9` | Open a session |
| `Tab` / `Shift+Tab` | Move cursor |
| `d` | Stop focused session |
| `c` | Cleanup all done sessions |
| `r` | Refresh list |
| `?` | Help |
| `q` | Quit |

### Inside a session window

| Key | Action |
|-----|--------|
| `Ctrl+b 0` | Back to session manager |
| `Ctrl+b 1-9` | Jump to session by number |
| `Ctrl+b n/p` | Next / previous window |
| `Ctrl+b d` | Detach (everything keeps running) |

## How it works

1. **Worktree isolation** — Each session gets its own [git worktree](https://git-scm.com/docs/git-worktree) with an independent working directory and branch
2. **Automatic branching** — Branches are generated from your task description (e.g., `sv/fix-the-login-bug`)
3. **Session persistence** — Powered by tmux. Sessions survive terminal restarts — relaunch and pick up where you left off
4. **Merge detection** — Auto-detects merged branches and can clean up completed sessions

## Commands

| Command | Description |
|---------|-------------|
| `source-verse` | Launch the session manager |
| `source-verse new "<task>"` | Create a new session |
| `source-verse list` | List all sessions |
| `source-verse switch <id>` | Attach to a session |
| `source-verse stop <id>` | Stop a session (`--cleanup` to remove worktree) |
| `source-verse restart <id>` | Restart a stopped session |
| `source-verse cleanup` | Remove all completed session worktrees |
| `source-verse status` | Show session summary and disk usage |

## Configuration

Optional config at `~/.source-verse/config.json`:

```json
{
  "mergeDetection": {
    "pollingIntervalMs": 60000,
    "autoCleanup": true
  }
}
```

## Contributing

```bash
git clone https://github.com/prakhar30/source-verse.git
cd source-verse
pnpm install
pnpm dev          # run in dev mode
pnpm test         # run tests
pnpm lint         # lint
```

Please open an issue before starting work on large changes.

## License

[MIT](LICENSE)
