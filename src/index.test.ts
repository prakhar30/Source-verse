import { describe, it, expect } from 'vitest';
import { createProgram, isGitRepository, assertGitRepository } from './index.js';

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
});
