#!/usr/bin/env node
'use strict';
// CLI: smos-custody-grant <path> --to-session <session_id> [--reason "..."]
// Writes a one-use operator override grant for the git-custody gate.
// Grant file: _dev/state/git-custody-gate/grants/<sha256(path:session)>.json

const fs = require('fs');
const pathMod = require('path');
const crypto = require('crypto');

const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || '/Users/admin/dev/Mythos-recovered';
const GRANTS_DIR = pathMod.join(REPO_ROOT, '_dev', 'state', 'git-custody-gate', 'grants');

function grantHash(repoRelPath, toSession) {
  return crypto.createHash('sha256').update(`${repoRelPath}:${toSession}`).digest('hex');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let rawPath = null;
  let toSession = null;
  let reason = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--to-session' && i + 1 < args.length) {
      toSession = args[++i];
    } else if (args[i] === '--reason' && i + 1 < args.length) {
      reason = args[++i];
    } else if (!args[i].startsWith('-')) {
      rawPath = args[i];
    }
  }
  return { rawPath, toSession, reason };
}

function toRepoRelative(rawPath) {
  const abs = pathMod.isAbsolute(rawPath) ? rawPath : pathMod.resolve(process.cwd(), rawPath);
  const rel = pathMod.relative(REPO_ROOT, abs);
  if (rel.startsWith('..')) {
    throw new Error(`Path is outside repo root: ${rawPath}`);
  }
  return rel;
}

function writeGrant(repoRelPath, toSession, reason) {
  fs.mkdirSync(GRANTS_DIR, { recursive: true });
  const hash = grantHash(repoRelPath, toSession);
  const grantFile = pathMod.join(GRANTS_DIR, hash + '.json');

  // Idempotent: overwrite any unconsumed grant for same path+session
  const grant = {
    schema: 'CustodyGrant/1.0',
    path: repoRelPath,
    to_session: toSession,
    reason: reason || null,
    granted_at: new Date().toISOString(),
    granted_by: 'operator',
    consumed: false,
    consumed_at: null,
  };

  const tmp = grantFile + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(grant, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, grantFile);
  return grantFile;
}

if (require.main === module) {
  const { rawPath, toSession, reason } = parseArgs(process.argv);

  if (!rawPath) {
    process.stderr.write('Usage: smos-custody-grant <path> --to-session <session_id> [--reason "..."]\n');
    process.exit(1);
  }
  if (!toSession) {
    process.stderr.write('Error: --to-session <session_id> is required\n');
    process.exit(1);
  }

  try {
    const repoRelPath = toRepoRelative(rawPath);
    const grantFile = writeGrant(repoRelPath, toSession, reason);
    const relGrantFile = pathMod.relative(REPO_ROOT, grantFile);
    process.stdout.write(`Grant written: ${relGrantFile}\n`);
    process.stdout.write(`  path:       ${repoRelPath}\n`);
    process.stdout.write(`  to_session: ${toSession}\n`);
    if (reason) process.stdout.write(`  reason:     ${reason}\n`);
    process.stdout.write(`  one-use:    true (consumed on first gate check)\n`);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { grantHash, writeGrant, toRepoRelative, GRANTS_DIR };
