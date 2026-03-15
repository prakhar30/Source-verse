import { GitManager } from '../git/manager.js';
import { slugifyTaskName } from '../git/slugify.js';
import { SessionManager } from '../session/manager.js';
import { PtySpawner } from '../pty/spawner.js';

async function generateSessionId(gitManager: GitManager): Promise<string> {
  const existing = await gitManager.listWorktrees();
  const usedIds = existing.map((worktree) => Number(worktree.sessionId)).filter(Number.isFinite);
  const nextId = usedIds.length > 0 ? Math.max(...usedIds) + 1 : 1;
  return String(nextId);
}

function attachTerminal(handle: { onData: (cb: (data: string) => void) => void }): void {
  handle.onData((data) => {
    process.stdout.write(data);
  });

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', (data) => {
    (handle as { write: (d: string) => void }).write(data.toString());
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
  } = {},
): Promise<void> {
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

export function handleList(): void {
  console.log('list: not implemented yet');
}

export function handleSwitch(sessionId: string): void {
  console.log(`switch: not implemented yet (session: ${sessionId})`);
}

export function handleStop(sessionId: string): void {
  console.log(`stop: not implemented yet (session: ${sessionId})`);
}

export function handleCleanup(): void {
  console.log('cleanup: not implemented yet');
}

export function handleStatus(): void {
  console.log('status: not implemented yet');
}
