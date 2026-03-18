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
  handleSuspendAll,
  handleResumeAll,
} from './commands.js';
import { startControlPanel } from '../tui/control-panel.js';
import { SessionManager } from '../session/manager.js';
import { GitManager } from '../git/manager.js';
import { TmuxSpawner, MAIN_SESSION } from '../pty/spawner.js';
import { loadConfig } from '../config/loader.js';

const require = createRequire(import.meta.url);
// Resolve package.json from both src/ (dev/test) and dist/ (production)
let version = '0.0.0';
try {
  version = (require('../../package.json') as { version: string }).version;
} catch {
  try {
    version = (require('../../../package.json') as { version: string }).version;
  } catch {
    // Fallback for test environments
  }
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('source-verse')
    .description('Run multiple Claude Code sessions in parallel from a single terminal')
    .version(version, '-V, --version')
    .action(async () => {
      const repoPath = process.cwd();
      const tmuxSpawner = new TmuxSpawner();

      const tmuxAvailable = await tmuxSpawner.isCommandAvailable('tmux');
      if (!tmuxAvailable) {
        console.error('  Error: tmux is not installed. Install it and try again.');
        console.error('    brew install tmux   (macOS)');
        console.error('    apt install tmux    (Debian/Ubuntu)');
        process.exitCode = 1;
        return;
      }

      const sessionExists = await tmuxSpawner.hasSession(MAIN_SESSION);

      if (sessionExists) {
        // Ensure control window exists (user may have closed it)
        const hasControl = await tmuxSpawner.hasWindow('control');
        if (!hasControl) {
          const controlCmd = tmuxSpawner.getControlPanelCommand(repoPath);
          await tmuxSpawner.createWindow('control', repoPath, controlCmd);
        }
        // Attach (or switch-client if already in tmux) to window 0
        await tmuxSpawner.attachSession(`${MAIN_SESSION}:control`);
      } else {
        // Create sv-main with the control panel in window 0
        const controlCmd = tmuxSpawner.getControlPanelCommand(repoPath);
        await tmuxSpawner.createMainSession(controlCmd, repoPath);
        await tmuxSpawner.attachSession(MAIN_SESSION);
      }
    });

  // Hidden command: runs the control panel TUI inside tmux window 0
  program
    .command('_control-panel', { hidden: true })
    .option('--cwd <path>', 'Working directory for the repo')
    .action(async (options: { cwd?: string }) => {
      const repoPath = options.cwd || process.cwd();
      const config = await loadConfig();
      await startControlPanel({
        sessionManager: new SessionManager(),
        gitManager: new GitManager(repoPath),
        tmuxSpawner: new TmuxSpawner(),
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

  program
    .command('suspend-all')
    .description('Gracefully suspend all running sessions')
    .action(async () => {
      await handleSuspendAll();
    });

  program
    .command('resume-all')
    .description('Resume all suspended sessions')
    .action(async () => {
      await handleResumeAll();
    });

  return program;
}
