import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: vi.fn((fn: unknown) => fn),
}));

import { PtySpawner } from './spawner.js';
import * as nodePty from 'node-pty';
import { execFile } from 'node:child_process';

const mockSpawn = vi.mocked(nodePty.spawn);
const mockExecFile = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;

function createMockPtyProcess() {
  return {
    pid: 12345,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };
}

describe('PtySpawner', () => {
  let spawner: PtySpawner;
  let mockPty: ReturnType<typeof createMockPtyProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    spawner = new PtySpawner();
    mockPty = createMockPtyProcess();
    mockSpawn.mockReturnValue(mockPty as unknown as nodePty.IPty);
  });

  describe('spawn', () => {
    it('spawns a process with the given command and arguments', () => {
      spawner.spawn({
        command: 'echo',
        args: ['hello'],
        cwd: '/tmp/test',
      });

      expect(mockSpawn).toHaveBeenCalledWith('echo', ['hello'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: '/tmp/test',
        env: process.env,
      });
    });

    it('uses custom cols and rows when provided', () => {
      spawner.spawn({
        command: 'bash',
        args: [],
        cwd: '/tmp',
        cols: 120,
        rows: 40,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'bash',
        [],
        expect.objectContaining({ cols: 120, rows: 40 }),
      );
    });

    it('uses custom env when provided', () => {
      const customEnv = { PATH: '/usr/bin', HOME: '/home/test' };

      spawner.spawn({
        command: 'bash',
        args: [],
        cwd: '/tmp',
        env: customEnv,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'bash',
        [],
        expect.objectContaining({ env: customEnv }),
      );
    });

    it('returns a handle with the process PID', () => {
      const handle = spawner.spawn({
        command: 'bash',
        args: [],
        cwd: '/tmp',
      });

      expect(handle.pid).toBe(12345);
    });

    it('forwards data events from the PTY process', () => {
      const handle = spawner.spawn({
        command: 'bash',
        args: [],
        cwd: '/tmp',
      });

      const dataCallback = vi.fn();
      handle.onData(dataCallback);

      expect(mockPty.onData).toHaveBeenCalledWith(dataCallback);
    });

    it('forwards exit events with exit code and signal', () => {
      const handle = spawner.spawn({
        command: 'bash',
        args: [],
        cwd: '/tmp',
      });

      const exitCallback = vi.fn();
      handle.onExit(exitCallback);

      // Get the wrapper function that was passed to mockPty.onExit
      const wrapperFn = mockPty.onExit.mock.calls[0][0] as (event: {
        exitCode: number;
        signal?: number;
      }) => void;
      wrapperFn({ exitCode: 0, signal: 15 });

      expect(exitCallback).toHaveBeenCalledWith(0, 15);
    });

    it('forwards write calls to the PTY process', () => {
      const handle = spawner.spawn({
        command: 'bash',
        args: [],
        cwd: '/tmp',
      });

      handle.write('hello\n');

      expect(mockPty.write).toHaveBeenCalledWith('hello\n');
    });

    it('forwards resize calls to the PTY process', () => {
      const handle = spawner.spawn({
        command: 'bash',
        args: [],
        cwd: '/tmp',
      });

      handle.resize(100, 50);

      expect(mockPty.resize).toHaveBeenCalledWith(100, 50);
    });

    it('forwards kill calls to the PTY process', () => {
      const handle = spawner.spawn({
        command: 'bash',
        args: [],
        cwd: '/tmp',
      });

      handle.kill();

      expect(mockPty.kill).toHaveBeenCalled();
    });
  });

  describe('spawnClaude', () => {
    it('spawns claude with the task description as argument', () => {
      spawner.spawnClaude('/tmp/worktree', 'fix the login bug');

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['fix the login bug'],
        expect.objectContaining({ cwd: '/tmp/worktree' }),
      );
    });

    it('returns a valid PtyHandle', () => {
      const handle = spawner.spawnClaude('/tmp/worktree', 'fix bug');

      expect(handle.pid).toBe(12345);
      expect(handle.onData).toBeTypeOf('function');
      expect(handle.onExit).toBeTypeOf('function');
      expect(handle.write).toBeTypeOf('function');
      expect(handle.kill).toBeTypeOf('function');
    });
  });

  describe('isCommandAvailable', () => {
    it('returns true when the command exists on PATH', async () => {
      mockExecFile.mockResolvedValue({ stdout: '/usr/bin/claude', stderr: '' });

      const result = await spawner.isCommandAvailable('claude');

      expect(result).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith('which', ['claude']);
    });

    it('returns false when the command is not found', async () => {
      mockExecFile.mockRejectedValue(new Error('not found'));

      const result = await spawner.isCommandAvailable('claude');

      expect(result).toBe(false);
    });
  });
});
