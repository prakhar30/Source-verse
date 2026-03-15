/**
 * Computes panel dimensions from terminal size.
 *
 * Layout:
 * ┌──── left (session list) ────┬──── right (session output) ────┐
 * │                             │                                 │
 * │                             │                                 │
 * ├─────────────────────────────┴─────────────────────────────────┤
 * │  keybindings bar                                              │
 * └───────────────────────────────────────────────────────────────┘
 */

export interface PanelDimensions {
  /** Total terminal columns */
  termWidth: number;
  /** Total terminal rows */
  termHeight: number;
  /** Width of the left (session list) panel including borders */
  leftWidth: number;
  /** Width of the right (output) panel including borders */
  rightWidth: number;
  /** Height of the main content area (both panels) including borders */
  contentHeight: number;
  /** Height of the bottom keybindings bar including borders */
  barHeight: number;
  /** Usable inner width of the left panel (excludes borders + padding) */
  leftInner: number;
  /** Usable inner width of the right panel (excludes borders + padding) */
  rightInner: number;
  /** Usable inner height of the content panels (excludes borders) */
  contentInner: number;
}

const MIN_LEFT_WIDTH = 30;
const LEFT_RATIO = 0.3;
const BAR_HEIGHT = 3;
const BORDER_CHARS = 3; // left border + right border + divider padding

export function computeLayout(termWidth: number, termHeight: number): PanelDimensions {
  const leftWidth = Math.max(MIN_LEFT_WIDTH, Math.floor(termWidth * LEFT_RATIO));
  const rightWidth = termWidth - leftWidth;
  const contentHeight = termHeight - BAR_HEIGHT;

  return {
    termWidth,
    termHeight,
    leftWidth,
    rightWidth,
    contentHeight,
    barHeight: BAR_HEIGHT,
    leftInner: leftWidth - BORDER_CHARS,
    rightInner: rightWidth - BORDER_CHARS,
    contentInner: contentHeight - 2, // top and bottom border rows
  };
}
