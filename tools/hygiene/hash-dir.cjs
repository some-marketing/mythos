#!/usr/bin/env node
'use strict';

// tools/hygiene/hash-dir.cjs — deterministic content hash of a directory tree.
// Shared by the Mac <-> Orwell parity guard so BOTH sides compute the same
// normalized hash over the same algorithm (no cross-machine drift from
// differing hash implementations). Run standalone:
//   node hash-dir.cjs <dir> [max-depth]

const fs = require('fs');
const path = require('path');
const { normalizedContentHash } = require('../reconciliation/lib/normalized-content-hash.cjs');

function hashDir(dir, depth = 4) {
  const entries = [];
  (function walk(d, rel) {
    let names;
    try { names = fs.readdirSync(d); } catch { return; }
    for (const n of names.sort()) {
      if (n.startsWith('._')) continue; // AppleDouble metadata sidecars (macOS tar -> NTFS); not content
      const full = path.join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (depth > 0) walk(full, r);
      } else if (st.isFile()) {
        entries.push([r, fs.readFileSync(full, 'utf8')]);
      }
    }
  })(dir, '');
  return normalizedContentHash(entries, { format: 'json' }).sha256;
}

if (require.main === module) {
  const dir = process.argv[2];
  const depth = parseInt(process.argv[3] || '4', 10);
  if (!dir) { process.stderr.write('usage: node hash-dir.cjs <dir> [max-depth]\n'); process.exit(2); }
  try {
    process.stdout.write(hashDir(dir, depth) + '\n');
  } catch (e) {
    process.stderr.write(`hash-dir: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = { hashDir };
