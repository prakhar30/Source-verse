/**
 * Maps session status values to visual indicators (symbol + color).
 */

import type { SessionStatus } from '../session/types.js';
import { style } from './renderer.js';

export interface StatusIndicator {
  symbol: string;
  color: string;
  label: string;
}

const STATUS_MAP: Record<SessionStatus, StatusIndicator> = {
  running: { symbol: '●', color: style.fg.green, label: 'Running' },
  waiting: { symbol: '◐', color: style.fg.yellow, label: 'Waiting' },
  created: { symbol: '○', color: style.fg.gray, label: 'Idle' },
  done: { symbol: '✓', color: style.fg.cyan, label: 'Done' },
  merged: { symbol: '✓', color: style.fg.magenta, label: 'Merged' },
  cleaned_up: { symbol: '✕', color: style.fg.gray, label: 'Cleaned' },
};

export function getStatusIndicator(status: SessionStatus): StatusIndicator {
  return STATUS_MAP[status];
}

export function formatStatus(status: SessionStatus): string {
  const indicator = STATUS_MAP[status];
  return `${indicator.color}${indicator.symbol}${style.reset}`;
}
