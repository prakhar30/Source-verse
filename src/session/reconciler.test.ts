import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager } from './manager.js';
import { SessionReconciler } from './reconciler.js';
import type { TmuxChecker, PathChecker } from './reconciler.js';

function createMockTmuxChecker(aliveSessions: Set<string>): TmuxChecker {
  return {
    async hasSession(sessionName: string): Promise<boolean> {
      return aliveSessions.has(sessionName);
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
        createMockTmuxChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      const result = await reconciler.reconcile();

      expect(result.reattached).toEqual([]);
      expect(result.markedDone).toEqual([]);
      expect(result.markedError).toEqual([]);
      expect(result.orphanedWorktrees).toEqual([]);
    });

    it('reattaches running session with alive tmux session', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task', 'sv-1');
      await manager.updateStatus(session.id, 'running');

      const reconciler = new SessionReconciler(
        manager,
        createMockTmuxChecker(new Set(['sv-1'])),
        createMockPathChecker(new Set()),
      );

      const result = await reconciler.reconcile();

      expect(result.reattached).toEqual([session.id]);
      expect(result.markedDone).toEqual([]);

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('running');
    });

    it('marks running session as done when tmux session is dead', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task', 'sv-1');
      await manager.updateStatus(session.id, 'running');

      const reconciler = new SessionReconciler(
        manager,
        createMockTmuxChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      const result = await reconciler.reconcile();

      expect(result.markedDone).toEqual([session.id]);
      expect(result.reattached).toEqual([]);

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('done');
    });

    it('marks waiting session as done when tmux session is dead', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task', 'sv-1');
      await manager.updateStatus(session.id, 'waiting');

      const reconciler = new SessionReconciler(
        manager,
        createMockTmuxChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      const result = await reconciler.reconcile();

      expect(result.markedDone).toEqual([session.id]);

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('done');
    });

    it('reattaches waiting session with alive tmux session', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task', 'sv-1');
      await manager.updateStatus(session.id, 'waiting');

      const reconciler = new SessionReconciler(
        manager,
        createMockTmuxChecker(new Set(['sv-1'])),
        createMockPathChecker(new Set()),
      );

      const result = await reconciler.reconcile();

      expect(result.reattached).toEqual([session.id]);

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('waiting');
    });

    it('marks active session as error when tmuxSessionName is missing', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task', '');
      await manager.updateStatus(session.id, 'running');

      const reconciler = new SessionReconciler(
        manager,
        createMockTmuxChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      const result = await reconciler.reconcile();

      expect(result.markedError).toEqual([session.id]);

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('error');
    });

    it('detects orphaned worktree for cleaned_up session', async () => {
      const session = await manager.createSession('task', '/tmp/wt-orphan', 'sv/task', 'sv-1');
      await manager.updateStatus(session.id, 'cleaned_up');

      const reconciler = new SessionReconciler(
        manager,
        createMockTmuxChecker(new Set()),
        createMockPathChecker(new Set(['/tmp/wt-orphan'])),
      );

      const result = await reconciler.reconcile();

      expect(result.orphanedWorktrees).toEqual([session.id]);
    });

    it('ignores cleaned_up session when worktree does not exist', async () => {
      const session = await manager.createSession('task', '/tmp/wt-gone', 'sv/task', 'sv-1');
      await manager.updateStatus(session.id, 'cleaned_up');

      const reconciler = new SessionReconciler(
        manager,
        createMockTmuxChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      const result = await reconciler.reconcile();

      expect(result.orphanedWorktrees).toEqual([]);
    });

    it('does not modify sessions in created status', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task', 'sv-1');

      const reconciler = new SessionReconciler(
        manager,
        createMockTmuxChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      await reconciler.reconcile();

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('created');
    });

    it('does not modify sessions in done status', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task', 'sv-1');
      await manager.updateStatus(session.id, 'done');

      const reconciler = new SessionReconciler(
        manager,
        createMockTmuxChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      await reconciler.reconcile();

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('done');
    });

    it('does not modify sessions in merged status', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task', 'sv-1');
      await manager.updateStatus(session.id, 'merged');

      const reconciler = new SessionReconciler(
        manager,
        createMockTmuxChecker(new Set()),
        createMockPathChecker(new Set()),
      );

      await reconciler.reconcile();

      const reloaded = await manager.getSession(session.id);
      expect(reloaded?.status).toBe('merged');
    });

    it('handles mixed sessions correctly', async () => {
      const running = await manager.createSession('running task', '/tmp/wt1', 'sv/running', 'sv-1');
      await manager.updateStatus(running.id, 'running');

      const dead = await manager.createSession('dead task', '/tmp/wt2', 'sv/dead', 'sv-2');
      await manager.updateStatus(dead.id, 'running');

      const created = await manager.createSession('new task', '/tmp/wt3', 'sv/new', 'sv-3');

      const cleanedUp = await manager.createSession('old task', '/tmp/wt4', 'sv/old', 'sv-4');
      await manager.updateStatus(cleanedUp.id, 'cleaned_up');

      const reconciler = new SessionReconciler(
        manager,
        createMockTmuxChecker(new Set(['sv-1'])),
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
