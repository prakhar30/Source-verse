import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';

export async function isGitRepository(directory: string): Promise<boolean> {
  try {
    await access(join(directory, '.git'), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function assertGitRepository(directory: string): Promise<void> {
  const isRepo = await isGitRepository(directory);
  if (!isRepo) {
    throw new Error(
      `Not a git repository: ${directory}\nRun this command from inside a git repository.`,
    );
  }
}
