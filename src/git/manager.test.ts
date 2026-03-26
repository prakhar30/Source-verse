import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitManager } from './manager.js';

vi.mock('./exec.js', () => ({
  execGit: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
}));

vi.mock('../platform/copy.js', () => ({
  cloneRepoDir: vi.fn().mockResolvedValue(undefined),
  copyBuildCaches: vi.fn().mockResolvedValue({ dirs: [], reflink: false }),
  moveToTrash: vi.fn().mockResolvedValue(undefined),
  warmDiskCache: vi.fn(),
}));

import { execGit } from './exec.js';
import { readdir, stat } from 'node:fs/promises';
import { cloneRepoDir, moveToTrash } from '../platform/copy.js';

const mockExecGit = vi.mocked(execGit);
const mockReaddir = vi.mocked(readdir);
const mockStat = vi.mocked(stat);
const mockCloneRepoDir = vi.mocked(cloneRepoDir);
const mockMoveToTrash = vi.mocked(moveToTrash);

describe('GitManager', () => {
  let manager: GitManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new GitManager('/home/user/projects/my-app');
    // Default: no clones on filesystem
    mockReaddir.mockResolvedValue([]);
    mockStat.mockRejectedValue(new Error('ENOENT'));
  });

  describe('getDefaultBranch', () => {
    it('returns "main" when main branch exists', async () => {
      mockExecGit.mockResolvedValueOnce('  main\n');
      const result = await manager.getDefaultBranch();
      expect(result).toBe('main');
    });

    it('returns "master" when only master exists', async () => {
      mockExecGit.mockResolvedValueOnce('  master\n');
      const result = await manager.getDefaultBranch();
      expect(result).toBe('master');
    });

    it('prefers "main" when both exist', async () => {
      mockExecGit.mockResolvedValueOnce('  main\n  master\n');
      const result = await manager.getDefaultBranch();
      expect(result).toBe('main');
    });

    it('throws when neither main nor master exists', async () => {
      mockExecGit.mockResolvedValueOnce('\n');
      await expect(manager.getDefaultBranch()).rejects.toThrow('Could not detect default branch');
    });
  });

  describe('createWorktree', () => {
    it('creates worktree at correct path with branch from origin/main', async () => {
      mockExecGit
        .mockResolvedValueOnce('  main\n') // getDefaultBranch
        .mockResolvedValueOnce('') // fetch origin main
        .mockResolvedValueOnce('') // branch --list (assertBranchDoesNotExist)
        .mockResolvedValueOnce('worktree /home/user/projects/my-app\n\n') // worktree list (assertWorktreeDoesNotExist)
        .mockResolvedValueOnce(''); // worktree add

      const result = await manager.createWorktree('abc123', 'sv/fix-login');

      expect(result).toBe('/home/user/projects/my-app-sv-abc123');
      expect(mockExecGit).toHaveBeenCalledWith(
        [
          'worktree',
          'add',
          '-b',
          'sv/fix-login',
          '/home/user/projects/my-app-sv-abc123',
          'origin/main',
        ],
        '/home/user/projects/my-app',
      );
    });

    it('throws when branch already exists', async () => {
      mockExecGit
        .mockResolvedValueOnce('  main\n') // getDefaultBranch
        .mockResolvedValueOnce('') // fetch
        .mockResolvedValueOnce('  sv/fix-login\n'); // branch --list returns match

      await expect(manager.createWorktree('abc123', 'sv/fix-login')).rejects.toThrow(
        'Branch "sv/fix-login" already exists',
      );
    });

    it('throws when worktree path already exists', async () => {
      mockExecGit
        .mockResolvedValueOnce('  main\n') // getDefaultBranch
        .mockResolvedValueOnce('') // fetch
        .mockResolvedValueOnce('') // branch --list (no conflict)
        .mockResolvedValueOnce(
          'worktree /home/user/projects/my-app-sv-abc123\nbranch refs/heads/sv/old\n\n',
        ); // worktree list contains the path

      await expect(manager.createWorktree('abc123', 'sv/fix-login')).rejects.toThrow(
        'Worktree already exists',
      );
    });

    it('fetches latest default branch before creating', async () => {
      mockExecGit
        .mockResolvedValueOnce('  master\n') // getDefaultBranch
        .mockResolvedValueOnce('') // fetch origin master
        .mockResolvedValueOnce('') // branch --list
        .mockResolvedValueOnce('worktree /home/user/projects/my-app\n\n') // worktree list
        .mockResolvedValueOnce(''); // worktree add

      await manager.createWorktree('abc123', 'sv/fix-login');

      expect(mockExecGit).toHaveBeenCalledWith(
        ['fetch', 'origin', 'master'],
        '/home/user/projects/my-app',
      );
    });
  });

  describe('createWorktree with useApfsClone', () => {
    const cloneConfig = {
      cacheDirs: [],
      warmDiskCache: false,
      useApfsClone: true,
      fastTeardown: true,
      enableFsmonitor: true,
    };

    it('uses cloneRepoDir instead of git worktree add', async () => {
      mockExecGit
        .mockResolvedValueOnce('  main\n') // getDefaultBranch
        .mockResolvedValueOnce('') // fetch origin main
        .mockResolvedValueOnce('') // checkout -b in clone
        .mockResolvedValueOnce(''); // config core.fsmonitor

      // stat should throw ENOENT (path doesn't exist)
      mockStat.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await manager.createWorktree('1', 'sv/my-task', cloneConfig);

      expect(result).toBe('/home/user/projects/my-app-sv-1');
      expect(mockCloneRepoDir).toHaveBeenCalledWith(
        '/home/user/projects/my-app',
        '/home/user/projects/my-app-sv-1',
      );
      expect(mockExecGit).toHaveBeenCalledWith(
        ['checkout', '-b', 'sv/my-task', 'origin/main'],
        '/home/user/projects/my-app-sv-1',
      );
    });

    it('enables fsmonitor when configured', async () => {
      mockExecGit
        .mockResolvedValueOnce('  main\n') // getDefaultBranch
        .mockResolvedValueOnce('') // fetch
        .mockResolvedValueOnce('') // checkout -b
        .mockResolvedValueOnce(''); // config core.fsmonitor

      mockStat.mockRejectedValueOnce(new Error('ENOENT'));

      await manager.createWorktree('1', 'sv/my-task', cloneConfig);

      expect(mockExecGit).toHaveBeenCalledWith(
        ['config', 'core.fsmonitor', 'true'],
        '/home/user/projects/my-app-sv-1',
      );
    });

    it('does not enable fsmonitor when disabled', async () => {
      mockExecGit
        .mockResolvedValueOnce('  main\n') // getDefaultBranch
        .mockResolvedValueOnce('') // fetch
        .mockResolvedValueOnce(''); // checkout -b

      mockStat.mockRejectedValueOnce(new Error('ENOENT'));

      await manager.createWorktree('1', 'sv/my-task', {
        ...cloneConfig,
        enableFsmonitor: false,
      });

      expect(mockExecGit).not.toHaveBeenCalledWith(
        ['config', 'core.fsmonitor', 'true'],
        expect.anything(),
      );
    });

    it('throws when destination path already exists', async () => {
      mockExecGit
        .mockResolvedValueOnce('  main\n') // getDefaultBranch
        .mockResolvedValueOnce(''); // fetch

      // stat returns successfully (path exists)
      mockStat.mockResolvedValueOnce({ isDirectory: () => true } as never);

      await expect(manager.createWorktree('1', 'sv/my-task', cloneConfig)).rejects.toThrow(
        'Path already exists',
      );
    });
  });

  describe('removeWorktree', () => {
    it('removes worktree and deletes merged branch', async () => {
      mockExecGit
        .mockResolvedValueOnce(
          'worktree /home/user/projects/my-app-sv-abc123\nbranch refs/heads/sv/fix-login\n\n',
        )
        .mockResolvedValueOnce('') // worktree remove
        .mockResolvedValueOnce('  main\n') // getDefaultBranch (isBranchMerged)
        .mockResolvedValueOnce('  sv/fix-login\n  main\n') // branch --merged
        .mockResolvedValueOnce(''); // branch -d

      await manager.removeWorktree('abc123');

      expect(mockExecGit).toHaveBeenCalledWith(
        ['branch', '-d', 'sv/fix-login'],
        '/home/user/projects/my-app',
      );
    });

    it('force deletes unmerged branch when flag is set', async () => {
      mockExecGit
        .mockResolvedValueOnce(
          'worktree /home/user/projects/my-app-sv-abc123\nbranch refs/heads/sv/fix-login\n\n',
        )
        .mockResolvedValueOnce('') // worktree remove
        .mockResolvedValueOnce('  main\n') // getDefaultBranch
        .mockResolvedValueOnce('  main\n') // branch --merged (does not include sv/fix-login)
        .mockResolvedValueOnce(''); // branch -D

      await manager.removeWorktree('abc123', true);

      expect(mockExecGit).toHaveBeenCalledWith(
        ['branch', '-D', 'sv/fix-login'],
        '/home/user/projects/my-app',
      );
    });

    it('does not delete unmerged branch when force flag is false', async () => {
      mockExecGit
        .mockResolvedValueOnce(
          'worktree /home/user/projects/my-app-sv-abc123\nbranch refs/heads/sv/fix-login\n\n',
        )
        .mockResolvedValueOnce('') // worktree remove
        .mockResolvedValueOnce('  main\n') // getDefaultBranch
        .mockResolvedValueOnce('  main\n'); // branch --merged (not merged)

      await manager.removeWorktree('abc123');

      expect(mockExecGit).not.toHaveBeenCalledWith(
        expect.arrayContaining(['branch', '-d']),
        expect.anything(),
      );
      expect(mockExecGit).not.toHaveBeenCalledWith(
        expect.arrayContaining(['branch', '-D']),
        expect.anything(),
      );
    });
  });

  describe('removeWorktree with fastTeardown', () => {
    const fastConfig = {
      cacheDirs: [],
      warmDiskCache: false,
      useApfsClone: true,
      fastTeardown: true,
      enableFsmonitor: true,
    };

    it('uses moveToTrash for APFS clones', async () => {
      // isCloneDirectory check: .git is a directory
      mockStat.mockResolvedValueOnce({ isDirectory: () => true } as never);

      await manager.removeWorktree('abc123', false, fastConfig);

      expect(mockMoveToTrash).toHaveBeenCalledWith('/home/user/projects/my-app-sv-abc123');
      expect(mockExecGit).not.toHaveBeenCalledWith(
        expect.arrayContaining(['worktree', 'remove']),
        expect.anything(),
      );
    });

    it('falls back to git worktree remove for real worktrees', async () => {
      // isCloneDirectory check: .git is a file (worktree)
      mockStat.mockResolvedValueOnce({ isDirectory: () => false } as never);
      // findBranchForWorktree
      mockExecGit.mockResolvedValueOnce(
        'worktree /home/user/projects/my-app-sv-abc123\nbranch refs/heads/sv/fix\n\n',
      );
      // worktree remove
      mockExecGit.mockResolvedValueOnce('');
      // getDefaultBranch (isBranchMerged)
      mockExecGit.mockResolvedValueOnce('  main\n');
      // branch --merged
      mockExecGit.mockResolvedValueOnce('  main\n');

      await manager.removeWorktree('abc123', false, fastConfig);

      expect(mockMoveToTrash).not.toHaveBeenCalled();
      expect(mockExecGit).toHaveBeenCalledWith(
        ['worktree', 'remove', '--force', '/home/user/projects/my-app-sv-abc123'],
        '/home/user/projects/my-app',
      );
    });
  });

  describe('listWorktrees', () => {
    it('returns only source-verse managed worktrees', async () => {
      const porcelainOutput = [
        'worktree /home/user/projects/my-app',
        'HEAD abc1234',
        'branch refs/heads/main',
        '',
        'worktree /home/user/projects/my-app-sv-session1',
        'HEAD def5678',
        'branch refs/heads/sv/fix-login',
        '',
        'worktree /home/user/projects/other-project',
        'HEAD ghi9012',
        'branch refs/heads/feature/unrelated',
        '',
      ].join('\n');

      mockExecGit.mockResolvedValueOnce(porcelainOutput);

      const result = await manager.listWorktrees();

      expect(result).toEqual([
        {
          path: '/home/user/projects/my-app-sv-session1',
          branch: 'sv/fix-login',
          sessionId: 'session1',
        },
      ]);
    });

    it('returns empty array when no sv worktrees exist', async () => {
      const porcelainOutput = [
        'worktree /home/user/projects/my-app',
        'HEAD abc1234',
        'branch refs/heads/main',
        '',
      ].join('\n');

      mockExecGit.mockResolvedValueOnce(porcelainOutput);

      const result = await manager.listWorktrees();
      expect(result).toEqual([]);
    });

    it('handles multiple sv worktrees', async () => {
      const porcelainOutput = [
        'worktree /home/user/projects/my-app',
        'HEAD abc1234',
        'branch refs/heads/main',
        '',
        'worktree /home/user/projects/my-app-sv-s1',
        'HEAD def5678',
        'branch refs/heads/sv/task-one',
        '',
        'worktree /home/user/projects/my-app-sv-s2',
        'HEAD ghi9012',
        'branch refs/heads/sv/task-two',
        '',
      ].join('\n');

      mockExecGit.mockResolvedValueOnce(porcelainOutput);

      const result = await manager.listWorktrees();
      expect(result).toHaveLength(2);
      expect(result[0].sessionId).toBe('s1');
      expect(result[1].sessionId).toBe('s2');
    });

    it('includes APFS clones from filesystem scan', async () => {
      // git worktree list returns nothing
      mockExecGit.mockResolvedValueOnce(
        'worktree /home/user/projects/my-app\nHEAD abc\nbranch refs/heads/main\n\n',
      );

      // readdir returns a clone directory
      mockReaddir.mockResolvedValueOnce(['my-app-sv-5', 'other-dir'] as never);

      // isCloneDirectory: .git is a directory
      mockStat.mockResolvedValueOnce({ isDirectory: () => true } as never);

      // getBranchInClone
      mockExecGit.mockResolvedValueOnce('sv/cloned-task\n');

      const result = await manager.listWorktrees();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: '/home/user/projects/my-app-sv-5',
        branch: 'sv/cloned-task',
        sessionId: '5',
      });
    });

    it('deduplicates: git worktrees take precedence over clones', async () => {
      // git worktree list returns sv-1
      const porcelainOutput = [
        'worktree /home/user/projects/my-app',
        'HEAD abc1234',
        'branch refs/heads/main',
        '',
        'worktree /home/user/projects/my-app-sv-1',
        'HEAD def5678',
        'branch refs/heads/sv/task',
        '',
      ].join('\n');
      mockExecGit.mockResolvedValueOnce(porcelainOutput);

      // readdir also returns my-app-sv-1 (same directory)
      mockReaddir.mockResolvedValueOnce(['my-app-sv-1'] as never);
      mockStat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      mockExecGit.mockResolvedValueOnce('sv/task\n');

      const result = await manager.listWorktrees();

      // Should only have 1 entry, not 2
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('1');
    });
  });

  describe('fetchDefaultBranch', () => {
    it('fetches the default branch from origin', async () => {
      mockExecGit
        .mockResolvedValueOnce('  main\n') // getDefaultBranch
        .mockResolvedValueOnce(''); // fetch origin main

      await manager.fetchDefaultBranch();

      expect(mockExecGit).toHaveBeenCalledWith(
        ['fetch', 'origin', 'main'],
        '/home/user/projects/my-app',
      );
    });
  });

  describe('isBranchMerged', () => {
    it('returns true when branch is in merged list', async () => {
      mockExecGit
        .mockResolvedValueOnce('  main\n') // getDefaultBranch
        .mockResolvedValueOnce('  main\n  sv/fix-login\n'); // branch --merged

      const result = await manager.isBranchMerged('sv/fix-login');
      expect(result).toBe(true);
    });

    it('returns false when branch is not in merged list', async () => {
      mockExecGit
        .mockResolvedValueOnce('  main\n') // getDefaultBranch
        .mockResolvedValueOnce('  main\n'); // branch --merged

      const result = await manager.isBranchMerged('sv/fix-login');
      expect(result).toBe(false);
    });

    it('accepts optional cwd parameter', async () => {
      mockExecGit
        .mockResolvedValueOnce('  main\n') // getDefaultBranch
        .mockResolvedValueOnce('  main\n  sv/fix-login\n'); // branch --merged

      await manager.isBranchMerged('sv/fix-login', '/tmp/clone-dir');

      expect(mockExecGit).toHaveBeenCalledWith(['branch', '--merged', 'main'], '/tmp/clone-dir');
    });
  });

  describe('NFR-7 safety: original repo protection', () => {
    it('removeWorktree never targets the original repo path', async () => {
      const repoPath = '/home/user/projects/my-app';
      const guardedManager = new GitManager(repoPath);

      mockExecGit.mockResolvedValueOnce(''); // worktree list (findBranch)
      mockExecGit.mockResolvedValueOnce(''); // worktree remove

      await guardedManager.removeWorktree('test-session');
      expect(mockExecGit).toHaveBeenCalledWith(
        expect.arrayContaining(['worktree', 'remove']),
        repoPath,
      );
    });

    it('listWorktrees never returns the main worktree', async () => {
      const porcelainOutput = [
        'worktree /home/user/projects/my-app',
        'HEAD abc1234',
        'branch refs/heads/main',
        '',
        'worktree /home/user/projects/my-app-sv-1',
        'HEAD def5678',
        'branch refs/heads/sv/task',
        '',
      ].join('\n');

      mockExecGit.mockResolvedValueOnce(porcelainOutput);

      const result = await manager.listWorktrees();

      expect(result.every((w) => w.path !== '/home/user/projects/my-app')).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]!.sessionId).toBe('1');
    });

    it('listWorktrees filters out non-source-verse worktrees', async () => {
      const porcelainOutput = [
        'worktree /home/user/projects/my-app',
        'HEAD abc1234',
        'branch refs/heads/main',
        '',
        'worktree /home/user/projects/unrelated-worktree',
        'HEAD xyz9999',
        'branch refs/heads/feature/other',
        '',
        'worktree /home/user/projects/my-app-sv-42',
        'HEAD def5678',
        'branch refs/heads/sv/my-task',
        '',
      ].join('\n');

      mockExecGit.mockResolvedValueOnce(porcelainOutput);

      const result = await manager.listWorktrees();

      expect(result).toHaveLength(1);
      expect(result[0]!.sessionId).toBe('42');
      expect(result.find((w) => w.path === '/home/user/projects/my-app')).toBeUndefined();
      expect(
        result.find((w) => w.path === '/home/user/projects/unrelated-worktree'),
      ).toBeUndefined();
    });
  });

  describe('hasUnpushedCommits', () => {
    it('returns true when there are unpushed commits', async () => {
      mockExecGit.mockResolvedValueOnce('abc1234 some commit\n');

      const result = await manager.hasUnpushedCommits('sv/fix-login');
      expect(result).toBe(true);
      expect(mockExecGit).toHaveBeenCalledWith(
        ['log', 'origin/sv/fix-login..sv/fix-login', '--oneline'],
        '/home/user/projects/my-app',
      );
    });

    it('returns false when all commits are pushed', async () => {
      mockExecGit.mockResolvedValueOnce('');

      const result = await manager.hasUnpushedCommits('sv/fix-login');
      expect(result).toBe(false);
    });

    it('returns true when remote branch does not exist but local has commits', async () => {
      mockExecGit
        .mockRejectedValueOnce(new Error('unknown revision'))
        .mockResolvedValueOnce('abc1234 initial\n');

      const result = await manager.hasUnpushedCommits('sv/new-branch');
      expect(result).toBe(true);
    });

    it('returns false when branch does not exist at all', async () => {
      mockExecGit
        .mockRejectedValueOnce(new Error('unknown revision'))
        .mockRejectedValueOnce(new Error('unknown revision'));

      const result = await manager.hasUnpushedCommits('sv/nonexistent');
      expect(result).toBe(false);
    });

    it('accepts optional cwd parameter', async () => {
      mockExecGit.mockResolvedValueOnce('abc1234 some commit\n');

      await manager.hasUnpushedCommits('sv/fix-login', '/tmp/clone-dir');

      expect(mockExecGit).toHaveBeenCalledWith(
        ['log', 'origin/sv/fix-login..sv/fix-login', '--oneline'],
        '/tmp/clone-dir',
      );
    });
  });
});
