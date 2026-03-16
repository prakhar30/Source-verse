export interface SourceVerseConfig {
  mergeDetection: MergeDetectionConfig;
}

export interface MergeDetectionConfig {
  pollingIntervalMs: number;
  autoCleanup: boolean;
}

export const DEFAULT_CONFIG: SourceVerseConfig = {
  mergeDetection: {
    pollingIntervalMs: 60_000,
    autoCleanup: true,
  },
};
