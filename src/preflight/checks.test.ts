import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assertGitInstalled,
  assertTmuxInstalled,
  assertIsGitRepository,
  assertHasRemote,
  assertDirectoryWritable,
  checkDiskSpace,
  getAvailableDiskSpaceBytes,
  runPreflight,
  isCommandInstalled,
} from './checks.js';

vi.mock('node:child_process', () => {
  const fn = vi.fn();
  // Add custom promisify so util.promisify returns {stdout, stderr}
  const customPromisify = Symbol.for('nodejs.util.promisify.custom');
  (fn as Record<symbol, unknown>)[customPromisify] = (...args: unknown[]) => {
    return new Promise((resolve, reject) => {
      fn(...args, (error: Error | null, stdout: string, stderr: string) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
    });
  };
  return { execFile: fn };
});

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  constants: { F_OK: 0, W_OK: 2 },
}));

vi.mock('../git/validation.js', () => ({
  isGitRepository: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { isGitRepository } from '../git/validation.js';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
const mockAccess = access as unknown as ReturnType<typeof vi.fn>;
const mockIsGitRepo = isGitRepository as unknown as ReturnType<typeof vi.fn>;

function setupExecFile(
  handler: (cmd: string, args: string[]) => { stdout?: string; error?: Error },
) {
  mockExecFile.mockImplementation((...callArgs: unknown[]) => {
    const cmd = callArgs[0] as string;
    const args = callArgs[1] as string[];
    const cb = callArgs[callArgs.length - 1] as Function;
    const result = handler(cmd, args);
    if (result.error) {
      cb(result.error, '', 'command failed');
    } else {
      cb(null, result.stdout ?? '', '');
    }
  });
}

describe('isCommandInstalled', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true when command is found', async () => {
    setupExecFile(() => ({ stdout: '/usr/bin/git' }));
    expect(await isCommandInstalled('git')).toBe(true);
  });

  it('returns false when command is not found', async () => {
    setupExecFile(() => ({ error: new Error('not found') }));
    expect(await isCommandInstalled('nonexistent')).toBe(false);
  });
});

describe('assertGitInstalled', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when git is installed', async () => {
    setupExecFile(() => ({ stdout: '/usr/bin/git' }));
    expect(await assertGitInstalled()).toBeNull();
  });

  it('returns error when git is not installed', async () => {
    setupExecFile(() => ({ error: new Error('not found') }));
    const error = await assertGitInstalled();
    expect(error).not.toBeNull();
    expect(error!.check).toBe('git');
    expect(error!.message).toContain('Git is not installed');
  });
});

describe('assertIsGitRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null for a git repository', async () => {
    mockIsGitRepo.mockResolvedValue(true);
    expect(await assertIsGitRepository('/repo')).toBeNull();
  });

  it('returns error for non-git directory', async () => {
    mockIsGitRepo.mockResolvedValue(false);
    const error = await assertIsGitRepository('/not-repo');
    expect(error).not.toBeNull();
    expect(error!.check).toBe('git-repo');
    expect(error!.message).toContain('Not a git repository');
  });
});

describe('assertHasRemote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when remotes exist', async () => {
    setupExecFile(() => ({ stdout: 'origin\n' }));
    expect(await assertHasRemote('/repo')).toBeNull();
  });

  it('returns error when no remotes configured', async () => {
    setupExecFile(() => ({ stdout: '' }));
    const error = await assertHasRemote('/repo');
    expect(error).not.toBeNull();
    expect(error!.check).toBe('git-remote');
    expect(error!.message).toContain('No git remote configured');
  });

  it('returns error when command fails', async () => {
    setupExecFile(() => ({ error: new Error('fail') }));
    const error = await assertHasRemote('/repo');
    expect(error).not.toBeNull();
    expect(error!.check).toBe('git-remote');
  });
});

describe('assertDirectoryWritable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when directory is writable', async () => {
    mockAccess.mockResolvedValue(undefined);
    expect(await assertDirectoryWritable('/repo')).toBeNull();
  });

  it('returns error when directory is not writable', async () => {
    mockAccess.mockRejectedValue(new Error('EACCES'));
    const error = await assertDirectoryWritable('/repo');
    expect(error).not.toBeNull();
    expect(error!.check).toBe('permissions');
    expect(error!.message).toContain('Permission denied');
  });
});

