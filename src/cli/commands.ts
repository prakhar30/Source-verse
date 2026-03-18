import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitManager } from '../git/manager.js';
import { slugifyTaskName } from '../git/slugify.js';
import { SessionManager } from '../session/manager.js';
import { TmuxSpawner, MAIN_SESSION } from '../pty/spawner.js';
import type { Session, SessionStatus } from '../session/types.js';
import { runPreflight } from '../preflight/checks.js';

const execFileAsync = promisify(execFile);

async function generateSessionId(gitManager: GitManager): Promise<string> {
  const existing = await gitManager.listWorktrees();
  const usedIds = existing.map((worktree) => Number(worktree.sessionId)).filter(Number.isFinite);
  const nextId = usedIds.length > 0 ? Math.max(...usedIds) + 1 : 1;
  return String(nextId);
}

function tmuxName(sessionId: string): string {
  return `sv-${sessionId}`;
}

export async function handleNew(
  task: string,
  repoPath = process.cwd(),
  deps: {
    gitManager?: GitManager;
    sessionManager?: SessionManager;
    tmuxSpawner?: TmuxSpawner;
    skipPreflight?: boolean;
  } = {},
): Promise<void> {
  if (!deps.skipPreflight) {
    const preflight = await runPreflight(repoPath);
    if (!preflight.ok) {
      for (const error of preflight.errors) {
        console.error(`  Error: ${error.message}`);
      }
      process.exitCode = 1;
      return;
    }
    for (const warning of preflight.warnings) {
      console.log(`  \u26a0 ${warning}`);
    }
  }

  const gitManager = deps.gitManager ?? new GitManager(repoPath);
  const sessionManager = deps.sessionManager ?? new SessionManager();
  const tmuxSpawner = deps.tmuxSpawner ?? new TmuxSpawner();

  const tmuxAvailable = await tmuxSpawner.isCommandAvailable('tmux');
  if (!tmuxAvailable) {
    console.error('  Error: tmux is not installed. Install it and try again.');
    console.error('    brew install tmux   (macOS)');
    console.error('    apt install tmux    (Debian/Ubuntu)');
    process.exitCode = 1;
    return;
  }

  const branchName = slugifyTaskName(task);
  const sessionId = await generateSessionId(gitManager);
  const sessionName = tmuxName(sessionId);

  const worktreePath = await gitManager.createWorktree(sessionId, branchName);
  const defaultBranch = await gitManager.getDefaultBranch();

  const session = await sessionManager.createSession(task, worktreePath, branchName, sessionName);

  console.log('');
  console.log(`  \u2713 Created worktree: ${worktreePath}`);
  console.log(`  \u2713 Branched: ${branchName} (from ${defaultBranch})`);
  console.log(`  \u2713 Session ${sessionId} created`);

  const claudeAvailable = await tmuxSpawner.isCommandAvailable('claude');

  if (!claudeAvailable) {
    console.log('');
    console.log('  \u26a0 Claude Code not found on PATH. Worktree is ready \u2014 run:');
    console.log(`    cd ${worktreePath}`);
    console.log('');
    return;
  }

  // Ensure sv-main exists
  const mainExists = await tmuxSpawner.hasMainSession();

  if (await tmuxSpawner.isInMainSession()) {
    // Inside sv-main: create window and switch to it
    await tmuxSpawner.spawnClaudeInWindow(sessionName, worktreePath, task);
    await sessionManager.updateStatus(session.id, 'running');
    console.log(`  \u2713 Started Claude Code in window "${sessionName}"`);
    console.log('');
    await tmuxSpawner.selectWindow(sessionName);
  } else if (mainExists) {
    // sv-main exists but we're outside it: add window, attach
    await tmuxSpawner.spawnClaudeInWindow(sessionName, worktreePath, task);
    await sessionManager.updateStatus(session.id, 'running');
    console.log(`  \u2713 Started Claude Code in window "${sessionName}"`);
    console.log('  Attaching to sv-main... (detach with Ctrl+b d)');
    console.log('');
    await tmuxSpawner.attachSession(`${MAIN_SESSION}:${sessionName}`);
  } else {
    // No sv-main: create it with control panel, then add session window
    const controlCmd = tmuxSpawner.getControlPanelCommand(repoPath);
    await tmuxSpawner.createMainSession(controlCmd, repoPath);
    await tmuxSpawner.spawnClaudeInWindow(sessionName, worktreePath, task);
    await sessionManager.updateStatus(session.id, 'running');
    console.log(`  \u2713 Started Claude Code in window "${sessionName}"`);
    console.log('  Attaching to sv-main... (detach with Ctrl+b d)');
    console.log('');
    await tmuxSpawner.attachSession(`${MAIN_SESSION}:${sessionName}`);
  }
}

