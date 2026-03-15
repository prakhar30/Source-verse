import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isGitRepository, assertGitRepository } from './validation.js';

describe('isGitRepository', () => {
  it('returns true when .git directory exists', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'sv-test-'));
    try {
      await mkdir(join(tempDir, '.git'));
      expect(await isGitRepository(tempDir)).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it('returns false when .git directory does not exist', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'sv-test-'));
    try {
      expect(await isGitRepository(tempDir)).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it('returns false for a nonexistent directory', async () => {
    expect(await isGitRepository('/tmp/nonexistent-sv-test-dir')).toBe(false);
  });
});

describe('assertGitRepository', () => {
  it('resolves for a git repository', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'sv-test-'));
    try {
      await mkdir(join(tempDir, '.git'));
      await expect(assertGitRepository(tempDir)).resolves.toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it('throws with a clear message for a non-git directory', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'sv-test-'));
    try {
      await expect(assertGitRepository(tempDir)).rejects.toThrow(
        'Not a git repository',
      );
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });
});
