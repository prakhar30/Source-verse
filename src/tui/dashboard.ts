/**
 * Main TUI dashboard — composes panels, manages state, handles input.
 *
 * Uses tmux for session management: output is polled via capture-pane,
 * input is sent via send-keys, sessions persist independently.
 */

import type { Session } from '../session/types.js';
import type { SessionManager } from '../session/manager.js';
import type { GitManager } from '../git/manager.js';
import type { TmuxSpawner } from '../pty/spawner.js';
import type { MergeDetectionConfig } from '../config/types.js';
import { slugifyTaskName } from '../git/slugify.js';
import { MergeWatcher } from '../merge/watcher.js';
import { computeLayout } from './layout.js';
import { cursor, screen, writeRaw, style } from './renderer.js';
import { parseKeyInput, enableRawMode, disableRawMode } from './input.js';
import {
  renderSessionList,
  renderSessionOutput,
  renderKeybindingsBar,
  renderHelpOverlay,
  renderEmptyState,
} from './panels.js';

export interface DashboardDeps {
  sessionManager: SessionManager;
  gitManager: GitManager;
  tmuxSpawner: TmuxSpawner;
  repoPath: string;
  mergeDetectionConfig?: MergeDetectionConfig;
}

export interface DashboardState {
  sessions: Session[];
  focusedIndex: number;
  scrollOffset: number;
  showHelp: boolean;
  running: boolean;
  inputMode: boolean;
  promptMode: PromptMode | null;
}

interface PromptMode {
  label: string;
  value: string;
  onSubmit: (value: string) => Promise<void>;
}

/** Per-session output lines, keyed by session ID. */
const outputBuffers = new Map<string, string[]>();

const MAX_OUTPUT_LINES = 5000;
const OUTPUT_POLL_MS = 1000;

export function createInitialState(sessions: Session[]): DashboardState {
  return {
    sessions,
    focusedIndex: 0,
    scrollOffset: 0,
    showHelp: false,
    running: true,
    inputMode: false,
    promptMode: null,
  };
}

function getOutputLines(state: DashboardState): string[] {
  const session = state.sessions[state.focusedIndex];
  if (!session) return [];
  return outputBuffers.get(session.id) ?? [];
}

function setOutputBuffer(sessionId: string, lines: string[]): void {
  if (lines.length > MAX_OUTPUT_LINES) {
    outputBuffers.set(sessionId, lines.slice(lines.length - MAX_OUTPUT_LINES));
  } else {
    outputBuffers.set(sessionId, lines);
  }
}

function autoScrollOffset(state: DashboardState): number {
  const termHeight = process.stdout.rows || 24;
  const dimensions = computeLayout(process.stdout.columns || 80, termHeight);
  const visibleLines = dimensions.contentInner;
  const lines = getOutputLines(state);
  return Math.max(0, lines.length - visibleLines);
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
    const outputLines = getOutputLines(state);
    renderSessionList(state.sessions, state.focusedIndex, dimensions);
    renderSessionOutput(outputLines, state.scrollOffset, dimensions);
    renderKeybindingsBar(dimensions);
  }

  if (state.showHelp) {
    renderHelpOverlay(dimensions);
  }

  if (state.inputMode) {
    renderModeIndicator('INPUT', termWidth, termHeight);
  }

  if (state.promptMode) {
    renderPromptBar(state.promptMode, termWidth, termHeight);
  }
}

function renderModeIndicator(mode: string, termWidth: number, termHeight: number): void {
  const label = ` ${mode} `;
  const col = termWidth - label.length;
  writeRaw(
    cursor.moveTo(termHeight, col) +
      style.bg.cyan +
      style.fg.black +
      style.bold +
      label +
      style.reset,
  );
}

function renderPromptBar(prompt: PromptMode, termWidth: number, _termHeight: number): void {
  const maxValueLen = termWidth - prompt.label.length - 4;
  const displayValue =
    prompt.value.length > maxValueLen ? prompt.value.slice(-maxValueLen) : prompt.value;
  const text = `${prompt.label}: ${displayValue}`;
  const barRow = process.stdout.rows || 24;
  writeRaw(
    cursor.moveTo(barRow, 1) + screen.clearLine + style.bold + text + style.reset + cursor.show,
  );
}

async function refreshSessions(
  state: DashboardState,
  deps: DashboardDeps,
): Promise<DashboardState> {
  const sessions = await deps.sessionManager.listSessions();
  const next = { ...state, sessions };
  if (next.focusedIndex >= sessions.length) {
    next.focusedIndex = Math.max(0, sessions.length - 1);
  }
  return next;
}

/**
 * Poll tmux capture-pane for every running session and update output buffers.
 */
