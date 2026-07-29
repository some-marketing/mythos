/**
 * CLI argument parsing helpers
 */

export function parseArgs(argv) {
  const args = {
    command: null,
    _positional: []
  };

  let i = 2;
  if (argv[i] && !argv[i].startsWith('-')) {
    args.command = argv[i];
    i++;
  }

  for (; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      args.help = true;
      continue;
    }

    if (arg === '-v' || arg === '--version') {
      args.version = true;
      continue;
    }

    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        const key = arg.slice(2, eq).replace(/-/g, '_');
        const val = arg.slice(eq + 1);
        args[key] = val === '' ? true : val;
        continue;
      }
      const key = arg.slice(2).replace(/-/g, '_');
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
      continue;
    }

    args._positional.push(arg);
  }

  return args;
}

export function printGlobalHelp() {
  console.log(`
Phased Testing Framework CLI

Usage:
  node framework/runner/cli.js <command> [options]

Commands:
  new-runset       Allocate a new runset folder for a testcase
  run              Execute a phased test run
  report           Generate reports from run artifacts
  handoff          Create developer handoff bundle
  validate         Validate testcase definitions and project structure
  compare-exports  Compare backend exports (CRM vs WPForms)

Global options:
  -h, --help       Show help
  -v, --version    Show version
`.trim());
}

export function printVersion(version) {
  console.log(version);
}

