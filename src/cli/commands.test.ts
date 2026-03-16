import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../git/slugify.js', () => ({
  slugifyTaskName: vi.fn(),
}));

import {
  handleNew,
  handleList,
  handleSwitch,
  handleStop,
  handleCleanup,
  handleStatus,
  handleRestart,
} from './commands.js';
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
      skipPreflight: true,
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

function createTestSession(overrides: Partial<{
  id: string;
  taskDescription: string;
  worktreePath: string;
  branchName: string;
  status: string;
  pid: number | null;
  createdAt: string;
  updatedAt: string;
}> = {}) {
  return {
    id: 'abcdef12-3456-7890-abcd-ef1234567890',
    taskDescription: 'fix login bug',
    worktreePath: '/projects/my-app-sv-1',
    branchName: 'sv/fix-login-bug',
    status: 'running',
    pid: 12345,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('handleList', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('shows helpful message when no sessions exist', async () => {
    mockSessionManager.listSessions.mockResolvedValue([]);

    await handleList({ sessionManager: mockSessionManager as never });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('No sessions found');
    expect(output).toContain('source-verse new');
  });

  it('displays session table with correct columns', async () => {
    const session = createTestSession();
    mockSessionManager.listSessions.mockResolvedValue([session]);

    await handleList({ sessionManager: mockSessionManager as never });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('ID');
    expect(output).toContain('Task');
    expect(output).toContain('Status');
    expect(output).toContain('Branch');
    expect(output).toContain('Elapsed');
    expect(output).toContain('abcdef12');
    expect(output).toContain('fix login bug');
    expect(output).toContain('sv/fix-login-bug');
  });

  it('truncates long task descriptions', async () => {
    const session = createTestSession({
      taskDescription: 'This is a very long task description that should be truncated at forty characters',
    });
    mockSessionManager.listSessions.mockResolvedValue([session]);

    await handleList({ sessionManager: mockSessionManager as never });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).not.toContain('that should be truncated at forty characters');
    expect(output).toContain('…');
  });

  it('color-codes running status in green', async () => {
    const session = createTestSession({ status: 'running' });
    mockSessionManager.listSessions.mockResolvedValue([session]);

    await handleList({ sessionManager: mockSessionManager as never });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('\x1b[32mrunning\x1b[0m');
  });

  it('color-codes waiting status in yellow', async () => {
    const session = createTestSession({ status: 'waiting' });
    mockSessionManager.listSessions.mockResolvedValue([session]);

    await handleList({ sessionManager: mockSessionManager as never });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('\x1b[33mwaiting\x1b[0m');
  });

  it('displays multiple sessions', async () => {
    const sessions = [
      createTestSession({ id: 'aaaa1111-0000-0000-0000-000000000000', taskDescription: 'task one' }),
      createTestSession({ id: 'bbbb2222-0000-0000-0000-000000000000', taskDescription: 'task two', status: 'done' }),
    ];
    mockSessionManager.listSessions.mockResolvedValue(sessions);

    await handleList({ sessionManager: mockSessionManager as never });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('aaaa1111');
    expect(output).toContain('bbbb2222');
    expect(output).toContain('task one');
    expect(output).toContain('task two');
  });
});

