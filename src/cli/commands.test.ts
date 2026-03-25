import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../git/slugify.js', () => ({
  slugifyTaskName: vi.fn(),
}));

vi.mock('../config/loader.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    mergeDetection: { pollingIntervalMs: 60000, autoCleanup: true },
    worktree: {
      cacheDirs: ['node_modules', '.next', 'dist', 'build', 'target', '.venv'],
      warmDiskCache: true,
    },
  }),
}));

import {
  handleNew,
  handleList,
  handleSwitch,
  handleStop,
  handleCleanup,
  handleStatus,
  handleRestart,
  handleSuspendAll,
  handleResumeAll,
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
    hasUnpushedCommits: vi.fn(),
    fetchDefaultBranch: vi.fn(),
  };
}

function createMockSessionManager() {
  return {
    createSession: vi.fn(),
    getSession: vi.fn(),
    listSessions: vi.fn(),
    updateStatus: vi.fn(),
    updatePid: vi.fn(),
    updateClaudeSessionId: vi.fn(),
    removeSession: vi.fn(),
  };
}

function createMockTmuxSpawner() {
  return {
    isCommandAvailable: vi.fn(),
    // Window-based methods (new)
    hasMainSession: vi.fn(),
    hasWindow: vi.fn(),
    killWindow: vi.fn(),
    spawnClaudeInWindow: vi.fn(),
    selectWindow: vi.fn(),
    listWindows: vi.fn(),
    createMainSession: vi.fn(),
    getControlPanelCommand: vi.fn().mockReturnValue('node bin/source-verse.ts _control-panel'),
    isInsideTmux: vi.fn().mockReturnValue(false),
    isInMainSession: vi.fn().mockResolvedValue(false),
    // Legacy methods (kept for compat)
    spawnClaude: vi.fn(),
    hasSession: vi.fn(),
    attachSession: vi.fn(),
    killSession: vi.fn(),
    captureOutput: vi.fn(),
    sendKeys: vi.fn(),
    sendLine: vi.fn(),
    sendLineToWindow: vi.fn(),
    listSessions: vi.fn(),
    createSession: vi.fn(),
  };
}

