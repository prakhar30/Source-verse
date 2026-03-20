import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: vi.fn((fn: unknown) => fn),
}));

import { TmuxSpawner } from './spawner.js';
import { execFile } from 'node:child_process';

const mockExecFile = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;

describe('TmuxSpawner', () => {
  let spawner: TmuxSpawner;

  beforeEach(() => {
    vi.clearAllMocks();
    spawner = new TmuxSpawner();
  });

  describe('isCommandAvailable', () => {
    it('returns true when the command exists on PATH', async () => {
      mockExecFile.mockResolvedValue({ stdout: '/usr/bin/tmux', stderr: '' });

      const result = await spawner.isCommandAvailable('tmux');

      expect(result).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith('which', ['tmux']);
    });

    it('returns false when the command is not found', async () => {
      mockExecFile.mockRejectedValue(new Error('not found'));

      const result = await spawner.isCommandAvailable('tmux');

      expect(result).toBe(false);
    });
  });

  describe('createMainSession', () => {
    it('creates session and configures status bar and terminal behavior', async () => {
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await spawner.createMainSession('node control.js', '/home/user/repo');

      // Verify session creation
      expect(mockExecFile).toHaveBeenCalledWith('tmux', [
        'new-session',
        '-d',
        '-s',
        'sv-main',
        '-n',
        'control',
        '-c',
        '/home/user/repo',
        'node control.js',
      ]);

      // Verify status bar configuration
      expect(mockExecFile).toHaveBeenCalledWith('tmux', [
        'set-option',
        '-t',
        'sv-main',
        'status-style',
        'bg=colour235,fg=colour248',
      ]);

      expect(mockExecFile).toHaveBeenCalledWith('tmux', [
        'set-option',
        '-t',
        'sv-main',
        'status-right-length',
        '70',
      ]);

      // Verify terminal behavior: mouse enabled
      expect(mockExecFile).toHaveBeenCalledWith('tmux', [
        'set-option',
        '-t',
        'sv-main',
        'mouse',
        'on',
      ]);

      // Verify terminal behavior: clipboard enabled
      expect(mockExecFile).toHaveBeenCalledWith('tmux', [
        'set-option',
        '-t',
        'sv-main',
        'set-clipboard',
        'on',
      ]);
    });

    it('does not throw if terminal behavior options fail', async () => {
      let callCount = 0;
      mockExecFile.mockImplementation(async () => {
        callCount++;
        // Let session creation succeed, fail on some set-option calls
        if (callCount > 1 && callCount % 2 === 0) {
          throw new Error('option not supported');
        }
        return { stdout: '', stderr: '' };
      });

      await expect(spawner.createMainSession('node control.js', '/repo')).resolves.toBeUndefined();
    });
  });

  describe('createSession', () => {
    it('calls tmux new-session with correct arguments', async () => {
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await spawner.createSession({
        sessionName: 'sv-1',
        command: 'claude',
        args: ['fix the bug'],
        cwd: '/tmp/worktree',
      });

      expect(mockExecFile).toHaveBeenCalledWith('tmux', [
        'new-session',
        '-d',
        '-s',
        'sv-1',
        '-c',
        '/tmp/worktree',
        'claude fix the bug',
      ]);
    });
  });

  describe('spawnClaude', () => {
    it('creates a tmux session running claude with the task', async () => {
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await spawner.spawnClaude('sv-1', '/tmp/worktree', 'fix the login bug');

      expect(mockExecFile).toHaveBeenCalledWith('tmux', [
        'new-session',
        '-d',
        '-s',
        'sv-1',
        '-c',
        '/tmp/worktree',
        'claude fix the login bug',
      ]);
    });
  });

  describe('hasSession', () => {
    it('returns true when session exists', async () => {
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await spawner.hasSession('sv-1');

      expect(result).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith('tmux', ['has-session', '-t', 'sv-1']);
    });

    it('returns false when session does not exist', async () => {
      mockExecFile.mockRejectedValue(new Error('session not found'));

      const result = await spawner.hasSession('sv-1');

      expect(result).toBe(false);
    });
  });

  describe('captureOutput', () => {
    it('returns lines from tmux capture-pane', async () => {
      mockExecFile.mockResolvedValue({ stdout: 'line 1\nline 2\nline 3\n', stderr: '' });

      const lines = await spawner.captureOutput('sv-1');

      expect(lines).toEqual(['line 1', 'line 2', 'line 3', '']);
      expect(mockExecFile).toHaveBeenCalledWith('tmux', [
        'capture-pane',
        '-t',
        'sv-1',
        '-p',
        '-S',
        '-500',
      ]);
    });

    it('returns empty array on failure', async () => {
      mockExecFile.mockRejectedValue(new Error('fail'));

      const lines = await spawner.captureOutput('sv-1');

      expect(lines).toEqual([]);
    });
  });

  describe('sendKeys', () => {
    it('sends keys to the named session', async () => {
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await spawner.sendKeys('sv-1', 'hello');

      expect(mockExecFile).toHaveBeenCalledWith('tmux', ['send-keys', '-t', 'sv-1', 'hello']);
    });
  });

  describe('sendLine', () => {
    it('sends text followed by Enter', async () => {
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await spawner.sendLine('sv-1', 'fix the bug');

      expect(mockExecFile).toHaveBeenCalledWith('tmux', [
        'send-keys',
        '-t',
        'sv-1',
        'fix the bug',
        'Enter',
      ]);
    });
  });

  describe('killSession', () => {
    it('kills the named session', async () => {
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await spawner.killSession('sv-1');

      expect(mockExecFile).toHaveBeenCalledWith('tmux', ['kill-session', '-t', 'sv-1']);
    });

    it('does not throw when session is already dead', async () => {
      mockExecFile.mockRejectedValue(new Error('session not found'));

      await expect(spawner.killSession('sv-1')).resolves.toBeUndefined();
    });
  });

  describe('listSessions', () => {
    it('returns only sv- prefixed sessions', async () => {
      mockExecFile.mockResolvedValue({
        stdout: 'sv-1\nsv-2\nother-session\nsv-3\n',
        stderr: '',
      });

      const sessions = await spawner.listSessions();

      expect(sessions).toEqual(['sv-1', 'sv-2', 'sv-3']);
    });

    it('returns empty array when no tmux server is running', async () => {
      mockExecFile.mockRejectedValue(new Error('no server running'));

      const sessions = await spawner.listSessions();

      expect(sessions).toEqual([]);
    });
  });
});