async function pollOutputs(state: DashboardState, deps: DashboardDeps): Promise<void> {
  for (const session of state.sessions) {
    if (
      (session.status === 'running' || session.status === 'waiting') &&
      session.tmuxSessionName
    ) {
      const alive = await deps.tmuxSpawner.hasSession(session.tmuxSessionName);
      if (alive) {
        const lines = await deps.tmuxSpawner.captureOutput(session.tmuxSessionName);
        setOutputBuffer(session.id, lines);
      } else {
        // Session died since last check
        await deps.sessionManager.updateStatus(session.id, 'done');
        const existing = outputBuffers.get(session.id) ?? [];
        existing.push('', '[tmux session ended]');
        outputBuffers.set(session.id, existing);
      }
    }
  }
}

async function reconcileSessionStatuses(
  state: DashboardState,
  deps: DashboardDeps,
): Promise<DashboardState> {
  for (const session of state.sessions) {
    if (session.status === 'running' && session.tmuxSessionName) {
      const alive = await deps.tmuxSpawner.hasSession(session.tmuxSessionName);
      if (!alive) {
        await deps.sessionManager.updateStatus(session.id, 'done');
      }
    }
  }
  return refreshSessions(state, deps);
}

async function generateSessionId(deps: DashboardDeps): Promise<string> {
  const existing = await deps.gitManager.listWorktrees();
  const usedIds = existing.map((w) => Number(w.sessionId)).filter(Number.isFinite);
  const nextId = usedIds.length > 0 ? Math.max(...usedIds) + 1 : 1;
  return String(nextId);
}

async function createNewSession(
  taskDescription: string,
  state: DashboardState,
  deps: DashboardDeps,
  renderCallback: () => void,
): Promise<DashboardState> {
  const branchName = slugifyTaskName(taskDescription);
  const sessionId = await generateSessionId(deps);
  const tmuxSessionName = `sv-${sessionId}`;
  const worktreePath = await deps.gitManager.createWorktree(sessionId, branchName);
  const session = await deps.sessionManager.createSession(
    taskDescription,
    worktreePath,
    branchName,
    tmuxSessionName,
  );

  const claudeAvailable = await deps.tmuxSpawner.isCommandAvailable('claude');
  if (claudeAvailable) {
    await deps.tmuxSpawner.spawnClaude(tmuxSessionName, worktreePath, taskDescription);
    await deps.sessionManager.updateStatus(session.id, 'running');
    setOutputBuffer(session.id, ['[Claude Code started in tmux session ' + tmuxSessionName + ']']);
  } else {
    setOutputBuffer(session.id, [
      '[Claude Code not found on PATH \u2014 worktree created but no session spawned]',
    ]);
  }

  const next = await refreshSessions(state, deps);
  const newIndex = next.sessions.findIndex((s) => s.id === session.id);
  if (newIndex !== -1) {
    next.focusedIndex = newIndex;
  }
  next.scrollOffset = 0;
  renderCallback();
  return next;
}

async function deleteSession(state: DashboardState, deps: DashboardDeps): Promise<DashboardState> {
  const session = state.sessions[state.focusedIndex];
  if (!session) return state;

  // Kill tmux session if alive
  if (session.tmuxSessionName) {
    await deps.tmuxSpawner.killSession(session.tmuxSessionName);
  }

  await deps.sessionManager.updateStatus(session.id, 'done');

  const existing = outputBuffers.get(session.id) ?? [];
  existing.push('', '[Session stopped]');
  outputBuffers.set(session.id, existing);

  return refreshSessions(state, deps);
}

