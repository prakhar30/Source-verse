import { execFile, spawn as nodeSpawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { SpawnOptions } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Manages Claude Code sessions inside tmux.
 *
 * Each session gets a named tmux session (e.g. sv-1) that persists
 * independently of this process. Output is captured via tmux capture-pane,
 * input is sent via tmux send-keys, and full attach is a plain tmux attach.
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

  /**
   * Create a new tmux session running the given command in the background.
   * The session persists even if this process exits.
   */
  async createSession(options: SpawnOptions): Promise<void> {
    const { sessionName, command, args, cwd } = options;
    const fullCommand = [command, ...args].join(' ');

    await execFileAsync('tmux', [
      'new-session',
      '-d',
      '-s',
      sessionName,
      '-c',
      cwd,
      fullCommand,
    ]);
  }

  /**
   * Create a tmux session that runs Claude Code with the given task.
   */
  async spawnClaude(sessionName: string, cwd: string, taskDescription: string): Promise<void> {
    await this.createSession({
      sessionName,
      command: 'claude',
      args: [taskDescription],
      cwd,
    });
  }

  /** Check whether a named tmux session exists. */
  async hasSession(sessionName: string): Promise<boolean> {
    try {
      await execFileAsync('tmux', ['has-session', '-t', sessionName]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Capture the visible pane content (plus scrollback) from a tmux session.
   * Returns an array of lines.
   */
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

  /** Send keystrokes to a tmux session. */
  async sendKeys(sessionName: string, keys: string): Promise<void> {
    await execFileAsync('tmux', ['send-keys', '-t', sessionName, keys]);
  }

  /** Send a line of text followed by Enter. */
  async sendLine(sessionName: string, text: string): Promise<void> {
    await execFileAsync('tmux', ['send-keys', '-t', sessionName, text, 'Enter']);
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
   * Attach the current terminal to a tmux session.
   * This blocks until the user detaches (Ctrl+b d) or the session ends.
   * Returns the exit code of the tmux attach process.
   */
  attachSession(sessionName: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = nodeSpawn('tmux', ['attach-session', '-t', sessionName], {
        stdio: 'inherit',
      });

      child.on('error', reject);
      child.on('close', (code) => {
        resolve(code ?? 0);
      });
    });
  }

  /** List all source-verse tmux sessions (those starting with "sv-"). */
  async listSessions(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('tmux', [
        'list-sessions',
        '-F',
        '#{session_name}',
      ]);
      return stdout
        .trim()
        .split('\n')
        .filter((name) => name.startsWith('sv-'));
    } catch {
      return [];
    }
  }
}
