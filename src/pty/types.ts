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

export interface WindowInfo {
  index: number;
  name: string;
  active: boolean;
}
