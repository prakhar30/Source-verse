/**
 * ANSI escape sequence helpers for terminal rendering.
 *
 * Provides low-level primitives: cursor movement, colors, clearing,
 * and box-drawing characters used by the panel renderers.
 */

const ESC = '\x1b[';

export const cursor = {
  hide: `${ESC}?25l`,
  show: `${ESC}?25h`,
  moveTo: (row: number, col: number) => `${ESC}${row};${col}H`,
  savePosition: `${ESC}s`,
  restorePosition: `${ESC}u`,
} as const;

export const screen = {
  clear: `${ESC}2J`,
  clearLine: `${ESC}2K`,
  alternateOn: `${ESC}?1049h`,
  alternateOff: `${ESC}?1049l`,
} as const;

export const style = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  inverse: `${ESC}7m`,
  fg: {
    black: `${ESC}30m`,
    red: `${ESC}31m`,
    green: `${ESC}32m`,
    yellow: `${ESC}33m`,
    blue: `${ESC}34m`,
    magenta: `${ESC}35m`,
    cyan: `${ESC}36m`,
    white: `${ESC}37m`,
    gray: `${ESC}90m`,
  },
  bg: {
    black: `${ESC}40m`,
    red: `${ESC}41m`,
    green: `${ESC}42m`,
    yellow: `${ESC}43m`,
    blue: `${ESC}44m`,
    magenta: `${ESC}45m`,
    cyan: `${ESC}46m`,
    white: `${ESC}47m`,
    gray: `${ESC}100m`,
  },
} as const;

export const box = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  teeRight: '├',
  teeLeft: '┤',
  teeDown: '┬',
  teeUp: '┴',
  cross: '┼',
} as const;

/** Strip ANSI escape codes to get the visible length of a string. */
export function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/** Pad or truncate a string to exactly `width` visible characters. */
export function fitText(text: string, width: number): string {
  const visible = visibleLength(text);
  if (visible <= width) {
    return text + ' '.repeat(width - visible);
  }
  return truncateAnsi(text, width);
}

/** Truncate a string with ANSI codes to `maxWidth` visible chars, appending ellipsis. */
function truncateAnsi(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (maxWidth <= 3) return '.'.repeat(maxWidth);

  const ansiRegex = /\x1b\[[0-9;]*m/g;
  let visibleCount = 0;
  let result = '';
  let lastIndex = 0;
  const ellipsisWidth = 1;
  const targetWidth = maxWidth - ellipsisWidth;

  let match: RegExpExecArray | null;
  while ((match = ansiRegex.exec(text)) !== null) {
    const textBefore = text.slice(lastIndex, match.index);
    for (const char of textBefore) {
      if (visibleCount >= targetWidth) break;
      result += char;
      visibleCount++;
    }
    if (visibleCount >= targetWidth) break;
    result += match[0];
    lastIndex = ansiRegex.lastIndex;
  }

  if (visibleCount < targetWidth) {
    const remaining = text.slice(lastIndex);
    for (const char of remaining) {
      if (visibleCount >= targetWidth) break;
      result += char;
      visibleCount++;
    }
  }

  return result + '…' + style.reset;
}

/** Write a string directly to stdout without a newline. */
export function writeRaw(text: string): void {
  process.stdout.write(text);
}
