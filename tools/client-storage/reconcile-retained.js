#!/usr/bin/env node
'use strict';

// Moves already-copied files that are now classified KEEP out of the active
// migration set and into verified historical snapshots. This changes only
// local control metadata. It never copies, renames, overwrites, or deletes a
// source or cloud file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
  piiPathMapPath,
  walkClientTree,
  matchesAnyGlob,
  ALWAYS_KEEP_RELPATHS,
  ALWAYS_KEEP_GLOBS,
  PRIVATE_CONTROL_RELPATHS,
  isPrivateControlRelPath,
  ensureReportsDir,
  writeAtomic,
  nowUtcStamp
} = require('./lib.js');

function stableSha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function printHelp() {
  process.stdout.write(`reconcile-retained.js -- preserve copied KEEP snapshots without retiring local work

Usage:
  node reconcile-retained.js --client CODE --classify-report FILE [--execute]

Default mode validates and reports only. --execute moves manifest entries
that are no longer MOVE/PII-MOVE into preserved_snapshots and retains any
private PII locator in pii-path-map.json retained_entries. Source and cloud
files are never copied, renamed, overwritten, or deleted.
`);
}

function validatePreservedSnapshot(entry) {
  if (
    !entry ||
    !Number.isFinite(entry.size) ||
    entry.size < 0 ||
    !/^[a-f0-9]{64}$/.test(entry.sha256 || '') ||
    (Boolean(entry.pii_id) === Boolean(entry.repo_relpath))
  ) {
    return false;
  }
  if (
    entry.pii_id &&
    ['repo_relpath', 'drive_relpath', 'renamed_to'].some((key) =>
      Object.prototype.hasOwnProperty.call(entry, key)
    )
  ) {
    return false;
  }
  return true;
}

async function findUniqueRetainedPiiLocator({
  missingEntry,
  classifyReport,
  clientRoot,
  mountedPath,
  claimedPaths
}) {
  const candidates = [];
  const visibleKeep = new Map(
    classifyReport.entries
      .filter((item) => item.klass === 'KEEP' && typeof item.relpath === 'string')
      .map((item) => [item.relpath, item])
  );
  // KEEP entries under a PII context are intentionally path-redacted in the
  // public report. Reconstruct only the narrow, policy-declared always-keep
  // set locally; do not turn hashes into a general filename search.
  for (const file of walkClientTree(clientRoot)) {
    if (
      !isPrivateControlRelPath(file.relPath) &&
      (ALWAYS_KEEP_RELPATHS.has(file.relPath) || matchesAnyGlob(file.relPath, ALWAYS_KEEP_GLOBS))
    ) {
      visibleKeep.set(file.relPath, {
        klass: 'KEEP',
        relpath: file.relPath,
        size: file.size
      });
    }
  }
  for (const item of visibleKeep.values()) {
    if (
      item.klass !== 'KEEP' ||
      typeof item.relpath !== 'string' ||
      item.size !== missingEntry.size ||
      claimedPaths.has(item.relpath)
    ) {
      continue;
    }
    let sourcePath;
    let targetPath;
    try {
      sourcePath = assertUnderRoot(path.join(clientRoot, item.relpath), clientRoot);
      targetPath = assertUnderRoot(path.join(mountedPath, item.relpath), mountedPath);
    } catch {
      continue;
    }
    if (
      !fs.existsSync(sourcePath) ||
      !fs.statSync(sourcePath).isFile() ||
      !fs.existsSync(targetPath) ||
      !fs.statSync(targetPath).isFile() ||
      fs.statSync(sourcePath).size !== missingEntry.size ||
      fs.statSync(targetPath).size !== missingEntry.size
    ) {
      continue;
    }
    if (
      await sha256File(sourcePath) === missingEntry.sha256 &&
      await sha256File(targetPath) === missingEntry.sha256
    ) {
      candidates.push({
        pii_id: missingEntry.pii_id,
        repo_relpath: item.relpath,
        size: missingEntry.size,
        sha256: missingEntry.sha256
      });
    }
  }
  if (candidates.length !== 1) {
    return {
      ok: false,
      code: EXIT_CODES.PII_MAP_DRIFT,
      reason: 'an opaque retained snapshot does not have exactly one checksum-bound local/cloud locator'
    };
  }
  return { ok: true, entry: candidates[0] };
}

