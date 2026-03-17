import { Command } from 'commander';
import { createRequire } from 'node:module';
import {
  handleNew,
  handleList,
  handleSwitch,
  handleStop,
  handleCleanup,
  handleStatus,
  handleRestart,
} from './commands.js';
import { startDashboard } from '../tui/dashboard.js';
import { SessionManager } from '../session/manager.js';
import { GitManager } from '../git/manager.js';
import { PtySpawner } from '../pty/spawner.js';
import { loadConfig } from '../config/loader.js';

const require = createRequire(import.meta.url);
const { version } = require('../../../package.json') as { version: string };

export function createProgram(): Command {
  const program = new Command();

  program
    .name('source-verse')
    .description('Run multiple Claude Code sessions in parallel from a single terminal')
    .version(version, '-V, --version')
    .action(async () => {
      const repoPath = process.cwd();
      const config = await loadConfig();
      await startDashboard({
        sessionManager: new SessionManager(),
        gitManager: new GitManager(repoPath),
        ptySpawner: new PtySpawner(),
        repoPath,
        mergeDetectionConfig: config.mergeDetection,
      });
    });

  program
    .command('new <task>')
    .description('Create a new session with the given task description')
    .action(async (task: string) => {
      await handleNew(task);
    });

  program
    .command('list')
    .description('List all active sessions with their status')
    .action(async () => {
      await handleList();
    });

  program
    .command('switch <id>')
    .description('Switch the terminal view to a specific session')
    .action(async (id: string) => {
      await handleSwitch(id);
    });

  program
    .command('stop <id>')
    .description('Stop a session and optionally clean up its repo copy')
    .option('--cleanup', 'Remove the worktree after stopping')
    .action(async (id: string, options: { cleanup?: boolean }) => {
      await handleStop(id, options);
    });

  program
    .command('cleanup')
    .description('Remove all completed/merged session repo copies')
    .action(async () => {
      await handleCleanup();
    });

  program
    .command('status')
    .description('Show a summary of all sessions and their states')
    .action(async () => {
      await handleStatus();
    });

  program
    .command('restart <id>')
    .description('Restart a crashed or completed session')
    .action(async (id: string) => {
      await handleRestart(id);
    });

  return program;
}
