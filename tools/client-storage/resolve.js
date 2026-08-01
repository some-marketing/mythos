#!/usr/bin/env node
'use strict';

// CLI: resolve.js --client CODE
// Cross-client storage-root resolver. Reads clients/CODE/client.json's
// file_storage {provider, mounted_path, manifest} and, on success, prints
// ONLY the absolute mounted path to stdout. All other output (including a
// machine-readable status line on every run) goes to stderr so callers can
// safely capture stdout as the path.
//
// This script is the single authority tools/client-storage other tools
// consult for "what is CODE's registered cloud-storage root" -- see lib.js
// resolveStorageRoot() for the allowlist/hazard rules it enforces.

const { parseArgs, resolveStorageRoot, emitStatus, fail, EXIT_CODES } = require('./lib.js');

function printHelp() {
  process.stdout.write(`resolve.js -- cross-client storage-root resolver

Usage:
  node resolve.js --client CODE

On success: prints the absolute registered mounted path to stdout (nothing
else), exits 0.

On failure: prints a single-line JSON status object to stderr and exits with
a distinct nonzero code:
  2  UNMOUNTED               mount root under ~/Library/CloudStorage/ missing
  3  NO_FILE_STORAGE         client.json has no file_storage block
  4  PATH_MISSING            registered mounted_path does not exist
  5  CONFLICT_FILES_PRESENT  *.conflict* / "conflicted copy" files found
  6  HAZARD_MOUNT            mount is hard-denied or not this client's own
  8  MISSING_CLIENT          clients/CODE/client.json not found
  1  USAGE_ERROR             bad arguments or unreadable client.json
`);
}

function main() {
  const args = parseArgs(process.argv, { valued: ['client'] });
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (!args.client) {
    process.stderr.write('Usage: node resolve.js --client CODE (see --help)\n');
    process.exit(EXIT_CODES.USAGE_ERROR);
  }

  const result = resolveStorageRoot(args.client);
  if (!result.ok) {
    fail(result.code, { client: args.client, reason: result.reason, conflicts: result.conflicts });
    return;
  }

  emitStatus({
    ok: true,
    client: args.client,
    provider: result.provider,
    mounted_path: result.mountedPath,
    mount_dir: result.mountDirName,
    manifest: result.manifest
  });
  process.stdout.write(result.mountedPath + '\n');
  process.exit(EXIT_CODES.OK);
}

if (require.main === module) {
  main();
}

module.exports = { main };
