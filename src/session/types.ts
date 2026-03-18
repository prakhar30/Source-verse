export type SessionStatus =
  | 'created'
  | 'running'
  | 'waiting'
  | 'done'
  | 'error'
  | 'merged'
  | 'cleaned_up';

export interface Session {
  id: string;
  taskDescription: string;
  worktreePath: string;
  branchName: string;
  tmuxSessionName: string;
  status: SessionStatus;
  pid: number | null;
  createdAt: string;
  updatedAt: string;
}
