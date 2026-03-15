/**
 * source-verse — public API surface
 *
 * Module system: ESM (type: "module" in package.json)
 * Node.js target: ES2022 / NodeNext
 */

export { createProgram } from './cli/program.js';
export { isGitRepository, assertGitRepository } from './git/validation.js';