async function buildRetainedReconciliation(clientCode, classifyReportPath) {
  let classifyReport;
  try {
    classifyReport = JSON.parse(fs.readFileSync(classifyReportPath, 'utf8'));
  } catch {
    return { ok: false, code: EXIT_CODES.REPORT_MISSING, reason: 'classification report is missing or invalid JSON' };
  }
  if (classifyReport.client !== clientCode || !Array.isArray(classifyReport.entries)) {
    return { ok: false, code: EXIT_CODES.CLASSIFY_MISMATCH, reason: 'classification report client or entries are invalid' };
  }
  const piiMapCheck = await validatePiiPathMapBinding(clientCode, classifyReport.pii_path_map_binding);
  if (!piiMapCheck.ok) return piiMapCheck;
  const membership = validatePiiPublicMembership(classifyReport.entries, piiMapCheck.index);
  if (!membership.ok) return membership;

  const resolved = resolveStorageRoot(clientCode);
  if (!resolved.ok) return resolved;
  const clientRoot = clientRootPath(clientCode);
  const storageMapPath = path.join(clientRoot, 'storage-map.json');
  const privateMapPath = piiPathMapPath(clientCode);
  let originalStorageBytes;
  let originalPrivateBytes;
  let storageMap;
  try {
    originalStorageBytes = fs.readFileSync(storageMapPath);
    originalPrivateBytes = fs.readFileSync(privateMapPath);
    storageMap = JSON.parse(originalStorageBytes.toString('utf8'));
  } catch {
    return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'storage controls are missing or invalid' };
  }
  if (
    storageMap.client !== clientCode ||
    !storageMap.drive ||
    storageMap.drive.provider !== resolved.provider ||
    storageMap.drive.mounted_path !== resolved.mountedPath ||
    !Array.isArray(storageMap.entries) ||
    (storageMap.preserved_snapshots !== undefined && !Array.isArray(storageMap.preserved_snapshots))
  ) {
    return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'storage-map identity is invalid for the resolved client lane' };
  }
  const priorPreserved = storageMap.preserved_snapshots || [];
  if (!priorPreserved.every(validatePreservedSnapshot)) {
    return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'preserved snapshot metadata is invalid' };
  }

  const activePathSet = new Set(
    classifyReport.entries
      .filter((entry) => entry.klass === 'MOVE')
      .map((entry) => entry.relpath)
  );
  const activePiiSet = new Set(
    classifyReport.entries
      .filter((entry) => entry.klass === 'PII-MOVE')
      .map((entry) => entry.pii_id)
  );
  const explicitKeepByPath = new Map(
    classifyReport.entries
      .filter((entry) => entry.klass === 'KEEP' && typeof entry.relpath === 'string')
      .map((entry) => [entry.relpath, entry])
  );
  const activeEntries = [];
  const newlyPreserved = [];
  for (const entry of storageMap.entries) {
    const active = entry.pii_id
      ? activePiiSet.has(entry.pii_id)
      : activePathSet.has(entry.repo_relpath);
    if (active) {
      activeEntries.push(entry);
      continue;
    }
    if (!entry.pii_id) {
      const keep = explicitKeepByPath.get(entry.repo_relpath);
      if (!keep || keep.size !== entry.size) {
        return {
          ok: false,
          code: EXIT_CODES.CLASSIFY_DRIFT,
          reason: 'a non-active manifest entry is not an exact current KEEP identity'
        };
      }
    }
    newlyPreserved.push(entry);
  }

  const retainedById = new Map(piiMapCheck.retainedIndex);
  const claimedPaths = new Set([
    ...[...piiMapCheck.index.values()].map((entry) => entry.repo_relpath),
    ...[...piiMapCheck.retainedIndex.values()].map((entry) => entry.repo_relpath),
    ...storageMap.entries.filter((entry) => entry.repo_relpath).map((entry) => entry.repo_relpath)
  ]);
  let recoveredPrivateLocators = 0;
  let verifiedBytes = 0;
  const preservedSnapshots = [...priorPreserved, ...newlyPreserved];
  const newlyPreservedSet = new Set(newlyPreserved);
  for (const entry of preservedSnapshots) {
    if (!validatePreservedSnapshot(entry)) {
      return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'a retained manifest entry has invalid identity metadata' };
    }
    let driveRelPath = entry.drive_relpath;
    if (entry.pii_id) {
      let locator = piiMapCheck.index.get(entry.pii_id) || retainedById.get(entry.pii_id);
      if (!locator) {
        const recovered = await findUniqueRetainedPiiLocator({
          missingEntry: entry,
          classifyReport,
          clientRoot,
          mountedPath: resolved.mountedPath,
          claimedPaths
        });
        if (!recovered.ok) return recovered;
        locator = recovered.entry;
        retainedById.set(locator.pii_id, locator);
        claimedPaths.add(locator.repo_relpath);
        recoveredPrivateLocators += 1;
      }
      const visibleKeep = explicitKeepByPath.get(locator.repo_relpath);
      const policyKeep =
        ALWAYS_KEEP_RELPATHS.has(locator.repo_relpath) ||
        matchesAnyGlob(locator.repo_relpath, ALWAYS_KEEP_GLOBS);
      const sourcePath = assertUnderRoot(path.join(clientRoot, locator.repo_relpath), clientRoot);
      if (
        ((!visibleKeep || visibleKeep.size !== entry.size) && !policyKeep) ||
        !fs.existsSync(sourcePath) ||
        !fs.statSync(sourcePath).isFile() ||
        (
          newlyPreservedSet.has(entry) &&
          (
            fs.statSync(sourcePath).size !== entry.size ||
            await sha256File(sourcePath) !== entry.sha256
          )
        )
      ) {
        return {
          ok: false,
          code: EXIT_CODES.CLASSIFY_DRIFT,
          reason: 'an opaque non-active manifest entry is not a checksum-bound current KEEP identity'
        };
      }
      driveRelPath = locator.repo_relpath;
      retainedById.set(entry.pii_id, locator);
    } else {
      const visibleKeep = explicitKeepByPath.get(entry.repo_relpath);
      if (!visibleKeep || (newlyPreservedSet.has(entry) && visibleKeep.size !== entry.size)) {
        return {
          ok: false,
          code: EXIT_CODES.CLASSIFY_DRIFT,
          reason: 'a preserved path snapshot is not an exact current KEEP identity'
        };
      }
    }
    let targetPath;
    try {
      targetPath = assertUnderRoot(path.join(resolved.mountedPath, driveRelPath), resolved.mountedPath);
    } catch {
      return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'a retained snapshot target cannot be resolved safely' };
    }
    if (
      !fs.existsSync(targetPath) ||
      !fs.statSync(targetPath).isFile() ||
      fs.statSync(targetPath).size !== entry.size ||
      await sha256File(targetPath) !== entry.sha256
    ) {
      return { ok: false, code: EXIT_CODES.CHECKSUM_MISMATCH, reason: 'a retained cloud snapshot does not match its manifest identity' };
    }
    verifiedBytes += entry.size;
  }

  const preservedIdentities = new Set();
  for (const entry of preservedSnapshots) {
    const identity = entry.pii_id ? `PII:${entry.pii_id}` : `PATH:${entry.repo_relpath}`;
    if (preservedIdentities.has(identity)) {
      return { ok: false, code: EXIT_CODES.TARGET_COLLISION, reason: 'preserved snapshots contain duplicate identities' };
    }
    preservedIdentities.add(identity);
  }
  const activePrivate = [...piiMapCheck.index.values()].filter((entry) => activePiiSet.has(entry.pii_id));
  const nextPrivateMap = {
    ...piiMapCheck.map,
    generated_at: new Date().toISOString(),
    entries: activePrivate,
    retained_entries: [...retainedById.values()]
      .filter((entry) => !activePiiSet.has(entry.pii_id))
      .sort((a, b) => a.pii_id.localeCompare(b.pii_id))
  };
  const nextStorageMap = {
    ...storageMap,
    entries: activeEntries,
    preserved_snapshots: preservedSnapshots
  };
  return {
    ok: true,
    storageMapPath,
    privateMapPath,
    originalStorageBytes,
    originalPrivateBytes,
    nextStorageMap,
    nextPrivateMap,
    activeEntries: activeEntries.length,
    newlyPreserved: newlyPreserved.length,
    preservedTotal: preservedSnapshots.length,
    recoveredPrivateLocators,
    verifiedBytes
  };
}