const STATUS_COLORS: Record<SessionStatus, string> = {
  created: '\x1b[37m',
  running: '\x1b[32m',
  waiting: '\x1b[33m',
  done: '\x1b[37m',
  error: '\x1b[31m',
  merged: '\x1b[37m',
  cleaned_up: '\x1b[37m',
};
const RESET = '\x1b[0m';

const TASK_TRUNCATE_LENGTH = 40;

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '\u2026';
}

function formatElapsed(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function formatSessionTable(sessions: Session[]): string {
  const header = `${padRight('ID', 10)} ${padRight('Task', TASK_TRUNCATE_LENGTH + 2)} ${padRight('Status', 14)} ${padRight('Branch', 30)} ${padRight('Tmux', 10)} Elapsed`;
  const separator = '-'.repeat(header.length);
  const rows = sessions.map((session) => {
    const id = session.id.slice(0, 8);
    const task = truncate(session.taskDescription, TASK_TRUNCATE_LENGTH);
    const color = STATUS_COLORS[session.status];
    const status = `${color}${session.status}${RESET}`;
    const branch = session.branchName;
    const tmux = session.tmuxSessionName ?? '-';
    const elapsed = formatElapsed(session.createdAt);

    return `${padRight(id, 10)} ${padRight(task, TASK_TRUNCATE_LENGTH + 2)} ${padRight(status, 14 + color.length + RESET.length)} ${padRight(branch, 30)} ${padRight(tmux, 10)} ${elapsed}`;
  });

  return [header, separator, ...rows].join('\n');
}

export async function handleList(
  deps: {
    sessionManager?: SessionManager;
    tmuxSpawner?: TmuxSpawner;
  } = {},
): Promise<void> {
  const sessionManager = deps.sessionManager ?? new SessionManager();
  const tmuxSpawner = deps.tmuxSpawner ?? new TmuxSpawner();
  const sessions = await sessionManager.listSessions();

  if (sessions.length === 0) {
    console.log('');
    console.log('  No sessions found.');
    console.log('  Run `source-verse new "your task"` to create one.');
    console.log('');
    return;
  }

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

  console.log('');
  console.log(formatSessionTable(sessions));
  console.log('');
}

export async function handleSwitch(
  sessionId: string,
  deps: {
    sessionManager?: SessionManager;
    tmuxSpawner?: TmuxSpawner;
  } = {},
): Promise<void> {
  const sessionManager = deps.sessionManager ?? new SessionManager();
  const tmuxSpawner = deps.tmuxSpawner ?? new TmuxSpawner();

  const session = await sessionManager.getSession(sessionId);

  if (!session) {
    console.error(`  Error: Session not found: ${sessionId}`);
    process.exitCode = 1;
    return;
  }

  if (!session.tmuxSessionName) {
    console.error(`  Error: Session ${sessionId.slice(0, 8)} has no tmux session.`);
    process.exitCode = 1;
    return;
  }

  const alive = await tmuxSpawner.hasWindow(session.tmuxSessionName);
  if (!alive) {
    console.error(`  Error: Window "${session.tmuxSessionName}" is not running.`);
    console.error(`  Use \`source-verse restart ${sessionId.slice(0, 8)}\` to restart it.`);
    await sessionManager.updateStatus(session.id, 'done');
    process.exitCode = 1;
    return;
  }

  if (await tmuxSpawner.isInMainSession()) {
    // Inside sv-main: just switch window
    await tmuxSpawner.selectWindow(session.tmuxSessionName);
  } else {
    // Outside: attach to sv-main at the right window
    console.log(`  Attaching to session ${session.id.slice(0, 8)} (${session.branchName})...`);
    console.log('  Detach with Ctrl+b d');
    console.log('');
    await tmuxSpawner.attachSession(`${MAIN_SESSION}:${session.tmuxSessionName}`);
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(`${message} [y/N] `);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
    process.stdin.once('data', (data) => {
      process.stdin.pause();
      const answer = (data as unknown as string).toString().trim().toLowerCase();
      resolve(answer === 'y' || answer === 'yes');
    });
  });
}

