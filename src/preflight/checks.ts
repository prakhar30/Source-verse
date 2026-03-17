import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isGitRepository } from '../git/validation.js';

const execFileAsync = promisify(execFile);

export interface PreflightError {
  check: string;
  message: string;
}

export interface PreflightResult {
  ok: boolean;
  errors: PreflightError[];
  warnings: string[];
}

export async function isCommandInstalled(command: string): Promise<boolean> {
  try {
    await execFileAsync('which', [command]);
    return true;
  } catch {
    return false;
  }
}

export async function assertGitInstalled(): Promise<PreflightError | null> {
  const installed = await isCommandInstalled('git');
  if (!installed) {
    return {
      check: 'git',
      message: 'Git is not installed. Install it from https://git-scm.com and try again.',
    };
  }
  return null;
}

export async function assertIsGitRepository(repoPath: string): Promise<PreflightError | null> {
  const isRepo = await isGitRepository(repoPath);
  if (!isRepo) {
    return {
      check: 'git-repo',
      message: `Not a git repository: ${repoPath}\nRun this command from inside a git repository.`,
    };
  }
  return null;
}

export async function assertHasRemote(repoPath: string): Promise<PreflightError | null> {
  try {
    const { stdout } = await execFileAsync('git', ['remote'], { cwd: repoPath });
    if (!stdout.trim()) {
      return {
        check: 'git-remote',
        message: 'No git remote configured. Add a remote with: git remote add origin <url>',
      };
    }
    return null;
  } catch {
    return {
      check: 'git-remote',
      message: 'Failed to check git remotes. Ensure git is working correctly.',
    };
  }
}

export async function assertDirectoryWritable(dirPath: string): Promise<PreflightError | null> {
  const parentDir = dirname(dirPath);
  try {
    await access(parentDir, constants.W_OK);
    return null;
  } catch {
    return {
      check: 'permissions',
      message: `Permission denied: cannot write to ${parentDir}\nCheck directory permissions and try again.`,
    };
  }
}

export async function getAvailableDiskSpaceBytes(dirPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('df', ['--output=avail', '-B1', dirPath]);
    const lines = stdout.trim().split('\n');
    const valueLine = lines[lines.length - 1]?.trim();
    if (!valueLine) return null;
    const bytes = Number(valueLine);
    return Number.isFinite(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

const ONE_GB_BYTES = 1_073_741_824;

export async function checkDiskSpace(
  repoPath: string,
  thresholdBytes = ONE_GB_BYTES,
): Promise<string | null> {
  const available = await getAvailableDiskSpaceBytes(repoPath);
  if (available === null) return null;
  if (available < thresholdBytes) {
    const availableMb = Math.floor(available / (1024 * 1024));
    const thresholdMb = Math.floor(thresholdBytes / (1024 * 1024));
    return `Low disk space: ${availableMb} MB available (threshold: ${thresholdMb} MB). Creating a new worktree may fail.`;
  }
  return null;
}

export async function runPreflight(repoPath: string): Promise<PreflightResult> {
  const errors: PreflightError[] = [];
  const warnings: string[] = [];

  const gitError = await assertGitInstalled();
  if (gitError) {
    errors.push(gitError);
    return { ok: false, errors, warnings };
  }

  const repoError = await assertIsGitRepository(repoPath);
  if (repoError) {
    errors.push(repoError);
    return { ok: false, errors, warnings };
  }

  const remoteError = await assertHasRemote(repoPath);
  if (remoteError) {
    errors.push(remoteError);
  }

  const permError = await assertDirectoryWritable(repoPath);
  if (permError) {
    errors.push(permError);
  }

  const diskWarning = await checkDiskSpace(repoPath);
  if (diskWarning) {
    warnings.push(diskWarning);
  }

  return { ok: errors.length === 0, errors, warnings };
}
