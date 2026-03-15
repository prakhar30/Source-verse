/**
 * Panel rendering functions for the TUI dashboard.
 *
 * Each function builds a string buffer for its panel region,
 * using ANSI escape codes for positioning and styling.
 */

import type { Session } from '../session/types.js';
import type { PanelDimensions } from './layout.js';
import { cursor, style, box, fitText, writeRaw } from './renderer.js';
import { formatStatus } from './status-indicator.js';

/** Render the left panel: session list with status indicators. */
export function renderSessionList(
  sessions: Session[],
  focusedIndex: number,
  dimensions: PanelDimensions,
): void {
  const { leftWidth, contentHeight, leftInner } = dimensions;
  const title = ' Sessions ';

  // Top border with title
  const titlePadding = leftWidth - 2 - title.length;
  writeRaw(
    cursor.moveTo(1, 1) +
      style.fg.cyan +
      box.topLeft +
      box.horizontal.repeat(Math.floor((leftWidth - 2 - title.length) / 2)) +
      style.bold +
      title +
      style.reset +
      style.fg.cyan +
      box.horizontal.repeat(Math.ceil(titlePadding / 2)) +
      box.teeDown +
      style.reset,
  );

  // Session rows
  for (let row = 0; row < contentHeight - 2; row++) {
    const y = row + 2;
    const session = sessions[row];

    writeRaw(cursor.moveTo(y, 1) + style.fg.cyan + box.vertical + style.reset);

    if (session) {
      const isFocused = row === focusedIndex;
      const number = `${row + 1}`;
      const statusIcon = formatStatus(session.status);
      const description = session.taskDescription;
      const prefix = ` ${number}. ${statusIcon} `;
      // prefix visible length: space + digit + ". " + icon + space = 6 chars for single digit
      const prefixVisibleLen = number.length + 5;
      const descWidth = leftInner - prefixVisibleLen;

      if (isFocused) {
        writeRaw(style.inverse);
      }

      writeRaw(prefix + fitText(description, descWidth));

      if (isFocused) {
        writeRaw(style.reset);
      }
    } else {
      writeRaw(' '.repeat(leftWidth - 2));
    }

    writeRaw(style.fg.cyan + box.vertical + style.reset);
  }

  // Bottom border
  writeRaw(
    cursor.moveTo(contentHeight, 1) +
      style.fg.cyan +
      box.bottomLeft +
      box.horizontal.repeat(leftWidth - 2) +
      box.teeUp +
      style.reset,
  );
}

/** Render the right panel: active session output area. */
export function renderSessionOutput(
  outputLines: string[],
  scrollOffset: number,
  dimensions: PanelDimensions,
): void {
  const { leftWidth, rightWidth, contentHeight, rightInner } = dimensions;
  const rightStart = leftWidth + 1;
  const title = ' Output ';

  // Top border with title
  const titlePadding = rightWidth - 2 - title.length;
  writeRaw(
    cursor.moveTo(1, rightStart) +
      style.fg.cyan +
      box.horizontal.repeat(Math.floor((rightWidth - 2 - title.length) / 2)) +
      style.bold +
      title +
      style.reset +
      style.fg.cyan +
      box.horizontal.repeat(Math.ceil(titlePadding / 2)) +
      box.topRight +
      style.reset,
  );

  // Output rows
  const visibleLines = contentHeight - 2;
  for (let row = 0; row < visibleLines; row++) {
    const y = row + 2;
    const lineIndex = scrollOffset + row;
    const line = outputLines[lineIndex] ?? '';

    writeRaw(
      cursor.moveTo(y, rightStart) +
        style.fg.cyan +
        box.vertical +
        style.reset +
        ' ' +
        fitText(line, rightInner) +
        style.fg.cyan +
        box.vertical +
        style.reset,
    );
  }

  // Bottom border
  writeRaw(
    cursor.moveTo(contentHeight, rightStart) +
      style.fg.cyan +
      box.horizontal.repeat(rightWidth - 2) +
      box.bottomRight +
      style.reset,
  );
}