export async function handleStop(
  sessionId: string,
  options: { cleanup?: boolean } = {},
  repoPath = process.cwd(),
  deps: {
    sessionManager?: SessionManager;
    gitManager?: GitManager;
    tmuxSpawner?: TmuxSpawner;
  } = {},
): Promise<void> {
  const sessionManager = deps.sessionManager ?? new SessionManager();
  const gitManager = deps.gitManager ?? new GitManager(repoPath);
  const tmuxSpawner = deps.tmuxSpawner ?? new TmuxSpawner();

  const session = await sessionManager.getSession(sessionId);

  if (!session) {
    console.error(`  Error: Session not found: ${sessionId}`);
    process.exitCode = 1;
    return;
  }

  // Kill tmux window if alive
  if (session.tmuxSessionName) {
    const alive = await tmuxSpawner.hasWindow(session.tmuxSessionName);
    if (alive) {
      await tmuxSpawner.killWindow(session.tmuxSessionName);
      console.log(`  \u2713 Killed window "${session.tmuxSessionName}"`);
    }
  }

  // Also kill PID if still running (belt and suspenders)
  if (session.pid !== null && isProcessRunning(session.pid)) {
    process.kill(session.pid, 'SIGTERM');
    console.log(`  \u2713 Stopped process (PID ${session.pid})`);
    await sessionManager.updatePid(session.id, null);
  }

  await sessionManager.updateStatus(session.id, 'done');
  console.log(`  \u2713 Session ${session.id.slice(0, 8)} status set to done`);

  let shouldCleanup = options.cleanup ?? false;

  if (!shouldCleanup && process.stdin.isTTY) {
    const isMerged = await gitManager.isBranchMerged(session.branchName).catch(() => false);
    const hasUnpushed = await gitManager.hasUnpushedCommits(session.branchName).catch(() => false);

    if (hasUnpushed) {
      console.log(`  \u26a0 Branch ${session.branchName} has unpushed commits.`);
    }
    if (!isMerged) {
      console.log(`  \u26a0 Branch ${session.branchName} has unmerged changes.`);
    }

    shouldCleanup = await confirmAction('  Remove worktree and clean up?');
  }

  if (shouldCleanup) {
    const worktrees = await gitManager.listWorktrees();
    const worktree = worktrees.find((w) => w.path === session.worktreePath);

    if (worktree) {
      await gitManager.removeWorktree(worktree.sessionId);
      console.log(`  \u2713 Removed worktree: ${session.worktreePath}`);
    }

    await sessionManager.updateStatus(session.id, 'cleaned_up');
    console.log(`  \u2713 Session ${session.id.slice(0, 8)} cleaned up`);
  }
}

const CLEANABLE_STATUSES: SessionStatus[] = ['done', 'merged'];
const ACTIVE_STATUSES: SessionStatus[] = ['running', 'waiting', 'created'];

