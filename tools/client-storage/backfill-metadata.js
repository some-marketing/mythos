#!/usr/bin/env node
'use strict';

// Backfills migration-time provider checksum/mtime expectations for manifests
// created before U8. Values are derived only after the exact mounted target
// matches the existing SHA-256 manifest evidence. No client/cloud file is
// copied, renamed, overwritten, or deleted.

const fs = require('fs');
const path = require('path');
const {
  parseArgs,
  emitStatus,
  fail,
  EXIT_CODES,
  resolveStorageRoot,
  sha256File,
  hashFile,
  quickXorHashFile,
  clientRootPath,
  writeAtomic,
  ensureReportsDir,
  nowUtcStamp
} = require('./lib.js');
const { validateStorageState } = require('./verify-remote.js');

async function buildBackfill(clientCode, migrationReportPath) {
  const resolved = resolveStorageRoot(clientCode);
  if (!resolved.ok) return resolved;
  const state = validateStorageState(clientCode, resolved);
  if (!state.ok) return state;
  const storageMapPath = path.join(clientRootPath(clientCode), 'storage-map.json');
  let report;
  let originalBytes;
  try {
    report = JSON.parse(fs.readFileSync(migrationReportPath, 'utf8'));
    originalBytes = fs.readFileSync(storageMapPath);
  } catch {
    return { ok: false, code: EXIT_CODES.REPORT_MISSING, reason: 'migration report or storage map is missing' };
  }
  const storageSha256 = await sha256File(storageMapPath);
  if (
    report.schema !== 'ClientStorageManifestVerify/1.0' ||
    report.client !== clientCode ||
    report.snapshot_status !== 'PASS' ||
    report.storage_map_sha256 !== storageSha256 ||
    report.target_mismatch_count !== 0 ||
    report.preserved_snapshot_mismatch_count !== 0
  ) {
    return { ok: false, code: EXIT_CODES.PREFLIGHT_FAILED, reason: 'migration report does not bind a complete mounted snapshot' };
  }
  const nextMap = JSON.parse(originalBytes.toString('utf8'));
  const entryByIdentity = new Map();
  for (const [collection, preserved] of [
    [nextMap.entries, false],
    [nextMap.preserved_snapshots || [], true]
  ]) {
    for (const entry of collection) {
      const identity = entry.pii_id ? `PII:${entry.pii_id}` : `PATH:${entry.repo_relpath}`;
      entryByIdentity.set(`${preserved}:${identity}`, entry);
    }
  }
  let updated = 0;
  let verifiedBytes = 0;
  for (const item of state.all) {
    if (
      !fs.existsSync(item.targetPath) ||
      !fs.lstatSync(item.targetPath).isFile() ||
      fs.lstatSync(item.targetPath).isSymbolicLink() ||
      fs.statSync(item.targetPath).size !== item.entry.size ||
      await sha256File(item.targetPath) !== item.entry.sha256
    ) {
      return { ok: false, code: EXIT_CODES.CHECKSUM_MISMATCH, reason: 'a mounted target no longer matches the manifest' };
    }
    const target = entryByIdentity.get(`${item.preserved}:${item.identity}`);
    if (!target.md5) target.md5 = await hashFile(item.targetPath, 'md5');
    if (!target.quick_xor_hash) target.quick_xor_hash = await quickXorHashFile(item.targetPath);
    if (!target.drive_mtime) target.drive_mtime = fs.statSync(item.targetPath).mtime.toISOString();
    if (
      target.md5 !== item.entry.md5 ||
      target.quick_xor_hash !== item.entry.quick_xor_hash ||
      target.drive_mtime !== item.entry.drive_mtime
    ) updated += 1;
    verifiedBytes += item.entry.size;
  }
  return {
    ok: true,
    storageMapPath,
    originalBytes,
    nextMap,
    updated,
    entryCount: state.all.length,
    verifiedBytes,
    migrationReportPath
  };
}

function writeBackfillCas(result) {
  const lockPath = path.join(path.dirname(result.storageMapPath), '.storage-map.lock');
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch {
    return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'storage-map mutation lock is already held' };
  }
  try {
    if (!fs.readFileSync(result.storageMapPath).equals(result.originalBytes)) {
      return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'storage-map changed after metadata validation' };
    }
    writeAtomic(result.storageMapPath, JSON.stringify(result.nextMap, null, 2) + '\n');
    return { ok: true };
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lockPath);
  }
}

async function main() {
  const args = parseArgs(process.argv, {
    flags: ['execute'],
    valued: ['client', 'migration-report']
  });
  if (!args.client || !args['migration-report']) {
    fail(EXIT_CODES.USAGE_ERROR, {
      stage: 'backfill-metadata',
      reason: '--client and --migration-report are required'
    });
    return;
  }
  const result = await buildBackfill(args.client, path.resolve(args['migration-report']));
  if (!result.ok) {
    fail(result.code, { client: args.client, stage: 'backfill-metadata', reason: result.reason });
    return;
  }
  if (!args.execute) {
    emitStatus({
      ok: true,
      client: args.client,
      dry_run: true,
      entries_to_update: result.updated,
      verified_entries: result.entryCount,
      verified_bytes: result.verifiedBytes
    });
    return;
  }
  const written = writeBackfillCas(result);
  if (!written.ok) {
    fail(written.code, { client: args.client, stage: 'backfill-metadata-write', reason: written.reason });
    return;
  }
  const report = {
    schema: 'ClientStorageMetadataBackfill/1.0',
    client: args.client,
    generated_at: new Date().toISOString(),
    status: 'PASS',
    entries_updated: result.updated,
    verified_entries: result.entryCount,
    verified_bytes: result.verifiedBytes,
    migration_report_sha256: await sha256File(result.migrationReportPath),
    storage_map_before_sha256: require('crypto').createHash('sha256').update(result.originalBytes).digest('hex'),
    storage_map_after_sha256: await sha256File(result.storageMapPath),
    cloud_files_modified: 0,
    local_sources_modified: 0,
    pii_paths_reported: 0
  };
  const stamp = nowUtcStamp();
  const dir = ensureReportsDir();
  const jsonPath = path.join(dir, `${args.client}__metadata-backfill__${stamp}.json`);
  const mdPath = path.join(dir, `${args.client}__metadata-backfill__${stamp}.md`);
  writeAtomic(jsonPath, JSON.stringify(report, null, 2) + '\n');
  writeAtomic(mdPath, [
    `# storage metadata backfill: ${args.client}`,
    '',
    `Status: ${report.status}`,
    `Entries updated: ${report.entries_updated}`,
    `Verified entries: ${report.verified_entries}`,
    'Cloud files modified: 0',
    'Local sources modified: 0',
    ''
  ].join('\n'));
  emitStatus({
    ok: true,
    client: args.client,
    entries_updated: result.updated,
    report_json: path.relative(process.cwd(), jsonPath)
  });
}

if (require.main === module) {
  main().catch((error) => {
    fail(EXIT_CODES.USAGE_ERROR, {
      stage: 'backfill-metadata',
      reason: `unexpected metadata backfill failure (${error && error.code || 'UNKNOWN'})`
    });
  });
}

module.exports = { buildBackfill, writeBackfillCas, main };
