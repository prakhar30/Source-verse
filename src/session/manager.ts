import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Session, SessionStatus } from './types.js';

const DEFAULT_STATE_DIR = join(process.env.HOME ?? tmpdir(), '.source-verse');
const SESSIONS_FILENAME = 'sessions.json';

export class SessionManager {
  private readonly stateFilePath: string;
  private readonly stateDir: string;

  constructor(stateDir = DEFAULT_STATE_DIR) {
    this.stateDir = stateDir;
    this.stateFilePath = join(stateDir, SESSIONS_FILENAME);
  }

  async createSession(
    taskDescription: string,
    worktreePath: string,
    branchName: string,
    tmuxSessionName: string,
  ): Promise<Session> {
    const sessions = await this.loadSessions();
    const now = new Date().toISOString();

    const session: Session = {
      id: randomUUID(),
      taskDescription,
      worktreePath,
      branchName,
      tmuxSessionName,
      status: 'created',
      pid: null,
      createdAt: now,
      updatedAt: now,
    };

    sessions.push(session);
    await this.saveSessions(sessions);
    return session;
  }

  async getSession(id: string): Promise<Session | null> {
    const sessions = await this.loadSessions();
    // Support both full UUIDs and short prefix matches (e.g. first 8 chars)
    const exact = sessions.find((session) => session.id === id);
    if (exact) return exact;
    const prefixMatches = sessions.filter((session) => session.id.startsWith(id));
    if (prefixMatches.length === 1) return prefixMatches[0]!;
    return null;
  }

  async listSessions(): Promise<Session[]> {
    const sessions = await this.loadSessions();
    return sessions.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  async updateStatus(id: string, status: SessionStatus): Promise<Session> {
    const sessions = await this.loadSessions();
    const session = sessions.find((s) => s.id === id);

    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    session.status = status;
    session.updatedAt = new Date().toISOString();
    await this.saveSessions(sessions);
    return session;
  }

  async updatePid(id: string, pid: number | null): Promise<Session> {
    const sessions = await this.loadSessions();
    const session = sessions.find((s) => s.id === id);

    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    session.pid = pid;
    session.updatedAt = new Date().toISOString();
    await this.saveSessions(sessions);
    return session;
  }

  async removeSession(id: string): Promise<void> {
    const sessions = await this.loadSessions();
    const index = sessions.findIndex((s) => s.id === id);

    if (index === -1) {
      throw new Error(`Session not found: ${id}`);
    }

    sessions.splice(index, 1);
    await this.saveSessions(sessions);
  }

  private async loadSessions(): Promise<Session[]> {
    try {
      const data = await readFile(this.stateFilePath, 'utf-8');
      const parsed: unknown = JSON.parse(data);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed as Session[];
    } catch (error: unknown) {
      const isFileNotFound =
        error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';

      if (isFileNotFound) {
        return [];
      }

      if (error instanceof SyntaxError) {
        return [];
      }

      throw error;
    }
  }

  private async saveSessions(sessions: Session[]): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });

    const tempPath = join(
      dirname(this.stateFilePath),
      `.sessions-${Date.now()}-${randomUUID().slice(0, 8)}.tmp`,
    );
    const data = JSON.stringify(sessions, null, 2) + '\n';

    await writeFile(tempPath, data, 'utf-8');
    await rename(tempPath, this.stateFilePath);
  }
}
