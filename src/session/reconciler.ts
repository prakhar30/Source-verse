import { stat } from 'node:fs/promises';
import type { SessionManager } from './manager.js';
import type { Session, SessionStatus } from './types.js';

export interface TmuxChecker {
  hasSession: (sessionName: string) => Promise<boolean>;
}

export interface PathChecker {
  exists: (path: string) => Promise<boolean>;
}

const defaultPathChecker: PathChecker = {
  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
};

export interface ReconcileResult {
  reattached: string[];
  markedDone: string[];
  markedError: string[];
  orphanedWorktrees: string[];
}

const ACTIVE_STATUSES: ReadonlySet<SessionStatus> = new Set(['running', 'waiting']);

export class SessionReconciler {
  private readonly sessionManager: SessionManager;
  private readonly tmuxChecker: TmuxChecker;
  private readonly pathChecker: PathChecker;

  constructor(
    sessionManager: SessionManager,
    tmuxChecker: TmuxChecker,
    pathChecker: PathChecker = defaultPathChecker,
  ) {
    this.sessionManager = sessionManager;
    this.tmuxChecker = tmuxChecker;
    this.pathChecker = pathChecker;
  }

  async reconcile(): Promise<ReconcileResult> {
    const sessions = await this.sessionManager.listSessions();
    const result: ReconcileResult = {
      reattached: [],
      markedDone: [],
      markedError: [],
      orphanedWorktrees: [],
    };

    for (const session of sessions) {
      await this.reconcileSession(session, result);
    }

    return result;
  }

  private async reconcileSession(session: Session, result: ReconcileResult): Promise<void> {
    if (ACTIVE_STATUSES.has(session.status)) {
      await this.reconcileActiveSession(session, result);
      return;
    }

    if (session.status === 'cleaned_up') {
      await this.reconcileCleanedUpSession(session, result);
    }
  }

  private async reconcileActiveSession(session: Session, result: ReconcileResult): Promise<void> {
    if (!session.tmuxSessionName) {
      await this.sessionManager.updateStatus(session.id, 'error');
      result.markedError.push(session.id);
      return;
    }

    const alive = await this.tmuxChecker.hasSession(session.tmuxSessionName);

    if (alive) {
      result.reattached.push(session.id);
      return;
    }

    await this.sessionManager.updateStatus(session.id, 'done');
    result.markedDone.push(session.id);
  }

  private async reconcileCleanedUpSession(
    session: Session,
    result: ReconcileResult,
  ): Promise<void> {
    const worktreeExists = await this.pathChecker.exists(session.worktreePath);

    if (worktreeExists) {
      result.orphanedWorktrees.push(session.id);
    }
  }
}
