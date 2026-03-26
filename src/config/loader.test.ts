import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { loadConfig } from './loader.js';
import { DEFAULT_CONFIG } from './types.js';

describe('loadConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sv-config-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // loadConfig resolves useApfsClone based on platform at runtime,
  // so we build the expected default dynamically.
  const expectedDefault = {
    ...DEFAULT_CONFIG,
    worktree: { ...DEFAULT_CONFIG.worktree, useApfsClone: platform() === 'darwin' },
  };

  it('returns default config when no config file exists', async () => {
    const config = await loadConfig(tempDir);
    expect(config).toEqual(expectedDefault);
  });

  it('returns default config when config file is invalid JSON', async () => {
    await writeFile(join(tempDir, 'config.json'), 'not json', 'utf-8');
    const config = await loadConfig(tempDir);
    expect(config).toEqual(expectedDefault);
  });

  it('returns default config when config file contains a non-object', async () => {
    await writeFile(join(tempDir, 'config.json'), '"string"', 'utf-8');
    const config = await loadConfig(tempDir);
    expect(config).toEqual(expectedDefault);
  });

  it('merges partial config with defaults', async () => {
    const partial = { mergeDetection: { pollingIntervalMs: 30000 } };
    await writeFile(join(tempDir, 'config.json'), JSON.stringify(partial), 'utf-8');

    const config = await loadConfig(tempDir);

    expect(config.mergeDetection.pollingIntervalMs).toBe(30000);
    expect(config.mergeDetection.autoCleanup).toBe(true);
  });

  it('reads autoCleanup when set to false', async () => {
    const partial = { mergeDetection: { autoCleanup: false } };
    await writeFile(join(tempDir, 'config.json'), JSON.stringify(partial), 'utf-8');

    const config = await loadConfig(tempDir);

    expect(config.mergeDetection.autoCleanup).toBe(false);
    expect(config.mergeDetection.pollingIntervalMs).toBe(60000);
  });

  it('reads a fully specified config', async () => {
    const full = { mergeDetection: { pollingIntervalMs: 5000, autoCleanup: false } };
    await writeFile(join(tempDir, 'config.json'), JSON.stringify(full), 'utf-8');

    const config = await loadConfig(tempDir);

    expect(config.mergeDetection.pollingIntervalMs).toBe(5000);
    expect(config.mergeDetection.autoCleanup).toBe(false);
  });

  it('ignores unknown fields and uses defaults for missing ones', async () => {
    const weird = { mergeDetection: { pollingIntervalMs: 'not-a-number', extra: true } };
    await writeFile(join(tempDir, 'config.json'), JSON.stringify(weird), 'utf-8');

    const config = await loadConfig(tempDir);

    expect(config.mergeDetection.pollingIntervalMs).toBe(60000);
    expect(config.mergeDetection.autoCleanup).toBe(true);
  });

  it('returns default worktree config when not specified', async () => {
    const config = await loadConfig(tempDir);

    expect(config.worktree.cacheDirs).toEqual(DEFAULT_CONFIG.worktree.cacheDirs);
    expect(config.worktree.warmDiskCache).toBe(true);
  });

  it('reads custom cacheDirs from config', async () => {
    const partial = { worktree: { cacheDirs: ['vendor', '.cache'] } };
    await writeFile(join(tempDir, 'config.json'), JSON.stringify(partial), 'utf-8');

    const config = await loadConfig(tempDir);

    expect(config.worktree.cacheDirs).toEqual(['vendor', '.cache']);
    expect(config.worktree.warmDiskCache).toBe(true);
  });

  it('reads warmDiskCache when set to false', async () => {
    const partial = { worktree: { warmDiskCache: false } };
    await writeFile(join(tempDir, 'config.json'), JSON.stringify(partial), 'utf-8');

    const config = await loadConfig(tempDir);

    expect(config.worktree.warmDiskCache).toBe(false);
    expect(config.worktree.cacheDirs).toEqual(DEFAULT_CONFIG.worktree.cacheDirs);
  });

  it('uses default cacheDirs when config has non-array value', async () => {
    const weird = { worktree: { cacheDirs: 'not-an-array' } };
    await writeFile(join(tempDir, 'config.json'), JSON.stringify(weird), 'utf-8');

    const config = await loadConfig(tempDir);

    expect(config.worktree.cacheDirs).toEqual(DEFAULT_CONFIG.worktree.cacheDirs);
  });

  it('defaults useApfsClone based on platform', async () => {
    const config = await loadConfig(tempDir);

    expect(config.worktree.useApfsClone).toBe(platform() === 'darwin');
  });

  it('respects explicit useApfsClone override', async () => {
    const partial = { worktree: { useApfsClone: false } };
    await writeFile(join(tempDir, 'config.json'), JSON.stringify(partial), 'utf-8');

    const config = await loadConfig(tempDir);

    expect(config.worktree.useApfsClone).toBe(false);
  });

  it('defaults fastTeardown to true', async () => {
    const config = await loadConfig(tempDir);

    expect(config.worktree.fastTeardown).toBe(true);
  });

  it('respects explicit fastTeardown override', async () => {
    const partial = { worktree: { fastTeardown: false } };
    await writeFile(join(tempDir, 'config.json'), JSON.stringify(partial), 'utf-8');

    const config = await loadConfig(tempDir);

    expect(config.worktree.fastTeardown).toBe(false);
  });

  it('defaults enableFsmonitor to true', async () => {
    const config = await loadConfig(tempDir);

    expect(config.worktree.enableFsmonitor).toBe(true);
  });

  it('respects explicit enableFsmonitor override', async () => {
    const partial = { worktree: { enableFsmonitor: false } };
    await writeFile(join(tempDir, 'config.json'), JSON.stringify(partial), 'utf-8');

    const config = await loadConfig(tempDir);

    expect(config.worktree.enableFsmonitor).toBe(false);
  });
});