describe('handleNew', () => {
  let mockGitManager: ReturnType<typeof createMockGitManager>;
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockTmuxSpawner: ReturnType<typeof createMockTmuxSpawner>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGitManager = createMockGitManager();
    mockSessionManager = createMockSessionManager();
    mockTmuxSpawner = createMockTmuxSpawner();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  function callHandleNew(task: string, repoPath = '/projects/my-app') {
    return handleNew(task, repoPath, {
      gitManager: mockGitManager as never,
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
      skipPreflight: true,
    });
  }

  function setupDefaults(claudeAvailable = false) {
    mockSlugify.mockReturnValue('sv/fix-login-bug');
    mockGitManager.listWorktrees.mockResolvedValue([]);
    mockGitManager.createWorktree.mockResolvedValue('/projects/my-app-sv-1');
    mockGitManager.getDefaultBranch.mockResolvedValue('main');
    mockTmuxSpawner.isCommandAvailable.mockImplementation(async (cmd: string) => {
      if (cmd === 'tmux') return true;
      if (cmd === 'claude') return claudeAvailable;
      return false;
    });
    mockSessionManager.createSession.mockResolvedValue({
      id: 'session-uuid',
      taskDescription: 'fix login bug',
      worktreePath: '/projects/my-app-sv-1',
      branchName: 'sv/fix-login-bug',
      tmuxSessionName: 'sv-1',
      status: 'created',
      pid: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mockSessionManager.updateStatus.mockResolvedValue({});
    mockSessionManager.updatePid.mockResolvedValue({});
    mockTmuxSpawner.spawnClaudeInWindow.mockResolvedValue(undefined);
    mockTmuxSpawner.hasMainSession.mockResolvedValue(false);
    mockTmuxSpawner.isInMainSession.mockResolvedValue(false);
    mockTmuxSpawner.createMainSession.mockResolvedValue(undefined);
    mockTmuxSpawner.selectWindow.mockResolvedValue(undefined);
    mockTmuxSpawner.attachSession.mockResolvedValue(0);
    mockTmuxSpawner.hasWindow.mockResolvedValue(false);
  }

  it('creates worktree with slugified branch name', async () => {
    setupDefaults();

    await callHandleNew('fix login bug');

    expect(mockSlugify).toHaveBeenCalledWith('fix login bug');
    expect(mockGitManager.createWorktree).toHaveBeenCalledWith('1', 'sv/fix-login-bug', expect.objectContaining({ cacheDirs: expect.any(Array) }));
  });

  it('generates session id 1 when no existing worktrees', async () => {
    setupDefaults();

    await callHandleNew('task');

    expect(mockGitManager.createWorktree).toHaveBeenCalledWith('1', 'sv/fix-login-bug', expect.objectContaining({ cacheDirs: expect.any(Array) }));
  });

  it('increments session id based on existing worktrees', async () => {
    setupDefaults();
    mockGitManager.listWorktrees.mockResolvedValue([
      { path: '/projects/app-sv-1', branch: 'sv/old', sessionId: '1' },
      { path: '/projects/app-sv-3', branch: 'sv/other', sessionId: '3' },
    ]);

    await callHandleNew('new task');

    expect(mockGitManager.createWorktree).toHaveBeenCalledWith('4', 'sv/fix-login-bug', expect.objectContaining({ cacheDirs: expect.any(Array) }));
  });

  it('creates a session record after worktree creation', async () => {
    setupDefaults();

    await callHandleNew('fix login bug');

    expect(mockSessionManager.createSession).toHaveBeenCalledWith(
      'fix login bug',
      '/projects/my-app-sv-1',
      'sv/fix-login-bug',
      'sv-1',
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

    it('does not spawn a tmux window', async () => {
      setupDefaults(false);

      await callHandleNew('fix login bug');

      expect(mockTmuxSpawner.spawnClaudeInWindow).not.toHaveBeenCalled();
    });

    it('does not update session status to running', async () => {
      setupDefaults(false);

      await callHandleNew('fix login bug');

      expect(mockSessionManager.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('when claude is available', () => {
    it('spawns claude in a tmux window', async () => {
      setupDefaults(true);

      await callHandleNew('fix login bug');

      expect(mockTmuxSpawner.spawnClaudeInWindow).toHaveBeenCalledWith(
        'sv-1',
        '/projects/my-app-sv-1',
        'fix login bug',
      );
    });

    it('updates session status to running', async () => {
      setupDefaults(true);

      await callHandleNew('fix login bug');

      expect(mockSessionManager.updateStatus).toHaveBeenCalledWith('session-uuid', 'running');
    });

    it('prints started message with window name', async () => {
      setupDefaults(true);

      await callHandleNew('fix login bug');

      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(output).toContain('Started Claude Code in window "sv-1"');
    });

    it('creates sv-main when it does not exist', async () => {
      setupDefaults(true);
      mockTmuxSpawner.hasMainSession.mockResolvedValue(false);

      await callHandleNew('fix login bug');

      expect(mockTmuxSpawner.createMainSession).toHaveBeenCalled();
    });

    it('attaches to sv-main after creating session', async () => {
      setupDefaults(true);
      mockTmuxSpawner.hasMainSession.mockResolvedValue(false);

      await callHandleNew('fix login bug');

      expect(mockTmuxSpawner.attachSession).toHaveBeenCalledWith('sv-main:sv-1');
    });
  });

  it('propagates errors from GitManager', async () => {
    setupDefaults();
    mockGitManager.createWorktree.mockRejectedValue(new Error('Branch "sv/task" already exists.'));

    await expect(callHandleNew('task')).rejects.toThrow('Branch "sv/task" already exists.');
  });

  it('propagates errors from slugifyTaskName', async () => {
    setupDefaults();
    mockSlugify.mockImplementation(() => {
      throw new Error('Task description cannot be empty');
    });

    await expect(callHandleNew('')).rejects.toThrow('Task description cannot be empty');
  });
});

function createTestSession(
  overrides: Partial<{
    id: string;
    taskDescription: string;
    worktreePath: string;
    branchName: string;
    tmuxSessionName: string;
    status: string;
    pid: number | null;
    claudeSessionId: string | null;
    createdAt: string;
    updatedAt: string;
  }> = {},
) {
  return {
    id: 'abcdef12-3456-7890-abcd-ef1234567890',
    taskDescription: 'fix login bug',
    worktreePath: '/projects/my-app-sv-1',
    branchName: 'sv/fix-login-bug',
    tmuxSessionName: 'sv-1',
    status: 'running',
    pid: 12345,
    claudeSessionId: null,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('handleList', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockTmuxSpawner: ReturnType<typeof createMockTmuxSpawner>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
    mockTmuxSpawner = createMockTmuxSpawner();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('shows helpful message when no sessions exist', async () => {
    mockSessionManager.listSessions.mockResolvedValue([]);

    await handleList({
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('No sessions found');
    expect(output).toContain('source-verse new');
  });

  it('displays session table with correct columns', async () => {
    const session = createTestSession();
    mockSessionManager.listSessions.mockResolvedValue([session]);
    mockTmuxSpawner.hasWindow.mockResolvedValue(true);

    await handleList({
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

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
      taskDescription:
        'This is a very long task description that should be truncated at forty characters',
    });
    mockSessionManager.listSessions.mockResolvedValue([session]);
    mockTmuxSpawner.hasWindow.mockResolvedValue(true);

    await handleList({
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).not.toContain('that should be truncated at forty characters');
    expect(output).toContain('\u2026');
  });

  it('displays multiple sessions', async () => {
    const sessions = [
      createTestSession({
        id: 'aaaa1111-0000-0000-0000-000000000000',
        taskDescription: 'task one',
      }),
      createTestSession({
        id: 'bbbb2222-0000-0000-0000-000000000000',
        taskDescription: 'task two',
        status: 'done',
      }),
    ];
    mockSessionManager.listSessions.mockResolvedValue(sessions);
    mockTmuxSpawner.hasWindow.mockResolvedValue(true);

    await handleList({
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('aaaa1111');
    expect(output).toContain('bbbb2222');
    expect(output).toContain('task one');
    expect(output).toContain('task two');
  });
});

describe('handleSwitch', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockTmuxSpawner: ReturnType<typeof createMockTmuxSpawner>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
    mockTmuxSpawner = createMockTmuxSpawner();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  it('errors when session not found', async () => {
    mockSessionManager.getSession.mockResolvedValue(null);

    await handleSwitch('nonexistent', {
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    const output = consoleErrorSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Session not found');
    expect(process.exitCode).toBe(1);
  });

  it('errors when window is not running', async () => {
    const session = createTestSession({ status: 'running' });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockTmuxSpawner.hasWindow.mockResolvedValue(false);
    mockSessionManager.updateStatus.mockResolvedValue({});

    await handleSwitch(session.id, {
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    const output = consoleErrorSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('is not running');
    expect(process.exitCode).toBe(1);
  });

  it('attaches to sv-main at the right window', async () => {
    const session = createTestSession({ status: 'running' });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockTmuxSpawner.hasWindow.mockResolvedValue(true);
    mockTmuxSpawner.isInMainSession.mockResolvedValue(false);
    mockTmuxSpawner.attachSession.mockResolvedValue(0);

    await handleSwitch(session.id, {
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    expect(mockTmuxSpawner.attachSession).toHaveBeenCalledWith('sv-main:sv-1');
  });
});

describe('handleStop', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockGitManager: ReturnType<typeof createMockGitManager>;
  let mockTmuxSpawner: ReturnType<typeof createMockTmuxSpawner>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
    mockGitManager = createMockGitManager();
    mockTmuxSpawner = createMockTmuxSpawner();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  it('errors when session not found', async () => {
    mockSessionManager.getSession.mockResolvedValue(null);

    await handleStop('nonexistent', {}, '/projects/app', {
      sessionManager: mockSessionManager as never,
      gitManager: mockGitManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    const output = consoleErrorSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Session not found');
    expect(process.exitCode).toBe(1);
  });

  it('kills tmux window and updates status to done', async () => {
    const session = createTestSession({ status: 'running', pid: null });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockSessionManager.updateStatus.mockResolvedValue({});
    mockTmuxSpawner.hasWindow.mockResolvedValue(true);
    mockTmuxSpawner.killWindow.mockResolvedValue(undefined);

    await handleStop(session.id, {}, '/projects/app', {
      sessionManager: mockSessionManager as never,
      gitManager: mockGitManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    expect(mockTmuxSpawner.killWindow).toHaveBeenCalledWith('sv-1');
    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith(session.id, 'done');
  });

  it('cleans up worktree when --cleanup flag is set', async () => {
    const session = createTestSession({ status: 'running', pid: null });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockSessionManager.updateStatus.mockResolvedValue({});
    mockTmuxSpawner.hasWindow.mockResolvedValue(false);
    mockGitManager.listWorktrees.mockResolvedValue([
      { path: session.worktreePath, branch: session.branchName, sessionId: '1' },
    ]);
    mockGitManager.removeWorktree.mockResolvedValue(undefined);

    await handleStop(session.id, { cleanup: true }, '/projects/app', {
      sessionManager: mockSessionManager as never,
      gitManager: mockGitManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    expect(mockGitManager.removeWorktree).toHaveBeenCalledWith('1');
    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith(session.id, 'cleaned_up');
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
    vi.spyOn(process.stdin, 'once').mockImplementation(((
      event: string,
      cb: (data: string) => void,
    ) => {
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

  it('warns about skipped active sessions', async () => {
    mockSessionManager.listSessions.mockResolvedValue([
      createTestSession({
        id: 'running1-0000-0000-0000-000000000000',
        status: 'running',
        branchName: 'sv/active-task',
      }),
      createTestSession({
        id: 'done1234-0000-0000-0000-000000000000',
        status: 'done',
        branchName: 'sv/finished-task',
      }),
    ]);
    mockSessionManager.updateStatus.mockResolvedValue({});
    mockGitManager.listWorktrees.mockResolvedValue([]);

    simulateTTYConfirmation('y');

    await callHandleCleanup();

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Skipping running1');
    expect(output).toContain('status is running');
  });

  it('cancels cleanup when user declines', async () => {
    mockSessionManager.listSessions.mockResolvedValue([createTestSession({ status: 'done' })]);

    simulateTTYConfirmation('n');

    await callHandleCleanup();

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Cleanup cancelled');
    expect(mockGitManager.removeWorktree).not.toHaveBeenCalled();
    expect(mockSessionManager.updateStatus).not.toHaveBeenCalled();
  });
});

describe('handleStatus', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockTmuxSpawner: ReturnType<typeof createMockTmuxSpawner>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
    mockTmuxSpawner = createMockTmuxSpawner();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('shows helpful message when no sessions exist', async () => {
    mockSessionManager.listSessions.mockResolvedValue([]);

    await handleStatus({
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('No sessions found');
  });

  it('displays total session count', async () => {
    const sessions = [
      createTestSession({ id: 'aaa-1', status: 'running' }),
      createTestSession({ id: 'bbb-2', status: 'done' }),
    ];
    mockSessionManager.listSessions.mockResolvedValue(sessions);
    mockTmuxSpawner.hasWindow.mockResolvedValue(true);

    await handleStatus({
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Total sessions: 2');
  });
});

describe('handleRestart', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockTmuxSpawner: ReturnType<typeof createMockTmuxSpawner>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
    mockTmuxSpawner = createMockTmuxSpawner();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  it('errors when session not found', async () => {
    mockSessionManager.getSession.mockResolvedValue(null);

    await handleRestart('nonexistent', {
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    const output = consoleErrorSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Session not found');
    expect(process.exitCode).toBe(1);
  });

  it('errors when session is running', async () => {
    mockSessionManager.getSession.mockResolvedValue(createTestSession({ status: 'running' }));

    await handleRestart('abcdef12', {
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    const output = consoleErrorSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('cannot be restarted');
    expect(process.exitCode).toBe(1);
  });

  it('errors when claude is not available', async () => {
    mockSessionManager.getSession.mockResolvedValue(createTestSession({ status: 'error' }));
    mockTmuxSpawner.isCommandAvailable.mockImplementation(async (cmd: string) => {
      if (cmd === 'tmux') return true;
      return false;
    });

    await handleRestart('abcdef12', {
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    const output = consoleErrorSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Claude Code not found');
    expect(process.exitCode).toBe(1);
  });

  it('restarts an error session successfully', async () => {
    const session = createTestSession({ status: 'error' });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockTmuxSpawner.isCommandAvailable.mockResolvedValue(true);
    mockTmuxSpawner.killWindow.mockResolvedValue(undefined);
    mockTmuxSpawner.spawnClaudeInWindow.mockResolvedValue(undefined);
    mockTmuxSpawner.hasMainSession.mockResolvedValue(true);
    mockTmuxSpawner.isInMainSession.mockResolvedValue(false);
    mockTmuxSpawner.attachSession.mockResolvedValue(0);
    mockSessionManager.updateStatus.mockResolvedValue({});

    await handleRestart(session.id, {
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    expect(mockTmuxSpawner.spawnClaudeInWindow).toHaveBeenCalledWith(
      'sv-1',
      session.worktreePath,
      '--continue',
      { raw: true },
    );
    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith(session.id, 'running');
  });

  it('restarts a suspended session successfully', async () => {
    const session = createTestSession({ status: 'suspended' });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockTmuxSpawner.isCommandAvailable.mockResolvedValue(true);
    mockTmuxSpawner.killWindow.mockResolvedValue(undefined);
    mockTmuxSpawner.spawnClaudeInWindow.mockResolvedValue(undefined);
    mockTmuxSpawner.hasMainSession.mockResolvedValue(true);
    mockTmuxSpawner.isInMainSession.mockResolvedValue(false);
    mockTmuxSpawner.attachSession.mockResolvedValue(0);
    mockSessionManager.updateStatus.mockResolvedValue({});

    await handleRestart(session.id, {
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    expect(mockTmuxSpawner.spawnClaudeInWindow).toHaveBeenCalledWith(
      'sv-1',
      session.worktreePath,
      '--continue',
      { raw: true },
    );
    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith(session.id, 'running');
  });

  it('uses --resume with claudeSessionId when available', async () => {
    const session = createTestSession({
      status: 'suspended',
      claudeSessionId: 'abc123-def4-5678-9012-abcdef345678',
    });
    mockSessionManager.getSession.mockResolvedValue(session);
    mockTmuxSpawner.isCommandAvailable.mockResolvedValue(true);
    mockTmuxSpawner.killWindow.mockResolvedValue(undefined);
    mockTmuxSpawner.spawnClaudeInWindow.mockResolvedValue(undefined);
    mockTmuxSpawner.hasMainSession.mockResolvedValue(true);
    mockTmuxSpawner.isInMainSession.mockResolvedValue(false);
    mockTmuxSpawner.attachSession.mockResolvedValue(0);
    mockSessionManager.updateStatus.mockResolvedValue({});

    await handleRestart(session.id, {
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    expect(mockTmuxSpawner.spawnClaudeInWindow).toHaveBeenCalledWith(
      'sv-1',
      session.worktreePath,
      '--resume abc123-def4-5678-9012-abcdef345678',
      { raw: true },
    );
  });
});

describe('handleSuspendAll', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockTmuxSpawner: ReturnType<typeof createMockTmuxSpawner>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
    mockTmuxSpawner = createMockTmuxSpawner();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('shows message when no running sessions', async () => {
    mockSessionManager.listSessions.mockResolvedValue([createTestSession({ status: 'done' })]);

    await handleSuspendAll({
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('No running sessions to suspend');
  });

  it('sends /exit to all running sessions', async () => {
    const sessions = [
      createTestSession({
        id: 'aaa-1',
        status: 'running',
        tmuxSessionName: 'sv-1',
      }),
      createTestSession({
        id: 'bbb-2',
        status: 'running',
        tmuxSessionName: 'sv-2',
      }),
    ];
    mockSessionManager.listSessions.mockResolvedValue(sessions);
    mockTmuxSpawner.sendLineToWindow.mockResolvedValue(undefined);
    mockTmuxSpawner.hasWindow.mockResolvedValue(false); // windows exit immediately
    mockSessionManager.updateStatus.mockResolvedValue({});

    await handleSuspendAll({
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    expect(mockTmuxSpawner.sendLineToWindow).toHaveBeenCalledWith('sv-1', '/exit');
    expect(mockTmuxSpawner.sendLineToWindow).toHaveBeenCalledWith('sv-2', '/exit');
  });

  it('updates all running sessions to suspended status', async () => {
    const sessions = [
      createTestSession({
        id: 'aaa-1',
        status: 'running',
        tmuxSessionName: 'sv-1',
      }),
      createTestSession({
        id: 'bbb-2',
        status: 'done',
        tmuxSessionName: 'sv-2',
      }),
    ];
    mockSessionManager.listSessions.mockResolvedValue(sessions);
    mockTmuxSpawner.sendLineToWindow.mockResolvedValue(undefined);
    mockTmuxSpawner.hasWindow.mockResolvedValue(false);
    mockSessionManager.updateStatus.mockResolvedValue({});

    await handleSuspendAll({
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith('aaa-1', 'suspended');
    expect(mockSessionManager.updateStatus).not.toHaveBeenCalledWith('bbb-2', 'suspended');
  });

  it('force-kills windows that do not exit within timeout', async () => {
    const session = createTestSession({
      id: 'aaa-1',
      status: 'running',
      tmuxSessionName: 'sv-1',
    });
    mockSessionManager.listSessions.mockResolvedValue([session]);
    mockTmuxSpawner.sendLineToWindow.mockResolvedValue(undefined);
    // Window never dies on its own — but we mock it to die after first check to avoid real 15s wait
    mockTmuxSpawner.hasWindow.mockResolvedValueOnce(true).mockResolvedValue(false);
    mockTmuxSpawner.killWindow.mockResolvedValue(undefined);
    mockSessionManager.updateStatus.mockResolvedValue({});

    await handleSuspendAll({
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith('aaa-1', 'suspended');
  });
});

describe('handleResumeAll', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockTmuxSpawner: ReturnType<typeof createMockTmuxSpawner>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
    mockTmuxSpawner = createMockTmuxSpawner();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('shows message when no suspended sessions', async () => {
    mockSessionManager.listSessions.mockResolvedValue([createTestSession({ status: 'done' })]);

    await handleResumeAll('/projects/app', {
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('No suspended sessions to resume');
  });

  it('resumes all suspended sessions with --continue when no claudeSessionId', async () => {
    const sessions = [
      createTestSession({
        id: 'aaa-1',
        status: 'suspended',
        tmuxSessionName: 'sv-1',
        worktreePath: '/projects/app-sv-1',
      }),
      createTestSession({
        id: 'bbb-2',
        status: 'suspended',
        tmuxSessionName: 'sv-2',
        worktreePath: '/projects/app-sv-2',
      }),
    ];
    mockSessionManager.listSessions.mockResolvedValue(sessions);
    mockTmuxSpawner.hasMainSession.mockResolvedValue(true);
    mockTmuxSpawner.spawnClaudeInWindow.mockResolvedValue(undefined);
    mockSessionManager.updateStatus.mockResolvedValue({});

    await handleResumeAll('/projects/app', {
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    expect(mockTmuxSpawner.spawnClaudeInWindow).toHaveBeenCalledWith(
      'sv-1',
      '/projects/app-sv-1',
      '--continue',
      { raw: true },
    );
    expect(mockTmuxSpawner.spawnClaudeInWindow).toHaveBeenCalledWith(
      'sv-2',
      '/projects/app-sv-2',
      '--continue',
      { raw: true },
    );
    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith('aaa-1', 'running');
    expect(mockSessionManager.updateStatus).toHaveBeenCalledWith('bbb-2', 'running');
  });

  it('uses --resume with claudeSessionId when available', async () => {
    const sessions = [
      createTestSession({
        id: 'aaa-1',
        status: 'suspended',
        tmuxSessionName: 'sv-1',
        worktreePath: '/projects/app-sv-1',
        claudeSessionId: 'claude-id-111',
      }),
      createTestSession({
        id: 'bbb-2',
        status: 'suspended',
        tmuxSessionName: 'sv-2',
        worktreePath: '/projects/app-sv-2',
        claudeSessionId: null,
      }),
    ];
    mockSessionManager.listSessions.mockResolvedValue(sessions);
    mockTmuxSpawner.hasMainSession.mockResolvedValue(true);
    mockTmuxSpawner.spawnClaudeInWindow.mockResolvedValue(undefined);
    mockSessionManager.updateStatus.mockResolvedValue({});

    await handleResumeAll('/projects/app', {
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    expect(mockTmuxSpawner.spawnClaudeInWindow).toHaveBeenCalledWith(
      'sv-1',
      '/projects/app-sv-1',
      '--resume claude-id-111',
      { raw: true },
    );
    expect(mockTmuxSpawner.spawnClaudeInWindow).toHaveBeenCalledWith(
      'sv-2',
      '/projects/app-sv-2',
      '--continue',
      { raw: true },
    );
  });

  it('creates sv-main if it does not exist', async () => {
    const session = createTestSession({
      id: 'aaa-1',
      status: 'suspended',
      tmuxSessionName: 'sv-1',
    });
    mockSessionManager.listSessions.mockResolvedValue([session]);
    mockTmuxSpawner.hasMainSession.mockResolvedValue(false);
    mockTmuxSpawner.createMainSession.mockResolvedValue(undefined);
    mockTmuxSpawner.spawnClaudeInWindow.mockResolvedValue(undefined);
    mockSessionManager.updateStatus.mockResolvedValue({});

    await handleResumeAll('/projects/app', {
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    expect(mockTmuxSpawner.createMainSession).toHaveBeenCalled();
  });

  it('skips non-suspended sessions', async () => {
    const sessions = [
      createTestSession({
        id: 'aaa-1',
        status: 'suspended',
        tmuxSessionName: 'sv-1',
      }),
      createTestSession({
        id: 'bbb-2',
        status: 'done',
        tmuxSessionName: 'sv-2',
      }),
    ];
    mockSessionManager.listSessions.mockResolvedValue(sessions);
    mockTmuxSpawner.hasMainSession.mockResolvedValue(true);
    mockTmuxSpawner.spawnClaudeInWindow.mockResolvedValue(undefined);
    mockSessionManager.updateStatus.mockResolvedValue({});

    await handleResumeAll('/projects/app', {
      sessionManager: mockSessionManager as never,
      tmuxSpawner: mockTmuxSpawner as never,
    });

    expect(mockTmuxSpawner.spawnClaudeInWindow).toHaveBeenCalledTimes(1);
    expect(mockTmuxSpawner.spawnClaudeInWindow).toHaveBeenCalledWith(
      'sv-1',
      expect.any(String),
      '--continue',
      { raw: true },
    );
  });
});
