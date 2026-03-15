export interface PtyHandle {
  pid: number;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (exitCode: number, signal?: number) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}
