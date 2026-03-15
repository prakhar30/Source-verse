import { describe, it, expect } from 'vitest';
import { createInitialState } from './dashboard.js';
import { MOCK_SESSIONS, MOCK_OUTPUT_LINES } from './mock-data.js';

describe('createInitialState', () => {
  it('creates state with provided sessions', () => {
    const state = createInitialState(MOCK_SESSIONS);
    expect(state.sessions).toBe(MOCK_SESSIONS);
    expect(state.focusedIndex).toBe(0);
    expect(state.showHelp).toBe(false);
    expect(state.running).toBe(true);
    expect(state.scrollOffset).toBe(0);
  });

  it('creates state with empty sessions', () => {
    const state = createInitialState([]);
    expect(state.sessions).toHaveLength(0);
    expect(state.focusedIndex).toBe(0);
  });

  it('initializes output lines from mock data', () => {
    const state = createInitialState(MOCK_SESSIONS);
    expect(state.outputLines).toBe(MOCK_OUTPUT_LINES);
  });
});
