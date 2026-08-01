#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const inputArg = args.find(arg => !arg.startsWith('--'));
const acknowledged = args.includes('--ack-local-private-state');
const dryRun = args.includes('--dry-run') || !acknowledged;
if (!inputArg) {
  console.error('usage: portable-remember.cjs <input-file> [--dry-run|--ack-local-private-state]');
  process.exit(2);
}
const input = path.resolve(inputArg);
if (!fs.statSync(input).isFile()) throw new Error('memory input must be a regular file');
const localBase = process.env.MYTHOS_LOCAL_MEMORY_DIR
  || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'mythos', 'memory');
const destinationRoot = path.resolve(localBase);
if (destinationRoot === ROOT || destinationRoot.startsWith(ROOT + path.sep)) {
  throw new Error('local memory destination must remain outside the Mythos repository');
}
const safeName = path.basename(input).replace(/[^A-Za-z0-9._-]+/g, '-');
const destination = path.join(destinationRoot, safeName);
const content = fs.readFileSync(input);
const receipt = {
  schema: 'MythosPortableMemoryReceipt/1.0',
  dry_run: dryRun,
  repository_write: false,
  destination_class: 'local-private-state',
  filename: safeName,
  content_sha256: crypto.createHash('sha256').update(content).digest('hex'),
  bytes: content.length,
};
if (!dryRun) {
  fs.mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(destination, content, { mode: 0o600 });
}
console.log(JSON.stringify(receipt, null, 2));
