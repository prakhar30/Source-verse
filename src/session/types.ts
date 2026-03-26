export type SessionStatus =
  | 'created'
  | 'running'
  | 'waiting'
  | 'done'
  | 'error'
  | 'merged'
  | 'suspended'
  | 'cleaned_up';

export type CopyMode = 'worktree' | 'clone';

export interface Session {
  id: string;
  taskDescription: string;
  worktreePath: string;
  branchName: string;
  tmuxSessionName: string;
  status: SessionStatus;
  pid: number | null;
  claudeSessionId: string | null;
  /** How the working copy was created. Absent for legacy sessions (treated as 'worktree'). */
  copyMode?: CopyMode;
  createdAt: string;
  updatedAt: string;
}
