/**
 * Raw stdin keyboard input handler.
 *
 * Parses raw key sequences from stdin in raw mode and
 * dispatches to registered handlers.
 */

export type KeyAction =
  | 'next_session'
  | 'prev_session'
  | 'new_session'
  | 'delete_session'
  | 'cleanup'
  | 'quit'
  | 'help'
  | 'refresh'
  | 'jump_to_session';

export interface KeyEvent {
  action: KeyAction;
  /** For jump_to_session, the 1-based session number */
  sessionNumber?: number;
}

export type KeyHandler = (event: KeyEvent) => void;

const TAB = '\t';
const SHIFT_TAB = '\x1b[Z';
const CTRL_C = '\x03';

export function parseKeyInput(data: Buffer): KeyEvent | null {
  const raw = data.toString('utf-8');

  if (raw === 'q' || raw === CTRL_C) {
    return { action: 'quit' };
  }
  if (raw === TAB) {
    return { action: 'next_session' };
  }
  if (raw === SHIFT_TAB) {
    return { action: 'prev_session' };
  }
  if (raw === 'n') {
    return { action: 'new_session' };
  }
  if (raw === 'd') {
    return { action: 'delete_session' };
  }
  if (raw === '?' || raw === 'h') {
    return { action: 'help' };
  }
  if (raw === 'r') {
    return { action: 'refresh' };
  }
  if (raw === 'c') {
    return { action: 'cleanup' };
  }

  const digit = parseInt(raw, 10);
  if (digit >= 1 && digit <= 9) {
    return { action: 'jump_to_session', sessionNumber: digit };
  }

  return null;
}

export function enableRawMode(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
  }
}

export function disableRawMode(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}
