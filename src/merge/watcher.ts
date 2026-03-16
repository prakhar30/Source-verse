import type { SessionManager } from '../session/manager.js';
import type { GitManager } from '../git/manager.js';
import type { Session } from '../session/types.js';
import type { MergeDetectionConfig } from '../config/types.js';
import { DEFAULT_CONFIG } from '../config/types.js';

export interface MergeEvent {
  session: Session;
  cleanedUp: boolean;
}

export type MergeCallback = (event: MergeEvent) => void;

const CHECKABLE_STATUSES = new Set(['created', 'running', 'waiting', 'done']);

export class MergeWatcher {
  private readonly sessionManager: SessionManager;
  private readonly gitManager: GitManager;
  private readonly config: MergeDetectionConfig;
  private readonly onMergeDetected: MergeCallback;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    sessionManager: SessionManager,
    gitManager: GitManager,
    onMergeDetected: MergeCallback,
    config: MergeDetectionConfig = DEFAULT_CONFIG.mergeDetection,
  ) {
    this.sessionManager = sessionManager;
    this.gitManager = gitManager;
    this.onMergeDetected = onMergeDetected;
    this.config = config;
  }

  start(): void {
    if (this.intervalHandle !== null) return;

    this.intervalHandle = setInterval(() => {
      this.checkForMerges().catch(() => {
        // Silently ignore polling errors (network issues, etc.)
      });
    }, this.config.pollingIntervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async checkForMerges(): Promise<MergeEvent[]> {
    await this.gitManager.fetchDefaultBranch();

    const sessions = await this.sessionManager.listSessions();
    const checkable = sessions.filter((s) => CHECKABLE_STATUSES.has(s.status));
    const events: MergeEvent[] = [];

    for (const session of checkable) {
      const merged = await this.isBranchMergedSafe(session.branchName);
      if (!merged) continue;

      await this.sessionManager.updateStatus(session.id, 'merged');
      let cleanedUp = false;

      if (this.config.autoCleanup) {
        cleanedUp = await this.tryCleanup(session);
      }

      const event: MergeEvent = { session: { ...session, status: 'merged' }, cleanedUp };
      events.push(event);
      this.onMergeDetected(event);
    }

    return events;
  }

  private async isBranchMergedSafe(branchName: string): Promise<boolean> {
    try {
      return await this.gitManager.isBranchMerged(branchName);
    } catch {
      return false;
    }
  }

  private async tryCleanup(session: Session): Promise<boolean> {
    try {
      const worktrees = await this.gitManager.listWorktrees();
      const worktree = worktrees.find((w) => w.path === session.worktreePath);

      if (worktree) {
        await this.gitManager.removeWorktree(worktree.sessionId);
      }

      await this.sessionManager.updateStatus(session.id, 'cleaned_up');
      return true;
    } catch {
      return false;
    }
  }
}
