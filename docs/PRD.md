# Source-Verse — Product Requirements Document

**Version:** 1.0
**Date:** 2026-03-15
**Status:** Draft

---

## 1. Vision

A single terminal screen that enables developers to run multiple Claude Code instances in parallel, each working on isolated copies of the same repository — managed through one intuitive CLI.

## 2. Problem Statement

When working with AI coding assistants like Claude Code, developers are limited to a single session per terminal. Running multiple tasks in parallel (bug fix, feature, refactor) requires manually duplicating repos, managing branches, juggling terminal windows, and cleaning up afterward. This friction discourages parallelism and slows down development velocity.

## 3. Goals

| # | Goal | Success Metric |
|---|------|---------------|
| G1 | Enable parallel Claude Code sessions from a single terminal | User can run N independent sessions simultaneously |
| G2 | Automate repo duplication and branch management | Zero manual git commands needed to set up a parallel task |
| G3 | Provide effortless session switching | Switch between sessions in ≤2 keystrokes |
| G4 | Auto-cleanup after task completion | No orphaned repo copies or stale branches left behind |
| G5 | Be intuitive enough that no documentation is needed for basic usage | New user can start a parallel task within 60 seconds |

## 4. Target Users

### Primary Persona: Solo Developer

- Works on a single repository with multiple tasks in flight
- Uses Claude Code as a daily coding assistant
- Comfortable with the terminal but values convenience
- Wants to maximize throughput by running tasks in parallel

### Secondary Persona: Tech Lead

- Delegates multiple tasks to Claude Code simultaneously
- Needs visibility into what each session is working on
- Wants a clean workflow: task → branch → PR → merge → cleanup

## 5. User Stories

### 5.1 Session Management

| ID | Story | Priority |
|----|-------|----------|
| US-1 | As a developer, I want to start source-verse in any git repository so that I can manage parallel sessions from there. | P0 |
| US-2 | As a developer, I want to create a new parallel session with a task description so that Claude Code starts working on it immediately. | P0 |
| US-3 | As a developer, I want to list all active sessions with their status and task description so that I know what's running. | P0 |
| US-4 | As a developer, I want to switch between sessions instantly so that I can monitor or interact with any of them. | P0 |
| US-5 | As a developer, I want a session to auto-cleanup its repo copy after its branch is merged so that I don't accumulate clutter. | P1 |
| US-6 | As a developer, I want to manually stop and remove a session so that I can cancel tasks that are no longer needed. | P1 |
| US-7 | As a developer, I want to see a live status indicator for each session (working, waiting for input, done, error) so that I can prioritize my attention. | P2 |

### 5.2 Repository & Branch Management

| ID | Story | Priority |
|----|-------|----------|
| US-8 | As a developer, I want source-verse to automatically duplicate my repo into a sibling folder when I create a session so that each session has an isolated workspace. | P0 |
| US-9 | As a developer, I want each session's repo copy to automatically branch off main/master so that work is isolated from the start. | P0 |
| US-10 | As a developer, I want the branch name to be auto-generated from the task description so that branches are descriptive without manual naming. | P1 |
| US-11 | As a developer, I want source-verse to detect when a branch has been merged and trigger cleanup automatically. | P1 |

## 6. Functional Requirements

### 6.1 CLI Interface

The CLI is the single entry point for all interactions.

**Commands:**

| Command | Description |
|---------|-------------|
| `source-verse` | Launch the interactive dashboard in the current git repo. |
| `source-verse new "<task>"` | Create a new session with the given task description. |
| `source-verse list` | List all active sessions with their status. |
| `source-verse switch <id>` | Switch the terminal view to a specific session. |
| `source-verse stop <id>` | Stop a session and optionally clean up its repo copy. |
| `source-verse cleanup` | Remove all completed/merged session repo copies. |
| `source-verse status` | Show a summary of all sessions and their states. |

### 6.2 Dashboard (Interactive Mode)

When launched without a subcommand, source-verse enters an interactive terminal UI (TUI):

- **Session list panel:** Shows all active sessions with: session ID, task description (truncated), status indicator, branch name, and elapsed time.
- **Active session panel:** Displays the output of the currently focused Claude Code session, fully interactive (the user can type into it).
- **Keybindings bar:** Shows available shortcuts at the bottom of the screen.

**Key interactions:**

| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Cycle through sessions |
| `1-9` | Jump to session by number |
| `n` | Create new session (prompts for task description) |
| `d` | Stop/delete the focused session |
| `q` | Quit source-verse (sessions keep running in background) |
| `?` | Show help overlay |

