import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SourceVerseConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

const DEFAULT_STATE_DIR = join(process.env.HOME ?? tmpdir(), '.source-verse');
const CONFIG_FILENAME = 'config.json';

export async function loadConfig(stateDir = DEFAULT_STATE_DIR): Promise<SourceVerseConfig> {
  const configPath = join(stateDir, CONFIG_FILENAME);

  try {
    const data = await readFile(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(data);

    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_CONFIG;
    }

    return mergeWithDefaults(parsed as Record<string, unknown>);
  } catch (error: unknown) {
    const isFileNotFound =
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT';

    if (isFileNotFound || error instanceof SyntaxError) {
      return DEFAULT_CONFIG;
    }

    throw error;
  }
}

function mergeWithDefaults(parsed: Record<string, unknown>): SourceVerseConfig {
  const mergeDetection = parsed.mergeDetection as Record<string, unknown> | undefined;

  return {
    mergeDetection: {
      pollingIntervalMs:
        typeof mergeDetection?.pollingIntervalMs === 'number'
          ? mergeDetection.pollingIntervalMs
          : DEFAULT_CONFIG.mergeDetection.pollingIntervalMs,
      autoCleanup:
        typeof mergeDetection?.autoCleanup === 'boolean'
          ? mergeDetection.autoCleanup
          : DEFAULT_CONFIG.mergeDetection.autoCleanup,
    },
  };
}
