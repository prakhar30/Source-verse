import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgram } from './program.js';

vi.mock('./commands.js', () => ({
  handleNew: vi.fn(),
  handleList: vi.fn(),
  handleSwitch: vi.fn(),
  handleStop: vi.fn(),
  handleCleanup: vi.fn(),
  handleStatus: vi.fn(),
  handleRestart: vi.fn(),
}));

vi.mock('../tui/control-panel.js', () => ({
  startControlPanel: vi.fn(),
}));

vi.mock('../session/manager.js', () => ({
  SessionManager: vi.fn(),
}));

vi.mock('../git/manager.js', () => ({
  GitManager: vi.fn(),
}));

vi.mock('../pty/spawner.js', () => {
  const mockSpawner = {
    isCommandAvailable: vi.fn().mockResolvedValue(true),
    hasSession: vi.fn().mockResolvedValue(false),
    hasWindow: vi.fn().mockResolvedValue(false),
    createMainSession: vi.fn().mockResolvedValue(undefined),
    attachSession: vi.fn().mockResolvedValue(0),
    getControlPanelCommand: vi.fn().mockReturnValue('node bin/source-verse.ts _control-panel'),
    isInsideTmux: vi.fn().mockReturnValue(false),
  };
  return {
    TmuxSpawner: vi.fn(() => mockSpawner),
    MAIN_SESSION: 'sv-main',
  };
});

import {
  handleNew,
  handleList,
  handleSwitch,
  handleStop,
  handleCleanup,
  handleStatus,
} from './commands.js';

function parseArgs(...args: string[]) {
  const program = createProgram();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  return program.parseAsync(['node', 'source-verse', ...args]);
}

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

describe('createProgram', () => {
  it('creates sv-main session when no subcommand is given', async () => {
    const { TmuxSpawner } = await import('../pty/spawner.js');
    const spawner = new TmuxSpawner();
    await parseArgs();
    expect(spawner.isCommandAvailable).toHaveBeenCalledWith('tmux');
  });

  it('prints version with --version flag', async () => {
    await expect(parseArgs('--version')).rejects.toThrow();
  });

  it('prints help with --help flag', async () => {
    await expect(parseArgs('--help')).rejects.toThrow();
  });

  it('calls handleNew with task argument', async () => {
    await parseArgs('new', 'fix login bug');
    expect(handleNew).toHaveBeenCalledWith('fix login bug');
  });

  it('calls handleList for list command', async () => {
    await parseArgs('list');
    expect(handleList).toHaveBeenCalled();
  });

  it('calls handleSwitch with session id', async () => {
    await parseArgs('switch', '3');
    expect(handleSwitch).toHaveBeenCalledWith('3');
  });

  it('calls handleStop with session id', async () => {
    await parseArgs('stop', '2');
    expect(handleStop).toHaveBeenCalledWith('2', {});
  });

  it('calls handleStop with --cleanup flag', async () => {
    await parseArgs('stop', '2', '--cleanup');
    expect(handleStop).toHaveBeenCalledWith('2', { cleanup: true });
  });

  it('calls handleCleanup for cleanup command', async () => {
    await parseArgs('cleanup');
    expect(handleCleanup).toHaveBeenCalled();
  });

  it('calls handleStatus for status command', async () => {
    await parseArgs('status');
    expect(handleStatus).toHaveBeenCalled();
  });

  it('rejects unknown commands', async () => {
    await expect(parseArgs('unknown')).rejects.toThrow();
  });

  it('rejects new command without task argument', async () => {
    await expect(parseArgs('new')).rejects.toThrow();
  });

  it('rejects switch command without id argument', async () => {
    await expect(parseArgs('switch')).rejects.toThrow();
  });

  it('rejects stop command without id argument', async () => {
    await expect(parseArgs('stop')).rejects.toThrow();
  });
});
