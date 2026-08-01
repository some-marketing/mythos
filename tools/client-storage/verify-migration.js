#!/usr/bin/env node
'use strict';

// Verifies the mounted migration snapshot against storage-map.json without
// changing cloud or source files. Source drift is reported separately from
// snapshot integrity: a newer local source must block later retirement, but
// it does not make an already checksum-bound cloud snapshot disappear.

const fs = require('fs');
const path = require('path');
const {
  parseArgs,
  emitStatus,
  fail,
  EXIT_CODES,
  resolveStorageRoot,
  assertUnderRoot,
  sha256File,
  clientRootPath,
  validatePiiPathMapBinding,
  validatePiiPublicMembership,
  recoverEntryPath,
  loadPiiPathMap,
  loadStorageMap,
  ensureReportsDir,
  writeAtomic,
  nowUtcStamp,
  REPO_ROOT
} = require('./lib.js');

function printHelp() {
  process.stdout.write(`verify-migration.js -- verify a mounted migration snapshot

Usage:
  node verify-migration.js --client CODE --classify-report FILE

Checks every storage-map entry against the mounted target checksum and binds
the report to the exact storage map and classification report. It also checks
whether each local source still matches the migrated snapshot, reporting drift
without modifying either version. PII paths remain private.
`);
}

function validateRetirementLineage(storageMap, piiMapCheck) {
  const sha = /^[a-f0-9]{64}$/;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const retiredGroups = new Map();
  const retiredPiiIds = new Set();
  for (const entry of storageMap.entries) {
    const retired = entry.local_deleted_at != null;
    if (retired && (
      typeof entry.local_deleted_at !== 'string' ||
      !Number.isFinite(Date.parse(entry.local_deleted_at))
    )) {
      return { ok: false, reason: 'storage-map contains an invalid local retirement timestamp' };
    }
    if (entry.pii_id) {
      if (retired) {
        const tombstone = piiMapCheck.retiredIndex.get(entry.pii_id);
        if (
          !tombstone ||
          piiMapCheck.index.has(entry.pii_id) ||
          tombstone.size !== entry.size ||
          tombstone.sha256 !== entry.sha256 ||
          tombstone.retired_at !== entry.local_deleted_at
        ) {
          return { ok: false, reason: 'retired PII identity lacks its exact private tombstone' };
        }
        retiredPiiIds.add(entry.pii_id);
      } else if (!piiMapCheck.index.has(entry.pii_id) || piiMapCheck.retiredIndex.has(entry.pii_id)) {
        return { ok: false, reason: 'active PII identity is not in the active private map' };
      }
    }
    if (!retired) continue;
    const group = retiredGroups.get(entry.local_deleted_at) || { count: 0, bytes: 0 };
    group.count += 1;
    group.bytes += entry.size;
    retiredGroups.set(entry.local_deleted_at, group);
  }
  if (
    [...piiMapCheck.retiredIndex.keys()].some((id) => !retiredPiiIds.has(id)) ||
    (
      retiredGroups.size > 0 &&
      (!Array.isArray(storageMap.retirement_records) ||
        storageMap.retirement_records.length !== retiredGroups.size)
    ) ||
    (
      retiredGroups.size === 0 &&
      Array.isArray(storageMap.retirement_records) &&
      storageMap.retirement_records.length > 0
    )
  ) {
    return { ok: false, reason: 'retirement records or private tombstones do not match retired entries' };
  }
  const seenTimes = new Set();
  for (const record of storageMap.retirement_records || []) {
    const group = retiredGroups.get(record && record.local_deleted_at);
    if (
      !record ||
      !group ||
      seenTimes.has(record.local_deleted_at) ||
      record.status !== 'PASS' ||
      !uuid.test(record.retirement_id || '') ||
      !sha.test(record.migration_report_sha256 || '') ||
      !sha.test(record.remote_report_sha256 || '') ||
      !sha.test(record.storage_map_before_sha256 || '') ||
      !sha.test(record.entry_set_sha256 || '') ||
      record.entry_count !== group.count ||
      record.total_bytes !== group.bytes
    ) {
      return { ok: false, reason: 'retirement record does not exactly cover its stamped entries' };
    }
    seenTimes.add(record.local_deleted_at);
  }
  return { ok: true, retiredCount: [...retiredGroups.values()].reduce((sum, group) => sum + group.count, 0) };
}

