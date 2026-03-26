import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import { stat } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

/**
 * Detects whether the filesystem at the given path supports reflink (copy-on-write).
 *
 * - macOS: APFS supports `cp -c` (reflink copy)
 * - Linux: btrfs and XFS support `cp --reflink=auto`
 */
export function getReflinkCopyArgs(): { args: string[]; supported: boolean } {
  const os = platform();

  if (os === 'darwin') {
    // macOS APFS supports cp -c (clone / copy-on-write)
    return { args: ['-c', '-R'], supported: true };
  }

  if (os === 'linux') {
    // Linux btrfs/XFS support --reflink=auto; falls back gracefully on ext4
    return { args: ['--reflink=auto', '-R'], supported: true };
  }

  // Unsupported platform — fall back to regular recursive copy
  return { args: ['-R'], supported: false };
}

/**
 * Copy a directory using the fastest available method (reflink when possible).
 * Skips if the source directory does not exist.
 * Returns true if the copy was performed, false if skipped.
 */
export async function reflinkCopyDir(source: string, destination: string): Promise<boolean> {
  const exists = await directoryExists(source);
  if (!exists) return false;

  const { args } = getReflinkCopyArgs();
  await execFileAsync('cp', [...args, source, destination]);
  return true;
}

/**
 * Copy multiple cache directories from source repo to worktree in parallel,
 * respecting a concurrency limit to avoid exhausting file descriptors.
 */
export async function copyBuildCaches(
  sourceRepoPath: string,
  worktreePath: string,
  cacheDirs: string[],
  concurrencyLimit = 4,
): Promise<CopyCacheResult> {
  const results: CopiedDir[] = [];
  const queue = [...cacheDirs];
  const inFlight: Promise<void>[] = [];

  while (queue.length > 0 || inFlight.length > 0) {
    while (inFlight.length < concurrencyLimit && queue.length > 0) {
      const dir = queue.shift()!;
      const source = `${sourceRepoPath}/${dir}`;
      const destination = `${worktreePath}/${dir}`;

      const promise = reflinkCopyDir(source, destination)
        .then((didCopy) => {
          results.push({ dir, copied: didCopy });
        })
        .catch(() => {
          results.push({ dir, copied: false });
        })
        .finally(() => {
          const idx = inFlight.indexOf(promise);
          if (idx !== -1) inFlight.splice(idx, 1);
        });

      inFlight.push(promise);
    }

    if (inFlight.length > 0) {
      await Promise.race(inFlight);
    }
  }

  return { dirs: results, reflink: getReflinkCopyArgs().supported };
}

/**
 * Walk a directory in the background to warm the OS disk cache.
 * Returns immediately — the walk happens asynchronously.
 */
export function warmDiskCache(dirPath: string): void {
  const os = platform();
  const cmd = os === 'darwin' ? 'find' : 'find';
  const args = [dirPath, '-type', 'f'];

  const child = execFile(cmd, args, { maxBuffer: 1024 * 1024 * 10 }, () => {
    // Intentionally swallow errors — this is a best-effort optimization
  });

  // Detach so it doesn't block process exit
  child.unref();
}

export interface CopiedDir {
  dir: string;
  copied: boolean;
}

export interface CopyCacheResult {
  dirs: CopiedDir[];
  reflink: boolean;
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}
