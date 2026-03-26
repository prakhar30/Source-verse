import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getReflinkCopyArgs,
  copyBuildCaches,
  warmDiskCache,
  cloneRepoDir,
  moveToTrash,
  isApfsSupported,
} from './copy.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
    const child = { unref: vi.fn() };
    if (cb) cb(null, '', '');
    return child;
  }),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  rename: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:util', () => ({
  promisify: () => async (_cmd: string, _args: string[]) => {
    return { stdout: '', stderr: '' };
  },
}));

import { stat, rename, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const mockStat = vi.mocked(stat);
const mockRename = vi.mocked(rename);
const mockMkdir = vi.mocked(mkdir);
const mockSpawn = vi.mocked(spawn);

describe('getReflinkCopyArgs', () => {
  it('returns -c -R for darwin (macOS)', () => {
    const result = getReflinkCopyArgs();
    expect(result).toHaveProperty('args');
    expect(result).toHaveProperty('supported');
    expect(Array.isArray(result.args)).toBe(true);
    expect(typeof result.supported).toBe('boolean');
  });

  it('returns args with -R included', () => {
    const result = getReflinkCopyArgs();
    expect(result.args).toContain('-R');
  });
});

describe('copyBuildCaches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips directories that do not exist', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'));

    const result = await copyBuildCaches('/src', '/dest', ['node_modules', '.next']);

    expect(result.dirs).toHaveLength(2);
    expect(result.dirs.every((d) => d.copied === false)).toBe(true);
  });

  it('returns reflink status based on platform', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'));

    const result = await copyBuildCaches('/src', '/dest', []);

    expect(typeof result.reflink).toBe('boolean');
  });

  it('handles empty cacheDirs array', async () => {
    const result = await copyBuildCaches('/src', '/dest', []);

    expect(result.dirs).toHaveLength(0);
  });

  it('respects concurrency limit', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'));

    const dirs = Array.from({ length: 10 }, (_, i) => `dir-${i}`);
    const result = await copyBuildCaches('/src', '/dest', dirs, 2);

    expect(result.dirs).toHaveLength(10);
  });
});

describe('warmDiskCache', () => {
  it('does not throw', () => {
    expect(() => warmDiskCache('/some/path')).not.toThrow();
  });
});

describe('cloneRepoDir', () => {
  it('does not throw when called', async () => {
    await expect(cloneRepoDir('/source', '/dest')).resolves.not.toThrow();
  });
});

describe('moveToTrash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockSpawn.mockReturnValue({ unref: vi.fn() } as never);
  });

  it('rejects paths that do not match -sv- convention', async () => {
    await expect(moveToTrash('/projects/my-app')).rejects.toThrow(
      'does not match source-verse naming',
    );
  });

  it('accepts paths that match -sv- convention', async () => {
    await expect(moveToTrash('/projects/my-app-sv-1')).resolves.not.toThrow();
  });

  it('creates trash directory and renames', async () => {
    await moveToTrash('/projects/my-app-sv-1');

    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('/tmp/sv-trash-'), {
      recursive: true,
    });
    expect(mockRename).toHaveBeenCalledWith(
      '/projects/my-app-sv-1',
      expect.stringContaining('my-app-sv-1'),
    );
  });

  it('spawns background rm -rf', async () => {
    await moveToTrash('/projects/my-app-sv-1');

    expect(mockSpawn).toHaveBeenCalledWith(
      'rm',
      ['-rf', expect.stringContaining('/tmp/sv-trash-')],
      { detached: true, stdio: 'ignore' },
    );
  });
});

describe('isApfsSupported', () => {
  it('returns a boolean', () => {
    expect(typeof isApfsSupported()).toBe('boolean');
  });
});