export async function handleCleanup(
  repoPath = process.cwd(),
  deps: {
    sessionManager?: SessionManager;
    gitManager?: GitManager;
  } = {},
): Promise<void> {
  const sessionManager = deps.sessionManager ?? new SessionManager();
  const gitManager = deps.gitManager ?? new GitManager(repoPath);

  const sessions = await sessionManager.listSessions();

  const cleanable = sessions.filter((s) => CLEANABLE_STATUSES.includes(s.status));
  const skipped = sessions.filter((s) => ACTIVE_STATUSES.includes(s.status));

  if (cleanable.length === 0) {
    console.log('');
    console.log('  No sessions to clean up.');
    console.log('');
    return;
  }

  if (skipped.length > 0) {
    printSkippedWarnings(skipped);
  }

  await printCleanupPreview(cleanable);

  const confirmed = process.stdin.isTTY
    ? await confirmAction(`  Clean up ${cleanable.length} session(s)?`)
    : false;

  if (!confirmed) {
    console.log('  Cleanup cancelled.');
    return;
  }

  const freedSizes = await cleanupSessions(cleanable, sessionManager, gitManager);
  printCleanupSummary(cleanable.length, freedSizes);
}

function printSkippedWarnings(skipped: Session[]): void {
  for (const session of skipped) {
    console.log(
      `  \u26a0 Skipping ${session.id.slice(0, 8)} (${session.branchName}): status is ${session.status}`,
    );
  }
}

async function printCleanupPreview(cleanable: Session[]): Promise<void> {
  console.log('');
  console.log('  Sessions to clean up:');
  for (const session of cleanable) {
    const size = await getDirectorySize(session.worktreePath);
    console.log(
      `    ${session.id.slice(0, 8)} (${session.branchName}) \u2014 ${session.status} \u2014 ${size}`,
    );
  }
  console.log('');
}

async function cleanupSessions(
  sessions: Session[],
  sessionManager: SessionManager,
  gitManager: GitManager,
): Promise<string[]> {
  const worktrees = await gitManager.listWorktrees();
  const freedSizes: string[] = [];

  for (const session of sessions) {
    const size = await getDirectorySize(session.worktreePath);
    const worktree = worktrees.find((w) => w.path === session.worktreePath);

    if (worktree) {
      await gitManager.removeWorktree(worktree.sessionId);
      console.log(`  \u2713 Removed worktree: ${session.worktreePath}`);
    }

    await sessionManager.updateStatus(session.id, 'cleaned_up');
    freedSizes.push(size);
  }

  return freedSizes;
}

function printCleanupSummary(count: number, sizes: string[]): void {
  const totalDisplay = sizes.filter((s) => s !== 'N/A').join(' + ') || 'unknown';
  console.log('');
  console.log(`  \u2713 Cleaned up ${count} session(s). Freed: ${totalDisplay}`);
  console.log('');
}

async function getDirectorySize(dirPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('du', ['-sh', dirPath]);
    return stdout.split('\t')[0] ?? 'unknown';
  } catch {
    return 'N/A';
  }
}

