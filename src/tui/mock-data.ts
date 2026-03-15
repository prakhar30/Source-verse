/**
 * Hardcoded mock session data for testing the TUI layout.
 * Will be replaced with real session data in issue #13.
 */

import type { Session } from '../session/types.js';

export const MOCK_SESSIONS: Session[] = [
  {
    id: 'a1b2c3d4',
    taskDescription: 'Fix login page validation bug',
    worktreePath: '/tmp/sv/worktrees/fix-login-page',
    branchName: 'sv/fix-login-page-validation-bug',
    status: 'running',
    pid: 12345,
    createdAt: '2026-03-15T10:30:00Z',
    updatedAt: '2026-03-15T14:15:00Z',
  },
  {
    id: 'e5f6g7h8',
    taskDescription: 'Add dark mode support to settings panel',
    worktreePath: '/tmp/sv/worktrees/dark-mode',
    branchName: 'sv/add-dark-mode-support',
    status: 'waiting',
    pid: 12346,
    createdAt: '2026-03-15T11:00:00Z',
    updatedAt: '2026-03-15T13:45:00Z',
  },
  {
    id: 'i9j0k1l2',
    taskDescription: 'Refactor database connection pooling',
    worktreePath: '/tmp/sv/worktrees/db-pool',
    branchName: 'sv/refactor-database-connection-pooling',
    status: 'done',
    pid: null,
    createdAt: '2026-03-15T09:00:00Z',
    updatedAt: '2026-03-15T12:30:00Z',
  },
  {
    id: 'm3n4o5p6',
    taskDescription: 'Write API documentation for v2 endpoints',
    worktreePath: '/tmp/sv/worktrees/api-docs',
    branchName: 'sv/write-api-documentation',
    status: 'created',
    pid: null,
    createdAt: '2026-03-15T13:00:00Z',
    updatedAt: '2026-03-15T13:00:00Z',
  },
  {
    id: 'q7r8s9t0',
    taskDescription: 'Upgrade Node.js from 18 to 22',
    worktreePath: '/tmp/sv/worktrees/node-upgrade',
    branchName: 'sv/upgrade-nodejs-18-to-22',
    status: 'running',
    pid: 12347,
    createdAt: '2026-03-15T08:00:00Z',
    updatedAt: '2026-03-15T14:00:00Z',
  },
];

export const MOCK_OUTPUT_LINES: string[] = [
  '$ claude --task "Fix login page validation bug"',
  '',
  "I'll help fix the login page validation bug. Let me start by examining the current code.",
  '',
  '> Reading src/pages/Login.tsx...',
  '> Reading src/utils/validation.ts...',
  '',
  'I found the issue. The email validation regex is not handling edge cases correctly.',
  "The current pattern doesn't account for plus-addressing (user+tag@domain.com).",
  '',
  'Let me fix the validation function:',
  '',
  '  // Before:',
  '  const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/;',
  '',
  '  // After:',
  '  const emailRegex = /^[a-zA-Z0-9.+_-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/;',
  '',
  '> Editing src/utils/validation.ts...',
  '> Running tests...',
  '',
  '✓ All 24 tests passed',
  '',
  'The fix adds support for the "+" character in email addresses.',
  'This resolves the validation bug for users with plus-addressed emails.',
];