### 6.3 Repo Duplication

When a new session is created:

1. Identify the current repository root and its parent directory.
2. Create a shallow copy of the repo in the parent directory: `<parent>/<repo-name>-sv-<session-id>/`.
3. The copy must include all tracked files and the full git history needed to branch and push.
4. Configure the copy's git remote to point to the same origin as the source repo.

**Implementation note:** Prefer `git worktree` over full repo duplication where possible, as worktrees are faster, use less disk space, and share the object store. Fall back to full copy only if worktree limitations apply.

### 6.4 Branch Management

For each new session:

1. Fetch the latest main/master branch from origin.
2. Create a new branch from main/master: `sv/<short-task-slug>` (e.g., `sv/fix-login-bug`).
3. Check out the new branch in the session's working copy.

### 6.5 Session Lifecycle

```
[ Created ] → [ Running ] → [ Waiting for Input ] → [ Done ] → [ Merged ] → [ Cleaned Up ]
                    ↑              |                      |
                    └──────────────┘                      ↓
                                                   [ Cleanup ]
```

**States:**

| State | Description |
|-------|-------------|
| Created | Repo copy made, branch created, Claude Code not yet started. |
| Running | Claude Code is actively executing in the session. |
| Waiting | Claude Code is waiting for user input. |
| Done | Claude Code has finished its task. |
| Merged | The session's branch has been merged into main/master. |
| Cleaned Up | The repo copy has been deleted and the session is archived. |

### 6.6 Cleanup

- **Auto-cleanup:** When source-verse detects (via polling or webhook) that a session's branch has been merged into main/master, it deletes the repo copy and archives the session.
- **Manual cleanup:** The user can run `source-verse stop <id>` to force-stop and remove a session at any time. This should prompt for confirmation if the branch has unmerged changes.
- **Bulk cleanup:** `source-verse cleanup` removes all repo copies for sessions in the "Done" or "Merged" state.

## 7. Non-Functional Requirements

| # | Requirement | Target |
|---|-------------|--------|
| NFR-1 | Session creation time (repo duplication + branch) | < 5 seconds for repos up to 1 GB |
| NFR-2 | Session switching latency | < 100ms (perceived instant) |
| NFR-3 | Maximum concurrent sessions | At least 10 |
| NFR-4 | Disk usage per session (with git worktree) | Minimal — shared object store |
| NFR-5 | Terminal compatibility | Works in standard terminals: iTerm2, Terminal.app, Windows Terminal, Alacritty, kitty |
| NFR-6 | OS support | macOS, Linux. Windows via WSL. |
| NFR-7 | No data loss | Never delete the original repo. Only delete copies created by source-verse. |

## 8. Technical Architecture (High-Level)

### 8.1 Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Language | TypeScript (Node.js) | Matches Claude Code's ecosystem; rich TUI libraries available. |
| TUI framework | Ink (React for CLI) or Blessed | Mature terminal UI libraries with layout support. |
| Process management | Node.js `child_process` + PTY (node-pty) | Required to spawn and interact with Claude Code instances. |
| Git operations | `simple-git` or direct git CLI calls | Repo duplication, branching, merge detection. |
| State persistence | JSON file in `~/.source-verse/` | Track sessions across restarts. |
| Package distribution | npm | Standard for Node.js CLI tools. |

### 8.2 Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│                  source-verse CLI                │
│  ┌───────────┐  ┌────────────┐  ┌────────────┐  │
│  │ Dashboard  │  │  Session   │  │    Git      │  │
│  │   (TUI)    │  │  Manager   │  │  Manager    │  │
│  └─────┬─────┘  └─────┬──────┘  └─────┬──────┘  │
│        │               │               │          │
│        ▼               ▼               ▼          │
│  ┌───────────┐  ┌────────────┐  ┌────────────┐  │
│  │  Terminal  │  │   PTY      │  │  Worktree   │  │
│  │  Renderer  │  │  Spawner   │  │  Manager    │  │
│  └───────────┘  └────────────┘  └────────────┘  │
│                        │                          │
│                        ▼                          │
│              ┌──────────────────┐                 │
│              │  Claude Code x N │                 │
│              └──────────────────┘                 │
└─────────────────────────────────────────────────┘
```

### 8.3 Key Components

| Component | Responsibility |
|-----------|---------------|
| **Dashboard (TUI)** | Renders the interactive terminal UI: session list, active session view, keybindings bar. Handles user input for navigation and session management. |
| **Session Manager** | Creates, tracks, and tears down sessions. Persists session state to disk. Manages the lifecycle state machine. |
| **Git Manager** | Handles all git operations: worktree creation, branch creation, merge detection, and cleanup of worktrees/copies. |
| **PTY Spawner** | Spawns Claude Code processes in pseudo-terminals so their output can be captured and displayed in the dashboard, and user input can be forwarded. |
| **Terminal Renderer** | Abstracts terminal drawing, layout, and input handling. Wraps the chosen TUI framework. |

## 9. UX & Interaction Design

### 9.1 First Launch

```
$ cd my-project
$ source-verse

  ┌─ source-verse ──────────────────────────────────┐
  │                                                   │
  │   No active sessions.                             │
  │                                                   │
  │   Press [n] to create a new session               │
  │   or run: source-verse new "fix the login bug"    │
  │                                                   │
  └───────────────────────────────────────────────────┘
