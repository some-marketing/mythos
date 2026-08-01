#!/usr/bin/env node
'use strict';

// Creates a private, path-bearing checksum inventory for intentionally ignored
// client intake. The snapshot is never committed or reported publicly. A
// matching snapshot lets classify.js distinguish stable ignored intake from a
// genuinely dirty tracked working copy; it cannot authorize tracked files.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  REPO_ROOT,
  EXIT_CODES,
  SOURCE_SNAPSHOT_SCHEMA,
  parseArgs,
  emitStatus,
  fail,
  clientRootPath,
  loadClientStoragePolicy,
  walkClientTree,
  isPrivateControlRelPath,
  sha256FileSync,
  sourceSnapshotPath,
  writeAtomic
} = require('./lib.js');

function printHelp() {
  process.stdout.write(`snapshot-source.js -- bind intentionally ignored client intake\n\nUsage:\n  node snapshot-source.js --client CODE --approve-private-intake --execute\n\nThe output file is private and ignored. No filenames are printed. Tracked or\nnon-ignored files can never be authorized by this snapshot.\n`);
}

function main() {
  const args = parseArgs(process.argv, { flags: ['approve-private-intake', 'execute'], valued: ['client'] });
  if (args.help) return printHelp();
  if (!args.client || !args['approve-private-intake'] || !args.execute) {
    fail(EXIT_CODES.USAGE_ERROR, { reason: '--client, --approve-private-intake, and --execute are required' });
    return;
  }
  const clientCode = args.client;
  let policy;
  try {
    policy = loadClientStoragePolicy(clientCode);
  } catch (error) {
    fail(EXIT_CODES.USAGE_ERROR, { client: clientCode, reason: error.message });
    return;
  }
  if (!policy.privateSourceSnapshotEnabled) {
    fail(EXIT_CODES.USAGE_ERROR, {
      client: clientCode,
      reason: 'private ignored-source snapshots are not enabled by client storage policy'
    });
    return;
  }
  const clientRoot = clientRootPath(clientCode);
  if (!fs.existsSync(clientRoot)) {
    fail(EXIT_CODES.MISSING_CLIENT, { client: clientCode, reason: 'client root is missing' });
    return;
  }

  const files = walkClientTree(clientRoot).filter((file) => !isPrivateControlRelPath(file.relPath));
  const repoPaths = files.map((file) => path.normalize(path.relative(REPO_ROOT, file.absPath)));
  const ignoredProbe = spawnSync('git', ['check-ignore', '-z', '--stdin'], {
    cwd: REPO_ROOT,
    input: Buffer.from(`${repoPaths.join('\0')}\0`),
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024
  });
  if (![0, 1].includes(ignoredProbe.status) || ignoredProbe.error) {
    fail(EXIT_CODES.USAGE_ERROR, { client: clientCode, reason: 'unable to establish ignored intake state' });
    return;
  }
  const ignored = new Set(
    ignoredProbe.stdout.toString('utf8').split('\0').filter(Boolean).map((value) => path.normalize(value))
  );
  const selected = files.filter((file) => ignored.has(path.normalize(path.relative(REPO_ROOT, file.absPath))));
  if (selected.length === 0) {
    fail(EXIT_CODES.USAGE_ERROR, { client: clientCode, reason: 'no ignored client intake files were found' });
    return;
  }

  const entries = selected.map((file) => {
    const before = fs.statSync(file.absPath);
    const sha256 = sha256FileSync(file.absPath);
    const after = fs.statSync(file.absPath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error('client intake changed while it was being snapshotted');
    }
    return {
      relpath: file.relPath.split(path.sep).join('/'),
      size: after.size,
      sha256
    };
  }).sort((a, b) => a.relpath.localeCompare(b.relpath));

  const document = {
    schema: SOURCE_SNAPSHOT_SCHEMA,
    client: clientCode,
    generated_at: new Date().toISOString(),
    entries
  };
  writeAtomic(sourceSnapshotPath(clientCode), JSON.stringify(document, null, 2) + '\n');
  emitStatus({
    ok: true,
    client: clientCode,
    entry_count: entries.length,
    total_bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    private: true
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    fail(EXIT_CODES.USAGE_ERROR, { reason: error.message });
  }
}

module.exports = { main };