describe('getAvailableDiskSpaceBytes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns available bytes from df output', async () => {
    setupExecFile(() => ({ stdout: '     Avail\n5368709120\n' }));
    const bytes = await getAvailableDiskSpaceBytes('/repo');
    expect(bytes).toBe(5368709120);
  });

  it('returns null when df fails', async () => {
    setupExecFile(() => ({ error: new Error('fail') }));
    expect(await getAvailableDiskSpaceBytes('/repo')).toBeNull();
  });

  it('returns null for non-numeric output', async () => {
    setupExecFile(() => ({ stdout: '     Avail\nnot-a-number\n' }));
    expect(await getAvailableDiskSpaceBytes('/repo')).toBeNull();
  });
});

describe('checkDiskSpace', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when enough space is available', async () => {
    setupExecFile(() => ({ stdout: '     Avail\n5368709120\n' }));
    expect(await checkDiskSpace('/repo')).toBeNull();
  });

  it('returns warning when space is below threshold', async () => {
    setupExecFile(() => ({ stdout: '     Avail\n500000000\n' }));
    const warning = await checkDiskSpace('/repo');
    expect(warning).not.toBeNull();
    expect(warning).toContain('Low disk space');
  });

  it('returns null when df fails', async () => {
    setupExecFile(() => ({ error: new Error('fail') }));
    expect(await checkDiskSpace('/repo')).toBeNull();
  });

  it('uses custom threshold', async () => {
    setupExecFile(() => ({ stdout: '     Avail\n500000000\n' }));
    expect(await checkDiskSpace('/repo', 100_000_000)).toBeNull();
  });
});

describe('assertTmuxInstalled', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when tmux is installed', async () => {
    setupExecFile(() => ({ stdout: '/usr/bin/tmux' }));
    expect(await assertTmuxInstalled()).toBeNull();
  });

  it('returns error when tmux is not installed', async () => {
    setupExecFile(() => ({ error: new Error('not found') }));
    const error = await assertTmuxInstalled();
    expect(error).not.toBeNull();
    expect(error!.check).toBe('tmux');
    expect(error!.message).toContain('tmux is not installed');
  });
});

describe('runPreflight', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns ok when all checks pass', async () => {
    setupExecFile((cmd, _args) => {
      if (cmd === 'which') return { stdout: '/usr/bin/found' };
      if (cmd === 'git') return { stdout: 'origin\n' };
      if (cmd === 'df') return { stdout: '     Avail\n5368709120\n' };
      return { stdout: '' };
    });
    mockIsGitRepo.mockResolvedValue(true);
    mockAccess.mockResolvedValue(undefined);

    const result = await runPreflight('/repo');
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when tmux is not installed', async () => {
    setupExecFile(() => ({ error: new Error('not found') }));

    const result = await runPreflight('/repo');
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.check).toBe('tmux');
  });

  it('returns error when git is not installed but tmux is', async () => {
    let whichCallCount = 0;
    setupExecFile((cmd) => {
      if (cmd === 'which') {
        whichCallCount++;
        // First which call is for tmux (pass), second is for git (fail)
        if (whichCallCount === 1) return { stdout: '/usr/bin/tmux' };
        return { error: new Error('not found') };
      }
      return { error: new Error('fail') };
    });

    const result = await runPreflight('/repo');
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.check).toBe('git');
  });

  it('returns error when not a git repo', async () => {
    setupExecFile((cmd) => {
      if (cmd === 'which') return { stdout: '/usr/bin/found' };
      return { error: new Error('fail') };
    });
    mockIsGitRepo.mockResolvedValue(false);

    const result = await runPreflight('/repo');
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.check).toBe('git-repo');
  });

  it('includes disk space warning when space is low', async () => {
    setupExecFile((cmd) => {
      if (cmd === 'which') return { stdout: '/usr/bin/found' };
      if (cmd === 'git') return { stdout: 'origin\n' };
      if (cmd === 'df') return { stdout: '     Avail\n500000000\n' };
      return { stdout: '' };
    });
    mockIsGitRepo.mockResolvedValue(true);
    mockAccess.mockResolvedValue(undefined);

    const result = await runPreflight('/repo');
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Low disk space');
  });

  it('stops early when tmux not installed — does not check git', async () => {
    setupExecFile(() => ({ error: new Error('not found') }));

    const result = await runPreflight('/repo');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.check).toBe('tmux');
    expect(mockIsGitRepo).not.toHaveBeenCalled();
  });
});
