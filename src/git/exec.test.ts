import { describe, it, expect } from 'vitest';
import { execGit, GitCommandError } from './exec.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('execGit', () => {
  it('returns stdout from a successful git command', async () => {
    const result = await execGit(['--version'], process.cwd());
    expect(result).toMatch(/^git version/);
  });

  it('throws GitCommandError on failure', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'sv-exec-test-'));
    try {
      await expect(execGit(['status'], tempDir)).rejects.toThrow(GitCommandError);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it('includes command and stderr in error', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'sv-exec-test-'));
    try {
      await expect(execGit(['status'], tempDir)).rejects.toMatchObject({
        command: ['status'],
        name: 'GitCommandError',
      });
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });
});
