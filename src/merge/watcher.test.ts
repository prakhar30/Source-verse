import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MergeWatcher } from './watcher.js';
import type { MergeCallback } from './watcher.js';
import type { SessionManager } from '../session/manager.js';
import type { GitManager } from '../git/manager.js';
import type { Session } from '../session/types.js';
import type { MergeDetectionConfig } from '../config/types.js';

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-id',
    taskDescription: 'Fix bug',
    worktreePath: '/home/user/projects/app-sv-1',
    branchName: 'sv/fix-bug',
    status: 'running',
    pid: 1234,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockDeps() {
  const sessionManager = {
    listSessions: vi.fn<() => Promise<Session[]>>().mockResolvedValue([]),
    updateStatus: vi.fn().mockResolvedValue({}),
  } as unknown as SessionManager;

  const gitManager = {
    fetchDefaultBranch: vi.fn().mockResolvedValue(undefined),
    isBranchMerged: vi.fn<(name: string) => Promise<boolean>>().mockResolvedValue(false),
    listWorktrees: vi.fn().mockResolvedValue([]),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
  } as unknown as GitManager;

  const onMergeDetected = vi.fn<MergeCallback>();

  return { sessionManager, gitManager, onMergeDetected };
}

const FAST_CONFIG: MergeDetectionConfig = {
  pollingIntervalMs: 100,
  autoCleanup: true,
};

