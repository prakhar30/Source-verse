#!/usr/bin/env tsx
/**
 * source-verse CLI entry point
 *
 * This is the binary stub for the `source-verse` CLI command.
 * Command parsing and feature logic will be added in future issues.
 */

const [, , ...args] = process.argv;

function main(argv: string[]): void {
  if (argv.length === 0) {
    console.log('source-verse — parallel Claude Code session manager');
    console.log('');
    console.log('Usage: source-verse [command]');
    console.log('');
    console.log('Commands:');
    console.log('  (coming soon)');
    console.log('');
    console.log('Run source-verse --help for more information.');
    return;
  }

  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log('0.1.0');
    return;
  }

  console.log(`Unknown command: ${argv[0]}`);
  process.exit(1);
}

main(args);
