import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { handleNew } from './commands.js';

const exec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout;
}

async function createTempRepo(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'sv-integration-'));
  const repoDir = join(tempDir, 'my-app');
  const bareDir = join(tempDir, 'origin.git');

  // Create a bare "remote" repo
  await git(['init', '--bare', bareDir], tempDir);

  // Clone it to get a proper repo with remote
  await git(['clone', bareDir, repoDir], tempDir);

  // Configure git user for commits
  await git(['config', 'user.email', 'test@test.com'], repoDir);
  await git(['config', 'user.name', 'Test'], repoDir);

  // Create initial commit on main
  await git(['checkout', '-b', 'main'], repoDir);
  await exec('touch', ['README.md'], { cwd: repoDir });
  await git(['add', 'README.md'], repoDir);
  await git(['commit', '-m', 'initial commit'], repoDir);
  await git(['push', '-u', 'origin', 'main'], repoDir);

  return repoDir;
}

describe('handleNew integration', () => {
  let repoDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    repoDir = await createTempRepo();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    // Clean up: temp dir is parent of parent (repoDir = tempDir/my-app)
    const tempDir = join(repoDir, '..');
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates a worktree and branch for a new task', async () => {
    await handleNew('fix the login bug', repoDir);

    const worktreePath = join(repoDir, '..', 'my-app-sv-1');
    expect(existsSync(worktreePath)).toBe(true);

    // Verify the branch exists
    const branches = await git(['branch', '--list', 'sv/fix-the-login-bug'], repoDir);
    expect(branches.trim()).toContain('sv/fix-the-login-bug');
  });

  it('prints success output with worktree path and branch name', async () => {
    await handleNew('add user auth', repoDir);

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Created worktree:');
    expect(output).toContain('my-app-sv-1');
    expect(output).toContain('Branched: sv/add-user-auth (from main)');
  });

  it('increments session id for subsequent tasks', async () => {
    await handleNew('first task', repoDir);
    await handleNew('second task', repoDir);

    const worktree1 = join(repoDir, '..', 'my-app-sv-1');
    const worktree2 = join(repoDir, '..', 'my-app-sv-2');
    expect(existsSync(worktree1)).toBe(true);
    expect(existsSync(worktree2)).toBe(true);
  });

  it('throws when branch name already exists', async () => {
    await handleNew('duplicate task', repoDir);

    await expect(handleNew('duplicate task', repoDir)).rejects.toThrow(
      'Branch "sv/duplicate-task" already exists',
    );
  });

  it('worktree is checked out on the correct branch', async () => {
    await handleNew('my feature', repoDir);

    const worktreePath = join(repoDir, '..', 'my-app-sv-1');
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath);
    expect(branch.trim()).toBe('sv/my-feature');
  });

  it('worktree branch is based on latest origin/main', async () => {
    await handleNew('based on main', repoDir);

    const mainCommit = await git(['rev-parse', 'origin/main'], repoDir);
    const worktreeBase = await git(['merge-base', 'sv/based-on-main', 'origin/main'], repoDir);
    expect(worktreeBase.trim()).toBe(mainCommit.trim());
  });
});
