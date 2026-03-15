import { Command } from 'commander';
import { createRequire } from 'node:module';
import {
  handleNew,
  handleList,
  handleSwitch,
  handleStop,
  handleCleanup,
  handleStatus,
} from './commands.js';
import { startDashboard } from '../tui/dashboard.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

const WELCOME_MESSAGE = `
  source-verse — parallel Claude Code session manager

  No active sessions.

  Press [n] to create a new session
  or run: source-verse new "fix the login bug"
`;

export function createProgram(): Command {
  const program = new Command();

  program
    .name('source-verse')
    .description('Run multiple Claude Code sessions in parallel from a single terminal')
    .version(version, '-V, --version')
    .action(() => {
      console.log(WELCOME_MESSAGE);
    });

  program
    .command('dashboard')
    .description('Launch the interactive TUI dashboard')
    .action(() => {
      startDashboard();
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

  return program;
}
