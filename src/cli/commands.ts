import { GitManager } from '../git/manager.js';
import { slugifyTaskName } from '../git/slugify.js';


async function generateSessionId(gitManager: GitManager): Promise<string> {
  const existing = await gitManager.listWorktrees();
  const usedIds = existing.map((worktree) => Number(worktree.sessionId)).filter(Number.isFinite);
  const nextId = usedIds.length > 0 ? Math.max(...usedIds) + 1 : 1;
  return String(nextId);
}

export async function handleNew(task: string, repoPath = process.cwd()): Promise<void> {
  const gitManager = new GitManager(repoPath);
  const branchName = slugifyTaskName(task);
  const sessionId = await generateSessionId(gitManager);

  const worktreePath = await gitManager.createWorktree(sessionId, branchName);
  const defaultBranch = await gitManager.getDefaultBranch();

  console.log('');
  console.log(`  ✓ Created worktree: ${worktreePath}`);
  console.log(`  ✓ Branched: ${branchName} (from ${defaultBranch})`);
  console.log('');
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
