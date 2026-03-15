import { describe, it, expect } from 'vitest';
import { visibleLength, fitText, cursor, style, box } from './renderer.js';

describe('visibleLength', () => {
  it('returns length of plain text', () => {
    expect(visibleLength('hello')).toBe(5);
  });

  it('ignores ANSI color codes', () => {
    expect(visibleLength(`${style.fg.red}hello${style.reset}`)).toBe(5);
  });

  it('handles multiple ANSI codes', () => {
    const text = `${style.bold}${style.fg.cyan}AB${style.reset}${style.fg.green}CD${style.reset}`;
    expect(visibleLength(text)).toBe(4);
  });

  it('returns 0 for empty string', () => {
    expect(visibleLength('')).toBe(0);
  });

  it('returns 0 for ANSI-only string', () => {
    expect(visibleLength(style.fg.red + style.reset)).toBe(0);
  });
});

describe('fitText', () => {
  it('pads short text with spaces', () => {
    const result = fitText('hi', 5);
    expect(result).toBe('hi   ');
    expect(visibleLength(result)).toBe(5);
  });

  it('returns exact-width text unchanged', () => {
    expect(fitText('hello', 5)).toBe('hello');
  });

  it('truncates long text with ellipsis', () => {
    const result = fitText('hello world', 6);
    expect(visibleLength(result)).toBeLessThanOrEqual(6);
    expect(result).toContain('…');
  });

  it('handles text with ANSI codes', () => {
    const text = `${style.fg.red}hello${style.reset}`;
    const result = fitText(text, 10);
    expect(visibleLength(result)).toBe(10);
  });

  it('returns empty string for width 0', () => {
    expect(fitText('hello', 0)).toBe('');
  });
});

describe('cursor', () => {
  it('generates correct moveTo sequence', () => {
    expect(cursor.moveTo(5, 10)).toBe('\x1b[5;10H');
  });

  it('has hide and show sequences', () => {
    expect(cursor.hide).toBe('\x1b[?25l');
    expect(cursor.show).toBe('\x1b[?25h');
  });
});

describe('box', () => {
  it('has all box-drawing characters', () => {
    expect(box.topLeft).toBe('┌');
    expect(box.topRight).toBe('┐');
    expect(box.bottomLeft).toBe('└');
    expect(box.bottomRight).toBe('┘');
    expect(box.horizontal).toBe('─');
    expect(box.vertical).toBe('│');
  });
});
