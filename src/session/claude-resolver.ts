import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolves the most recent Claude Code session ID for a given working directory.
 *
 * Claude stores conversations in ~/.claude/projects/<path-hash>/<sessionId>.jsonl
 * where <path-hash> is the absolute path with '/' replaced by '-'.
 */
export async function resolveClaudeSessionId(worktreePath: string): Promise<string | null> {
  const claudeProjectDir = worktreePath.replaceAll('/', '-');
  const projectPath = join(homedir(), '.claude', 'projects', claudeProjectDir);

  try {
    const files = await readdir(projectPath);
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) return null;

    // Find the most recently modified session file
    let newestFile = jsonlFiles[0]!;
    let newestTime = 0;

    for (const file of jsonlFiles) {
      const stats = await stat(join(projectPath, file));
      if (stats.mtimeMs > newestTime) {
        newestTime = stats.mtimeMs;
        newestFile = file;
      }
    }

    return newestFile.replace('.jsonl', '');
  } catch {
    return null;
  }
}