function writeRetainedReconciliationCas(result, writeFn = writeAtomic) {
  const lockPath = path.join(path.dirname(result.storageMapPath), '.storage-map.lock');
  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, 'wx');
  } catch {
    return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'storage-map mutation lock is already held' };
  }
  try {
    if (
      !fs.readFileSync(result.storageMapPath).equals(result.originalStorageBytes) ||
      !fs.readFileSync(result.privateMapPath).equals(result.originalPrivateBytes)
    ) {
      return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'storage controls changed after retained-snapshot validation' };
    }
    try {
      writeFn(result.privateMapPath, JSON.stringify(result.nextPrivateMap, null, 2) + '\n');
      writeFn(result.storageMapPath, JSON.stringify(result.nextStorageMap, null, 2) + '\n');
    } catch {
      // The lock excludes peer writers. Restore both exact pre-transaction
      // byte sequences so an interrupted second publication does not leave
      // operators with mismatched controls.
      try {
        writeAtomic(result.privateMapPath, result.originalPrivateBytes.toString('utf8'));
        writeAtomic(result.storageMapPath, result.originalStorageBytes.toString('utf8'));
      } catch {
        return {
          ok: false,
          code: EXIT_CODES.TARGET_CONFLICT,
          reason: 'control publication failed and automatic rollback could not be completed'
        };
      }
      return {
        ok: false,
        code: EXIT_CODES.TARGET_CONFLICT,
        reason: 'control publication failed; both controls were restored'
      };
    }
    return {
      ok: true,
      storageAfterBytes: fs.readFileSync(result.storageMapPath),
      privateAfterBytes: fs.readFileSync(result.privateMapPath)
    };
  } finally {
    try { fs.closeSync(lockFd); } catch { /* already closed */ }
    try { fs.unlinkSync(lockPath); } catch { /* stale lock remains fail-closed */ }
  }
}

