import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../git/manager.js', () => ({
  GitManager: vi.fn(),
}));

vi.mock('../git/slugify.js', () => ({
  slugifyTaskName: vi.fn(),
}));

import { handleNew } from './commands.js';
import { GitManager } from '../git/manager.js';
import { slugifyTaskName } from '../git/slugify.js';

const mockSlugify = vi.mocked(slugifyTaskName);
const MockGitManager = vi.mocked(GitManager);

function createMockManager() {
  return {
    listWorktrees: vi.fn(),
    createWorktree: vi.fn(),
    getDefaultBranch: vi.fn(),
    removeWorktree: vi.fn(),
    isBranchMerged: vi.fn(),
  };
}

describe('handleNew', () => {
  let mockManager: ReturnType<typeof createMockManager>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = createMockManager();
    MockGitManager.mockImplementation(() => mockManager as unknown as GitManager);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('creates worktree with slugified branch name', async () => {
    mockSlugify.mockReturnValue('sv/fix-login-bug');
    mockManager.listWorktrees.mockResolvedValue([]);
    mockManager.createWorktree.mockResolvedValue('/projects/my-app-sv-1');
    mockManager.getDefaultBranch.mockResolvedValue('main');

    await handleNew('fix login bug', '/projects/my-app');

    expect(mockSlugify).toHaveBeenCalledWith('fix login bug');
    expect(mockManager.createWorktree).toHaveBeenCalledWith('1', 'sv/fix-login-bug');
  });

  it('generates session id 1 when no existing worktrees', async () => {
    mockSlugify.mockReturnValue('sv/task');
    mockManager.listWorktrees.mockResolvedValue([]);
    mockManager.createWorktree.mockResolvedValue('/projects/app-sv-1');
    mockManager.getDefaultBranch.mockResolvedValue('main');

    await handleNew('task', '/projects/app');

    expect(mockManager.createWorktree).toHaveBeenCalledWith('1', 'sv/task');
  });

  it('increments session id based on existing worktrees', async () => {
    mockSlugify.mockReturnValue('sv/new-task');
    mockManager.listWorktrees.mockResolvedValue([
      { path: '/projects/app-sv-1', branch: 'sv/old', sessionId: '1' },
      { path: '/projects/app-sv-3', branch: 'sv/other', sessionId: '3' },
    ]);
    mockManager.createWorktree.mockResolvedValue('/projects/app-sv-4');
    mockManager.getDefaultBranch.mockResolvedValue('main');

    await handleNew('new task', '/projects/app');

    expect(mockManager.createWorktree).toHaveBeenCalledWith('4', 'sv/new-task');
  });

  it('prints success message with worktree path and branch', async () => {
    mockSlugify.mockReturnValue('sv/fix-login-bug');
    mockManager.listWorktrees.mockResolvedValue([]);
    mockManager.createWorktree.mockResolvedValue('/projects/my-app-sv-1');
    mockManager.getDefaultBranch.mockResolvedValue('main');

    await handleNew('fix login bug', '/projects/my-app');

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Created worktree: /projects/my-app-sv-1');
    expect(output).toContain('Branched: sv/fix-login-bug (from main)');
  });

  it('prints correct default branch in success message', async () => {
    mockSlugify.mockReturnValue('sv/task');
    mockManager.listWorktrees.mockResolvedValue([]);
    mockManager.createWorktree.mockResolvedValue('/projects/app-sv-1');
    mockManager.getDefaultBranch.mockResolvedValue('master');

    await handleNew('task', '/projects/app');

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('(from master)');
  });

  it('propagates errors from GitManager', async () => {
    mockSlugify.mockReturnValue('sv/task');
    mockManager.listWorktrees.mockResolvedValue([]);
    mockManager.createWorktree.mockRejectedValue(new Error('Branch "sv/task" already exists.'));

    await expect(handleNew('task', '/projects/app')).rejects.toThrow(
      'Branch "sv/task" already exists.',
    );
  });

  it('propagates errors from slugifyTaskName', async () => {
    mockSlugify.mockImplementation(() => {
      throw new Error('Task description cannot be empty');
    });

    await expect(handleNew('', '/projects/app')).rejects.toThrow(
      'Task description cannot be empty',
    );
  });
});
