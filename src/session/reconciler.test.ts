import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager } from './manager.js';
import { SessionReconciler } from './reconciler.js';
import type { ProcessChecker, PathChecker } from './reconciler.js';

function createMockProcessChecker(alivePids: Set<number>): ProcessChecker {
  return {
    isAlive(pid: number): boolean {
      return alivePids.has(pid);
    },
  };
}

function createMockPathChecker(existingPaths: Set<string>): PathChecker {
  return {
    async exists(path: string): Promise<boolean> {
      return existingPaths.has(path);
    },
  };
}

describe('SessionReconciler', () => {
  let tempDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sv-reconciler-test-'));
    manager = new SessionManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('reconcile', () => {
    it('returns empty result when no sessions exist', async () => {
      const reconciler = new SessionReconciler(
        manager,
        createMockProcessChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      const result = await reconciler.reconcile();

      expect(result.reattached).toEqual([]);
      expect(result.markedDone).toEqual([]);
      expect(result.markedError).toEqual([]);
      expect(result.orphanedWorktrees).toEqual([]);
    });

    it('reattaches running session with alive PID', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task');
      await manager.updateStatus(session.id, 'running');
      await manager.updatePid(session.id, 1234);

      const reconciler = new SessionReconciler(
        manager,
        createMockProcessChecker(new Set([1234])),
        createMockPathChecker(new Set()),
      );

      const result = await reconciler.reconcile();

      expect(result.reattached).toEqual([session.id]);
      expect(result.markedDone).toEqual([]);

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('running');
      expect(reloaded?.pid).toBe(1234);
    });

    it('marks running session as done when PID is dead', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task');
      await manager.updateStatus(session.id, 'running');
      await manager.updatePid(session.id, 9999);

      const reconciler = new SessionReconciler(
        manager,
        createMockProcessChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      const result = await reconciler.reconcile();

      expect(result.markedDone).toEqual([session.id]);
      expect(result.reattached).toEqual([]);

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('done');
      expect(reloaded?.pid).toBeNull();
    });

    it('marks waiting session as done when PID is dead', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task');
      await manager.updateStatus(session.id, 'waiting');
      await manager.updatePid(session.id, 5555);

      const reconciler = new SessionReconciler(
        manager,
        createMockProcessChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      const result = await reconciler.reconcile();

      expect(result.markedDone).toEqual([session.id]);

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('done');
    });

    it('reattaches waiting session with alive PID', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task');
      await manager.updateStatus(session.id, 'waiting');
      await manager.updatePid(session.id, 7777);

      const reconciler = new SessionReconciler(
        manager,
        createMockProcessChecker(new Set([7777])),
        createMockPathChecker(new Set()),
      );

      const result = await reconciler.reconcile();

      expect(result.reattached).toEqual([session.id]);

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('waiting');
    });

    it('marks active session as error when PID is null', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task');
      await manager.updateStatus(session.id, 'running');

      const reconciler = new SessionReconciler(
        manager,
        createMockProcessChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      const result = await reconciler.reconcile();

      expect(result.markedError).toEqual([session.id]);

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('error');
    });

    it('detects orphaned worktree for cleaned_up session', async () => {
      const session = await manager.createSession('task', '/tmp/wt-orphan', 'sv/task');
      await manager.updateStatus(session.id, 'cleaned_up');

      const reconciler = new SessionReconciler(
        manager,
        createMockProcessChecker(new Set()),
        createMockPathChecker(new Set(['/tmp/wt-orphan'])),
      );

      const result = await reconciler.reconcile();

      expect(result.orphanedWorktrees).toEqual([session.id]);
    });

    it('ignores cleaned_up session when worktree does not exist', async () => {
      const session = await manager.createSession('task', '/tmp/wt-gone', 'sv/task');
      await manager.updateStatus(session.id, 'cleaned_up');

      const reconciler = new SessionReconciler(
        manager,
        createMockProcessChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      const result = await reconciler.reconcile();

      expect(result.orphanedWorktrees).toEqual([]);
    });

    it('does not modify sessions in created status', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task');

      const reconciler = new SessionReconciler(
        manager,
        createMockProcessChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      await reconciler.reconcile();

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('created');
    });

    it('does not modify sessions in done status', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task');
      await manager.updateStatus(session.id, 'done');

      const reconciler = new SessionReconciler(
        manager,
        createMockProcessChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      await reconciler.reconcile();

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('done');
    });

    it('does not modify sessions in merged status', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task');
      await manager.updateStatus(session.id, 'merged');

      const reconciler = new SessionReconciler(
        manager,
        createMockProcessChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      await reconciler.reconcile();

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('merged');
    });

    it('handles mixed sessions correctly', async () => {
      const running = await manager.createSession('running task', '/tmp/wt1', 'sv/running');
      await manager.updateStatus(running.id, 'running');
      await manager.updatePid(running.id, 1000);

      const dead = await manager.createSession('dead task', '/tmp/wt2', 'sv/dead');
      await manager.updateStatus(dead.id, 'running');
      await manager.updatePid(dead.id, 2000);

      const created = await manager.createSession('new task', '/tmp/wt3', 'sv/new');

      const cleanedUp = await manager.createSession('old task', '/tmp/wt4', 'sv/old');
      await manager.updateStatus(cleanedUp.id, 'cleaned_up');

      const reconciler = new SessionReconciler(
        manager,
        createMockProcessChecker(new Set([1000])),
        createMockPathChecker(new Set(['/tmp/wt4'])),
      );

      const result = await reconciler.reconcile();

      expect(result.reattached).toEqual([running.id]);
      expect(result.markedDone).toEqual([dead.id]);
      expect(result.orphanedWorktrees).toEqual([cleanedUp.id]);

      const reloadedRunning = await manager.getSession(running.id);
      expect(reloadedRunning?.status).toBe('running');

      const reloadedDead = await manager.getSession(dead.id);
      expect(reloadedDead?.status).toBe('done');

      const reloadedCreated = await manager.getSession(created.id);
      expect(reloadedCreated?.status).toBe('created');

      const reloadedCleanedUp = await manager.getSession(cleanedUp.id);
      expect(reloadedCleanedUp?.status).toBe('cleaned_up');
    });
  });
});
