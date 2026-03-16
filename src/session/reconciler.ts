import { stat } from 'node:fs/promises';
import type { SessionManager } from './manager.js';
import type { Session, SessionStatus } from './types.js';

export interface ProcessChecker {
  isAlive: (pid: number) => boolean;
}

export interface PathChecker {
  exists: (path: string) => Promise<boolean>;
}

const defaultProcessChecker: ProcessChecker = {
  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
};

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
  private readonly processChecker: ProcessChecker;
  private readonly pathChecker: PathChecker;

  constructor(
    sessionManager: SessionManager,
    processChecker: ProcessChecker = defaultProcessChecker,
    pathChecker: PathChecker = defaultPathChecker,
  ) {
    this.sessionManager = sessionManager;
    this.processChecker = processChecker;
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
    if (session.pid === null) {
      await this.sessionManager.updateStatus(session.id, 'error');
      result.markedError.push(session.id);
      return;
    }

    const alive = this.processChecker.isAlive(session.pid);

    if (alive) {
      result.reattached.push(session.id);
      return;
    }

    await this.sessionManager.updateStatus(session.id, 'done');
    await this.sessionManager.updatePid(session.id, null);
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