async function getDirectorySizeBytes(dirPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('du', ['-sb', dirPath]);
    const bytes = Number(stdout.split('\t')[0]);
    return Number.isFinite(bytes) ? bytes : 0;
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return 'N/A';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)}${units[unitIndex]!}`;
}

export async function handleStatus(
  deps: {
    sessionManager?: SessionManager;
    tmuxSpawner?: TmuxSpawner;
  } = {},
): Promise<void> {
  const sessionManager = deps.sessionManager ?? new SessionManager();
  const tmuxSpawner = deps.tmuxSpawner ?? new TmuxSpawner();
  const sessions = await sessionManager.listSessions();

  if (sessions.length === 0) {
    console.log('');
    console.log('  No sessions found.');
    console.log('');
    return;
  }

  // Reconcile: check which windows are alive
  for (const session of sessions) {
    if (session.status === 'running' && session.tmuxSessionName) {
      const alive = await tmuxSpawner.hasWindow(session.tmuxSessionName);
      if (!alive) {
        await sessionManager.updateStatus(session.id, 'done');
        session.status = 'done';
      }
    }
  }

  const byStatus = new Map<SessionStatus, number>();
  for (const session of sessions) {
    byStatus.set(session.status, (byStatus.get(session.status) ?? 0) + 1);
  }

  console.log('');
  console.log(`  Total sessions: ${sessions.length}`);
  console.log('');

  for (const [status, count] of byStatus) {
    const color = STATUS_COLORS[status];
    console.log(`    ${color}${status}${RESET}: ${count}`);
  }

  console.log('');

  const activeSessions = sessions.filter(
    (s) => s.status !== 'cleaned_up' && s.status !== 'merged',
  );

  if (activeSessions.length > 0) {
    console.log('  Worktree disk usage:');
    let totalBytes = 0;
    for (const session of activeSessions) {
      const size = await getDirectorySize(session.worktreePath);
      const bytes = await getDirectorySizeBytes(session.worktreePath);
      totalBytes += bytes;
      console.log(`    ${session.id.slice(0, 8)} (${session.branchName}): ${size}`);
    }
    if (activeSessions.length > 1) {
      console.log(`    ${'\u2500'.repeat(20)}`);
      console.log(`    Total: ${formatBytes(totalBytes)}`);
    }
    console.log('');
  }
}

const RESTARTABLE_STATUSES: ReadonlySet<SessionStatus> = new Set(['error', 'done', 'created']);

export async function handleRestart(
  sessionId: string,
  deps: {
    sessionManager?: SessionManager;
    tmuxSpawner?: TmuxSpawner;
  } = {},
): Promise<void> {
  const sessionManager = deps.sessionManager ?? new SessionManager();
  const tmuxSpawner = deps.tmuxSpawner ?? new TmuxSpawner();

  const session = await sessionManager.getSession(sessionId);

  if (!session) {
    console.error(`  Error: Session not found: ${sessionId}`);
    process.exitCode = 1;
    return;
  }

  if (!RESTARTABLE_STATUSES.has(session.status)) {
    console.error(
      `  Error: Session ${sessionId.slice(0, 8)} cannot be restarted (status: ${session.status})`,
    );
    process.exitCode = 1;
    return;
  }

  const tmuxAvailable = await tmuxSpawner.isCommandAvailable('tmux');
  if (!tmuxAvailable) {
    console.error('  Error: tmux is not installed.');
    process.exitCode = 1;
    return;
  }

  const claudeAvailable = await tmuxSpawner.isCommandAvailable('claude');
  if (!claudeAvailable) {
    console.error('  Error: Claude Code not found on PATH.');
    process.exitCode = 1;
    return;
  }

  const sessionName = session.tmuxSessionName || tmuxName(sessionId.slice(0, 8));

  // Kill any lingering window with the same name
  await tmuxSpawner.killWindow(sessionName);

  console.log(`  Restarting session ${session.id.slice(0, 8)} (${session.branchName})...`);
  console.log('');

  // Ensure sv-main exists
  const mainExists = await tmuxSpawner.hasMainSession();
  if (!mainExists) {
    const controlCmd = tmuxSpawner.getControlPanelCommand(process.cwd());
    await tmuxSpawner.createMainSession(controlCmd, process.cwd());
  }

  await tmuxSpawner.spawnClaudeInWindow(sessionName, session.worktreePath, '--resume');
  await sessionManager.updateStatus(session.id, 'running');

  console.log(`  \u2713 Started Claude Code in window "${sessionName}"`);

  if (await tmuxSpawner.isInMainSession()) {
    await tmuxSpawner.selectWindow(sessionName);
  } else {
    console.log('  Attaching... (detach with Ctrl+b d)');
    console.log('');
    await tmuxSpawner.attachSession(`${MAIN_SESSION}:${sessionName}`);
  }
}
