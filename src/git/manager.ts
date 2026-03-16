import { basename, resolve, dirname } from 'node:path';
import { execGit } from './exec.js';

export interface WorktreeInfo {
  path: string;
  branch: string;
  sessionId: string;
}

export class GitManager {
  private readonly repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = resolve(repoPath);
  }

  async getDefaultBranch(): Promise<string> {
    const refs = await execGit(['branch', '--list', 'main', 'master'], this.repoPath);
    const branches = refs
      .split('\n')
      .map((line) => line.replace(/^\*?\s+/, '').trim())
      .filter(Boolean);

    if (branches.includes('main')) return 'main';
    if (branches.includes('master')) return 'master';

    throw new Error(
      'Could not detect default branch. Expected "main" or "master" to exist locally.',
    );
  }

  async createWorktree(sessionId: string, branchName: string): Promise<string> {
    const repoName = basename(this.repoPath);
    const parentDir = dirname(this.repoPath);
    const worktreePath = resolve(parentDir, `${repoName}-sv-${sessionId}`);

    const defaultBranch = await this.getDefaultBranch();

    await execGit(['fetch', 'origin', defaultBranch], this.repoPath);

    await this.assertBranchDoesNotExist(branchName);
    await this.assertWorktreeDoesNotExist(worktreePath);

    await execGit(
      ['worktree', 'add', '-b', branchName, worktreePath, `origin/${defaultBranch}`],
      this.repoPath,
    );

    return worktreePath;
  }

  async removeWorktree(sessionId: string, forceDeleteBranch = false): Promise<void> {
    const repoName = basename(this.repoPath);
    const parentDir = dirname(this.repoPath);
    const worktreePath = resolve(parentDir, `${repoName}-sv-${sessionId}`);

    await execGit(['worktree', 'remove', '--force', worktreePath], this.repoPath);

    const branchName = await this.findBranchForWorktree(worktreePath);
    if (!branchName) return;

    const merged = await this.isBranchMerged(branchName);

    if (merged || forceDeleteBranch) {
      const deleteFlag = merged ? '-d' : '-D';
      await execGit(['branch', deleteFlag, branchName], this.repoPath);
    }
  }

  async listWorktrees(): Promise<WorktreeInfo[]> {
    const output = await execGit(['worktree', 'list', '--porcelain'], this.repoPath);
    return this.parsePorcelainWorktrees(output);
  }

  async fetchDefaultBranch(): Promise<void> {
    const defaultBranch = await this.getDefaultBranch();
    await execGit(['fetch', 'origin', defaultBranch], this.repoPath);
  }

  async isBranchMerged(branchName: string): Promise<boolean> {
    const defaultBranch = await this.getDefaultBranch();
    const output = await execGit(['branch', '--merged', defaultBranch], this.repoPath);
    const mergedBranches = output
      .split('\n')
      .map((line) => line.replace(/^\*?\s+/, '').trim())
      .filter(Boolean);

    return mergedBranches.includes(branchName);
  }

  private async assertBranchDoesNotExist(branchName: string): Promise<void> {
    const output = await execGit(['branch', '--list', branchName], this.repoPath);
    if (output.trim()) {
      throw new Error(`Branch "${branchName}" already exists.`);
    }
  }

  private async assertWorktreeDoesNotExist(worktreePath: string): Promise<void> {
    const worktrees = await execGit(['worktree', 'list', '--porcelain'], this.repoPath);
    if (worktrees.includes(worktreePath)) {
      throw new Error(`Worktree already exists at "${worktreePath}".`);
    }
  }

  private async findBranchForWorktree(worktreePath: string): Promise<string | null> {
    const output = await execGit(['worktree', 'list', '--porcelain'], this.repoPath);
    const blocks = output.split('\n\n').filter(Boolean);

    for (const block of blocks) {
      if (block.includes(worktreePath)) {
        const branchLine = block.split('\n').find((line) => line.startsWith('branch '));
        if (branchLine) {
          return branchLine.replace('branch refs/heads/', '');
        }
      }
    }

    return null;
  }

  private parsePorcelainWorktrees(output: string): WorktreeInfo[] {
    const repoName = basename(this.repoPath);
    const svPattern = `${repoName}-sv-`;
    const blocks = output.split('\n\n').filter(Boolean);
    const results: WorktreeInfo[] = [];

    for (const block of blocks) {
      const lines = block.split('\n');
      const worktreeLine = lines.find((line) => line.startsWith('worktree '));
      const branchLine = lines.find((line) => line.startsWith('branch '));

      if (!worktreeLine || !branchLine) continue;

      const worktreePath = worktreeLine.replace('worktree ', '');
      const pathBase = basename(worktreePath);

      if (!pathBase.startsWith(svPattern)) continue;

      const sessionId = pathBase.slice(svPattern.length);
      const branch = branchLine.replace('branch refs/heads/', '');

      results.push({ path: worktreePath, branch, sessionId });
    }

    return results;
  }
}