```

### 9.2 With Active Sessions

```
  ┌─ source-verse ─────────────────────────────────────────────┐
  │ Sessions              │ Session #2: Fix login bug           │
  │                       │                                     │
  │  ● 1 Fix login bug    │ $ claude                            │
  │  ◐ 2 Add dark mode    │ > I've identified the issue in      │
  │  ○ 3 Write tests      │   auth.ts:42. The session token     │
  │                       │   is not being refreshed when...     │
  │                       │                                     │
  │                       │                                     │
  │                       │                                     │
  ├───────────────────────┴─────────────────────────────────────┤
  │ [Tab] switch  [n] new  [d] delete  [q] quit  [?] help      │
  └─────────────────────────────────────────────────────────────┘

  ● Running  ◐ Waiting  ○ Idle  ✓ Done
```

### 9.3 Session Creation Flow

```
$ source-verse new "fix the login bug"

  ✓ Created worktree: ../my-project-sv-1/
  ✓ Branched: sv/fix-login-bug (from main)
  ✓ Started Claude Code session #1

  Switching to session #1...
```

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Accidental deletion of original repo | Critical | source-verse never touches the original repo's files. Only worktrees/copies it created (identified by naming convention and metadata) are eligible for deletion. |
| Disk space exhaustion from many copies | High | Use `git worktree` to share object stores. Show disk usage in `status`. Warn when creating sessions if disk is low. |
| Claude Code process crashes | Medium | Detect process exit, update session state, notify user. Allow restart. |
| Merge conflicts between parallel sessions | Medium | Out of scope for v1 — each session works on its own branch. Conflicts are resolved during PR review/merge, not by source-verse. |
| Terminal rendering issues across platforms | Medium | Test on top 5 terminal emulators. Use well-tested TUI libraries. Provide a fallback non-TUI mode. |

## 11. Milestones

### v0.1 — Foundation (MVP)

- [ ] CLI scaffolding with command parsing
- [ ] Git worktree creation and branch management
- [ ] Spawn a single Claude Code session in a worktree
- [ ] Basic session list and switch commands (non-TUI)
- [ ] Manual session cleanup

### v0.2 — Interactive Dashboard

- [ ] Terminal UI with session list and active session panels
- [ ] Keyboard navigation and session switching
- [ ] Session status indicators
- [ ] Help overlay

### v0.3 — Lifecycle Automation

- [ ] Auto-detect merged branches and trigger cleanup
- [ ] Session state persistence across restarts
- [ ] Bulk cleanup command
- [ ] Disk usage warnings

### v1.0 — Polish & Release

- [ ] Cross-platform testing (macOS, Linux, WSL)
- [ ] Error handling and recovery for all edge cases
- [ ] npm package publication
- [ ] README and getting-started guide
- [ ] CI/CD pipeline for the source-verse project itself

## 12. Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| Q1 | Should source-verse support non-Claude-Code terminals (e.g., plain shell sessions)? | Product | Open |
| Q2 | Should sessions persist and resume after a system reboot? | Product | Open |
| Q3 | Is `git worktree` sufficient for all use cases, or do some repos require full copies? | Engineering | Open |
| Q4 | Should source-verse integrate with GitHub/GitLab APIs for auto-PR creation? | Product | Open |
| Q5 | What is the desired behavior when the user quits source-verse — keep sessions running in background or stop them? | Product | Open |

## 13. Out of Scope (v1)

- Merge conflict resolution between parallel sessions
- Multi-repo support (source-verse manages one repo at a time)
- Remote/cloud session execution
- Built-in code review or diff viewer
- Integration with project management tools (Jira, Linear, etc.)

---

*This document is a living artifact. Update it as decisions are made and requirements evolve.*
