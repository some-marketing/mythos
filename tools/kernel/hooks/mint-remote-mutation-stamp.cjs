#!/usr/bin/env node
'use strict';

/**
 * mint-remote-mutation-stamp.cjs — mint a signed RemoteMutationStamp/1.0 after
 * a deliberate 1Password approval.
 *
 * Codex PR #20 review finding F1 (kernel-triad convene 20260817T184138Z): a
 * hand-authored, schema-valid stamp JSON dropped into
 * _dev/state/remote-mutation-stamps/ is now rejected by
 * pretool-remote-mutation-gate.cjs's stampInvalidReason() -- a stamp is not
 * authority because it parses, it is authority because its MAC recomputes.
 * This mirrors tools/verify/convene-unlock.cjs's pattern exactly: reuse the
 * SAME "Mythos Convene Approval" 1Password item and the SAME Keychain-backed
 * operator secret already used for ConveneReceipt/1.0, rather than
 * introducing new operator-side credential infrastructure.
 */

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveStampSecret, signStamp } = require('./lib/stamp-mac.cjs');

const DEFAULT_STAMPS_DIR = path.join(__dirname, '..', '..', '..', '_dev', 'state', 'remote-mutation-stamps');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    item: null,
    vault: null,
    stampId: null,
    scope: [],
    conditions: [],
    sourceDoc: null,
    expiresHours: null,
    stampsDir: DEFAULT_STAMPS_DIR,
    dryRun: false,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a === '--dry-run') { args.dryRun = true; continue; }
    if (a === '--item') { args.item = argv[++i]; continue; }
    if (a === '--vault') { args.vault = argv[++i]; continue; }
    if (a === '--stamp-id') { args.stampId = argv[++i]; continue; }
    if (a === '--scope') { args.scope.push(argv[++i]); continue; }
    if (a === '--conditions') { args.conditions.push(argv[++i]); continue; }
    if (a === '--source-doc') { args.sourceDoc = argv[++i]; continue; }
    if (a === '--expires-hours') { args.expiresHours = Number(argv[++i]); continue; }
    if (a === '--stamps-dir') { args.stampsDir = argv[++i]; continue; }
  }

  return args;
}

function printHelp() {
  process.stdout.write(`tools/kernel/hooks/mint-remote-mutation-stamp.cjs — mint RemoteMutationStamp/1.0

Usage:
  node tools/kernel/hooks/mint-remote-mutation-stamp.cjs --item <1password-item> \\
    --stamp-id <slug>__<UTC> --scope <entry> [--scope <entry> ...] \\
    --conditions <text> [--conditions <text> ...] --source-doc <path-to-.md> \\
    [--expires-hours <n>] [--dry-run]

Options:
  --item <id|name>         1Password item to read with 'op item get'.
  --vault <vault>          Optional 1Password vault.
  --stamp-id <id>          Stamp identifier (also the output filename stem).
  --scope <entry>          Authorized scope entry. Repeatable. Exact key or 're:<pattern>'.
  --conditions <text>      Binding condition. Repeatable. At least one required.
  --source-doc <path>      Repo-relative path to the g-remote-mutation-(packet|prestamp)__*.md doc.
  --expires-hours <number> Optional TTL in hours. Omit for no expiry.
  --stamps-dir <path>      Local stamps directory. Default: ${DEFAULT_STAMPS_DIR}
  --dry-run                Verify the 1Password item and print the stamp without writing.

Stamps are HMAC-signed with the Keychain-backed operator secret
(service "MYTHOS_OPERATOR_APPROVAL_SECRET", account "smos"). Without that
secret this command refuses to mint, because an unsigned stamp is rejected
by tools/kernel/hooks/pretool-remote-mutation-gate.cjs.
`);
}