describe('handleSwitch', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockPtySpawner: ReturnType<typeof createMockPtySpawner>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
    mockPtySpawner = createMockPtySpawner();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  it('errors when session not found', async () => {
    mockSessionManager.getSession.mockResolvedValue(null);

    await handleSwitch('nonexistent', {
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });

    const output = consoleErrorSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Session not found');
    expect(process.exitCode).toBe(1);
  });

  it('errors when session is not running', async () => {
    mockSessionManager.getSession.mockResolvedValue(createTestSession({ status: 'done' }));

    await handleSwitch('abcdef12', {
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });

    const output = consoleErrorSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('is not running');
    expect(process.exitCode).toBe(1);
  });

  it('errors when claude is not available', async () => {
    mockSessionManager.getSession.mockResolvedValue(createTestSession({ status: 'running' }));
    mockPtySpawner.isCommandAvailable.mockResolvedValue(false);

    await handleSwitch('abcdef12', {
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });

    const output = consoleErrorSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Claude Code not found');
    expect(process.exitCode).toBe(1);
  });

  it('spawns claude and attaches terminal for running session', async () => {
    const session = createTestSession({ status: 'running' });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockPtySpawner.isCommandAvailable.mockResolvedValue(true);
    mockSessionManager.updatePid.mockResolvedValue({});
    mockSessionManager.updateStatus.mockResolvedValue({});

    const mockHandle = createMockPtyHandle();
    mockHandle.onExit.mockImplementation((cb: (code: number, signal?: number) => void) => {
      cb(0);
    });
    mockPtySpawner.spawnClaude.mockReturnValue(mockHandle);

    await handleSwitch(session.id, {
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });

    expect(mockPtySpawner.spawnClaude).toHaveBeenCalledWith(session.worktreePath, '--resume');
    expect(mockSessionManager.updatePid).toHaveBeenCalledWith(session.id, 12345);
  });

  it('allows switching to waiting sessions', async () => {
    const session = createTestSession({ status: 'waiting' });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockPtySpawner.isCommandAvailable.mockResolvedValue(true);
    mockSessionManager.updatePid.mockResolvedValue({});
    mockSessionManager.updateStatus.mockResolvedValue({});

    const mockHandle = createMockPtyHandle();
    mockHandle.onExit.mockImplementation((cb: (code: number, signal?: number) => void) => {
      cb(0);
    });
    mockPtySpawner.spawnClaude.mockReturnValue(mockHandle);

    await handleSwitch(session.id, {
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });

    expect(mockPtySpawner.spawnClaude).toHaveBeenCalled();
  });

  it('updates status to done on successful exit', async () => {
    const session = createTestSession({ status: 'running' });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockPtySpawner.isCommandAvailable.mockResolvedValue(true);
    mockSessionManager.updatePid.mockResolvedValue({});
    mockSessionManager.updateStatus.mockResolvedValue({});

    const mockHandle = createMockPtyHandle();
    mockHandle.onExit.mockImplementation((cb: (code: number, signal?: number) => void) => {
      cb(0);
    });
    mockPtySpawner.spawnClaude.mockReturnValue(mockHandle);

    await handleSwitch(session.id, {
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });

    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith(session.id, 'done');
    expect(mockSessionManager.updatePid).toHaveBeenCalledWith(session.id, null);
  });

  it('preserves original status on non-zero exit', async () => {
    const session = createTestSession({ status: 'running' });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockPtySpawner.isCommandAvailable.mockResolvedValue(true);
    mockSessionManager.updatePid.mockResolvedValue({});
    mockSessionManager.updateStatus.mockResolvedValue({});

    const mockHandle = createMockPtyHandle();
    mockHandle.onExit.mockImplementation((cb: (code: number, signal?: number) => void) => {
      cb(1);
    });
    mockPtySpawner.spawnClaude.mockReturnValue(mockHandle);

    await handleSwitch(session.id, {
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });

    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith(session.id, 'running');
  });
});