async function main() {
  const args = parseArgs(process.argv, { valued: ['client', 'classify-report'] });
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.client || !args['classify-report']) {
    process.stderr.write('Usage: node verify-migration.js --client CODE --classify-report FILE\n');
    process.exit(EXIT_CODES.USAGE_ERROR);
  }
  const clientCode = args.client;
  const classifyPath = path.resolve(args['classify-report']);
  if (!fs.existsSync(classifyPath)) {
    fail(EXIT_CODES.REPORT_MISSING, { client: clientCode, stage: 'verify-migration', reason: 'classification report is missing' });
    return;
  }
  let classifyReport;
  try {
    classifyReport = JSON.parse(fs.readFileSync(classifyPath, 'utf8'));
  } catch {
    fail(EXIT_CODES.CLASSIFY_MISMATCH, { client: clientCode, stage: 'verify-migration', reason: 'classification report is invalid JSON' });
    return;
  }
  if (classifyReport.client !== clientCode || !Array.isArray(classifyReport.entries)) {
    fail(EXIT_CODES.CLASSIFY_MISMATCH, { client: clientCode, stage: 'verify-migration', reason: 'classification report client or entries are invalid' });
    return;
  }
  const resolved = resolveStorageRoot(clientCode);
  if (!resolved.ok) {
    fail(resolved.code, { client: clientCode, stage: 'verify-migration', reason: resolved.reason });
    return;
  }
  const clientRoot = clientRootPath(clientCode);
  const storageMapPath = path.join(clientRoot, 'storage-map.json');
  const storageMap = loadStorageMap(clientCode);
  if (
    !storageMap ||
    storageMap.client !== clientCode ||
    !storageMap.drive ||
    storageMap.drive.provider !== resolved.provider ||
    storageMap.drive.mounted_path !== resolved.mountedPath ||
    !Array.isArray(storageMap.entries) ||
    (storageMap.preserved_snapshots !== undefined && !Array.isArray(storageMap.preserved_snapshots))
  ) {
    fail(EXIT_CODES.TARGET_CONFLICT, { client: clientCode, stage: 'verify-migration', reason: 'storage-map identity is invalid' });
    return;
  }
  const malformedRetirementStamp = storageMap.entries.some((entry) =>
    entry.local_deleted_at != null &&
    (
      typeof entry.local_deleted_at !== 'string' ||
      !Number.isFinite(Date.parse(entry.local_deleted_at))
    )
  );
  if (malformedRetirementStamp) {
    fail(EXIT_CODES.TARGET_CONFLICT, {
      client: clientCode,
      stage: 'verify-migration',
      reason: 'storage-map contains an invalid local retirement timestamp'
    });
    return;
  }
  const hasRetiredSources = storageMap.entries.some((entry) => entry.local_deleted_at != null);
  const currentPrivateMap = loadPiiPathMap(clientCode);
  const currentPrivateMapPath = path.join(clientRoot, 'pii-path-map.json');
  const currentPrivateMapSha256 = fs.existsSync(currentPrivateMapPath)
    ? await sha256File(currentPrivateMapPath)
    : null;
  const piiMapCheck = await validatePiiPathMapBinding(
    clientCode,
    hasRetiredSources
      ? {
          required: true,
          schema: 'ClientStoragePiiPathMap/1.0',
          client: clientCode,
          entry_count: Array.isArray(currentPrivateMap && currentPrivateMap.entries)
            ? currentPrivateMap.entries.length
            : -1,
          sha256: currentPrivateMapSha256
        }
      : classifyReport.pii_path_map_binding
  );
  if (!piiMapCheck.ok) {
    fail(piiMapCheck.code, { client: clientCode, stage: 'verify-migration', reason: piiMapCheck.reason });
    return;
  }
  const retirementLineage = validateRetirementLineage(storageMap, piiMapCheck);
  if (!retirementLineage.ok) {
    fail(EXIT_CODES.TARGET_CONFLICT, {
      client: clientCode,
      stage: 'verify-migration',
      reason: retirementLineage.reason
    });
    return;
  }
  const activeAndRetiredPii = hasRetiredSources
    ? new Map([
        ...piiMapCheck.index,
        ...[...piiMapCheck.retiredIndex].map(([id, entry]) => [
          id,
          { ...entry, repo_relpath: entry.private_remote_relpath }
        ])
      ])
    : piiMapCheck.index;
  const membership = validatePiiPublicMembership(classifyReport.entries, activeAndRetiredPii);
  if (!membership.ok) {
    fail(membership.code, { client: clientCode, stage: 'verify-migration', reason: membership.reason });
    return;
  }

  const classifyIdentities = new Map();
  for (const entry of classifyReport.entries.filter((item) => ['MOVE', 'PII-MOVE'].includes(item.klass))) {
    const identity = entry.klass === 'PII-MOVE' ? `PII:${entry.pii_id}` : `PATH:${entry.relpath}`;
    if (classifyIdentities.has(identity)) {
      fail(EXIT_CODES.TARGET_COLLISION, { client: clientCode, stage: 'verify-migration', reason: 'classification has duplicate migration identities' });
      return;
    }
    classifyIdentities.set(identity, entry);
  }

  const results = [];
  const preservedSnapshots = storageMap.preserved_snapshots || [];
  let totalBytes = 0;
  let preservedBytes = 0;
  let preservedMismatchCount = 0;
  let sourceDriftCount = 0;
  let sourceMissingCount = 0;
  let sourceRetiredCount = 0;
  let targetMismatchCount = 0;
  const seenManifestIdentities = new Set();
  for (const manifestEntry of storageMap.entries) {
    const isPii = Boolean(manifestEntry.pii_id);
    if (
      isPii &&
      ['repo_relpath', 'drive_relpath', 'renamed_to'].some((key) =>
        Object.prototype.hasOwnProperty.call(manifestEntry, key)
      )
    ) {
      fail(EXIT_CODES.PII_MAP_DRIFT, {
        client: clientCode,
        stage: 'verify-migration',
        reason: 'an opaque PII manifest entry contains a path-bearing field'
      });
      return;
    }
    const identity = isPii ? `PII:${manifestEntry.pii_id}` : `PATH:${manifestEntry.repo_relpath}`;
    if (seenManifestIdentities.has(identity) || !classifyIdentities.has(identity)) {
      fail(EXIT_CODES.TARGET_COLLISION, { client: clientCode, stage: 'verify-migration', reason: 'storage-map identity is duplicate or absent from classification' });
      return;
    }
    seenManifestIdentities.add(identity);
    const publicEntry = classifyIdentities.get(identity);
    let located;
    try {
      located = isPii
        ? recoverEntryPath(publicEntry, clientRoot, activeAndRetiredPii)
        : { relPath: manifestEntry.repo_relpath, absPath: path.join(clientRoot, manifestEntry.repo_relpath) };
      assertUnderRoot(located.absPath, clientRoot);
    } catch {
      fail(EXIT_CODES.PII_MAP_DRIFT, { client: clientCode, stage: 'verify-migration', reason: 'a manifest identity cannot be resolved safely' });
      return;
    }
    if (
      isPii &&
      (
        manifestEntry.sha256 !== located.expectedSha256 ||
        manifestEntry.size !== publicEntry.size
      )
    ) {
      fail(EXIT_CODES.PII_MAP_DRIFT, {
        client: clientCode,
        stage: 'verify-migration',
        reason: 'an opaque PII manifest entry is not bound to the classified private identity'
      });
      return;
    }
    const driveRelPath = isPii ? located.relPath : manifestEntry.drive_relpath;
    const targetPath = assertUnderRoot(path.join(resolved.mountedPath, driveRelPath), resolved.mountedPath);
    let targetStatus = 'MATCH';
    if (
      !fs.existsSync(targetPath) ||
      !fs.statSync(targetPath).isFile() ||
      fs.statSync(targetPath).size !== manifestEntry.size ||
      await sha256File(targetPath) !== manifestEntry.sha256
    ) {
      targetStatus = 'MISMATCH';
      targetMismatchCount += 1;
    }

    let sourceStatus = 'MATCH';
    const intentionallyRetired =
      typeof manifestEntry.local_deleted_at === 'string' &&
      Number.isFinite(Date.parse(manifestEntry.local_deleted_at));
    if (intentionallyRetired) {
      if (!fs.existsSync(located.absPath)) {
        sourceStatus = 'RETIRED';
        sourceRetiredCount += 1;
      } else {
        sourceStatus = 'RESTORED';
        sourceDriftCount += 1;
      }
    } else if (!fs.existsSync(located.absPath) || !fs.statSync(located.absPath).isFile()) {
      sourceStatus = 'MISSING';
      sourceMissingCount += 1;
    } else if (
      fs.statSync(located.absPath).size !== manifestEntry.size ||
      await sha256File(located.absPath) !== manifestEntry.sha256
    ) {
      sourceStatus = 'DRIFT';
      sourceDriftCount += 1;
    }
    totalBytes += manifestEntry.size;
    results.push({
      klass: isPii ? 'PII-MOVE' : 'MOVE',
      relPath: isPii ? null : manifestEntry.repo_relpath,
      size: manifestEntry.size,
      sha256Prefix: manifestEntry.sha256.slice(0, 8),
      targetStatus,
      sourceStatus
    });
  }
  if (seenManifestIdentities.size !== classifyIdentities.size) {
    fail(EXIT_CODES.CLASSIFY_DRIFT, { client: clientCode, stage: 'verify-migration', reason: 'classification and storage-map migration sets differ' });
    return;
  }

  const preservedIdentities = new Set();
  for (const entry of preservedSnapshots) {
    const isPii = Boolean(entry && entry.pii_id);
    if (
      !entry ||
      !Number.isFinite(entry.size) ||
      entry.size < 0 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256 || '') ||
      (isPii === Boolean(entry.repo_relpath)) ||
      (isPii &&
        ['repo_relpath', 'drive_relpath', 'renamed_to'].some((key) =>
          Object.prototype.hasOwnProperty.call(entry, key)
        ))
    ) {
      fail(EXIT_CODES.PII_MAP_DRIFT, {
        client: clientCode,
        stage: 'verify-migration',
        reason: 'a preserved snapshot has invalid or path-bearing opaque identity metadata'
      });
      return;
    }
    const identity = isPii ? `PII:${entry.pii_id}` : `PATH:${entry.repo_relpath}`;
    if (
      preservedIdentities.has(identity) ||
      seenManifestIdentities.has(identity) ||
      classifyIdentities.has(identity)
    ) {
      fail(EXIT_CODES.TARGET_COLLISION, {
        client: clientCode,
        stage: 'verify-migration',
        reason: 'a preserved snapshot identity is duplicate or still active'
      });
      return;
    }
    preservedIdentities.add(identity);
    let driveRelPath = entry.drive_relpath;
    if (isPii) {
      const locator = piiMapCheck.retainedIndex.get(entry.pii_id);
      if (
        !locator ||
        locator.size !== entry.size ||
        locator.sha256 !== entry.sha256
      ) {
        fail(EXIT_CODES.PII_MAP_DRIFT, {
          client: clientCode,
          stage: 'verify-migration',
          reason: 'an opaque preserved snapshot is not bound to a retained private identity'
        });
        return;
      }
      driveRelPath = locator.repo_relpath;
    }
    let targetPath;
    try {
      targetPath = assertUnderRoot(path.join(resolved.mountedPath, driveRelPath), resolved.mountedPath);
    } catch {
      fail(EXIT_CODES.TARGET_CONFLICT, {
        client: clientCode,
        stage: 'verify-migration',
        reason: 'a preserved snapshot target cannot be resolved safely'
      });
      return;
    }
    if (
      !fs.existsSync(targetPath) ||
      !fs.statSync(targetPath).isFile() ||
      fs.statSync(targetPath).size !== entry.size ||
      await sha256File(targetPath) !== entry.sha256
    ) {
      preservedMismatchCount += 1;
    }
    preservedBytes += entry.size;
  }

  const snapshotStatus =
    targetMismatchCount === 0 && preservedMismatchCount === 0 ? 'PASS' : 'FAIL';
  const sourceCurrencyStatus =
    sourceMissingCount > 0
      ? 'MISSING'
      : sourceDriftCount > 0
        ? 'DRIFT'
        : sourceRetiredCount > 0
          ? 'RETIRED'
          : 'CURRENT';
  const closureReady = snapshotStatus === 'PASS' && sourceCurrencyStatus === 'CURRENT';
  const postRetirementAuditReady =
    hasRetiredSources &&
    snapshotStatus === 'PASS' &&
    sourceMissingCount === 0 &&
    sourceDriftCount === 0 &&
    sourceRetiredCount === storageMap.entries.filter((entry) =>
      entry.local_deleted_at != null
    ).length;
  const report = {
    schema: 'ClientStorageManifestVerify/1.0',
    client: clientCode,
    generated_at: new Date().toISOString(),
    status: closureReady || postRetirementAuditReady ? 'PASS' : snapshotStatus === 'FAIL' ? 'FAIL' : 'DRIFT',
    snapshot_status: snapshotStatus,
    source_currency_status: sourceCurrencyStatus,
    u4_closure_ready: closureReady,
    post_retirement_audit_ready: postRetirementAuditReady,
    retirement_eligible: false,
    truth_domain: 'mounted_snapshot',
    provider: resolved.provider,
    storage_map_sha256: await sha256File(storageMapPath),
    classify_report_sha256: await sha256File(classifyPath),
    pii_path_map_sha256: currentPrivateMapSha256,
    classification_pii_path_map_sha256: classifyReport.pii_path_map_binding.sha256,
    pii_active_identity_count: piiMapCheck.index.size,
    pii_retained_identity_count: piiMapCheck.retainedIndex.size,
    pii_retired_identity_count: piiMapCheck.retiredIndex.size,
    entry_count: results.length,
    total_bytes: totalBytes,
    target_match_count: results.length - targetMismatchCount,
    target_mismatch_count: targetMismatchCount,
    preserved_snapshot_count: preservedSnapshots.length,
    preserved_snapshot_bytes: preservedBytes,
    preserved_snapshot_match_count: preservedSnapshots.length - preservedMismatchCount,
    preserved_snapshot_mismatch_count: preservedMismatchCount,
    source_match_count: results.length - sourceDriftCount - sourceMissingCount - sourceRetiredCount,
    source_drift_count: sourceDriftCount,
    source_missing_count: sourceMissingCount,
    source_retired_count: sourceRetiredCount,
    local_files_deleted: [...storageMap.entries, ...preservedSnapshots]
      .filter((entry) => typeof entry.local_deleted_at === 'string').length,
    entries: results.map((entry) =>
      entry.klass === 'PII-MOVE'
        ? {
            klass: entry.klass,
            size: entry.size,
            sha256_prefix: entry.sha256Prefix,
            target_status: entry.targetStatus,
            source_status: entry.sourceStatus
          }
        : {
            klass: entry.klass,
            repo_relpath: entry.relPath,
            size: entry.size,
            target_status: entry.targetStatus,
            source_status: entry.sourceStatus
          }
    )
  };
  const stamp = nowUtcStamp();
  const dir = ensureReportsDir();
  const jsonPath = path.join(dir, `${clientCode}__manifest-verify__${stamp}.json`);
  const mdPath = path.join(dir, `${clientCode}__manifest-verify__${stamp}.md`);
  writeAtomic(jsonPath, JSON.stringify(report, null, 2) + '\n');
  writeAtomic(
    mdPath,
    [
      `# migration snapshot verification: ${clientCode}`,
      '',
      `Generated: ${report.generated_at}`,
      `Overall status: ${report.status}`,
      `Mounted snapshot: ${report.snapshot_status}`,
      `Source currency: ${report.source_currency_status}`,
      `U4 closure ready: ${report.u4_closure_ready}`,
      `Post-retirement audit ready: ${report.post_retirement_audit_ready}`,
      `Retirement eligible: ${report.retirement_eligible}`,
      `Mounted targets matching manifest: ${report.target_match_count}/${report.entry_count}`,
      `Preserved snapshots matching manifest: ${report.preserved_snapshot_match_count}/${report.preserved_snapshot_count}`,
      `Current sources matching snapshot: ${report.source_match_count}/${report.entry_count}`,
      `Sources changed after snapshot: ${report.source_drift_count}`,
      `Sources missing: ${report.source_missing_count}`,
      `Sources intentionally retired: ${report.source_retired_count}`,
      `Local files deleted: ${report.local_files_deleted}`,
      '',
      'This verifies the mounted snapshot, not provider-side cloud truth.',
      ''
    ].join('\n')
  );
  emitStatus({
    ok: report.u4_closure_ready || report.post_retirement_audit_ready,
    client: clientCode,
    status: report.status,
    entry_count: report.entry_count,
    total_bytes: report.total_bytes,
    source_drift_count: report.source_drift_count,
    report_json: path.relative(REPO_ROOT, jsonPath),
    report_md: path.relative(REPO_ROOT, mdPath)
  });
  process.exit(
    report.u4_closure_ready || report.post_retirement_audit_ready
      ? EXIT_CODES.OK
      : report.snapshot_status === 'FAIL'
        ? EXIT_CODES.CHECKSUM_MISMATCH
        : EXIT_CODES.CLASSIFY_DRIFT
  );
}

if (require.main === module) {
  main().catch((error) => {
    emitStatus({ ok: false, code: 'USAGE_ERROR', exit_code: EXIT_CODES.USAGE_ERROR, reason: error.message });
    process.exit(EXIT_CODES.USAGE_ERROR);
  });
}

module.exports = { main };
