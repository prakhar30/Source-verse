/**
 * Lightweight control panel that runs in tmux window 0.
 *
 * Displays a session list and handles keyboard commands.
 * No polling — renders on demand after user actions or merge events.
 */

import type { SessionManager } from '../session/manager.js';
import type { GitManager } from '../git/manager.js';
import type { TmuxSpawner } from '../pty/spawner.js';
import type { Session } from '../session/types.js';
import type { MergeDetectionConfig, WorktreeConfig } from '../config/types.js';
import { MergeWatcher } from '../merge/watcher.js';
import { slugifyTaskName } from '../git/slugify.js';
import { resolveClaudeSessionId } from '../session/claude-resolver.js';
import { formatStatus } from './status-indicator.js';
import { style, screen, cursor, fitText, writeRaw } from './renderer.js';
import { parseKeyInput, enableRawMode, disableRawMode } from './input.js';

export interface ControlPanelDeps {
  sessionManager: SessionManager;
  gitManager: GitManager;
  tmuxSpawner: TmuxSpawner;
  repoPath: string;
  mergeDetectionConfig?: MergeDetectionConfig;
  worktreeConfig?: WorktreeConfig;
}

interface PromptState {
  text: string;
}

function tmuxName(sessionId: string): string {
  return `sv-${sessionId}`;
}

async function generateSessionId(gitManager: GitManager): Promise<string> {
  const existing = await gitManager.listWorktrees();
  const usedIds = existing.map((w) => Number(w.sessionId)).filter(Number.isFinite);
  const nextId = usedIds.length > 0 ? Math.max(...usedIds) + 1 : 1;
  return String(nextId);
}

