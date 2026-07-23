#!/usr/bin/env node
'use strict';
// gen-protected-set.cjs — SINGLE-SOURCE rendering of policy -> enforcement.
//
// Reads protected-path-manifest.json and prints the sorted set of auto_L1
// (protected) globs. This is the EXACT path set that:
//   * a real chown/ACL confinement scheme must make physically unwritable to
//     the loop principal, AND
//   * the promotion merge-gate blocks writes to.
// Rendering it from ONE manifest is what stops OS-enforcement and policy from
// drifting (the architecture's single-source requirement).
//
// Usage:
//   node tools/kernel/loop-protocol/gen-protected-set.cjs           # text list
//   node tools/kernel/loop-protocol/gen-protected-set.cjs --json    # JSON array
//
// Exits 0 on success, 1 on manifest error.

const path = require('path');
const policy = require('./policy');

function main(argv) {
  const asJson = argv.includes('--json');
  let manifest;
  try {
    manifest = policy.loadManifest();
  } catch (e) {
    process.stderr.write('gen-protected-set: cannot load manifest: ' + e.message + '\n');
    return 1;
  }

  const globs = Array.isArray(manifest.auto_L1_globs) ? manifest.auto_L1_globs.slice() : [];
  // Stable, deduped, sorted — deterministic output for diffing / OS provisioning.
  const set = Array.from(new Set(globs)).sort();

  if (asJson) {
    process.stdout.write(JSON.stringify(set, null, 2) + '\n');
  } else {
    process.stdout.write(
      '# Protected (auto_L1) glob set — exec-trust-extended.\n' +
      '# Source: ' + path.relative(policy.ROOT, policy.DEFAULT_MANIFEST_PATH) + '\n' +
      '# These paths must be operator-owned / merge-gated and unwritable by the loop.\n'
    );
    for (const g of set) process.stdout.write(g + '\n');
  }
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { main };
