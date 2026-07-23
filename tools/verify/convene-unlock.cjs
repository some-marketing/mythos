#!/usr/bin/env node
'use strict';

/**
 * convene-unlock.cjs — mint a short-lived local governance-write receipt after
 * a deliberate 1Password approval.
 *
 * This command is intentionally separate from the PreToolUse hook. Running `op`
 * can require local authentication or device approval; the hot hook only checks
 * the local receipt written here.
 */

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_RECEIPTS_DIR = process.env.MYTHOS_CONVENE_RECEIPTS_DIR
  || path.join(os.tmpdir(), 'smos-convene-receipts');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    item: null,
    vault: null,
    paths: [],
    conveneRun: null,
    ttlHours: 24,
    receiptsDir: DEFAULT_RECEIPTS_DIR,
    dryRun: false,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a === '--dry-run') { args.dryRun = true; continue; }
    if (a === '--item') { args.item = argv[++i]; continue; }
    if (a === '--vault') { args.vault = argv[++i]; continue; }
    if (a === '--path') { args.paths.push(argv[++i]); continue; }
    if (a === '--convene-run') { args.conveneRun = argv[++i]; continue; }
    if (a === '--ttl-hours') { args.ttlHours = Number(argv[++i]); continue; }
    if (a === '--receipts-dir') { args.receiptsDir = argv[++i]; continue; }
  }

  return args;
}

function printHelp() {
  process.stdout.write(`tools/verify/convene-unlock.cjs — mint ConveneReceipt/1.0

Usage:
  node tools/verify/convene-unlock.cjs --item <1password-item> --path <repo/path> [--path <repo/dir/>] --convene-run <path>

Options:
  --item <id|name>         1Password item to read with 'op item get'.
  --vault <vault>          Optional 1Password vault.
  --path <repo/path>       Authorized repo-relative path. Repeatable. Directory scopes must end with '/'.
  --convene-run <path>     Convene artifact authorizing this unlock.
  --ttl-hours <number>     Receipt lifetime. Default: 24.
  --receipts-dir <path>    Local receipt directory. Default: ${DEFAULT_RECEIPTS_DIR}
  --dry-run                Verify 1Password item and print receipt without writing.
`);
}

function normalizeAuthorizedPath(value) {
  const p = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p || p.includes('..')) {
    throw new Error(`Invalid --path "${value}". Use a repo-relative path without '..'.`);
  }
  return p;
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

function buildReceipt(args, opItem, now = new Date()) {
  if (!Array.isArray(args.paths) || args.paths.length === 0) {
    throw new Error('At least one --path is required');
  }
  if (!args.conveneRun) {
    throw new Error('--convene-run is required');
  }
  const ttlHours = Number(args.ttlHours);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 48) {
    throw new Error('--ttl-hours must be > 0 and <= 48');
  }
  const authorizedPaths = args.paths.map(normalizeAuthorizedPath);
  return {
    schema: 'ConveneReceipt/1.0',
    verdict: 'approved',
    convene_run: args.conveneRun,
    authorized_paths: authorizedPaths,
    expires: new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString(),
    operator_ratified: true,
    authorization: {
      type: '1password',
      item_id: opItem.id,
      item_title: opItem.title,
      vault: opItem.vault
    },
    minted_at: now.toISOString()
  };
}

function receiptFilename(receipt) {
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      convene_run: receipt.convene_run,
      authorized_paths: receipt.authorized_paths,
      minted_at: receipt.minted_at
    }))
    .digest('hex')
    .slice(0, 16);
  const base = path.basename(String(receipt.convene_run || 'convene')).replace(/[^A-Za-z0-9._-]/g, '_');
  return `${base}-${hash}.json`;
}

function writeReceipt(receipt, receiptsDir = DEFAULT_RECEIPTS_DIR) {
  fs.mkdirSync(receiptsDir, { recursive: true, mode: 0o700 });
  const file = path.join(receiptsDir, receiptFilename(receipt));
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  return file;
}

function main() {
  const args = parseArgs();
  if (args.help) { printHelp(); return; }
  const opItem = verifyOnePasswordItem(args);
  const receipt = buildReceipt(args, opItem);
  if (args.dryRun) {
    process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
    return;
  }
  const file = writeReceipt(receipt, args.receiptsDir);
  process.stdout.write(`WROTE ${file}\n`);
}

module.exports = {
  DEFAULT_RECEIPTS_DIR,
  buildReceipt,
  normalizeAuthorizedPath,
  parseArgs,
  receiptFilename,
  verifyOnePasswordItem,
  writeReceipt
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`convene-unlock FATAL: ${err.message}\n`);
    process.exit(2);
  }
}
