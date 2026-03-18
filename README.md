# source-verse

[![CI](https://github.com/prakhar30/Source-verse/actions/workflows/ci.yml/badge.svg)](https://github.com/prakhar30/Source-verse/actions/workflows/ci.yml)

Run multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions in parallel from a single terminal.

source-verse lets you spin up isolated git worktrees, each running its own Claude Code instance, and manage them all through one CLI or an interactive TUI dashboard. Work on a bug fix, a new feature, and a refactor — all at the same time — without juggling terminal windows or duplicating repos.

## Prerequisites

- **Node.js** >= 18.0.0
- **git** (with worktree support, i.e. git >= 2.5)
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** installed and available on your `PATH`

## Installation

```bash
npm install -g source-verse
```

## Quick Start

```bash
# 1. Navigate to any git repository
cd my-project

# 2. Launch a parallel session with a task description
source-verse new "fix the login validation bug"

# 3. Open the interactive dashboard to manage all sessions
source-verse
```

That's it — source-verse creates an isolated worktree, branches off your default branch, and starts Claude Code with your task. Switch back to the dashboard at any time to monitor progress or start more sessions.

## Command Reference

| Command | Description |
|---------|-------------|
| `source-verse` | Launch the interactive TUI dashboard |
| `source-verse new "<task>"` | Create a new session with the given task description |
| `source-verse list` | List all active sessions with their status |
| `source-verse switch <id>` | Attach to a running session |
| `source-verse stop <id>` | Stop a session (optionally clean up with `--cleanup`) |
| `source-verse restart <id>` | Restart a crashed or completed session |
| `source-verse cleanup` | Remove all completed/merged session worktrees |
| `source-verse status` | Show a summary of all sessions and disk usage |
| `source-verse --help` | Show help |
| `source-verse --version` | Show version |

## Dashboard Keybindings

When running the interactive dashboard (`source-verse` with no subcommand):

| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Cycle through sessions |
| `1`–`9` | Jump to session by number |
| `n` | Create a new session |
| `d` | Stop/delete the focused session |
| `q` | Quit the dashboard |
| `?` | Show help overlay |

## How It Works

1. **Worktree isolation** — Each session gets its own [git worktree](https://git-scm.com/docs/git-worktree), so sessions share the same object store but have fully independent working directories and branches.
2. **Automatic branching** — Branch names are auto-generated from your task description (e.g., `fix-login-validation-bug`).
3. **Merge detection** — source-verse watches for merged branches and can auto-clean up completed sessions.
4. **Session persistence** — Sessions survive terminal restarts. Re-launch source-verse and pick up where you left off.

## Configuration

source-verse looks for a `.source-verse.json` file in your repository root. All settings are optional:

```json
{
  "mergeDetection": {
    "enabled": true,
    "pollIntervalMs": 30000,
    "autoCleanup": false
  }
}
```

## Contributing

Contributions are welcome! To get started:

```bash
# Clone the repository
git clone https://github.com/prakhar30/source-verse.git
cd source-verse

# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Run tests
pnpm test

# Lint
pnpm lint
```

Please open an issue before starting work on large changes so we can discuss the approach.

## License

[MIT](LICENSE) — Copyright (c) 2026 Prakhar Tripathi
