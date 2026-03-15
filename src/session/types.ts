export type SessionStatus = 'created' | 'running' | 'waiting' | 'done' | 'merged' | 'cleaned_up';

export interface Session {
  id: string;
  taskDescription: string;
  worktreePath: string;
  branchName: string;
  status: SessionStatus;
  pid: number | null;
  createdAt: string;
  updatedAt: string;
}
