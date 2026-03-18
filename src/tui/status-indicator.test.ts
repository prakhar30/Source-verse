import { describe, it, expect } from 'vitest';
import { getStatusIndicator, formatStatus } from './status-indicator.js';
import { style } from './renderer.js';

describe('getStatusIndicator', () => {
  it('returns correct indicator for running', () => {
    const indicator = getStatusIndicator('running');
    expect(indicator.symbol).toBe('●');
    expect(indicator.label).toBe('Running');
    expect(indicator.color).toBe(style.fg.green);
  });

  it('returns correct indicator for waiting', () => {
    const indicator = getStatusIndicator('waiting');
    expect(indicator.symbol).toBe('◐');
    expect(indicator.label).toBe('Waiting');
    expect(indicator.color).toBe(style.fg.yellow);
  });

  it('returns correct indicator for created (idle)', () => {
    const indicator = getStatusIndicator('created');
    expect(indicator.symbol).toBe('○');
    expect(indicator.label).toBe('Idle');
  });

  it('returns correct indicator for done', () => {
    const indicator = getStatusIndicator('done');
    expect(indicator.symbol).toBe('✓');
    expect(indicator.label).toBe('Done');
  });

  it('returns correct indicator for merged', () => {
    const indicator = getStatusIndicator('merged');
    expect(indicator.symbol).toBe('✓');
    expect(indicator.label).toBe('Merged');
  });

  it('returns correct indicator for suspended', () => {
    const indicator = getStatusIndicator('suspended');
    expect(indicator.symbol).toBe('⏸');
    expect(indicator.label).toBe('Suspended');
    expect(indicator.color).toBe(style.fg.yellow);
  });

  it('returns correct indicator for cleaned_up', () => {
    const indicator = getStatusIndicator('cleaned_up');
    expect(indicator.symbol).toBe('✕');
    expect(indicator.label).toBe('Cleaned');
  });
});

describe('formatStatus', () => {
  it('wraps symbol with color codes', () => {
    const result = formatStatus('running');
    expect(result).toContain('●');
    expect(result).toContain(style.fg.green);
    expect(result).toContain(style.reset);
  });

  it('wraps done symbol with cyan', () => {
    const result = formatStatus('done');
    expect(result).toContain('✓');
    expect(result).toContain(style.fg.cyan);
  });
});
