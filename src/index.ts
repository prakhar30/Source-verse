/**
 * source-verse — public API surface
 *
 * Module system: ESM (type: "module" in package.json)
 * Node.js target: ES2022 / NodeNext
 */

export { createProgram } from './cli/program.js';
export { isGitRepository, assertGitRepository } from './git/validation.js';
export { GitManager } from './git/manager.js';
export type { WorktreeInfo } from './git/manager.js';
export { execGit, GitCommandError } from './git/exec.js';
export { slugifyTaskName } from './git/slugify.js';
export { SessionManager } from './session/manager.js';
export type { Session, SessionStatus } from './session/types.js';
export { PtySpawner } from './pty/spawner.js';
export type { PtyHandle, SpawnOptions } from './pty/types.js';
export { loadConfig } from './config/loader.js';
export type { SourceVerseConfig, MergeDetectionConfig } from './config/types.js';
export { DEFAULT_CONFIG } from './config/types.js';
export { MergeWatcher } from './merge/watcher.js';
export type { MergeEvent, MergeCallback } from './merge/watcher.js';
export { startDashboard } from './tui/index.js';
export type { DashboardDeps, DashboardState } from './tui/index.js';
export { computeLayout } from './tui/index.js';
export type { PanelDimensions } from './tui/index.js';
export { getStatusIndicator, formatStatus } from './tui/index.js';
export type { StatusIndicator } from './tui/index.js';
export { parseKeyInput } from './tui/index.js';
export type { KeyAction, KeyEvent } from './tui/index.js';
