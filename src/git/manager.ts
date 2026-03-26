import { basename, join, resolve, dirname } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { execGit } from './exec.js';
import { cloneRepoDir, copyBuildCaches, moveToTrash, warmDiskCache } from '../platform/copy.js';
import type { WorktreeConfig } from '../config/types.js';

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

  async createWorktree(
    sessionId: string,
    branchName: string,
    worktreeConfig?: WorktreeConfig,
  ): Promise<string> {
    if (worktreeConfig?.useApfsClone) {
      return this.createViaClone(sessionId, branchName, worktreeConfig);
    }

    return this.createViaGitWorktree(sessionId, branchName, worktreeConfig);
  }

  async removeWorktree(
    sessionId: string,
    forceDeleteBranch = false,
    worktreeConfig?: WorktreeConfig,
  ): Promise<void> {
    const worktreePath = this.buildWorktreePath(sessionId);
    this.assertSafePath(worktreePath);

    if (worktreeConfig?.fastTeardown) {
      return this.removeViaTrash(worktreePath, sessionId, forceDeleteBranch);
    }

    return this.removeViaGitWorktree(worktreePath, forceDeleteBranch);
  }

  async listWorktrees(): Promise<WorktreeInfo[]> {
    const gitWorktrees = await this.listGitWorktrees();
    const clones = await this.scanForClones();

    // Deduplicate: git worktrees take precedence
    const gitPaths = new Set(gitWorktrees.map((w) => w.path));
    const uniqueClones = clones.filter((c) => !gitPaths.has(c.path));

    return [...gitWorktrees, ...uniqueClones];
  }

  async fetchDefaultBranch(): Promise<void> {
    const defaultBranch = await this.getDefaultBranch();
    await execGit(['fetch', 'origin', defaultBranch], this.repoPath);
  }

  async isBranchMerged(branchName: string, cwd?: string): Promise<boolean> {
    const repoPath = cwd ?? this.repoPath;
    const defaultBranch = await this.getDefaultBranch();
    const output = await execGit(['branch', '--merged', defaultBranch], repoPath);
    const mergedBranches = output
      .split('\n')
      .map((line) => line.replace(/^\*?\s+/, '').trim())
      .filter(Boolean);

    return mergedBranches.includes(branchName);
  }

  async hasUnpushedCommits(branchName: string, cwd?: string): Promise<boolean> {
    const repoPath = cwd ?? this.repoPath;
    try {
      const output = await execGit(
        ['log', `origin/${branchName}..${branchName}`, '--oneline'],
        repoPath,
      );
      return output.trim().length > 0;
    } catch {
      try {
        const output = await execGit(['log', branchName, '--oneline', '-1'], repoPath);
        return output.trim().length > 0;
      } catch {
        return false;
      }
    }
  }

  // ── Private: creation strategies ─────────────────────────────────

  private async createViaClone(
    sessionId: string,
    branchName: string,
    config: WorktreeConfig,
  ): Promise<string> {
    const worktreePath = this.buildWorktreePath(sessionId);
    const defaultBranch = await this.getDefaultBranch();

    await execGit(['fetch', 'origin', defaultBranch], this.repoPath);
    await this.assertPathDoesNotExist(worktreePath);

    await cloneRepoDir(this.repoPath, worktreePath);
    await execGit(['checkout', '-b', branchName, `origin/${defaultBranch}`], worktreePath);

    if (config.enableFsmonitor) {
      await execGit(['config', 'core.fsmonitor', 'true'], worktreePath);
    }

    return worktreePath;
  }

  private async createViaGitWorktree(
    sessionId: string,
    branchName: string,
    worktreeConfig?: WorktreeConfig,
  ): Promise<string> {
    const worktreePath = this.buildWorktreePath(sessionId);
    const defaultBranch = await this.getDefaultBranch();

    await execGit(['fetch', 'origin', defaultBranch], this.repoPath);
    await this.assertBranchDoesNotExist(branchName);
    await this.assertWorktreeDoesNotExist(worktreePath);

    await execGit(
      ['worktree', 'add', '-b', branchName, worktreePath, `origin/${defaultBranch}`],
      this.repoPath,
    );

    if (worktreeConfig?.cacheDirs && worktreeConfig.cacheDirs.length > 0) {
      await copyBuildCaches(this.repoPath, worktreePath, worktreeConfig.cacheDirs);
    }

    if (worktreeConfig?.warmDiskCache) {
      warmDiskCache(worktreePath);
    }

    return worktreePath;
  }

  // ── Private: removal strategies ──────────────────────────────────

  private async removeViaTrash(
    worktreePath: string,
    sessionId: string,
    forceDeleteBranch: boolean,
  ): Promise<void> {
    const isClone = await this.isCloneDirectory(worktreePath);

    if (!isClone) {
      // Real git worktree — use the standard removal path
      return this.removeViaGitWorktree(worktreePath, forceDeleteBranch);
    }

    // APFS clone — mv to trash (branch only exists in the clone, no cleanup needed)
    await moveToTrash(worktreePath);
  }

  private async removeViaGitWorktree(
    worktreePath: string,
    forceDeleteBranch: boolean,
  ): Promise<void> {
    const branchName = await this.findBranchForWorktree(worktreePath);

    await execGit(['worktree', 'remove', '--force', worktreePath], this.repoPath);

    if (!branchName) return;

    const merged = await this.isBranchMerged(branchName);

    if (merged || forceDeleteBranch) {
      const deleteFlag = merged ? '-d' : '-D';
      await execGit(['branch', deleteFlag, branchName], this.repoPath);
    }
  }

  // ── Private: listing helpers ─────────────────────────────────────

  private async listGitWorktrees(): Promise<WorktreeInfo[]> {
    const output = await execGit(['worktree', 'list', '--porcelain'], this.repoPath);
    return this.parsePorcelainWorktrees(output);
  }

  private async scanForClones(): Promise<WorktreeInfo[]> {
    const repoName = basename(this.repoPath);
    const parentDir = dirname(this.repoPath);
    const svPattern = `${repoName}-sv-`;
    const results: WorktreeInfo[] = [];

    let entries: string[];
    try {
      entries = await readdir(parentDir);
    } catch {
      return results;
    }

    const candidates = entries.filter((name) => name.startsWith(svPattern));

    for (const name of candidates) {
      const candidatePath = resolve(parentDir, name);
      const isClone = await this.isCloneDirectory(candidatePath);
      if (!isClone) continue;

      const sessionId = name.slice(svPattern.length);
      const branch = await this.getBranchInClone(candidatePath);
      if (!branch) continue;

      results.push({ path: candidatePath, branch, sessionId });
    }

    return results;
  }

  // ── Private: utility methods ─────────────────────────────────────

  private buildWorktreePath(sessionId: string): string {
    const repoName = basename(this.repoPath);
    const parentDir = dirname(this.repoPath);
    return resolve(parentDir, `${repoName}-sv-${sessionId}`);
  }

  private assertSafePath(worktreePath: string): void {
    if (resolve(worktreePath) === resolve(this.repoPath)) {
      throw new Error(
        'Refusing to remove the original repository. This is a safety guard (NFR-7).',
      );
    }

    const repoName = basename(this.repoPath);
    const svPattern = `${repoName}-sv-`;
    if (!basename(worktreePath).startsWith(svPattern)) {
      throw new Error(
        `Refusing to remove path that does not match source-verse naming convention: ${worktreePath}`,
      );
    }
  }

  /**
   * Detect if a directory is an APFS clone (full .git directory) vs a git worktree (.git file).
   * Git worktrees have a `.git` file that points to the main repo's `.git/worktrees/` directory.
   * APFS clones have a full `.git` directory.
   */
  private async isCloneDirectory(dirPath: string): Promise<boolean> {
    try {
      const gitPath = join(dirPath, '.git');
      const s = await stat(gitPath);
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  private async getBranchInClone(clonePath: string): Promise<string | null> {
    try {
      const output = await execGit(['branch', '--show-current'], clonePath);
      return output.trim() || null;
    } catch {
      return null;
    }
  }

  private async assertPathDoesNotExist(targetPath: string): Promise<void> {
    try {
      await stat(targetPath);
      throw new Error(`Path already exists: "${targetPath}".`);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('Path already exists')) {
        throw error;
      }
      // ENOENT means path doesn't exist — that's what we want
    }
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
