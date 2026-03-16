import { describe, it, expect } from 'vitest';
import {
  createProgram,
  isGitRepository,
  assertGitRepository,
  GitManager,
  execGit,
  GitCommandError,
  slugifyTaskName,
  SessionManager,
  PtySpawner,
  runPreflight,
  isCommandInstalled,
  checkDiskSpace,
  getAvailableDiskSpaceBytes,
} from './index.js';

describe('public API exports', () => {
  it('exports createProgram', () => {
    expect(typeof createProgram).toBe('function');
  });

  it('exports isGitRepository', () => {
    expect(typeof isGitRepository).toBe('function');
  });

  it('exports assertGitRepository', () => {
    expect(typeof assertGitRepository).toBe('function');
  });

  it('exports GitManager', () => {
    expect(typeof GitManager).toBe('function');
  });

  it('exports execGit', () => {
    expect(typeof execGit).toBe('function');
  });

  it('exports GitCommandError', () => {
    expect(typeof GitCommandError).toBe('function');
  });

  it('exports slugifyTaskName', () => {
    expect(typeof slugifyTaskName).toBe('function');
  });

  it('exports SessionManager', () => {
    expect(typeof SessionManager).toBe('function');
  });

  it('exports PtySpawner', () => {
    expect(typeof PtySpawner).toBe('function');
  });

  it('exports runPreflight', () => {
    expect(typeof runPreflight).toBe('function');
  });

  it('exports isCommandInstalled', () => {
    expect(typeof isCommandInstalled).toBe('function');
  });

  it('exports checkDiskSpace', () => {
    expect(typeof checkDiskSpace).toBe('function');
  });

  it('exports getAvailableDiskSpaceBytes', () => {
    expect(typeof getAvailableDiskSpaceBytes).toBe('function');
  });
});
