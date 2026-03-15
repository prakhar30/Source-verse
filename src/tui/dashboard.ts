/**
 * Main TUI dashboard — composes panels, manages state, handles input.
 *
 * Orchestrates the full-screen terminal UI with session list,
 * output panel, keybindings bar, and help overlay.
 */

import type { Session } from '../session/types.js';
import { computeLayout } from './layout.js';
import { cursor, screen, writeRaw } from './renderer.js';
import { parseKeyInput, enableRawMode, disableRawMode } from './input.js';
import {
  renderSessionList,
  renderSessionOutput,
  renderKeybindingsBar,
  renderHelpOverlay,
  renderEmptyState,
} from './panels.js';
import { MOCK_SESSIONS, MOCK_OUTPUT_LINES } from './mock-data.js';

export interface DashboardState {
  sessions: Session[];
  focusedIndex: number;
  outputLines: string[];
  scrollOffset: number;
  showHelp: boolean;
  running: boolean;
}

export function createInitialState(sessions: Session[]): DashboardState {
  return {
    sessions,
    focusedIndex: 0,
    outputLines: MOCK_OUTPUT_LINES,
    scrollOffset: 0,
    showHelp: false,
    running: true,
  };
}

function renderDashboardFrame(state: DashboardState): void {
  const termWidth = process.stdout.columns || 80;
  const termHeight = process.stdout.rows || 24;
  const dimensions = computeLayout(termWidth, termHeight);

  writeRaw(screen.clear + cursor.moveTo(1, 1));

  if (state.sessions.length === 0) {
    renderEmptyState(dimensions);
    renderKeybindingsBar(dimensions);
  } else {
    renderSessionList(state.sessions, state.focusedIndex, dimensions);
    renderSessionOutput(state.outputLines, state.scrollOffset, dimensions);
    renderKeybindingsBar(dimensions);
  }

  if (state.showHelp) {
    renderHelpOverlay(dimensions);
  }
}

function handleDashboardInput(state: DashboardState, data: Buffer): DashboardState {
  const event = parseKeyInput(data);
  if (!event) return state;

  const next = { ...state };

  switch (event.action) {
    case 'quit':
      next.running = false;
      break;

    case 'next_session':
      if (state.sessions.length > 0) {
        next.focusedIndex = (state.focusedIndex + 1) % state.sessions.length;
      }
      break;

    case 'prev_session':
      if (state.sessions.length > 0) {
        next.focusedIndex =
          (state.focusedIndex - 1 + state.sessions.length) % state.sessions.length;
      }
      break;

    case 'jump_to_session':
      if (
        event.sessionNumber !== undefined &&
        event.sessionNumber >= 1 &&
        event.sessionNumber <= state.sessions.length
      ) {
        next.focusedIndex = event.sessionNumber - 1;
      }
      break;

    case 'new_session':
      // Placeholder — will trigger real session creation in issue #13
      break;

    case 'delete_session':
      // Placeholder — will trigger real session deletion in issue #13
      break;

    case 'help':
      next.showHelp = !state.showHelp;
      break;
  }

  return next;
}

export function startDashboard(): void {
  let state = createInitialState(MOCK_SESSIONS);

  // Enter alternate screen buffer and hide cursor
  writeRaw(screen.alternateOn + cursor.hide);
  enableRawMode();

  renderDashboardFrame(state);

  const onData = (data: Buffer) => {
    const nextState = handleDashboardInput(state, data);
    if (!nextState.running) {
      cleanup();
      return;
    }
    if (nextState !== state) {
      state = nextState;
      renderDashboardFrame(state);
    }
  };

  const onResize = () => {
    renderDashboardFrame(state);
  };

  const cleanup = () => {
    process.stdin.removeListener('data', onData);
    process.stdout.removeListener('resize', onResize);
    disableRawMode();
    writeRaw(cursor.show + screen.alternateOff);
    process.exit(0);
  };

  process.stdin.on('data', onData);
  process.stdout.on('resize', onResize);
}
