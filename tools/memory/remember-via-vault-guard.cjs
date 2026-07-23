#!/usr/bin/env node
'use strict';

// remember-via-vault-guard.cjs — additive op-auth pre-check in front of
// tools/memory/remember-via-vault.sh (plan session-boundary-leak-repairs, S3,
// leak L7).
//
// The memory-mirror leg needs `op` (1Password) to fetch Sam's service-account
// token. When op is unauthenticated the underlying script fails (exit 2) and
// the mirror used to pend SILENTLY — a memory write simply never reached the
// vault, with nothing durable to notice. This guard closes that: it pre-checks
// op auth, and on an unauthenticated op it writes a LOUD pending receipt (a
// durable file the end-session closeout inventories) instead of dropping the
// write. It NEVER rewrites remember-via-vault.sh — on authed op it delegates
// verbatim.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PENDING_REL = path.join('_dev', 'state', 'memory-mirror-pending');

function defaultOpCheck() {
  // `op whoami` exits 0 only when a session is authenticated. A service-account
  // token in the env also authenticates op non-interactively.
  const res = spawnSync('op', ['whoami'], { encoding: 'utf8', timeout: 10000 });
  return !res.error && res.status === 0;
}

function defaultRunRemember(root, memoryFile, extraArgs) {
  const res = spawnSync('bash', [path.join(root, 'tools', 'memory', 'remember-via-vault.sh'), memoryFile, ...extraArgs], { cwd: root, stdio: 'inherit' });
  return res.status == null ? 1 : res.status;
}

function writePendingReceipt(root, memoryFile, now) {
  const dir = path.join(root, PENDING_REL);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = (now || new Date()).toISOString().replace(/[:.]/g, '-');
  const base = path.basename(String(memoryFile || 'unknown')).replace(/[^A-Za-z0-9._-]+/g, '-');
  const filePath = path.join(dir, `${stamp}__${base}.json`);
  const receipt = {
    schema: 'MemoryMirrorPending/1.0',
    memory_file: memoryFile || null,
    reason: 'op CLI unauthenticated at write time — memory-mirror leg could not reach Sam\'s Memories vault. NOT dropped; recorded here so closeout surfaces it.',
    next_command: `op signin && node tools/memory/remember-via-vault-guard.cjs ${memoryFile || '<memory-file>'}`,
    created_at: (now || new Date()).toISOString()
  };
  fs.writeFileSync(filePath, `${JSON.stringify(receipt, null, 2)}\n`);
  return filePath;
}

// Testable core. opts: { root, memoryFile, extraArgs, opCheck, runRemember, now }.
function guardedRemember(opts) {
  const root = opts.root;
  const memoryFile = opts.memoryFile;
  const opCheck = opts.opCheck || defaultOpCheck;
  const runRemember = opts.runRemember || defaultRunRemember;
  if (!memoryFile) {
    return { ok: false, deferred: false, reason: 'usage', message: 'usage: remember-via-vault-guard.cjs <memory-file> [--dry-run]' };
  }
  if (opCheck()) {
    const code = runRemember(root, memoryFile, opts.extraArgs || []);
    return { ok: code === 0, deferred: false, exit_code: code };
  }
  const receiptPath = writePendingReceipt(root, memoryFile, opts.now);
  return {
    ok: false,
    deferred: true,
    receipt_path: path.relative(root, receiptPath),
    message: `MEMORY-MIRROR PENDING (op unauthenticated): write NOT dropped — recorded at ${path.relative(root, receiptPath)}. Re-run once op is authed.`
  };
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const memoryFile = process.argv[2];
  const extraArgs = process.argv.slice(3);
  const result = guardedRemember({ root, memoryFile, extraArgs });
  if (result.message) process.stderr.write(`${result.message}\n`);
  // Deferred is a LOUD, non-silent outcome, but it is not a crash: exit 3 marks
  // "pending receipt written" distinctly from the underlying script's codes.
  if (result.deferred) process.exit(3);
  process.exit(result.ok ? 0 : (result.exit_code || 1));
}

if (require.main === module) main();

module.exports = { guardedRemember, writePendingReceipt, defaultOpCheck };