export async function startControlPanel(deps: ControlPanelDeps): Promise<void> {
  const { sessionManager, gitManager, tmuxSpawner } = deps;

  let running = true;
  let sessions: Session[] = [];
  let focusedIndex = 0;
  let prompt: PromptState | null = null;
  let confirmAction: { type: 'suspend_all' | 'quit' } | null = null;
  let mergeWatcher: MergeWatcher | null = null;
  const tagline =
    Math.random() < 0.5
      ? 'Parallel universes, one terminal.'
      : "Don't clone repos. Clone yourself.";

  // ── Helpers ──────────────────────────────────────────────────────

  async function loadSessions(): Promise<void> {
    sessions = await sessionManager.listSessions();
    // Reconcile: check which windows are actually alive
    for (const session of sessions) {
      if (session.status === 'running' && session.tmuxSessionName) {
        const alive = await tmuxSpawner.hasWindow(session.tmuxSessionName);
        if (!alive) {
          await sessionManager.updateStatus(session.id, 'done');
          session.status = 'done';
        }
      }
    }
    // Filter out cleaned_up sessions from display
    sessions = sessions.filter((s) => s.status !== 'cleaned_up');
  }

  function render(): void {
    writeRaw(screen.clear + cursor.moveTo(1, 1) + cursor.hide);

    const termWidth = process.stdout.columns || 80;

    // Title
    writeRaw(
      `  ${style.bold}Source-verse${style.reset} ${style.fg.gray}— ${tagline}${style.reset}\n\n`,
    );

    if (sessions.length === 0) {
      writeRaw(`  ${style.fg.gray}No sessions.${style.reset}\n`);
      writeRaw(
        `  ${style.fg.gray}Press ${style.bold}n${style.reset}${style.fg.gray} to create one.${style.reset}\n`,
      );
    } else {
      // Table header
      const colNum = 4;
      const colStatus = 3;
      const colTask = Math.min(40, Math.floor((termWidth - 20) * 0.35));
      const colBranch = Math.min(30, Math.floor((termWidth - 20) * 0.35));

      const header = `  ${style.fg.gray}${fitText('#', colNum)} ${fitText('', colStatus)} ${fitText('Task', colTask)} ${fitText('Status', 10)} ${fitText('Branch', colBranch)}${style.reset}`;
      writeRaw(header + '\n');
      writeRaw(
        `  ${style.fg.gray}${'─'.repeat(Math.min(termWidth - 4, colNum + colStatus + colTask + colBranch + 14))}${style.reset}\n`,
      );

      sessions.forEach((session, i) => {
        const isFocused = i === focusedIndex;
        const prefix = isFocused ? `${style.bold}${style.fg.cyan}>` : ' ';
        const num = String(i + 1);
        const statusIcon = formatStatus(session.status);
        const task = session.taskDescription;
        const statusLabel = session.status;
        const branch = session.branchName;
        const reset = style.reset;

        writeRaw(
          `  ${prefix} ${fitText(num, colNum)} ${statusIcon} ${fitText(task, colTask)} ${fitText(statusLabel, 10)} ${style.fg.gray}${fitText(branch, colBranch)}${reset}\n`,
        );
      });
    }

    writeRaw('\n');

    // Prompt mode
    if (prompt !== null) {
      writeRaw(`  ${style.fg.yellow}Task description:${style.reset} ${prompt.text}${cursor.show}`);
      return;
    }

    // Keybindings bar
    const keys = [
      `${style.bold}n${style.reset} New`,
      `${style.bold}Enter${style.reset}/${style.bold}1-9${style.reset} Open session`,
      `${style.bold}d${style.reset} Delete`,
      `${style.bold}c${style.reset} Cleanup`,
      `${style.bold}r${style.reset} Refresh`,
      `${style.bold}R${style.reset} Resume all`,
      `${style.bold}?${style.reset} Help`,
      `${style.bold}q${style.reset} Suspend & quit`,
      `${style.bold}Q${style.reset} Quit & cleanup`,
    ];
    writeRaw(`  ${style.fg.gray}${keys.join('  ')}${style.reset}`);
  }

  // ── Session actions ──────────────────────────────────────────────

  async function createSession(task: string): Promise<void> {
    const branchName = slugifyTaskName(task);
    const sessionId = await generateSessionId(gitManager);
    const sessionName = tmuxName(sessionId);

    try {
      const worktreePath = await gitManager.createWorktree(sessionId, branchName, deps.worktreeConfig);
      const session = await sessionManager.createSession(
        task,
        worktreePath,
        branchName,
        sessionName,
      );

      const claudeAvailable = await tmuxSpawner.isCommandAvailable('claude');
      if (claudeAvailable) {
        await tmuxSpawner.spawnClaudeInWindow(sessionName, worktreePath, task);
        await sessionManager.updateStatus(session.id, 'running');
      }
    } catch (err) {
      writeRaw(
        `\n  ${style.fg.red}Error: ${err instanceof Error ? err.message : String(err)}${style.reset}\n`,
      );
      await sleep(1500);
    }
  }

  async function deleteSession(): Promise<void> {
    if (sessions.length === 0) return;
    const session = sessions[focusedIndex];
    if (!session) return;

    // Kill the tmux window if alive
    if (session.tmuxSessionName) {
      await tmuxSpawner.killWindow(session.tmuxSessionName);
    }
    await sessionManager.updateStatus(session.id, 'done');
  }

  async function cleanupDoneSessions(): Promise<void> {
    const doneSessions = sessions.filter((s) => s.status === 'done' || s.status === 'merged');
    if (doneSessions.length === 0) {
      writeRaw(`\n  ${style.fg.gray}No done sessions to clean up.${style.reset}`);
      await sleep(1000);
      return;
    }

    const worktrees = await gitManager.listWorktrees();
    let cleaned = 0;

    for (const session of doneSessions) {
      // Kill window if still alive (safe - already has internal try/catch)
      if (session.tmuxSessionName) {
        await tmuxSpawner.killWindow(session.tmuxSessionName);
      }
      // Remove worktree and branch (may fail if already deleted)
      try {
        const worktree = worktrees.find((w) => w.path === session.worktreePath);
        if (worktree) {
          await gitManager.removeWorktree(worktree.sessionId, true);
        }
      } catch {
        // Worktree may already be gone — that's fine
      }
      // Always remove the session record
      await sessionManager.removeSession(session.id);
      cleaned++;
    }

    writeRaw(`\n  ${style.fg.green}Cleaned up ${cleaned} session(s).${style.reset}`);
    await sleep(1000);
  }

  async function switchToSession(index: number): Promise<void> {
    const session = sessions[index];
    if (!session?.tmuxSessionName) return;

    const alive = await tmuxSpawner.hasWindow(session.tmuxSessionName);
    if (!alive) {
      writeRaw(`\n  ${style.fg.red}Window not found. Press r to refresh.${style.reset}`);
      await sleep(1000);
      return;
    }

    try {
      await tmuxSpawner.selectWindow(session.tmuxSessionName);
    } catch {
      writeRaw(`\n  ${style.fg.red}Failed to switch window.${style.reset}`);
      await sleep(1000);
    }
  }

  async function suspendAllSessions(): Promise<void> {
    const runningSessions = sessions.filter((s) => s.status === 'running' && s.tmuxSessionName);

    if (runningSessions.length === 0) {
      writeRaw(`\n  ${style.fg.gray}No running sessions to suspend.${style.reset}`);
      await sleep(1000);
      return;
    }

    writeRaw(
      `\n  ${style.fg.yellow}Suspending ${runningSessions.length} session(s)...${style.reset}`,
    );

    // Send /exit to all running sessions
    for (const session of runningSessions) {
      try {
        await tmuxSpawner.sendLineToWindow(session.tmuxSessionName, '/exit');
      } catch {
        // Window may already be gone
      }
    }

    // Poll until all windows are gone (or timeout)
    let remaining = [...runningSessions];
    const startTime = Date.now();
    while (remaining.length > 0 && Date.now() - startTime < 15_000) {
      await sleep(500);
      const stillAlive: Session[] = [];
      for (const session of remaining) {
        const alive = await tmuxSpawner.hasWindow(session.tmuxSessionName);
        if (alive) {
          stillAlive.push(session);
        }
      }
      remaining = stillAlive;
    }

    // Force-kill any stragglers
    for (const session of remaining) {
      await tmuxSpawner.killWindow(session.tmuxSessionName);
    }

    // Resolve Claude session IDs and update statuses
    for (const session of runningSessions) {
      const claudeId = await resolveClaudeSessionId(session.worktreePath);
      if (claudeId) {
        await sessionManager.updateClaudeSessionId(session.id, claudeId);
      }
      await sessionManager.updateStatus(session.id, 'suspended');
    }
  }

  async function shutdownAllSessions(): Promise<void> {
    const runningSessions = sessions.filter((s) => s.status === 'running' && s.tmuxSessionName);

    if (runningSessions.length === 0) return;

    writeRaw(
      `\n  ${style.fg.yellow}Shutting down ${runningSessions.length} session(s)...${style.reset}`,
    );

    // Send /exit to all running sessions
    for (const session of runningSessions) {
      try {
        await tmuxSpawner.sendLineToWindow(session.tmuxSessionName, '/exit');
      } catch {
        // Window may already be gone
      }
    }

    // Poll until all windows are gone (or timeout)
    let remaining = [...runningSessions];
    const startTime = Date.now();
    while (remaining.length > 0 && Date.now() - startTime < 15_000) {
      await sleep(500);
      const stillAlive: Session[] = [];
      for (const session of remaining) {
        const alive = await tmuxSpawner.hasWindow(session.tmuxSessionName);
        if (alive) {
          stillAlive.push(session);
        }
      }
      remaining = stillAlive;
    }

    // Force-kill any stragglers
    for (const session of remaining) {
      await tmuxSpawner.killWindow(session.tmuxSessionName);
    }

    // Clean up worktrees and remove session records
    const worktrees = await gitManager.listWorktrees();
    for (const session of runningSessions) {
      try {
        const worktree = worktrees.find((w) => w.path === session.worktreePath);
        if (worktree) {
          await gitManager.removeWorktree(worktree.sessionId, true);
        }
      } catch {
        // Worktree may already be gone
      }
      await sessionManager.removeSession(session.id);
    }
  }

  async function resumeAllSessions(): Promise<void> {
    const suspendedSessions = sessions.filter((s) => s.status === 'suspended' && s.tmuxSessionName);

    if (suspendedSessions.length === 0) {
      writeRaw(`\n  ${style.fg.gray}No suspended sessions to resume.${style.reset}`);
      await sleep(1000);
      return;
    }

    writeRaw(
      `\n  ${style.fg.green}Resuming ${suspendedSessions.length} session(s)...${style.reset}`,
    );

    for (const session of suspendedSessions) {
      try {
        const claudeId = session.claudeSessionId;
        const claudeArgs = claudeId ? `--resume ${claudeId}` : '--continue';
        await tmuxSpawner.spawnClaudeInWindow(
          session.tmuxSessionName,
          session.worktreePath,
          claudeArgs,
          { raw: true },
        );
        await sessionManager.updateStatus(session.id, 'running');
      } catch {
        writeRaw(
          `\n  ${style.fg.red}Failed to resume session ${session.id.slice(0, 8)}${style.reset}`,
        );
      }
    }
  }

  // ── Input handling ───────────────────────────────────────────────

  function handleInput(data: Buffer): void {
    if (!running) return;

    const raw = data.toString('utf-8');

    // Prompt mode: capture task description
    if (prompt !== null) {
      if (raw === '\x1b' || raw === '\x03') {
        // Escape or Ctrl+C: cancel
        prompt = null;
        render();
        return;
      }
      if (raw === '\r' || raw === '\n') {
        // Enter: submit
        const task = prompt.text.trim();
        prompt = null;
        if (task) {
          createSession(task)
            .then(() => loadSessions())
            .then(() => render())
            .catch(() => render());
        } else {
          render();
        }
        return;
      }
      if (raw === '\x7f' || raw === '\b') {
        // Backspace
        prompt.text = prompt.text.slice(0, -1);
        render();
        return;
      }
      // Append printable characters
      if (raw.length === 1 && raw >= ' ') {
        prompt.text += raw;
        render();
      }
      return;
    }

    // Confirmation mode
    if (confirmAction !== null) {
      if (raw === 'y' || raw === 'Y') {
        const action = confirmAction;
        confirmAction = null;
        if (action.type === 'suspend_all') {
          suspendAllSessions()
            .then(() => {
              running = false;
              cleanup();
            })
            .catch(() => {
              loadSessions().then(() => render());
            });
        } else if (action.type === 'quit') {
          shutdownAllSessions()
            .then(() => {
              running = false;
              cleanup();
            })
            .catch(() => {
              running = false;
              cleanup();
            });
        }
        return;
      }
      if (raw === 'n' || raw === 'N' || raw === '\x1b') {
        confirmAction = null;
        render();
        return;
      }
      return; // ignore other keys during confirmation
    }

    // Command mode
    const event = parseKeyInput(data);
    if (!event) return;

    switch (event.action) {
      case 'quit': {
        const runningForQuit = sessions.filter((s) => s.status === 'running').length;
        if (runningForQuit === 0) {
          running = false;
          cleanup();
          return;
        }
        confirmAction = { type: 'quit' };
        writeRaw(
          `\n  ${style.fg.red}Quit and clean up ${runningForQuit} running session(s)? This removes worktrees. [y/N]${style.reset} `,
        );
        return;
      }

      case 'new_session':
        prompt = { text: '' };
        render();
        return;

      case 'enter':
      case 'jump_to_session': {
        const idx = event.action === 'enter' ? focusedIndex : (event.sessionNumber ?? 1) - 1;
        if (idx >= 0 && idx < sessions.length) {
          switchToSession(idx)
            .then(() => loadSessions())
            .then(() => render())
            .catch(() => {});
        }
        return;
      }

      case 'next_session':
        if (sessions.length > 0) {
          focusedIndex = (focusedIndex + 1) % sessions.length;
          render();
        }
        return;

      case 'prev_session':
        if (sessions.length > 0) {
          focusedIndex = (focusedIndex - 1 + sessions.length) % sessions.length;
          render();
        }
        return;

      case 'delete_session':
        deleteSession()
          .then(() => loadSessions())
          .then(() => {
            if (focusedIndex >= sessions.length) focusedIndex = Math.max(0, sessions.length - 1);
            render();
          })
          .catch(() => {});
        return;

      case 'cleanup':
        cleanupDoneSessions()
          .then(() => loadSessions())
          .then(() => {
            if (focusedIndex >= sessions.length) focusedIndex = Math.max(0, sessions.length - 1);
            render();
          })
          .catch(() => {});
        return;

      case 'refresh':
        loadSessions()
          .then(() => render())
          .catch(() => {});
        return;

      case 'suspend_all':
        suspendAllSessions()
          .then(() => {
            running = false;
            cleanup();
          })
          .catch(() => {
            loadSessions().then(() => render());
          });
        return;

      case 'resume_all':
        resumeAllSessions()
          .then(() => loadSessions())
          .then(() => render())
          .catch(() => render());
        return;

      case 'help':
        renderHelp();
        return;
    }
  }

  function renderHelp(): void {
    writeRaw(screen.clear + cursor.moveTo(1, 1));
    writeRaw(`\n  ${style.bold}Source-verse Help${style.reset}\n\n`);
    writeRaw(`  ${style.bold}Control Panel${style.reset}\n`);
    writeRaw(`  ${style.bold}n${style.reset}            Create a new session\n`);
    writeRaw(`  ${style.bold}Enter${style.reset}        Open focused session\n`);
    writeRaw(`  ${style.bold}1-9${style.reset}          Open session by number\n`);
    writeRaw(`  ${style.bold}Tab${style.reset}          Move cursor down\n`);
    writeRaw(`  ${style.bold}Shift+Tab${style.reset}    Move cursor up\n`);
    writeRaw(`  ${style.bold}d${style.reset}            Stop focused session\n`);
    writeRaw(`  ${style.bold}c${style.reset}            Cleanup all done sessions\n`);
    writeRaw(`  ${style.bold}r${style.reset}            Refresh session list\n`);
    writeRaw(`  ${style.bold}R${style.reset}            Resume all suspended sessions\n`);
    writeRaw(`  ${style.bold}q${style.reset}            Suspend all sessions and quit\n`);
    writeRaw(`  ${style.bold}Q${style.reset}            Quit and clean up all sessions\n`);
    writeRaw(`\n  ${style.bold}Inside a session window${style.reset}\n`);
    writeRaw(`  ${style.bold}Ctrl+b 0${style.reset}     Back to this control panel\n`);
    writeRaw(`  ${style.bold}Ctrl+b 1-9${style.reset}   Jump to session by number\n`);
    writeRaw(`  ${style.bold}Ctrl+b n${style.reset}     Next window\n`);
    writeRaw(`  ${style.bold}Ctrl+b p${style.reset}     Previous window\n`);
    writeRaw(`  ${style.bold}Ctrl+b d${style.reset}     Detach (everything keeps running)\n`);
    writeRaw(`  ${style.bold}Mouse scroll${style.reset} Scroll through conversation\n`);
    writeRaw(`  ${style.bold}Shift+click${style.reset} Select text (bypasses tmux mouse)\n`);
    writeRaw(`\n  ${style.fg.gray}Press any key to return${style.reset}`);

    // Wait for any key then re-render
    const onKey = () => {
      process.stdin.removeListener('data', onKey);
      process.stdin.on('data', handleInput);
      render();
    };
    process.stdin.removeListener('data', handleInput);
    process.stdin.on('data', onKey);
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  function cleanup(): void {
    if (mergeWatcher) mergeWatcher.stop();
    disableRawMode();
    writeRaw(cursor.show + screen.clear + cursor.moveTo(1, 1));
    process.exit(0);
  }

  // Start merge watcher
  if (deps.mergeDetectionConfig) {
    mergeWatcher = new MergeWatcher(
      sessionManager,
      gitManager,
      (_event) => {
        // Re-render when a merge is detected
        loadSessions()
          .then(() => render())
          .catch(() => {});
      },
      deps.mergeDetectionConfig,
    );
    mergeWatcher.start();
  }

  // Initial load and render
  await loadSessions();
  enableRawMode();
  process.stdin.on('data', handleInput);
  render();

  // Keep the process alive until quit
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (!running) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