describe('handleStop', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockGitManager: ReturnType<typeof createMockGitManager>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
    mockGitManager = createMockGitManager();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  it('errors when session not found', async () => {
    mockSessionManager.getSession.mockResolvedValue(null);

    await handleStop('nonexistent', {}, '/projects/app', {
      sessionManager: mockSessionManager as never,
      gitManager: mockGitManager as never,
    });

    const output = consoleErrorSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Session not found');
    expect(process.exitCode).toBe(1);
  });

  it('updates session status to done', async () => {
    const session = createTestSession({ status: 'running', pid: null });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockSessionManager.updateStatus.mockResolvedValue({});

    await handleStop(session.id, {}, '/projects/app', {
      sessionManager: mockSessionManager as never,
      gitManager: mockGitManager as never,
    });

    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith(session.id, 'done');
  });

  it('cleans up worktree when --cleanup flag is set', async () => {
    const session = createTestSession({ status: 'running', pid: null });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockSessionManager.updateStatus.mockResolvedValue({});
    mockGitManager.listWorktrees.mockResolvedValue([
      { path: session.worktreePath, branch: session.branchName, sessionId: '1' },
    ]);
    mockGitManager.removeWorktree.mockResolvedValue(undefined);

    await handleStop(session.id, { cleanup: true }, '/projects/app', {
      sessionManager: mockSessionManager as never,
      gitManager: mockGitManager as never,
    });

    expect(mockGitManager.removeWorktree).toHaveBeenCalledWith('1');
    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith(session.id, 'cleaned_up');
  });

  it('prints message when process is no longer running', async () => {
    const session = createTestSession({ status: 'running', pid: null });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockSessionManager.updateStatus.mockResolvedValue({});

    await handleStop(session.id, {}, '/projects/app', {
      sessionManager: mockSessionManager as never,
      gitManager: mockGitManager as never,
    });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Process is no longer running');
  });
});

