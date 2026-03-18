export interface TmuxSessionInfo {
  name: string;
  alive: boolean;
}

export interface SpawnOptions {
  sessionName: string;
  command: string;
  args: string[];
  cwd: string;
}
