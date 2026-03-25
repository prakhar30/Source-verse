export interface SourceVerseConfig {
  mergeDetection: MergeDetectionConfig;
  worktree: WorktreeConfig;
}

export interface MergeDetectionConfig {
  pollingIntervalMs: number;
  autoCleanup: boolean;
}

export interface WorktreeConfig {
  /** Directories to reflink-copy into new worktrees (preserves build caches). */
  cacheDirs: string[];
  /** Whether to warm the OS disk cache after worktree creation. */
  warmDiskCache: boolean;
}

export const DEFAULT_CACHE_DIRS = ['node_modules', '.next', 'dist', 'build', 'target', '.venv'];

export const DEFAULT_CONFIG: SourceVerseConfig = {
  mergeDetection: {
    pollingIntervalMs: 60_000,
    autoCleanup: true,
  },
  worktree: {
    cacheDirs: DEFAULT_CACHE_DIRS,
    warmDiskCache: true,
  },
};
