#!/usr/bin/env node
/**
 * source-verse CLI entry point
 *
 * Validates we're in a git repository, then delegates to Commander
 * for command parsing and dispatch.
 */

import { assertGitRepository } from '../src/git/validation.js';
import { createProgram } from '../src/cli/program.js';

async function main(): Promise<void> {
  await assertGitRepository(process.cwd());
  const program = createProgram();
  await program.parseAsync(process.argv);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
