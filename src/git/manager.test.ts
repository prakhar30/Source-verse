import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitManager } from './manager.js';

vi.mock('./exec.js', () => ({
  execGit: vi.fn(),
}));

import { execGit } from './exec.js';

const mockExecGit = vi.mocked(execGit);

describe('GitManager', () => {
  let manager: GitManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new GitManager('/home/user/projects/my-app');
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
        ['worktree', 'add', '-b', 'sv/fix-login', '/home/user/projects/my-app-sv-abc123', 'origin/main'],
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

  describe('removeWorktree', () => {
    it('removes worktree and deletes merged branch', async () => {
      mockExecGit
        .mockResolvedValueOnce('') // worktree remove
        .mockResolvedValueOnce( // worktree list (findBranchForWorktree)
          'worktree /home/user/projects/my-app-sv-abc123\nbranch refs/heads/sv/fix-login\n\n',
        )
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
        .mockResolvedValueOnce('') // worktree remove
        .mockResolvedValueOnce( // worktree list
          'worktree /home/user/projects/my-app-sv-abc123\nbranch refs/heads/sv/fix-login\n\n',
        )
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
        .mockResolvedValueOnce('') // worktree remove
        .mockResolvedValueOnce( // worktree list
          'worktree /home/user/projects/my-app-sv-abc123\nbranch refs/heads/sv/fix-login\n\n',
        )
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
        .mockRejectedValueOnce(new Error('unknown revision')) // origin/branch not found
        .mockResolvedValueOnce('abc1234 initial\n'); // local branch has commits

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
  });
});
