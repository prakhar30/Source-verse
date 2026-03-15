import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager } from './manager.js';
import type { Session } from './types.js';

describe('SessionManager', () => {
  let tempDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sv-session-test-'));
    manager = new SessionManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('createSession', () => {
    it('creates a session with all required fields', async () => {
      const session = await manager.createSession('fix login bug', '/tmp/worktree', 'sv/fix-login');

      expect(session.id).toBeDefined();
      expect(session.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(session.taskDescription).toBe('fix login bug');
      expect(session.worktreePath).toBe('/tmp/worktree');
      expect(session.branchName).toBe('sv/fix-login');
      expect(session.status).toBe('created');
      expect(session.pid).toBeNull();
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBe(session.createdAt);
    });

    it('persists session to disk', async () => {
      await manager.createSession('task one', '/tmp/wt1', 'sv/task-one');

      const raw = await readFile(join(tempDir, 'sessions.json'), 'utf-8');
      const sessions: Session[] = JSON.parse(raw);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].taskDescription).toBe('task one');
    });

    it('appends to existing sessions', async () => {
      await manager.createSession('task one', '/tmp/wt1', 'sv/task-one');
      await manager.createSession('task two', '/tmp/wt2', 'sv/task-two');

      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it('generates unique IDs for each session', async () => {
      const first = await manager.createSession('task one', '/tmp/wt1', 'sv/task-one');
      const second = await manager.createSession('task two', '/tmp/wt2', 'sv/task-two');

      expect(first.id).not.toBe(second.id);
    });
  });

  describe('getSession', () => {
    it('returns the session by ID', async () => {
      const created = await manager.createSession('my task', '/tmp/wt', 'sv/my-task');
      const found = await manager.getSession(created.id);

      expect(found).toEqual(created);
    });

    it('returns null for an unknown ID', async () => {
      const found = await manager.getSession('nonexistent-id');
      expect(found).toBeNull();
    });

    it('returns null when no sessions exist', async () => {
      const found = await manager.getSession('any-id');
      expect(found).toBeNull();
    });
  });

  describe('listSessions', () => {
    it('returns an empty array when no sessions exist', async () => {
      const sessions = await manager.listSessions();
      expect(sessions).toEqual([]);
    });

    it('returns sessions sorted by creation time', async () => {
      const first = await manager.createSession('first', '/tmp/wt1', 'sv/first');

      // Ensure distinct timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      const second = await manager.createSession('second', '/tmp/wt2', 'sv/second');

      const sessions = await manager.listSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe(first.id);
      expect(sessions[1].id).toBe(second.id);
    });
  });

  describe('updateStatus', () => {
    it('updates the status of a session', async () => {
      const created = await manager.createSession('task', '/tmp/wt', 'sv/task');
      const updated = await manager.updateStatus(created.id, 'running');

      expect(updated.status).toBe('running');
    });

    it('updates the updatedAt timestamp', async () => {
      const created = await manager.createSession('task', '/tmp/wt', 'sv/task');

      await new Promise((resolve) => setTimeout(resolve, 10));
      const updated = await manager.updateStatus(created.id, 'running');

      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt).getTime(),
      );
    });

    it('persists the status change to disk', async () => {
      const created = await manager.createSession('task', '/tmp/wt', 'sv/task');
      await manager.updateStatus(created.id, 'done');

      const freshManager = new SessionManager(tempDir);
      const reloaded = await freshManager.getSession(created.id);

      expect(reloaded?.status).toBe('done');
    });

    it('throws for an unknown session ID', async () => {
      await expect(manager.updateStatus('nonexistent', 'running')).rejects.toThrow(
        'Session not found: nonexistent',
      );
    });

    it('supports all valid status transitions', async () => {
      const session = await manager.createSession('task', '/tmp/wt', 'sv/task');

      const statuses = ['running', 'waiting', 'done', 'merged', 'cleaned_up'] as const;

      for (const status of statuses) {
        const updated = await manager.updateStatus(session.id, status);
        expect(updated.status).toBe(status);
      }
    });
  });

  describe('updatePid', () => {
    it('sets the PID on a session', async () => {
      const created = await manager.createSession('task', '/tmp/wt', 'sv/task');
      const updated = await manager.updatePid(created.id, 42);

      expect(updated.pid).toBe(42);
    });

    it('clears the PID when set to null', async () => {
      const created = await manager.createSession('task', '/tmp/wt', 'sv/task');
      await manager.updatePid(created.id, 42);
      const cleared = await manager.updatePid(created.id, null);

      expect(cleared.pid).toBeNull();
    });

    it('updates the updatedAt timestamp', async () => {
      const created = await manager.createSession('task', '/tmp/wt', 'sv/task');

      await new Promise((resolve) => setTimeout(resolve, 10));
      const updated = await manager.updatePid(created.id, 99);

      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt).getTime(),
      );
    });

    it('persists the PID change to disk', async () => {
      const created = await manager.createSession('task', '/tmp/wt', 'sv/task');
      await manager.updatePid(created.id, 555);

      const freshManager = new SessionManager(tempDir);
      const reloaded = await freshManager.getSession(created.id);

      expect(reloaded?.pid).toBe(555);
    });

    it('throws for an unknown session ID', async () => {
      await expect(manager.updatePid('nonexistent', 1)).rejects.toThrow(
        'Session not found: nonexistent',
      );
    });
  });

  describe('removeSession', () => {
    it('removes a session by ID', async () => {
      const created = await manager.createSession('task', '/tmp/wt', 'sv/task');
      await manager.removeSession(created.id);

      const found = await manager.getSession(created.id);
      expect(found).toBeNull();
    });

    it('persists the removal to disk', async () => {
      const created = await manager.createSession('task', '/tmp/wt', 'sv/task');
      await manager.removeSession(created.id);

      const freshManager = new SessionManager(tempDir);
      const sessions = await freshManager.listSessions();
      expect(sessions).toHaveLength(0);
    });

    it('does not affect other sessions', async () => {
      const first = await manager.createSession('first', '/tmp/wt1', 'sv/first');
      const second = await manager.createSession('second', '/tmp/wt2', 'sv/second');

      await manager.removeSession(first.id);

      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(second.id);
    });

    it('throws for an unknown session ID', async () => {
      await expect(manager.removeSession('nonexistent')).rejects.toThrow(
        'Session not found: nonexistent',
      );
    });
  });

  describe('edge cases', () => {
    it('creates state directory if it does not exist', async () => {
      const nestedDir = join(tempDir, 'nested', 'deep');
      const nestedManager = new SessionManager(nestedDir);

      await nestedManager.createSession('task', '/tmp/wt', 'sv/task');

      const sessions = await nestedManager.listSessions();
      expect(sessions).toHaveLength(1);
    });

    it('handles corrupt JSON gracefully', async () => {
      await mkdir(tempDir, { recursive: true });
      await writeFile(join(tempDir, 'sessions.json'), '{ broken json !!!', 'utf-8');

      const sessions = await manager.listSessions();
      expect(sessions).toEqual([]);
    });

    it('handles non-array JSON gracefully', async () => {
      await mkdir(tempDir, { recursive: true });
      await writeFile(join(tempDir, 'sessions.json'), '{"not": "an array"}', 'utf-8');

      const sessions = await manager.listSessions();
      expect(sessions).toEqual([]);
    });

    it('handles empty file gracefully', async () => {
      await mkdir(tempDir, { recursive: true });
      await writeFile(join(tempDir, 'sessions.json'), '', 'utf-8');

      const sessions = await manager.listSessions();
      expect(sessions).toEqual([]);
    });
  });
});