export async function startDashboard(deps: DashboardDeps): Promise<void> {
  const sessions = await deps.sessionManager.listSessions();
  let state = createInitialState(sessions);

  writeRaw(screen.alternateOn + cursor.hide);
  enableRawMode();

  const render = () => {
    state.scrollOffset = autoScrollOffset(state);
    renderDashboardFrame(state);
  };

  // Initial output capture for running sessions
  await pollOutputs(state, deps);
  render();

  // Poll tmux output on an interval
  const outputPollInterval = setInterval(async () => {
    try {
      await pollOutputs(state, deps);
      render();
    } catch {
      // Ignore polling errors
    }
  }, OUTPUT_POLL_MS);

  // Reconcile session statuses periodically
  const reconcileInterval = setInterval(async () => {
    try {
      state = await reconcileSessionStatuses(state, deps);
      render();
    } catch {
      // Ignore polling errors
    }
  }, 5000);

  const mergeWatcher = new MergeWatcher(
    deps.sessionManager,
    deps.gitManager,
    async (event) => {
      const label = event.cleanedUp ? 'merged and cleaned up' : 'merged';
      const existing = outputBuffers.get(event.session.id) ?? [];
      existing.push(``, `[Branch "${event.session.branchName}" was ${label}]`);
      outputBuffers.set(event.session.id, existing);
      state = await refreshSessions(state, deps);
      render();
    },
    deps.mergeDetectionConfig,
  );
  mergeWatcher.start();

  const cleanupAndExit = () => {
    mergeWatcher.stop();
    clearInterval(outputPollInterval);
    clearInterval(reconcileInterval);
    process.stdin.removeListener('data', onData);
    process.stdout.removeListener('resize', onResize);
    disableRawMode();
    writeRaw(cursor.show + screen.alternateOff);
  };

  const onResize = () => {
    render();
  };

  const onData = async (data: Buffer) => {
    if (state.promptMode) {
      handlePromptInput(data);
      return;
    }

    if (state.inputMode) {
      await handleInputModeData(data);
      return;
    }

    await handleCommandMode(data);
  };

  const handlePromptInput = (data: Buffer) => {
    const raw = data.toString('utf-8');

    if (raw === '\r' || raw === '\n') {
      const prompt = state.promptMode!;
      const value = prompt.value.trim();
      state.promptMode = null;
      writeRaw(cursor.hide);
      if (value) {
        render();
        prompt
          .onSubmit(value)
          .then(() => render())
          .catch(() => render());
      } else {
        render();
      }
      return;
    }

    if (raw === '\x1b' || raw === '\x03') {
      state.promptMode = null;
      writeRaw(cursor.hide);
      render();
      return;
    }

    if (raw === '\x7f' || raw === '\b') {
      state.promptMode = {
        ...state.promptMode!,
        value: state.promptMode!.value.slice(0, -1),
      };
      renderPromptBar(state.promptMode!, process.stdout.columns || 80, process.stdout.rows || 24);
      return;
    }

    if (raw.length === 1 && raw >= ' ') {
      state.promptMode = {
        ...state.promptMode!,
        value: state.promptMode!.value + raw,
      };
      renderPromptBar(state.promptMode!, process.stdout.columns || 80, process.stdout.rows || 24);
    }
  };

  const handleInputModeData = async (data: Buffer) => {
    const raw = data.toString('utf-8');

    // Escape exits input mode
    if (raw === '\x1b') {
      state.inputMode = false;
      render();
      return;
    }

    // Forward keystrokes to the focused tmux session
    const session = state.sessions[state.focusedIndex];
    if (session?.tmuxSessionName) {
      const alive = await deps.tmuxSpawner.hasSession(session.tmuxSessionName);
      if (alive) {
        await deps.tmuxSpawner.sendKeys(session.tmuxSessionName, raw);
      }
    }
  };

  const handleCommandMode = async (data: Buffer) => {
    const raw = data.toString('utf-8');

    // Enter input mode with 'i' or Enter
    if (raw === 'i' || raw === '\r') {
      const session = state.sessions[state.focusedIndex];
      if (session?.tmuxSessionName) {
        const alive = await deps.tmuxSpawner.hasSession(session.tmuxSessionName);
        if (alive) {
          state.inputMode = true;
          render();
          return;
        }
      }
    }

    const event = parseKeyInput(data);
    if (!event) return;

    switch (event.action) {
      case 'quit':
        cleanupAndExit();
        process.exit(0);
        return;

      case 'next_session':
        if (state.sessions.length > 0) {
          state.focusedIndex = (state.focusedIndex + 1) % state.sessions.length;
          state.scrollOffset = autoScrollOffset(state);
        }
        break;

      case 'prev_session':
        if (state.sessions.length > 0) {
          state.focusedIndex =
            (state.focusedIndex - 1 + state.sessions.length) % state.sessions.length;
          state.scrollOffset = autoScrollOffset(state);
        }
        break;

      case 'jump_to_session':
        if (
          event.sessionNumber !== undefined &&
          event.sessionNumber >= 1 &&
          event.sessionNumber <= state.sessions.length
        ) {
          state.focusedIndex = event.sessionNumber - 1;
          state.scrollOffset = autoScrollOffset(state);
        }
        break;

      case 'new_session':
        state.promptMode = {
          label: 'Task description',
          value: '',
          onSubmit: async (value) => {
            state = await createNewSession(value, state, deps, render);
          },
        };
        break;

      case 'delete_session':
        if (state.sessions.length > 0) {
          state = await deleteSession(state, deps);
        }
        break;

      case 'help':
        state.showHelp = !state.showHelp;
        break;
    }

    render();
  };

  process.stdin.on('data', onData);
  process.stdout.on('resize', onResize);
}
