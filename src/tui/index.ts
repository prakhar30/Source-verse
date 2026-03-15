/**
 * TUI module — public API surface.
 */

export { startDashboard } from './dashboard.js';
export type { DashboardDeps, DashboardState } from './dashboard.js';
export { computeLayout } from './layout.js';
export type { PanelDimensions } from './layout.js';
export { getStatusIndicator, formatStatus } from './status-indicator.js';
export type { StatusIndicator } from './status-indicator.js';
export { parseKeyInput, enableRawMode, disableRawMode } from './input.js';
export type { KeyAction, KeyEvent, KeyHandler } from './input.js';
export {
  renderSessionList,
  renderSessionOutput,
  renderKeybindingsBar,
  renderHelpOverlay,
  renderEmptyState,
} from './panels.js';
export { cursor, screen, style, box, visibleLength, fitText, writeRaw } from './renderer.js';