describe('handleCleanup', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockGitManager: ReturnType<typeof createMockGitManager>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
    mockGitManager = createMockGitManager();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    originalIsTTY = process.stdin.isTTY;
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true });
  });

  function callHandleCleanup() {
    return handleCleanup('/projects/app', {
      sessionManager: mockSessionManager as never,
      gitManager: mockGitManager as never,
    });
  }

  function simulateTTYConfirmation(answer: string) {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    const originalOnce = process.stdin.once.bind(process.stdin);
    vi.spyOn(process.stdin, 'once').mockImplementation(((event: string, cb: (data: string) => void) => {
      if (event === 'data') {
        cb(answer);
        return process.stdin;
      }
      return originalOnce(event, cb);
    }) as typeof process.stdin.once);
  }

  it('shows message when no sessions to clean up', async () => {
    mockSessionManager.listSessions.mockResolvedValue([]);

    await callHandleCleanup();

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('No sessions to clean up');
  });

  it('shows message when only cleaned_up sessions exist', async () => {
    mockSessionManager.listSessions.mockResolvedValue([
      createTestSession({ status: 'cleaned_up' }),
    ]);

    await callHandleCleanup();

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('No sessions to clean up');
  });

  it('warns about skipped active sessions', async () => {
    mockSessionManager.listSessions.mockResolvedValue([
      createTestSession({ id: 'running1-0000-0000-0000-000000000000', status: 'running', branchName: 'sv/active-task' }),
      createTestSession({ id: 'done1234-0000-0000-0000-000000000000', status: 'done', branchName: 'sv/finished-task' }),
    ]);
    mockSessionManager.updateStatus.mockResolvedValue({});
    mockGitManager.listWorktrees.mockResolvedValue([]);

    simulateTTYConfirmation('y');

    await callHandleCleanup();

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Skipping running1');
    expect(output).toContain('status is running');
  });

  it('shows preview of sessions to clean up', async () => {
    mockSessionManager.listSessions.mockResolvedValue([
      createTestSession({ id: 'done1234-0000-0000-0000-000000000000', status: 'done', branchName: 'sv/task-one' }),
    ]);
    mockSessionManager.updateStatus.mockResolvedValue({});
    mockGitManager.listWorktrees.mockResolvedValue([]);

    simulateTTYConfirmation('y');

    await callHandleCleanup();

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Sessions to clean up');
    expect(output).toContain('done1234');
    expect(output).toContain('sv/task-one');
  });

  it('cleans up done and merged sessions after confirmation', async () => {
    const doneSession = createTestSession({
      id: 'done1234-0000-0000-0000-000000000000',
      status: 'done',
      worktreePath: '/projects/app-sv-1',
    });
    const mergedSession = createTestSession({
      id: 'merged12-0000-0000-0000-000000000000',
      status: 'merged',
      worktreePath: '/projects/app-sv-2',
    });

    mockSessionManager.listSessions.mockResolvedValue([doneSession, mergedSession]);
    mockSessionManager.updateStatus.mockResolvedValue({});
    mockGitManager.listWorktrees.mockResolvedValue([
      { path: '/projects/app-sv-1', branch: 'sv/task-one', sessionId: '1' },
      { path: '/projects/app-sv-2', branch: 'sv/task-two', sessionId: '2' },
    ]);
    mockGitManager.removeWorktree.mockResolvedValue(undefined);

    simulateTTYConfirmation('y');

    await callHandleCleanup();

    expect(mockGitManager.removeWorktree).toHaveBeenCalledWith('1');
    expect(mockGitManager.removeWorktree).toHaveBeenCalledWith('2');
    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith(doneSession.id, 'cleaned_up');
    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith(mergedSession.id, 'cleaned_up');
  });

  it('cancels cleanup when user declines', async () => {
    mockSessionManager.listSessions.mockResolvedValue([
      createTestSession({ status: 'done' }),
    ]);

    simulateTTYConfirmation('n');

    await callHandleCleanup();

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Cleanup cancelled');
    expect(mockGitManager.removeWorktree).not.toHaveBeenCalled();
    expect(mockSessionManager.updateStatus).not.toHaveBeenCalled();
  });

  it('cancels cleanup when not a TTY', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true });
    mockSessionManager.listSessions.mockResolvedValue([
      createTestSession({ status: 'done' }),
    ]);

    await callHandleCleanup();

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Cleanup cancelled');
    expect(mockGitManager.removeWorktree).not.toHaveBeenCalled();
  });

  it('prints cleanup summary with freed space', async () => {
    mockSessionManager.listSessions.mockResolvedValue([
      createTestSession({ status: 'done', worktreePath: '/projects/app-sv-1' }),
    ]);
    mockSessionManager.updateStatus.mockResolvedValue({});
    mockGitManager.listWorktrees.mockResolvedValue([
      { path: '/projects/app-sv-1', branch: 'sv/task', sessionId: '1' },
    ]);
    mockGitManager.removeWorktree.mockResolvedValue(undefined);

    simulateTTYConfirmation('y');

    await callHandleCleanup();

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Cleaned up 1 session(s)');
    expect(output).toContain('Freed');
  });

  it('skips worktree removal when worktree not found but still updates status', async () => {
    const session = createTestSession({
      id: 'done1234-0000-0000-0000-000000000000',
      status: 'done',
      worktreePath: '/projects/app-sv-gone',
    });
    mockSessionManager.listSessions.mockResolvedValue([session]);
    mockSessionManager.updateStatus.mockResolvedValue({});
    mockGitManager.listWorktrees.mockResolvedValue([]);

    simulateTTYConfirmation('y');

    await callHandleCleanup();

    expect(mockGitManager.removeWorktree).not.toHaveBeenCalled();
    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith(session.id, 'cleaned_up');
  });
});

describe('handleStatus', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('shows helpful message when no sessions exist', async () => {
    mockSessionManager.listSessions.mockResolvedValue([]);

    await handleStatus({ sessionManager: mockSessionManager as never });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('No sessions found');
  });

  it('displays total session count', async () => {
    const sessions = [
      createTestSession({ id: 'aaa-1', status: 'running' }),
      createTestSession({ id: 'bbb-2', status: 'done' }),
    ];
    mockSessionManager.listSessions.mockResolvedValue(sessions);

    await handleStatus({ sessionManager: mockSessionManager as never });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Total sessions: 2');
  });

  it('displays status breakdown', async () => {
    const sessions = [
      createTestSession({ id: 'aaa-1', status: 'running' }),
      createTestSession({ id: 'bbb-2', status: 'running' }),
      createTestSession({ id: 'ccc-3', status: 'done' }),
    ];
    mockSessionManager.listSessions.mockResolvedValue(sessions);

    await handleStatus({ sessionManager: mockSessionManager as never });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('running');
    expect(output).toContain('2');
    expect(output).toContain('done');
    expect(output).toContain('1');
  });

  it('skips disk usage for cleaned_up and merged sessions', async () => {
    const sessions = [
      createTestSession({ id: 'aaa-1', status: 'cleaned_up', worktreePath: '/gone' }),
    ];
    mockSessionManager.listSessions.mockResolvedValue(sessions);

    await handleStatus({ sessionManager: mockSessionManager as never });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).not.toContain('Worktree disk usage');
  });
});

