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
    .command('new <task>')
    .description('Create a new session with the given task description')
    .action(async (task: string) => {
      await handleNew(task);
    });

  program
    .command('list')
    .description('List all active sessions with their status')
    .action(() => {
      handleList();
    });

  program
    .command('switch <id>')
    .description('Switch the terminal view to a specific session')
    .action((id: string) => {
      handleSwitch(id);
    });

  program
    .command('stop <id>')
    .description('Stop a session and optionally clean up its repo copy')
    .action((id: string) => {
      handleStop(id);
    });

  program
    .command('cleanup')
    .description('Remove all completed/merged session repo copies')
    .action(() => {
      handleCleanup();
    });

  program
    .command('status')
    .description('Show a summary of all sessions and their states')
    .action(() => {
      handleStatus();
    });

  return program;
}
