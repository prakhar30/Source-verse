import { describe, it, expect } from 'vitest';
import { createInitialState } from './dashboard.js';
import type { Session } from '../session/types.js';

const TEST_SESSIONS: Session[] = [
  {
    id: 'sess-1',
    taskDescription: 'Fix login bug',
    worktreePath: '/tmp/worktree-1',
    branchName: 'sv/fix-login-bug',
    tmuxSessionName: 'sv-1',
    status: 'running',
    pid: 1234,
    createdAt: '2026-03-15T10:00:00Z',
    updatedAt: '2026-03-15T10:00:00Z',
  },
  {
    id: 'sess-2',
    taskDescription: 'Add dark mode',
    worktreePath: '/tmp/worktree-2',
    branchName: 'sv/add-dark-mode',
    tmuxSessionName: 'sv-2',
    status: 'done',
    pid: null,
    createdAt: '2026-03-15T11:00:00Z',
    updatedAt: '2026-03-15T12:00:00Z',
  },
];

describe('createInitialState', () => {
  it('creates state with provided sessions', () => {
    const state = createInitialState(TEST_SESSIONS);
    expect(state.sessions).toBe(TEST_SESSIONS);
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

  it('initializes inputMode as false', () => {
    const state = createInitialState(TEST_SESSIONS);
    expect(state.inputMode).toBe(false);
  });

  it('initializes promptMode as null', () => {
    const state = createInitialState(TEST_SESSIONS);
    expect(state.promptMode).toBeNull();
  });
});
