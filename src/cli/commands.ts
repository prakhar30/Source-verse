import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitManager } from '../git/manager.js';
import { slugifyTaskName } from '../git/slugify.js';
import { SessionManager } from '../session/manager.js';
import { PtySpawner } from '../pty/spawner.js';
import type { Session, SessionStatus } from '../session/types.js';
import { runPreflight } from '../preflight/checks.js';

const execFileAsync = promisify(execFile);

async function generateSessionId(gitManager: GitManager): Promise<string> {
  const existing = await gitManager.listWorktrees();
  const usedIds = existing.map((worktree) => Number(worktree.sessionId)).filter(Number.isFinite);
  const nextId = usedIds.length > 0 ? Math.max(...usedIds) + 1 : 1;
  return String(nextId);
}

function attachTerminal(handle: {
  onData: (cb: (data: string) => void) => void;
  write: (data: string) => void;
}): void {
  handle.onData((data) => {
    process.stdout.write(data);
  });

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', (data) => {
    handle.write(data.toString());
  });
}

function detachTerminal(): void {
  process.stdin.removeAllListeners('data');
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
}

export async function handleNew(
  task: string,
  repoPath = process.cwd(),
  deps: {
    gitManager?: GitManager;
    sessionManager?: SessionManager;
    ptySpawner?: PtySpawner;
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
      console.log(`  ⚠ ${warning}`);
    }
  }

  const gitManager = deps.gitManager ?? new GitManager(repoPath);
  const sessionManager = deps.sessionManager ?? new SessionManager();
  const ptySpawner = deps.ptySpawner ?? new PtySpawner();

  const branchName = slugifyTaskName(task);
  const sessionId = await generateSessionId(gitManager);

  const worktreePath = await gitManager.createWorktree(sessionId, branchName);
  const defaultBranch = await gitManager.getDefaultBranch();

  const session = await sessionManager.createSession(task, worktreePath, branchName);

  console.log('');
  console.log(`  ✓ Created worktree: ${worktreePath}`);
  console.log(`  ✓ Branched: ${branchName} (from ${defaultBranch})`);
  console.log(`  ✓ Session ${sessionId} created`);

  const claudeAvailable = await ptySpawner.isCommandAvailable('claude');

  if (!claudeAvailable) {
    console.log('');
    console.log('  ⚠ Claude Code not found on PATH. Worktree is ready — run:');
    console.log(`    cd ${worktreePath}`);
    console.log('');
    return;
  }

  const handle = ptySpawner.spawnClaude(worktreePath, task);

  await sessionManager.updatePid(session.id, handle.pid);
  await sessionManager.updateStatus(session.id, 'running');

  console.log(`  ✓ Started Claude Code (PID ${handle.pid})`);
  console.log('');

  attachTerminal(handle);

  await new Promise<void>((resolve) => {
    handle.onExit(async (exitCode) => {
      detachTerminal();
      await sessionManager.updatePid(session.id, null);
      await sessionManager.updateStatus(session.id, exitCode === 0 ? 'done' : 'created');
      console.log('');
      console.log(`  Claude Code exited (code ${exitCode})`);
      console.log('');
      resolve();
    });
  });
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
  return text.slice(0, maxLength - 1) + '…';
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
  const header = `${padRight('ID', 10)} ${padRight('Task', TASK_TRUNCATE_LENGTH + 2)} ${padRight('Status', 14)} ${padRight('Branch', 30)} Elapsed`;
  const separator = '-'.repeat(header.length);
  const rows = sessions.map((session) => {
    const id = session.id.slice(0, 8);
    const task = truncate(session.taskDescription, TASK_TRUNCATE_LENGTH);
    const color = STATUS_COLORS[session.status];
    const status = `${color}${session.status}${RESET}`;
    const branch = session.branchName;
    const elapsed = formatElapsed(session.createdAt);

    return `${padRight(id, 10)} ${padRight(task, TASK_TRUNCATE_LENGTH + 2)} ${padRight(status, 14 + color.length + RESET.length)} ${padRight(branch, 30)} ${elapsed}`;
  });

  return [header, separator, ...rows].join('\n');
}

export async function handleList(
  deps: {
    sessionManager?: SessionManager;
  } = {},
): Promise<void> {
  const sessionManager = deps.sessionManager ?? new SessionManager();
  const sessions = await sessionManager.listSessions();

  if (sessions.length === 0) {
    console.log('');
    console.log('  No sessions found.');
    console.log('  Run `source-verse new "your task"` to create one.');
    console.log('');
    return;
  }

  console.log('');
  console.log(formatSessionTable(sessions));
  console.log('');
}