describe('MergeWatcher', () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe('checkForMerges', () => {
    it('fetches default branch before checking merges', async () => {
      const watcher = new MergeWatcher(
        deps.sessionManager,
        deps.gitManager,
        deps.onMergeDetected,
        FAST_CONFIG,
      );

      await watcher.checkForMerges();

      expect(deps.gitManager.fetchDefaultBranch).toHaveBeenCalledOnce();
    });

    it('detects a merged branch and updates status', async () => {
      const session = createMockSession({ status: 'done' });
      vi.mocked(deps.sessionManager.listSessions).mockResolvedValue([session]);
      vi.mocked(deps.gitManager.isBranchMerged).mockResolvedValue(true);

      const watcher = new MergeWatcher(
        deps.sessionManager,
        deps.gitManager,
        deps.onMergeDetected,
        { ...FAST_CONFIG, autoCleanup: false },
      );

      const events = await watcher.checkForMerges();

      expect(deps.sessionManager.updateStatus).toHaveBeenCalledWith(session.id, 'merged');
      expect(events).toHaveLength(1);
      expect(events[0].session.status).toBe('merged');
      expect(events[0].cleanedUp).toBe(false);
    });

    it('triggers auto-cleanup when enabled', async () => {
      const session = createMockSession({ status: 'done' });
      vi.mocked(deps.sessionManager.listSessions).mockResolvedValue([session]);
      vi.mocked(deps.gitManager.isBranchMerged).mockResolvedValue(true);
      vi.mocked(deps.gitManager.listWorktrees).mockResolvedValue([
        { path: session.worktreePath, branch: session.branchName, sessionId: '1' },
      ]);

      const watcher = new MergeWatcher(
        deps.sessionManager,
        deps.gitManager,
        deps.onMergeDetected,
        FAST_CONFIG,
      );

      const events = await watcher.checkForMerges();

      expect(deps.gitManager.removeWorktree).toHaveBeenCalledWith('1');
      expect(deps.sessionManager.updateStatus).toHaveBeenCalledWith(session.id, 'cleaned_up');
      expect(events[0].cleanedUp).toBe(true);
    });

    it('does not auto-cleanup when disabled', async () => {
      const session = createMockSession({ status: 'running' });
      vi.mocked(deps.sessionManager.listSessions).mockResolvedValue([session]);
      vi.mocked(deps.gitManager.isBranchMerged).mockResolvedValue(true);

      const watcher = new MergeWatcher(
        deps.sessionManager,
        deps.gitManager,
        deps.onMergeDetected,
        { ...FAST_CONFIG, autoCleanup: false },
      );

      const events = await watcher.checkForMerges();

      expect(deps.gitManager.removeWorktree).not.toHaveBeenCalled();
      expect(events[0].cleanedUp).toBe(false);
    });

    it('skips sessions with merged status', async () => {
      const session = createMockSession({ status: 'merged' });
      vi.mocked(deps.sessionManager.listSessions).mockResolvedValue([session]);

      const watcher = new MergeWatcher(
        deps.sessionManager,
        deps.gitManager,
        deps.onMergeDetected,
        FAST_CONFIG,
      );

      const events = await watcher.checkForMerges();

      expect(deps.gitManager.isBranchMerged).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
    });

    it('skips sessions with cleaned_up status', async () => {
      const session = createMockSession({ status: 'cleaned_up' });
      vi.mocked(deps.sessionManager.listSessions).mockResolvedValue([session]);

      const watcher = new MergeWatcher(
        deps.sessionManager,
        deps.gitManager,
        deps.onMergeDetected,
        FAST_CONFIG,
      );

      const events = await watcher.checkForMerges();

      expect(deps.gitManager.isBranchMerged).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
    });

    it('handles git errors gracefully when checking branch merge', async () => {
      const session = createMockSession({ status: 'done' });
      vi.mocked(deps.sessionManager.listSessions).mockResolvedValue([session]);
      vi.mocked(deps.gitManager.isBranchMerged).mockRejectedValue(new Error('branch not found'));

      const watcher = new MergeWatcher(
        deps.sessionManager,
        deps.gitManager,
        deps.onMergeDetected,
        FAST_CONFIG,
      );

      const events = await watcher.checkForMerges();

      expect(events).toHaveLength(0);
      expect(deps.onMergeDetected).not.toHaveBeenCalled();
    });

    it('handles cleanup failure gracefully', async () => {
      const session = createMockSession({ status: 'done' });
      vi.mocked(deps.sessionManager.listSessions).mockResolvedValue([session]);
      vi.mocked(deps.gitManager.isBranchMerged).mockResolvedValue(true);
      vi.mocked(deps.gitManager.listWorktrees).mockRejectedValue(new Error('git error'));

      const watcher = new MergeWatcher(
        deps.sessionManager,
        deps.gitManager,
        deps.onMergeDetected,
        FAST_CONFIG,
      );

      const events = await watcher.checkForMerges();

      expect(events).toHaveLength(1);
      expect(events[0].cleanedUp).toBe(false);
    });

    it('calls onMergeDetected callback for each merged session', async () => {
      const session1 = createMockSession({ id: 's1', branchName: 'sv/a', status: 'done' });
      const session2 = createMockSession({ id: 's2', branchName: 'sv/b', status: 'running' });
      vi.mocked(deps.sessionManager.listSessions).mockResolvedValue([session1, session2]);
      vi.mocked(deps.gitManager.isBranchMerged).mockResolvedValue(true);

      const watcher = new MergeWatcher(
        deps.sessionManager,
        deps.gitManager,
        deps.onMergeDetected,
        { ...FAST_CONFIG, autoCleanup: false },
      );

      await watcher.checkForMerges();

      expect(deps.onMergeDetected).toHaveBeenCalledTimes(2);
    });

    it('does not treat unmerged branches as merged', async () => {
      const session = createMockSession({ status: 'running' });
      vi.mocked(deps.sessionManager.listSessions).mockResolvedValue([session]);
      vi.mocked(deps.gitManager.isBranchMerged).mockResolvedValue(false);

      const watcher = new MergeWatcher(
        deps.sessionManager,
        deps.gitManager,
        deps.onMergeDetected,
        FAST_CONFIG,
      );

      const events = await watcher.checkForMerges();

      expect(events).toHaveLength(0);
      expect(deps.sessionManager.updateStatus).not.toHaveBeenCalled();
    });

    it('checks all checkable statuses (created, running, waiting, done)', async () => {
      const sessions = [
        createMockSession({ id: 's1', branchName: 'sv/a', status: 'created' }),
        createMockSession({ id: 's2', branchName: 'sv/b', status: 'running' }),
        createMockSession({ id: 's3', branchName: 'sv/c', status: 'waiting' }),
        createMockSession({ id: 's4', branchName: 'sv/d', status: 'done' }),
      ];
      vi.mocked(deps.sessionManager.listSessions).mockResolvedValue(sessions);
      vi.mocked(deps.gitManager.isBranchMerged).mockResolvedValue(true);

      const watcher = new MergeWatcher(
        deps.sessionManager,
        deps.gitManager,
        deps.onMergeDetected,
        { ...FAST_CONFIG, autoCleanup: false },
      );

      const events = await watcher.checkForMerges();

      expect(events).toHaveLength(4);
      expect(deps.gitManager.isBranchMerged).toHaveBeenCalledTimes(4);
    });
  });

  describe('start / stop', () => {
    it('starts polling and can be stopped', async () => {
      vi.useFakeTimers();

      const session = createMockSession({ status: 'done' });
      vi.mocked(deps.sessionManager.listSessions).mockResolvedValue([session]);
      vi.mocked(deps.gitManager.isBranchMerged).mockResolvedValue(false);

      const watcher = new MergeWatcher(
        deps.sessionManager,
        deps.gitManager,
        deps.onMergeDetected,
        FAST_CONFIG,
      );

      watcher.start();

      await vi.advanceTimersByTimeAsync(FAST_CONFIG.pollingIntervalMs);
      expect(deps.gitManager.fetchDefaultBranch).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(FAST_CONFIG.pollingIntervalMs);
      expect(deps.gitManager.fetchDefaultBranch).toHaveBeenCalledTimes(2);

      watcher.stop();

      await vi.advanceTimersByTimeAsync(FAST_CONFIG.pollingIntervalMs * 3);
      expect(deps.gitManager.fetchDefaultBranch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('does not start multiple intervals on repeated start calls', () => {
      vi.useFakeTimers();

      const watcher = new MergeWatcher(
        deps.sessionManager,
        deps.gitManager,
        deps.onMergeDetected,
        FAST_CONFIG,
      );

      watcher.start();
      watcher.start();
      watcher.stop();

      vi.advanceTimersByTime(FAST_CONFIG.pollingIntervalMs * 5);
      expect(deps.gitManager.fetchDefaultBranch).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