describe('handleRestart', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockPtySpawner: ReturnType<typeof createMockPtySpawner>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
    mockPtySpawner = createMockPtySpawner();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  it('errors when session not found', async () => {
    mockSessionManager.getSession.mockResolvedValue(null);

    await handleRestart('nonexistent', {
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });

    const output = consoleErrorSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Session not found');
    expect(process.exitCode).toBe(1);
  });

  it('errors when session is running', async () => {
    mockSessionManager.getSession.mockResolvedValue(createTestSession({ status: 'running' }));

    await handleRestart('abcdef12', {
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });

    const output = consoleErrorSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('cannot be restarted');
    expect(process.exitCode).toBe(1);
  });

  it('errors when session is cleaned_up', async () => {
    mockSessionManager.getSession.mockResolvedValue(createTestSession({ status: 'cleaned_up' }));

    await handleRestart('abcdef12', {
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });

    expect(process.exitCode).toBe(1);
  });

  it('errors when claude is not available', async () => {
    mockSessionManager.getSession.mockResolvedValue(createTestSession({ status: 'error' }));
    mockPtySpawner.isCommandAvailable.mockResolvedValue(false);

    await handleRestart('abcdef12', {
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });

    const output = consoleErrorSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Claude Code not found');
    expect(process.exitCode).toBe(1);
  });

  it('restarts an error session successfully', async () => {
    const session = createTestSession({ status: 'error' });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockPtySpawner.isCommandAvailable.mockResolvedValue(true);
    mockSessionManager.updatePid.mockResolvedValue({});
    mockSessionManager.updateStatus.mockResolvedValue({});

    const mockHandle = createMockPtyHandle();
    mockHandle.onExit.mockImplementation((cb: (code: number, signal?: number) => void) => {
      cb(0);
    });
    mockPtySpawner.spawnClaude.mockReturnValue(mockHandle);

    await handleRestart(session.id, {
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });

    expect(mockPtySpawner.spawnClaude).toHaveBeenCalledWith(session.worktreePath, '--resume');
    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith(session.id, 'running');
    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith(session.id, 'done');
  });

  it('restarts a done session successfully', async () => {
    const session = createTestSession({ status: 'done' });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockPtySpawner.isCommandAvailable.mockResolvedValue(true);
    mockSessionManager.updatePid.mockResolvedValue({});
    mockSessionManager.updateStatus.mockResolvedValue({});

    const mockHandle = createMockPtyHandle();
    mockHandle.onExit.mockImplementation((cb: (code: number, signal?: number) => void) => {
      cb(0);
    });
    mockPtySpawner.spawnClaude.mockReturnValue(mockHandle);

    await handleRestart(session.id, {
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });

    expect(mockPtySpawner.spawnClaude).toHaveBeenCalled();
  });

  it('sets status to error on non-zero exit', async () => {
    const session = createTestSession({ status: 'error' });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockPtySpawner.isCommandAvailable.mockResolvedValue(true);
    mockSessionManager.updatePid.mockResolvedValue({});
    mockSessionManager.updateStatus.mockResolvedValue({});

    const mockHandle = createMockPtyHandle();
    mockHandle.onExit.mockImplementation((cb: (code: number, signal?: number) => void) => {
      cb(1);
    });
    mockPtySpawner.spawnClaude.mockReturnValue(mockHandle);

    await handleRestart(session.id, {
      sessionManager: mockSessionManager as never,
      ptySpawner: mockPtySpawner as never,
    });

    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith(session.id, 'error');
  });
});