export async function handleSwitch(
  sessionId: string,
  deps: {
    sessionManager?: SessionManager;
    ptySpawner?: PtySpawner;
  } = {},
): Promise<void> {
  const sessionManager = deps.sessionManager ?? new SessionManager();
  const ptySpawner = deps.ptySpawner ?? new PtySpawner();

  const session = await sessionManager.getSession(sessionId);

  if (!session) {
    console.error(`  Error: Session not found: ${sessionId}`);
    process.exitCode = 1;
    return;
  }

  if (session.status !== 'running' && session.status !== 'waiting') {
    console.error(`  Error: Session ${sessionId.slice(0, 8)} is not running (status: ${session.status})`);
    process.exitCode = 1;
    return;
  }

  const claudeAvailable = await ptySpawner.isCommandAvailable('claude');

  if (!claudeAvailable) {
    console.error('  Error: Claude Code not found on PATH.');
    process.exitCode = 1;
    return;
  }

  console.log(`  Attaching to session ${session.id.slice(0, 8)} (${session.branchName})...`);
  console.log('  Press Ctrl+C to detach.');
  console.log('');

  const handle = ptySpawner.spawnClaude(session.worktreePath, '--resume');

  await sessionManager.updatePid(session.id, handle.pid);

  attachTerminal(handle);

  await new Promise<void>((resolve) => {
    handle.onExit(async (exitCode) => {
      detachTerminal();
      await sessionManager.updatePid(session.id, null);
      await sessionManager.updateStatus(session.id, exitCode === 0 ? 'done' : session.status);
      console.log('');
      console.log(`  Detached from session ${session.id.slice(0, 8)} (exit code ${exitCode})`);
      console.log('');
      resolve();
    });
  });
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
  } = {},
): Promise<void> {
  const sessionManager = deps.sessionManager ?? new SessionManager();
  const gitManager = deps.gitManager ?? new GitManager(repoPath);

  const session = await sessionManager.getSession(sessionId);

  if (!session) {
    console.error(`  Error: Session not found: ${sessionId}`);
    process.exitCode = 1;
    return;
  }

  if (session.pid !== null && isProcessRunning(session.pid)) {
    process.kill(session.pid, 'SIGTERM');
    console.log(`  ✓ Stopped process (PID ${session.pid})`);
    await sessionManager.updatePid(session.id, null);
  } else if (session.status === 'running') {
    console.log('  Process is no longer running.');
  }

  await sessionManager.updateStatus(session.id, 'done');
  console.log(`  ✓ Session ${session.id.slice(0, 8)} status set to done`);

  let shouldCleanup = options.cleanup ?? false;

  if (!shouldCleanup && process.stdin.isTTY) {
    const isMerged = await gitManager.isBranchMerged(session.branchName).catch(() => false);
    const hasUnpushed = await gitManager.hasUnpushedCommits(session.branchName).catch(() => false);

    if (hasUnpushed) {
      console.log(`  ⚠ Branch ${session.branchName} has unpushed commits.`);
    }
    if (!isMerged) {
      console.log(`  ⚠ Branch ${session.branchName} has unmerged changes.`);
    }

    shouldCleanup = await confirmAction('  Remove worktree and clean up?');
  }

  if (shouldCleanup) {
    const worktrees = await gitManager.listWorktrees();
    const worktree = worktrees.find((w) => w.path === session.worktreePath);

    if (worktree) {
      await gitManager.removeWorktree(worktree.sessionId);
      console.log(`  ✓ Removed worktree: ${session.worktreePath}`);
    }

    await sessionManager.updateStatus(session.id, 'cleaned_up');
    console.log(`  ✓ Session ${session.id.slice(0, 8)} cleaned up`);
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
      `  ⚠ Skipping ${session.id.slice(0, 8)} (${session.branchName}): status is ${session.status}`,
    );
  }
}

async function printCleanupPreview(cleanable: Session[]): Promise<void> {
  console.log('');
  console.log('  Sessions to clean up:');
  for (const session of cleanable) {
    const size = await getDirectorySize(session.worktreePath);
    console.log(
      `    ${session.id.slice(0, 8)} (${session.branchName}) — ${session.status} — ${size}`,
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
      console.log(`  ✓ Removed worktree: ${session.worktreePath}`);
    }

    await sessionManager.updateStatus(session.id, 'cleaned_up');
    freedSizes.push(size);
  }

  return freedSizes;
}

function printCleanupSummary(count: number, sizes: string[]): void {
  const totalDisplay = sizes.filter((s) => s !== 'N/A').join(' + ') || 'unknown';
  console.log('');
  console.log(`  ✓ Cleaned up ${count} session(s). Freed: ${totalDisplay}`);
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
  } = {},
): Promise<void> {
  const sessionManager = deps.sessionManager ?? new SessionManager();
  const sessions = await sessionManager.listSessions();

  if (sessions.length === 0) {
    console.log('');
    console.log('  No sessions found.');
    console.log('');
    return;
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
      console.log(`    ${'─'.repeat(20)}`);
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
    ptySpawner?: PtySpawner;
  } = {},
): Promise<void> {
  const sessionManager = deps.sessionManager ?? new SessionManager();
  const ptySpawner = deps.ptySpawner ?? new PtySpawner();

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

  const claudeAvailable = await ptySpawner.isCommandAvailable('claude');

  if (!claudeAvailable) {
    console.error('  Error: Claude Code not found on PATH.');
    process.exitCode = 1;
    return;
  }

  console.log(`  Restarting session ${session.id.slice(0, 8)} (${session.branchName})...`);
  console.log('');

  const handle = ptySpawner.spawnClaude(session.worktreePath, '--resume');

  await sessionManager.updatePid(session.id, handle.pid);
  await sessionManager.updateStatus(session.id, 'running');

  attachTerminal(handle);

  await new Promise<void>((resolve) => {
    handle.onExit(async (exitCode) => {
      detachTerminal();
      await sessionManager.updatePid(session.id, null);
      await sessionManager.updateStatus(session.id, exitCode === 0 ? 'done' : 'error');
      console.log('');
      console.log(`  Claude Code exited (code ${exitCode})`);
      console.log('');
      resolve();
    });
  });
}
