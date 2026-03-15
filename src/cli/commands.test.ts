import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../git/slugify.js', () => ({
  slugifyTaskName: vi.fn(),
}));

import { handleNew } from './commands.js';
import { slugifyTaskName } from '../git/slugify.js';

const mockSlugify = vi.mocked(slugifyTaskName);

function createMockGitManager() {
  return {
    listWorktrees: vi.fn(),
    createWorktree: vi.fn(),
    getDefaultBranch: vi.fn(),
    removeWorktree: vi.fn(),
    isBranchMerged: vi.fn(),
  };
}

function createMockSessionManager() {
  return {
    createSession: vi.fn(),
    getSession: vi.fn(),
    listSessions: vi.fn(),
    updateStatus: vi.fn(),
    updatePid: vi.fn(),
    removeSession: vi.fn(),
  };
}

function createMockPtySpawner() {
  return {
    isCommandAvailable: vi.fn(),
    spawnClaude: vi.fn(),
    spawn: vi.fn(),
  };
}

function createMockPtyHandle(overrides: Partial<ReturnType<typeof defaultPtyHandle>> = {}) {
  return { ...defaultPtyHandle(), ...overrides };
}

function defaultPtyHandle() {
  return {
    pid: 12345,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };
}

describe('handleNew', () => {
  let mockGitManager: ReturnType<typeof createMockGitManager>;
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockPtySpawner: ReturnType<typeof createMockPtySpawner>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGitManager = createMockGitManager();
    mockSessionManager = createMockSessionManager();
    mockPtySpawner = createMockPtySpawner();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  function callHandleNew(task: string, repoPath = '/projects/my-app') {
    return handleNew(task, repoPath, {
      gitManager: mockGitManager as never,
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });
  }

  function setupDefaults(claudeAvailable = false) {
    mockSlugify.mockReturnValue('sv/fix-login-bug');
    mockGitManager.listWorktrees.mockResolvedValue([]);
    mockGitManager.createWorktree.mockResolvedValue('/projects/my-app-sv-1');
    mockGitManager.getDefaultBranch.mockResolvedValue('main');
    mockSessionManager.createSession.mockResolvedValue({
      id: 'session-uuid',
      taskDescription: 'fix login bug',
      worktreePath: '/projects/my-app-sv-1',
      branchName: 'sv/fix-login-bug',
      status: 'created',
      pid: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mockSessionManager.updateStatus.mockResolvedValue({});
    mockSessionManager.updatePid.mockResolvedValue({});
    mockPtySpawner.isCommandAvailable.mockResolvedValue(claudeAvailable);
  }

  it('creates worktree with slugified branch name', async () => {
    setupDefaults();

    await callHandleNew('fix login bug');

    expect(mockSlugify).toHaveBeenCalledWith('fix login bug');
    expect(mockGitManager.createWorktree).toHaveBeenCalledWith('1', 'sv/fix-login-bug');
  });

  it('generates session id 1 when no existing worktrees', async () => {
    setupDefaults();

    await callHandleNew('task');

    expect(mockGitManager.createWorktree).toHaveBeenCalledWith('1', 'sv/fix-login-bug');
  });

  it('increments session id based on existing worktrees', async () => {
    setupDefaults();
    mockGitManager.listWorktrees.mockResolvedValue([
      { path: '/projects/app-sv-1', branch: 'sv/old', sessionId: '1' },
      { path: '/projects/app-sv-3', branch: 'sv/other', sessionId: '3' },
    ]);

    await callHandleNew('new task');

    expect(mockGitManager.createWorktree).toHaveBeenCalledWith('4', 'sv/fix-login-bug');
  });

  it('creates a session record after worktree creation', async () => {
    setupDefaults();

    await callHandleNew('fix login bug');

    expect(mockSessionManager.createSession).toHaveBeenCalledWith(
      'fix login bug',
      '/projects/my-app-sv-1',
      'sv/fix-login-bug',
    );
  });

  it('prints success message with worktree path, branch, and session', async () => {
    setupDefaults();

    await callHandleNew('fix login bug');

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Created worktree: /projects/my-app-sv-1');
    expect(output).toContain('Branched: sv/fix-login-bug (from main)');
    expect(output).toContain('Session 1 created');
  });

  it('prints correct default branch in success message', async () => {
    setupDefaults();
    mockGitManager.getDefaultBranch.mockResolvedValue('master');

    await callHandleNew('task');

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('(from master)');
  });

  describe('when claude is not available', () => {
    it('shows a helpful fallback message', async () => {
      setupDefaults(false);

      await callHandleNew('fix login bug');

      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(output).toContain('Claude Code not found on PATH');
      expect(output).toContain('cd /projects/my-app-sv-1');
    });

    it('does not spawn a PTY process', async () => {
      setupDefaults(false);

      await callHandleNew('fix login bug');

      expect(mockPtySpawner.spawnClaude).not.toHaveBeenCalled();
    });

    it('does not update session status to running', async () => {
      setupDefaults(false);

      await callHandleNew('fix login bug');

      expect(mockSessionManager.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('when claude is available', () => {
    it('spawns claude in the worktree directory', async () => {
      setupDefaults(true);
      const mockHandle = createMockPtyHandle();
      // Simulate immediate exit
      mockHandle.onExit.mockImplementation((cb: (code: number, signal?: number) => void) => {
        cb(0);
      });
      mockPtySpawner.spawnClaude.mockReturnValue(mockHandle);

      await callHandleNew('fix login bug');

      expect(mockPtySpawner.spawnClaude).toHaveBeenCalledWith(
        '/projects/my-app-sv-1',
        'fix login bug',
      );
    });

    it('updates session PID and status to running', async () => {
      setupDefaults(true);
      const mockHandle = createMockPtyHandle();
      mockHandle.onExit.mockImplementation((cb: (code: number, signal?: number) => void) => {
        cb(0);
      });
      mockPtySpawner.spawnClaude.mockReturnValue(mockHandle);

      await callHandleNew('fix login bug');

      expect(mockSessionManager.updatePid).toHaveBeenCalledWith('session-uuid', 12345);
      expect(mockSessionManager.updateStatus).toHaveBeenCalledWith('session-uuid', 'running');
    });

    it('prints started message with PID', async () => {
      setupDefaults(true);
      const mockHandle = createMockPtyHandle();
      mockHandle.onExit.mockImplementation((cb: (code: number, signal?: number) => void) => {
        cb(0);
      });
      mockPtySpawner.spawnClaude.mockReturnValue(mockHandle);

      await callHandleNew('fix login bug');

      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(output).toContain('Started Claude Code (PID 12345)');
    });

    it('clears PID and sets status to done on successful exit', async () => {
      setupDefaults(true);
      const mockHandle = createMockPtyHandle();
      mockHandle.onExit.mockImplementation((cb: (code: number, signal?: number) => void) => {
        cb(0);
      });
      mockPtySpawner.spawnClaude.mockReturnValue(mockHandle);

      await callHandleNew('fix login bug');

      // After exit: updatePid(null) and updateStatus('done')
      expect(mockSessionManager.updatePid).toHaveBeenCalledWith('session-uuid', null);
      expect(mockSessionManager.updateStatus).toHaveBeenCalledWith('session-uuid', 'done');
    });

    it('sets status to created on non-zero exit', async () => {
      setupDefaults(true);
      const mockHandle = createMockPtyHandle();
      mockHandle.onExit.mockImplementation((cb: (code: number, signal?: number) => void) => {
        cb(1);
      });
      mockPtySpawner.spawnClaude.mockReturnValue(mockHandle);

      await callHandleNew('fix login bug');

      expect(mockSessionManager.updateStatus).toHaveBeenCalledWith('session-uuid', 'created');
    });

    it('prints exit message with exit code', async () => {
      setupDefaults(true);
      const mockHandle = createMockPtyHandle();
      mockHandle.onExit.mockImplementation((cb: (code: number, signal?: number) => void) => {
        cb(0);
      });
      mockPtySpawner.spawnClaude.mockReturnValue(mockHandle);

      await callHandleNew('fix login bug');

      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(output).toContain('Claude Code exited (code 0)');
    });
  });

  it('propagates errors from GitManager', async () => {
    setupDefaults();
    mockGitManager.createWorktree.mockRejectedValue(new Error('Branch "sv/task" already exists.'));

    await expect(callHandleNew('task')).rejects.toThrow('Branch "sv/task" already exists.');
  });

  it('propagates errors from slugifyTaskName', async () => {
    mockSlugify.mockImplementation(() => {
      throw new Error('Task description cannot be empty');
    });

    await expect(callHandleNew('')).rejects.toThrow('Task description cannot be empty');
  });
});