function verifyOnePasswordItem(args, execFileSync = childProcess.execFileSync) {
  if (!args.item) throw new Error('--item is required');
  const opArgs = ['item', 'get', args.item, '--format', 'json'];
  if (args.vault) opArgs.push('--vault', args.vault);
  const raw = execFileSync('op', opArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const item = JSON.parse(raw);
  if (!item || !item.id) {
    throw new Error('1Password item did not return an id');
  }
  return {
    id: item.id,
    title: item.title || args.item,
    vault: item.vault && (item.vault.id || item.vault.name) || args.vault || null
  };
}

/**
 * Build a signed RemoteMutationStamp/1.0.
 *
 * `secret` is MANDATORY: an unsigned stamp is inert -- the gate rejects it --
 * so minting one without a secret would only produce a confusing artifact
 * that looks like authority and is not.
 *
 * @param {Object} args
 * @param {Date} [now]
 * @param {string} secret - Keychain-resolved operator secret.
 */
function buildStamp(args, now = new Date(), secret) {
  if (!args.stampId) throw new Error('--stamp-id is required');
  if (!Array.isArray(args.scope) || args.scope.length === 0) throw new Error('At least one --scope is required');
  if (!Array.isArray(args.conditions) || args.conditions.length === 0) throw new Error('At least one --conditions is required');
  if (!args.sourceDoc) throw new Error('--source-doc is required');
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('a Keychain-resolved operator secret is required to sign the stamp (unsigned stamps are rejected by the gate)');
  }
  const docName = path.basename(args.sourceDoc);
  if (!/^g-remote-mutation-(packet|prestamp)__.*\.md$/.test(docName)) {
    throw new Error(`--source-doc "${args.sourceDoc}" does not match g-remote-mutation-(packet|prestamp)__*.md`);
  }
  let expiresAt = null;
  if (args.expiresHours !== null && args.expiresHours !== undefined && !Number.isNaN(args.expiresHours)) {
    if (!Number.isFinite(args.expiresHours) || args.expiresHours <= 0) {
      throw new Error('--expires-hours must be > 0');
    }
    expiresAt = new Date(now.getTime() + args.expiresHours * 60 * 60 * 1000).toISOString();
  }
  const stamp = {
    schema: 'RemoteMutationStamp/1.0',
    stamp_id: args.stampId,
    source_doc: args.sourceDoc,
    granted_at: now.toISOString(),
    operator_authorization: `1Password item "${args.item}" (id ${args.item}) approved this grant`,
    scope: args.scope.slice(),
    conditions: args.conditions.slice(),
    expires_at: expiresAt,
    voided: false,
    superseded_by: null
  };
  return signStamp(secret, stamp);
}

function stampFilename(stamp) {
  return `${stamp.stamp_id}.json`;
}

function writeStamp(stamp, stampsDir = DEFAULT_STAMPS_DIR) {
  fs.mkdirSync(stampsDir, { recursive: true });
  const file = path.join(stampsDir, stampFilename(stamp));
  fs.writeFileSync(file, JSON.stringify(stamp, null, 2) + '\n');
  return file;
}

function main() {
  const args = parseArgs();
  if (args.help) { printHelp(); return; }
  const opItem = verifyOnePasswordItem(args);
  void opItem;
  // Operator-run CLI: the explicit env opt-in is permitted here (and only
  // here), mirroring tools/verify/convene-unlock.cjs and tools/planning/stamp-plan.js.
  // The verifying gate never sets it, so an agent-planted env secret cannot
  // forge a stamp.
  const secret = resolveStampSecret({ allowEnvSecret: true });
  if (!secret) {
    throw new Error(
      'no operator approval secret found in the on-device secret store — stamps must be signed.\n' +
      'Store it first (Keychain service "MYTHOS_OPERATOR_APPROVAL_SECRET" / account "smos") ' +
      'or export MYTHOS_OPERATOR_APPROVAL_SECRET in your operator shell.'
    );
  }
  const stamp = buildStamp(args, new Date(), secret);
  if (args.dryRun) {
    process.stdout.write(JSON.stringify(stamp, null, 2) + '\n');
    return;
  }
  const file = writeStamp(stamp, args.stampsDir);
  process.stdout.write(`WROTE ${file}\n`);
}

module.exports = {
  DEFAULT_STAMPS_DIR,
  buildStamp,
  stampFilename,
  verifyOnePasswordItem,
  writeStamp
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`mint-remote-mutation-stamp FATAL: ${err.message}\n`);
    process.exit(2);
  }
}
