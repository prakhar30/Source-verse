import { describe, it, expect } from 'vitest';
import { slugifyTaskName } from './slugify.js';

describe('slugifyTaskName', () => {
  it('converts a simple task to sv/ branch name', () => {
    expect(slugifyTaskName('fix login bug')).toBe('sv/fix-login-bug');
  });

  it('lowercases the input', () => {
    expect(slugifyTaskName('Fix Login Bug')).toBe('sv/fix-login-bug');
  });

  it('replaces special characters with hyphens', () => {
    expect(slugifyTaskName('add user@auth & session!')).toBe('sv/add-user-auth-session');
  });

  it('collapses consecutive hyphens', () => {
    expect(slugifyTaskName('fix---the---bug')).toBe('sv/fix-the-bug');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugifyTaskName('--fix the bug--')).toBe('sv/fix-the-bug');
  });

  it('truncates long task names to 50 characters', () => {
    const longTask = 'a'.repeat(100);
    const result = slugifyTaskName(longTask);
    expect(result.length).toBeLessThanOrEqual(3 + 50); // "sv/" + 50
  });

  it('does not end with a hyphen after truncation', () => {
    const task = 'fix-the-very-long-bug-that-requires-many-words-to-describe-fully';
    const result = slugifyTaskName(task);
    expect(result).not.toMatch(/-$/);
  });

  it('throws on empty string', () => {
    expect(() => slugifyTaskName('')).toThrow('Task description cannot be empty');
  });

  it('throws on whitespace-only string', () => {
    expect(() => slugifyTaskName('   ')).toThrow('Task description cannot be empty');
  });

  it('throws on string with no alphanumeric characters', () => {
    expect(() => slugifyTaskName('---!!!')).toThrow('at least one alphanumeric character');
  });
});