/** Render the bottom keybindings bar. */
export function renderKeybindingsBar(dimensions: PanelDimensions): void {
  const { termWidth, contentHeight, barHeight } = dimensions;
  const barTop = contentHeight + 1;

  const bindings = [
    { key: 'Tab', desc: 'Next' },
    { key: 'S-Tab', desc: 'Prev' },
    { key: '1-9', desc: 'Jump' },
    { key: 'i', desc: 'Input' },
    { key: 'n', desc: 'New' },
    { key: 'd', desc: 'Delete' },
    { key: '?', desc: 'Help' },
    { key: 'q', desc: 'Quit' },
  ];

  const formatted = bindings
    .map((b) => `${style.bold}${style.fg.cyan}${b.key}${style.reset} ${b.desc}`)
    .join('  │  ');

  // Top border
  writeRaw(
    cursor.moveTo(barTop, 1) +
      style.fg.cyan +
      box.topLeft +
      box.horizontal.repeat(termWidth - 2) +
      box.topRight +
      style.reset,
  );

  // Bindings row
  writeRaw(
    cursor.moveTo(barTop + 1, 1) +
      style.fg.cyan +
      box.vertical +
      style.reset +
      ' ' +
      fitText(formatted, termWidth - 4) +
      ' ' +
      style.fg.cyan +
      box.vertical +
      style.reset,
  );

  // Bottom border (only if barHeight allows)
  if (barHeight >= 3) {
    writeRaw(
      cursor.moveTo(barTop + 2, 1) +
        style.fg.cyan +
        box.bottomLeft +
        box.horizontal.repeat(termWidth - 2) +
        box.bottomRight +
        style.reset,
    );
  }
}

/** Render the help overlay showing all keybindings. */
export function renderHelpOverlay(dimensions: PanelDimensions): void {
  const { termWidth, termHeight } = dimensions;
  const overlayWidth = Math.min(50, termWidth - 4);
  const overlayHeight = 16;
  const startCol = Math.floor((termWidth - overlayWidth) / 2);
  const startRow = Math.floor((termHeight - overlayHeight) / 2);

  const helpLines = [
    '',
    '  Keyboard Shortcuts',
    '  ──────────────────────────────────',
    '',
    '  Tab / Shift+Tab    Cycle sessions',
    '  1-9                Jump to session',
    '  i / Enter          Input mode',
    '  Escape             Exit input mode',
    '  n                  New session',
    '  d                  Delete session',
    '  q / Ctrl+C         Quit dashboard',
    '  ?                  Toggle this help',
    '',
    '  ──────────────────────────────────',
    '  Press ? to close',
    '',
  ];

  // Draw overlay box
  writeRaw(
    cursor.moveTo(startRow, startCol) +
      style.bg.black +
      style.fg.white +
      box.topLeft +
      box.horizontal.repeat(overlayWidth - 2) +
      box.topRight,
  );

  for (let i = 0; i < overlayHeight - 2; i++) {
    const line = helpLines[i] ?? '';
    writeRaw(
      cursor.moveTo(startRow + 1 + i, startCol) +
        box.vertical +
        fitText(line, overlayWidth - 2) +
        box.vertical,
    );
  }

  writeRaw(
    cursor.moveTo(startRow + overlayHeight - 1, startCol) +
      box.bottomLeft +
      box.horizontal.repeat(overlayWidth - 2) +
      box.bottomRight +
      style.reset,
  );
}

/** Render the empty state when no sessions exist. */
export function renderEmptyState(dimensions: PanelDimensions): void {
  const { termWidth, termHeight } = dimensions;
  const centerRow = Math.floor(termHeight / 2) - 2;
  const lines = [
    `${style.bold}${style.fg.cyan}source-verse${style.reset}`,
    '',
    `${style.fg.gray}No active sessions.${style.reset}`,
    '',
    `Press ${style.bold}n${style.reset} to create a new session`,
    `Press ${style.bold}q${style.reset} to quit`,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const col = Math.floor((termWidth - 30) / 2);
    writeRaw(cursor.moveTo(centerRow + i, col) + line);
  }
}
