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
export { SessionReconciler } from './session/reconciler.js';
export type { TmuxChecker, PathChecker, ReconcileResult } from './session/reconciler.js';
export { TmuxSpawner, MAIN_SESSION } from './pty/spawner.js';
export type { TmuxSessionInfo, SpawnOptions, WindowInfo } from './pty/types.js';
export { loadConfig } from './config/loader.js';
export type { SourceVerseConfig, MergeDetectionConfig, WorktreeConfig } from './config/types.js';
export { DEFAULT_CONFIG, DEFAULT_CACHE_DIRS } from './config/types.js';
export { copyBuildCaches, warmDiskCache, reflinkCopyDir, getReflinkCopyArgs } from './platform/copy.js';
export type { CopyCacheResult, CopiedDir } from './platform/copy.js';
export { MergeWatcher } from './merge/watcher.js';
export type { MergeEvent, MergeCallback } from './merge/watcher.js';
export { startControlPanel } from './tui/index.js';
export type { ControlPanelDeps } from './tui/index.js';
export { getStatusIndicator, formatStatus } from './tui/index.js';
export type { StatusIndicator } from './tui/index.js';
export { parseKeyInput } from './tui/index.js';
export type { KeyAction, KeyEvent } from './tui/index.js';
export {
  runPreflight,
  isCommandInstalled,
  assertTmuxInstalled,
  checkDiskSpace,
  getAvailableDiskSpaceBytes,
} from './preflight/checks.js';
export type { PreflightResult, PreflightError } from './preflight/checks.js';
