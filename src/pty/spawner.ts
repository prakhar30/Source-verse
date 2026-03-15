import * as nodePty from 'node-pty';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PtyHandle, SpawnOptions } from './types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class PtySpawner {
  spawn(options: SpawnOptions): PtyHandle {
    const { command, args, cwd, cols = DEFAULT_COLS, rows = DEFAULT_ROWS, env } = options;

    const ptyProcess = nodePty.spawn(command, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: env ?? (process.env as Record<string, string>),
    });

    return {
      pid: ptyProcess.pid,

      onData(callback: (data: string) => void): void {
        ptyProcess.onData(callback);
      },

      onExit(callback: (exitCode: number, signal?: number) => void): void {
        ptyProcess.onExit(({ exitCode, signal }) => {
          callback(exitCode, signal);
        });
      },

      write(data: string): void {
        ptyProcess.write(data);
      },

      resize(newCols: number, newRows: number): void {
        ptyProcess.resize(newCols, newRows);
      },

      kill(): void {
        ptyProcess.kill();
      },
    };
  }

  spawnClaude(cwd: string, taskDescription: string): PtyHandle {
    return this.spawn({
      command: 'claude',
      args: [taskDescription],
      cwd,
      cols: process.stdout.columns ?? DEFAULT_COLS,
      rows: process.stdout.rows ?? DEFAULT_ROWS,
    });
  }

  async isCommandAvailable(command: string): Promise<boolean> {
    try {
      await execFileAsync('which', [command]);
      return true;
    } catch {
      return false;
    }
  }
}
