/**
 * TUI module — public API surface.
 */

export { startControlPanel } from './control-panel.js';
export type { ControlPanelDeps } from './control-panel.js';
export { getStatusIndicator, formatStatus } from './status-indicator.js';
export type { StatusIndicator } from './status-indicator.js';
export { parseKeyInput, enableRawMode, disableRawMode } from './input.js';
export type { KeyAction, KeyEvent, KeyHandler } from './input.js';
export { cursor, screen, style, box, visibleLength, fitText, writeRaw } from './renderer.js';
