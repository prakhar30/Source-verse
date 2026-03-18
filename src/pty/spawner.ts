import { execFile, spawn as nodeSpawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { SpawnOptions, WindowInfo } from './types.js';

const execFileAsync = promisify(execFile);

export const MAIN_SESSION = 'sv-main';
const CONTROL_WINDOW = 'control';

/**
 * Manages Claude Code sessions inside a single tmux session with multiple windows.
 *
 * Architecture: one tmux session (sv-main) with window 0 as the control panel
 * and windows 1+ each running a Claude Code instance in its own worktree.
 */
export class TmuxSpawner {
  async isCommandAvailable(command: string): Promise<boolean> {
    try {
      await execFileAsync('which', [command]);
      return true;
    } catch {
      return false;
    }
  }

  // ── Main session management ──────────────────────────────────────

  /** Create the sv-main tmux session with window 0 running the control panel. */
  async createMainSession(controlCommand: string, cwd: string): Promise<void> {
    await execFileAsync('tmux', [
      'new-session',
      '-d',
      '-s',
      MAIN_SESSION,
      '-n',
      CONTROL_WINDOW,
      '-c',
      cwd,
      controlCommand,
    ]);
    // Configure status bar with navigation hints
    await this.configureStatusBar();
  }

  /** Set tmux status bar to show source-verse navigation hints. */
  private async configureStatusBar(): Promise<void> {
    const cmds: [string, string][] = [
      ['status-style', 'bg=colour235,fg=colour248'],
      ['status-left', '#[fg=colour117,bold] source-verse #[fg=colour248]│ '],
      ['status-left-length', '20'],
      ['status-right', '#[fg=colour248] Ctrl+b 0: control │ Ctrl+b d: detach '],
      ['status-right-length', '50'],
      ['window-status-format', ' #I:#W '],
      ['window-status-current-format', '#[fg=colour117,bold] #I:#W '],
    ];
    for (const [option, value] of cmds) {
      try {
        await execFileAsync('tmux', ['set-option', '-t', MAIN_SESSION, option, value]);
      } catch {
        // Non-fatal: status bar is cosmetic
      }
    }
  }

  /** Check whether the sv-main session exists. */
  async hasMainSession(): Promise<boolean> {
    return this.hasSession(MAIN_SESSION);
  }

  // ── Window management ────────────────────────────────────────────

  /** Create a new window in sv-main running the given command. */
  async createWindow(windowName: string, cwd: string, command: string): Promise<void> {
    await execFileAsync('tmux', [
      'new-window',
      '-t',
      MAIN_SESSION,
      '-n',
      windowName,
      '-c',
      cwd,
      command,
    ]);
  }

  /** Switch to a window by name within sv-main (only works when inside tmux). */
  async selectWindow(windowName: string): Promise<void> {
    await execFileAsync('tmux', ['select-window', '-t', `${MAIN_SESSION}:${windowName}`]);
  }

  /** Check whether a named window exists in sv-main. */
  async hasWindow(windowName: string): Promise<boolean> {
    const windows = await this.listWindows();
    return windows.some((w) => w.name === windowName);
  }

  /** Kill a specific window in sv-main. */
  async killWindow(windowName: string): Promise<void> {
    try {
      await execFileAsync('tmux', ['kill-window', '-t', `${MAIN_SESSION}:${windowName}`]);
    } catch {
      // Window may already be dead
    }
  }

  /** Send a line of text to a window within sv-main. */
  async sendLineToWindow(windowName: string, text: string): Promise<void> {
    await execFileAsync('tmux', [
      'send-keys',
      '-t',
      `${MAIN_SESSION}:${windowName}`,
      text,
      'Enter',
    ]);
  }

  /** List all windows in sv-main. */
  async listWindows(): Promise<WindowInfo[]> {
    try {
      const { stdout } = await execFileAsync('tmux', [
        'list-windows',
        '-t',
        MAIN_SESSION,
        '-F',
        '#{window_index}\t#{window_name}\t#{window_active}',
      ]);
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [index, name, active] = line.split('\t');
          return {
            index: Number(index),
            name: name!,
            active: active === '1',
          };
        });
    } catch {
      return [];
    }
  }

  /** Spawn Claude Code in a new window within sv-main. */
  async spawnClaudeInWindow(
    windowName: string,
    cwd: string,
    taskDescription: string,
  ): Promise<void> {
    // Kill stale window with same name if it exists
    const exists = await this.hasWindow(windowName);
    if (exists) {
      await this.killWindow(windowName);
    }
    await this.createWindow(windowName, cwd, `claude ${JSON.stringify(taskDescription)}`);
  }

  // ── Environment detection ────────────────────────────────────────

  /** Check if we're running inside any tmux session. */
  isInsideTmux(): boolean {
    return !!process.env.TMUX;
  }

  /** Get the name of the current tmux session (only valid when inside tmux). */
  async getCurrentSessionName(): Promise<string> {
    const { stdout } = await execFileAsync('tmux', ['display-message', '-p', '#{session_name}']);
    return stdout.trim();
  }

  /** Check if we're inside the sv-main session specifically. */
  async isInMainSession(): Promise<boolean> {
    if (!this.isInsideTmux()) return false;
    const name = await this.getCurrentSessionName();
    return name === MAIN_SESSION;
  }

  /** Build the command string to launch the control panel process. */
  getControlPanelCommand(repoPath: string): string {
    const bin = process.argv[1]!;
    return `node ${JSON.stringify(bin)} _control-panel --cwd ${JSON.stringify(repoPath)}`;
  }

  // ── Session-level operations (kept for compatibility) ────────────

  /** Check whether a named tmux session exists. */
  async hasSession(sessionName: string): Promise<boolean> {
    try {
      await execFileAsync('tmux', ['has-session', '-t', sessionName]);
      return true;
    } catch {
      return false;
    }
  }

  /** Kill a tmux session. */
  async killSession(sessionName: string): Promise<void> {
    try {
      await execFileAsync('tmux', ['kill-session', '-t', sessionName]);
    } catch {
      // Session may already be dead
    }
  }

  /**
   * Attach the current terminal to a tmux session (optionally at a specific window).
   * When already inside tmux, uses switch-client instead.
   * Blocks until the user detaches or the session ends.
   */
  attachSession(target: string): Promise<number> {
    const isNested = this.isInsideTmux();
    const cmd = isNested ? 'switch-client' : 'attach-session';
    const args = isNested ? [cmd, '-t', target] : [cmd, '-t', target];

    return new Promise((resolve, reject) => {
      const child = nodeSpawn('tmux', args, {
        stdio: 'inherit',
      });

      child.on('error', reject);
      child.on('close', (code) => {
        resolve(code ?? 0);
      });
    });
  }

  /** @deprecated Use spawnClaudeInWindow instead. */
  async createSession(options: SpawnOptions): Promise<void> {
    const { sessionName, command, args, cwd } = options;
    const fullCommand = [command, ...args].join(' ');

    await execFileAsync('tmux', ['new-session', '-d', '-s', sessionName, '-c', cwd, fullCommand]);
  }

  /** @deprecated Use spawnClaudeInWindow instead. */
  async spawnClaude(sessionName: string, cwd: string, taskDescription: string): Promise<void> {
    await this.createSession({
      sessionName,
      command: 'claude',
      args: [taskDescription],
      cwd,
    });
  }

  /** @deprecated No longer needed with native tmux windows. */
  async captureOutput(sessionName: string, scrollbackLines = 500): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('tmux', [
        'capture-pane',
        '-t',
        sessionName,
        '-p',
        '-S',
        `-${scrollbackLines}`,
      ]);
      return stdout.split('\n');
    } catch {
      return [];
    }
  }

  /** @deprecated No longer needed with native tmux windows. */
  async sendKeys(sessionName: string, keys: string): Promise<void> {
    await execFileAsync('tmux', ['send-keys', '-t', sessionName, keys]);
  }

  /** @deprecated No longer needed with native tmux windows. */
  async sendLine(sessionName: string, text: string): Promise<void> {
    await execFileAsync('tmux', ['send-keys', '-t', sessionName, text, 'Enter']);
  }

  /** List all source-verse tmux sessions (those starting with "sv-"). */
  async listSessions(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('tmux', ['list-sessions', '-F', '#{session_name}']);
      return stdout
        .trim()
        .split('\n')
        .filter((name) => name.startsWith('sv-'));
    } catch {
      return [];
    }
  }
}
