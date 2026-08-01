#!/usr/bin/env node
'use strict';

// Converts already checksum-verified path-based storage-map entries to opaque
// PII identities after a classifier hardening pass. This tool never copies,
// overwrites, renames, or deletes source/cloud files. It will write only the
// local storage-map and a sanitized reconciliation report, and only with
// --execute after the complete source/target/manifest set passes validation.

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
  recoverEntryPath,
  ensureReportsDir,
  writeAtomic,
  nowUtcStamp,
  REPO_ROOT
} = require('./lib.js');

function stableSha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function printHelp() {
  process.stdout.write(`reconcile-pii.js -- harden existing manifest identities without recopying

Usage:
  node reconcile-pii.js --client CODE --classify-report FILE [--execute]

Default mode validates and reports the number of conversions without writing.
--execute atomically replaces only clients/CODE/storage-map.json after every
new PII identity is bound to an existing manifest entry and both source and
cloud target match the expected checksum. Renamed path entries are rejected;
they require an explicit private remote-locator design before reconciliation.
No source or cloud file is copied, overwritten, renamed, or deleted.
`);
}

async function buildReconciliation(clientCode, classifyReportPath) {
  if (!fs.existsSync(classifyReportPath)) {
    return { ok: false, code: EXIT_CODES.REPORT_MISSING, reason: 'classification report is missing' };
  }
  let classifyReport;
  try {
    classifyReport = JSON.parse(fs.readFileSync(classifyReportPath, 'utf8'));
  } catch {
    return { ok: false, code: EXIT_CODES.CLASSIFY_MISMATCH, reason: 'classification report is invalid JSON' };
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
  let originalMapBytes;
  let storageMap;
  try {
    originalMapBytes = fs.readFileSync(storageMapPath);
    storageMap = JSON.parse(originalMapBytes.toString('utf8'));
  } catch {
    return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'storage-map is missing or invalid JSON' };
  }
  if (
    !storageMap ||
    storageMap.client !== clientCode ||
    !storageMap.drive ||
    storageMap.drive.provider !== resolved.provider ||
    storageMap.drive.mounted_path !== resolved.mountedPath ||
    !Array.isArray(storageMap.entries)
  ) {
    return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'storage-map identity is invalid for the resolved client lane' };
  }

  const convertedEntries = [...storageMap.entries];
  const claimedManifestIndexes = new Set();
  let conversions = 0;
  let alreadyOpaque = 0;
  let verifiedBytes = 0;
  const publicPii = classifyReport.entries.filter((entry) => entry.klass === 'PII-MOVE');

  for (const publicEntry of publicPii) {
    let located;
    try {
      located = recoverEntryPath(publicEntry, clientRoot, piiMapCheck.index);
      assertUnderRoot(located.absPath, clientRoot);
    } catch {
      return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'a PII identity cannot be resolved safely' };
    }
    if (!fs.existsSync(located.absPath) || !fs.statSync(located.absPath).isFile()) {
      return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'a bound PII source is missing or not a regular file' };
    }
    const sourceSha256 = await sha256File(located.absPath);
    if (sourceSha256 !== located.expectedSha256 || fs.statSync(located.absPath).size !== publicEntry.size) {
      return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'a bound PII source changed after classification' };
    }

    const opaqueMatches = storageMap.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.pii_id === publicEntry.pii_id && entry.sha256 === sourceSha256);
    const pathMatches = storageMap.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) =>
        entry.repo_relpath === located.relPath &&
        entry.sha256 === sourceSha256
      );
    const matches = opaqueMatches.length > 0 ? opaqueMatches : pathMatches;
    if (matches.length !== 1) {
      return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'a PII identity does not have exactly one checksum-bound manifest entry' };
    }
    const { entry: current, index } = matches[0];
    if (claimedManifestIndexes.has(index)) {
      return { ok: false, code: EXIT_CODES.TARGET_COLLISION, reason: 'multiple PII identities claim the same manifest entry' };
    }
    claimedManifestIndexes.add(index);
    if (current.size !== publicEntry.size) {
      return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'a PII manifest entry size does not match its classified identity' };
    }

    if (current.pii_id) {
      if (['repo_relpath', 'drive_relpath', 'renamed_to'].some((key) => Object.prototype.hasOwnProperty.call(current, key))) {
        return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'an opaque PII manifest entry contains a path-bearing field' };
      }
    } else {
      if (
        current.drive_relpath !== located.relPath ||
        (current.renamed_to !== null && current.renamed_to !== undefined)
      ) {
        return { ok: false, code: EXIT_CODES.RENAME_MAP_DRIFT, reason: 'a renamed path entry cannot be made opaque without a private remote locator' };
      }
    }
    const targetPath = assertUnderRoot(path.join(resolved.mountedPath, located.relPath), resolved.mountedPath);
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'a checksum-bound cloud target is missing or not a regular file' };
    }
    if (fs.existsSync(`${targetPath}.tmp-migrate`)) {
      return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'temporary migration residue exists for a PII target' };
    }
    const targetSha256 = await sha256File(targetPath);
    if (targetSha256 !== sourceSha256 || fs.statSync(targetPath).size !== publicEntry.size) {
      return { ok: false, code: EXIT_CODES.CHECKSUM_MISMATCH, reason: 'a cloud target does not match its bound PII source' };
    }

    if (current.pii_id) {
      alreadyOpaque += 1;
    } else {
      const hardened = { ...current, pii_id: publicEntry.pii_id };
      delete hardened.repo_relpath;
      delete hardened.drive_relpath;
      delete hardened.renamed_to;
      convertedEntries[index] = hardened;
      conversions += 1;
    }
    verifiedBytes += publicEntry.size;
  }

  const identities = new Set();
  for (const entry of convertedEntries) {
    const identity = entry.pii_id ? `PII:${entry.pii_id}` : `PATH:${entry.repo_relpath}`;
    if (identities.has(identity)) {
      return { ok: false, code: EXIT_CODES.TARGET_COLLISION, reason: 'reconciled storage-map would contain duplicate identities' };
    }
    identities.add(identity);
  }

  const reconciledMap = { ...storageMap, entries: convertedEntries };
  return {
    ok: true,
    classifyReport,
    storageMapPath,
    originalMapBytes,
    originalMap: storageMap,
    reconciledMap,
    conversions,
    alreadyOpaque,
    verifiedPiiEntries: publicPii.length,
    verifiedBytes
  };
}

