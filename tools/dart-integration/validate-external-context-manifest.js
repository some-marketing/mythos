#!/usr/bin/env node
'use strict';

const {
  validateExternalContextManifest
} = require('./lib/external-context-manifest');

function parseArgs(argv) {
  const args = { files: [], json: false };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else args.files.push(arg);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.files.length === 0) {
    console.error('Usage: node tools/dart-integration/validate-external-context-manifest.js <manifest.json> [more.json] [--json]');
    process.exit(2);
  }

  const results = args.files.map((file) => validateExternalContextManifest(file));
  if (args.json) {
    console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
  } else {
    for (const result of results) {
      console.log((result.ok ? 'PASS ' : 'FAIL ') + result.manifest_path);
      for (const error of result.errors) console.log('  - ' + error);
      for (const warning of result.warnings) console.log('  ! ' + warning);
    }
  }

  process.exit(results.every((result) => result.ok) ? 0 : 1);
}

if (require.main === module) main();
