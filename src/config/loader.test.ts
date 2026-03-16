import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

  it('returns default config when no config file exists', async () => {
    const config = await loadConfig(tempDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('returns default config when config file is invalid JSON', async () => {
    await writeFile(join(tempDir, 'config.json'), 'not json', 'utf-8');
    const config = await loadConfig(tempDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('returns default config when config file contains a non-object', async () => {
    await writeFile(join(tempDir, 'config.json'), '"string"', 'utf-8');
    const config = await loadConfig(tempDir);
    expect(config).toEqual(DEFAULT_CONFIG);
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
});