async function main() {
  const args = parseArgs(process.argv, {
    flags: ['execute'],
    valued: ['client', 'classify-report']
  });
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.client || !args['classify-report']) {
    process.stderr.write('Usage: node reconcile-retained.js --client CODE --classify-report FILE [--execute]\n');
    process.exit(EXIT_CODES.USAGE_ERROR);
  }
  const clientCode = args.client;
  const classifyPath = path.resolve(args['classify-report']);
  const result = await buildRetainedReconciliation(clientCode, classifyPath);
  if (!result.ok) {
    fail(result.code, { client: clientCode, stage: 'retained-snapshot-reconciliation', reason: result.reason });
    return;
  }
  if (!args.execute) {
    emitStatus({
      ok: true,
      client: clientCode,
      dry_run: true,
      active_entries: result.activeEntries,
      newly_preserved_snapshots: result.newlyPreserved,
      recovered_private_locators: result.recoveredPrivateLocators,
      verified_bytes: result.verifiedBytes
    });
    return;
  }
  const written = writeRetainedReconciliationCas(result);
  if (!written.ok) {
    fail(written.code, { client: clientCode, stage: 'retained-snapshot-write', reason: written.reason });
    return;
  }
  const report = {
    schema: 'ClientStorageRetainedReconcile/1.0',
    client: clientCode,
    generated_at: new Date().toISOString(),
    status: 'PASS',
    active_entries: result.activeEntries,
    newly_preserved_snapshots: result.newlyPreserved,
    preserved_snapshots_total: result.preservedTotal,
    recovered_private_locators: result.recoveredPrivateLocators,
    verified_bytes: result.verifiedBytes,
    classify_report_sha256: await sha256File(classifyPath),
    storage_map_before_sha256: stableSha256(result.originalStorageBytes),
    storage_map_after_sha256: stableSha256(written.storageAfterBytes),
    private_map_before_sha256: stableSha256(result.originalPrivateBytes),
    private_map_after_sha256: stableSha256(written.privateAfterBytes),
    cloud_files_copied: 0,
    cloud_files_renamed: 0,
    cloud_files_deleted: 0,
    local_files_deleted: 0
  };
  const stamp = nowUtcStamp();
  const reportDir = ensureReportsDir();
  const jsonPath = path.join(reportDir, `${clientCode}__retained-reconcile__${stamp}.json`);
  const mdPath = path.join(reportDir, `${clientCode}__retained-reconcile__${stamp}.md`);
  writeAtomic(jsonPath, JSON.stringify(report, null, 2) + '\n');
  writeAtomic(mdPath, [
    `# retained snapshot reconciliation: ${clientCode}`,
    '',
    `Generated: ${report.generated_at}`,
    `Status: ${report.status}`,
    `Active migration entries: ${report.active_entries}`,
    `Newly preserved snapshots: ${report.newly_preserved_snapshots}`,
    `Recovered private locators: ${report.recovered_private_locators}`,
    `Verified retained bytes: ${report.verified_bytes}`,
    'Cloud files copied/renamed/deleted: 0/0/0',
    'Local files deleted: 0',
    ''
  ].join('\n'));
  emitStatus({
    ok: true,
    client: clientCode,
    report: path.relative(process.cwd(), jsonPath),
    newly_preserved_snapshots: result.newlyPreserved,
    local_files_deleted: 0,
    cloud_files_deleted: 0
  });
}

if (require.main === module) {
  main().catch((error) => {
    fail(EXIT_CODES.USAGE_ERROR, {
      stage: 'retained-snapshot-reconciliation',
      reason: `unexpected retained-snapshot failure (${error && error.code || 'UNKNOWN'})`
    });
  });
}

module.exports = {
  validatePreservedSnapshot,
  findUniqueRetainedPiiLocator,
  buildRetainedReconciliation,
  writeRetainedReconciliationCas,
  main
};
