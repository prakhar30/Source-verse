import { execFile } from 'node:child_process';

export class GitCommandError extends Error {
  constructor(
    public readonly command: string[],
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(`git ${command.join(' ')} failed (exit ${exitCode}): ${stderr.trim()}`);
    this.name = 'GitCommandError';
  }
}

export function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new GitCommandError(args, error.code ?? null, stderr));
        return;
      }
      resolve(stdout);
    });
  });
}