function writeReconciledMapCas(result) {
  const lockPath = path.join(path.dirname(result.storageMapPath), '.storage-map.lock');
  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, 'wx');
  } catch {
    return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'PII reconciliation lock is already held' };
  }
  try {
    const currentBytes = fs.readFileSync(result.storageMapPath);
    if (!currentBytes.equals(result.originalMapBytes)) {
      return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'storage-map changed after reconciliation validation' };
    }
    writeAtomic(result.storageMapPath, JSON.stringify(result.reconciledMap, null, 2) + '\n');
    return { ok: true, afterBytes: fs.readFileSync(result.storageMapPath) };
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lockPath);
  }
}

async function main() {
  const args = parseArgs(process.argv, {
    flags: ['execute'],
    valued: ['client', 'classify-report']
  });
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (!args.client || !args['classify-report']) {
    process.stderr.write('Usage: node reconcile-pii.js --client CODE --classify-report FILE [--execute]\n');
    process.exit(EXIT_CODES.USAGE_ERROR);
  }

  const clientCode = args.client;
  const classifyReportPath = path.resolve(args['classify-report']);
  const result = await buildReconciliation(clientCode, classifyReportPath);
  if (!result.ok) {
    fail(result.code || EXIT_CODES.USAGE_ERROR, {
      client: clientCode,
      stage: 'pii-reconciliation',
      reason: result.reason
    });
    return;
  }

  if (!args.execute) {
    emitStatus({
      ok: true,
      client: clientCode,
      dry_run: true,
      conversions: result.conversions,
      already_opaque: result.alreadyOpaque,
      verified_pii_entries: result.verifiedPiiEntries,
      verified_bytes: result.verifiedBytes
    });
    return;
  }

  const writeResult = writeReconciledMapCas(result);
  if (!writeResult.ok) {
    fail(writeResult.code, {
      client: clientCode,
      stage: 'pii-reconciliation-write',
      reason: writeResult.reason
    });
    return;
  }
  const beforeBytes = result.originalMapBytes;
  const afterBytes = writeResult.afterBytes;
  const report = {
    schema: 'ClientStoragePiiReconcile/1.0',
    client: clientCode,
    generated_at: new Date().toISOString(),
    status: 'PASS',
    conversions: result.conversions,
    already_opaque: result.alreadyOpaque,
    verified_pii_entries: result.verifiedPiiEntries,
    verified_bytes: result.verifiedBytes,
    classify_report_sha256: await sha256File(classifyReportPath),
    storage_map_before_sha256: stableSha256(beforeBytes),
    storage_map_after_sha256: stableSha256(afterBytes),
    cloud_files_copied: 0,
    cloud_files_overwritten: 0,
    local_files_deleted: 0
  };
  const stamp = nowUtcStamp();
  const reportDir = ensureReportsDir();
  const jsonPath = path.join(reportDir, `${clientCode}__pii-reconcile__${stamp}.json`);
  const mdPath = path.join(reportDir, `${clientCode}__pii-reconcile__${stamp}.md`);
  writeAtomic(jsonPath, JSON.stringify(report, null, 2) + '\n');
  writeAtomic(
    mdPath,
    [
      `# PII identity reconciliation: ${clientCode}`,
      '',
      `Generated: ${report.generated_at}`,
      `Status: ${report.status}`,
      `Converted path identities: ${report.conversions}`,
      `Already opaque: ${report.already_opaque}`,
      `Verified PII entries: ${report.verified_pii_entries}`,
      `Verified bytes: ${report.verified_bytes}`,
      '',
      'No cloud file was copied or overwritten. No local file was deleted.',
      ''
    ].join('\n')
  );
  emitStatus({
    ok: true,
    client: clientCode,
    conversions: result.conversions,
    already_opaque: result.alreadyOpaque,
    verified_pii_entries: result.verifiedPiiEntries,
    report_json: path.relative(REPO_ROOT, jsonPath),
    report_md: path.relative(REPO_ROOT, mdPath)
  });
}

if (require.main === module) {
  main().catch((error) => {
    emitStatus({ ok: false, code: 'USAGE_ERROR', exit_code: EXIT_CODES.USAGE_ERROR, reason: error.message });
    process.exit(EXIT_CODES.USAGE_ERROR);
  });
}

module.exports = { buildReconciliation, writeReconciledMapCas, main };
