#!/usr/bin/env node
'use strict';

// CLI: migrate.js --client CODE --classify-report FILE [--batch-size 200]
//                  [--execute] [--preflight-report FILE]
//
// Default (no --execute): prints the copy plan and exits 0. Nothing is
// written anywhere. --preflight-report is NOT required for a dry run, but
// the dry-run output says so explicitly, since --execute will refuse to run
// without one.
//
// With --execute: REQUIRES --preflight-report pointing at a preflight
// machine-JSON for the same client, with status "PASS", generated less than
// 24h ago. This is the safety chain the review flagged as enforced only by
// operator discipline before -- it is now enforced in code: migrate.js will
// not run against a mount it hasn't itself verified was recently checked
// writable, conflict-free, quota-sufficient, and disk-safe.
//
// For each MOVE/PII-MOVE entry in the classify report, copies the source
// into <mounted_path>/<drive_relpath>.tmp-migrate, fsyncs, renames into
// place, reads the drive copy back, sha256-verifies it against the source,
// and appends a manifest entry to clients/CODE/storage-map.json. drive_relpath
// applies clients/CODE/rename-map.json (written by preflight.js when
// --renames-approved) when present -- this is what actually makes an
// approved OneDrive rename take effect on disk. Any checksum mismatch halts
// the ENTIRE run nonzero. A .conflict rescan runs before the first batch and
// at every batch boundary; any hit halts. Source files are NEVER deleted or
// modified by this tool.
//
// Resume-safe: an entry already present in storage-map.json with a matching
// sha256 is skipped.
//
// PII note: the classify report redacts PII-MOVE filenames (byte count +
// 8-char sha256 prefix only), per the classify.js contract, so committed
// report surfaces never carry PII filenames. The ignored, content-bound
// clients/CODE/pii-path-map.json resolves unique opaque IDs to paths at run
// time. PII storage-map identity also uses that opaque ID, so equal-content
// files remain independently executable and resumable.

const fs = require('fs');
const path = require('path');
const {
  parseArgs,
  emitStatus,
  fail,
  EXIT_CODES,
  PREFLIGHT_MAX_AGE_MS,
  resolveStorageRoot,
  assertUnderRoot,
  shallowConflictScan,
  sha256File,
  hashFile,
  quickXorHashFile,
  clientRootPath,
  validatePiiPathMapBinding,
  validatePiiPublicMembership,
  validateClassifyReportSemantics,
  recoverEntryPath,
  loadRenameMap,
  renameMapPath,
  normalizedMacPathIdentity,
  ensureReportsDir,
  writeAtomic,
  nowUtcStamp,
  newStorageMap,
  REPO_ROOT
} = require('./lib.js');

const DEFAULT_BATCH_SIZE = 200;

function sanitizeMigrationError(error, item = null) {
  const code = error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
  const identity = item && item.klass === 'PII-MOVE' ? 'opaque PII entry' : 'migration entry';
  return `filesystem operation failed for ${identity} (${code})`;
}

function acquireStorageMapLock(clientRoot) {
  const lockPath = path.join(clientRoot, '.storage-map.lock');
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch {
    return { ok: false, reason: 'storage-map mutation lock is already held' };
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try { fs.closeSync(fd); } catch { /* already closed */ }
    try { fs.unlinkSync(lockPath); } catch { /* stale lock remains fail-closed */ }
  };
  process.once('exit', release);
  return {
    ok: true,
    release: () => {
      process.removeListener('exit', release);
      release();
    }
  };
}

function printHelp() {
  process.stdout.write(`migrate.js -- checksum-verified copy-plus-manifest migration for one client

Usage:
  node migrate.js --client CODE --classify-report FILE [--batch-size 200]
                   [--execute] [--preflight-report FILE]

Without --execute: prints the copy plan only. Nothing is written anywhere.
(--preflight-report is not required for a dry run, but is for --execute.)

With --execute, --preflight-report FILE is REQUIRED: it must be a preflight
machine-JSON for this same client, status "PASS", generated less than 24h
ago. Then, per MOVE/PII-MOVE entry: sha256 source -> copy to
<mounted_path>/<drive_relpath>.tmp-migrate (drive_relpath honors
clients/CODE/rename-map.json when present) -> fsync -> mkdir -p final dir ->
rename into place -> read back + sha256 -> on match, append a
storage-map.json entry (including renamed_to when a rename applied); on
mismatch, halt the ENTIRE run nonzero. Re-scans for .conflict files before
the first batch and at every batch boundary; halts on any hit. Never deletes
or modifies source files. Resume-safe against a prior partial run.

Writes a verify report to
_dev/reports/analysis/client-storage/CODE__verify__<UTCts>.md (PII entries
reported as counts+bytes+sha256-prefix only, same as classify.js).

--preflight-report is bound to the EXACT --classify-report file by content
sha256 (not just by path/timestamp) -- if classify.js is re-run between
preflight and migrate, even within the 24h freshness window, migrate.js
detects the drift and refuses rather than migrating against stale pricing.

Exit codes of note:
  14  CHECKSUM_MISMATCH   read-back sha256 didn't match the source
  15  REPORT_MISSING      --classify-report or --preflight-report path missing
  16  PREFLIGHT_REQUIRED  --execute given without --preflight-report
  17  PREFLIGHT_STALE     preflight report is older than 24h
  18  PREFLIGHT_FAILED    preflight report is for a different client, or status != PASS
  20  CLASSIFY_MISMATCH   --classify-report's "client" field != --client
  21  CLASSIFY_DRIFT       --classify-report content != what preflight priced quota against
  22  TARGET_CONFLICT      target/tmp exists without a checksum-verified manifest resume
  23  TARGET_COLLISION     multiple plan entries resolve to the same drive target
  24  RENAME_MAP_DRIFT    rename-map presence/content differs from the PASS preflight
  25  PII_MAP_DRIFT       private PII path-map/binding/source identity drifted
`);
}

function batches(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Validates the --preflight-report gate for --execute. Also binds it to the
// EXACT --classify-report file this migrate.js invocation was given, by
// content hash (not path) -- so a classify.js re-run between preflight and
// migrate (which could change which files are MOVE/PII-MOVE without the
// path or the 24h freshness window changing) is caught as CLASSIFY_DRIFT
// rather than silently migrating against a preflight that priced quota
// against a different set of bytes.
async function validatePreflightReport(preflightReportPath, clientCode, classifyReportPath) {
  if (!fs.existsSync(preflightReportPath)) {
    return { ok: false, code: EXIT_CODES.REPORT_MISSING, reason: `--preflight-report path does not exist: ${preflightReportPath}` };
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(preflightReportPath, 'utf8'));
  } catch (err) {
    return { ok: false, code: EXIT_CODES.PREFLIGHT_FAILED, reason: `--preflight-report is not valid JSON: ${err.message}` };
  }
  if (report.client !== clientCode) {
    return { ok: false, code: EXIT_CODES.PREFLIGHT_FAILED, reason: `preflight report is for client "${report.client}", not "${clientCode}"` };
  }
  if (report.status !== 'PASS') {
    return { ok: false, code: EXIT_CODES.PREFLIGHT_FAILED, reason: `preflight report status is "${report.status}", not PASS` };
  }
  const generatedAtMs = Date.parse(report.generated_at);
  if (!Number.isFinite(generatedAtMs)) {
    return { ok: false, code: EXIT_CODES.PREFLIGHT_FAILED, reason: 'preflight report has no valid generated_at timestamp' };
  }
  const ageMs = Date.now() - generatedAtMs;
  if (ageMs > PREFLIGHT_MAX_AGE_MS) {
    return { ok: false, code: EXIT_CODES.PREFLIGHT_STALE, reason: `preflight report is ${(ageMs / 3600000).toFixed(1)}h old (max 24h)` };
  }
  if (!report.classify_report_sha256) {
    return { ok: false, code: EXIT_CODES.PREFLIGHT_FAILED, reason: 'preflight report has no classify_report_sha256 -- regenerate it with the current preflight.js' };
  }
  const actualClassifySha256 = await sha256File(classifyReportPath);
  if (actualClassifySha256 !== report.classify_report_sha256) {
    return {
      ok: false,
      code: EXIT_CODES.CLASSIFY_DRIFT,
      reason: `--classify-report content (sha256 ${actualClassifySha256.slice(0, 8)}…) does not match the one preflight priced quota against (sha256 ${report.classify_report_sha256.slice(0, 8)}…) -- re-run preflight.js against the current classify report`
    };
  }
  let classifyReport;
  try {
    classifyReport = JSON.parse(fs.readFileSync(classifyReportPath, 'utf8'));
  } catch (err) {
    return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: `--classify-report is not valid JSON: ${err.message}` };
  }
  if (
    !classifyReport.pii_path_map_binding ||
    !report.pii_path_map_binding ||
    JSON.stringify(classifyReport.pii_path_map_binding) !== JSON.stringify(report.pii_path_map_binding)
  ) {
    return {
      ok: false,
      code: EXIT_CODES.PII_MAP_DRIFT,
      reason: 'preflight PII path-map binding does not exactly match the bound classify report'
    };
  }
  const piiMapCheck = await validatePiiPathMapBinding(clientCode, report.pii_path_map_binding);
  if (!piiMapCheck.ok) return piiMapCheck;
  const piiMembership = validatePiiPublicMembership(classifyReport.entries, piiMapCheck.index);
  if (!piiMembership.ok) return piiMembership;
  const binding = report.rename_map_binding;
  if (
    !binding ||
    typeof binding.required !== 'boolean' ||
    binding.client !== clientCode ||
    (binding.required &&
      (binding.schema !== 'ClientStorageRenameMap/1.0' || !/^[a-f0-9]{64}$/.test(binding.sha256 || '')))
  ) {
    return {
      ok: false,
      code: EXIT_CODES.RENAME_MAP_DRIFT,
      reason: 'preflight report has no valid client-bound rename_map_binding -- regenerate preflight'
    };
  }
  const currentRenameMapPath = renameMapPath(clientCode);
  const renameMapExists = fs.existsSync(currentRenameMapPath);
  if (!binding.required && renameMapExists) {
    return {
      ok: false,
      code: EXIT_CODES.RENAME_MAP_DRIFT,
      reason: 'preflight bound a no-rename run, but rename-map.json is present'
    };
  }
  if (binding.required) {
    if (!renameMapExists) {
      return { ok: false, code: EXIT_CODES.RENAME_MAP_DRIFT, reason: 'preflight-required rename-map.json is missing' };
    }
    let renameMap;
    try {
      renameMap = JSON.parse(fs.readFileSync(currentRenameMapPath, 'utf8'));
    } catch (err) {
      return { ok: false, code: EXIT_CODES.RENAME_MAP_DRIFT, reason: `rename-map.json is not valid JSON: ${err.message}` };
    }
    if (renameMap.schema !== binding.schema || renameMap.client !== binding.client) {
      return {
        ok: false,
        code: EXIT_CODES.RENAME_MAP_DRIFT,
        reason: 'rename-map.json schema/client does not match the PASS preflight binding'
      };
    }
    const actualRenameMapSha256 = await sha256File(currentRenameMapPath);
    if (actualRenameMapSha256 !== binding.sha256) {
      return {
        ok: false,
        code: EXIT_CODES.RENAME_MAP_DRIFT,
        reason: 'rename-map.json content changed after preflight -- re-run preflight'
      };
    }
  }
  return { ok: true, report, piiMapCheck };
}

async function main() {
  const args = parseArgs(process.argv, {
    flags: ['execute'],
    valued: ['client', 'classify-report', 'batch-size', 'preflight-report']
  });
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (!args.client || !args['classify-report']) {
    process.stderr.write('Usage: node migrate.js --client CODE --classify-report FILE [...] (see --help)\n');
    process.exit(EXIT_CODES.USAGE_ERROR);
  }

  const clientCode = args.client;
  const batchSize = args['batch-size'] ? Number(args['batch-size']) : DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    fail(EXIT_CODES.USAGE_ERROR, { client: clientCode, reason: '--batch-size must be a positive integer' });
    return;
  }
  const reportPath = path.resolve(args['classify-report']);
  if (!fs.existsSync(reportPath)) {
    fail(EXIT_CODES.REPORT_MISSING, { client: clientCode, reason: `classify report not found: ${reportPath}` });
    return;
  }

  let preflightCheckReport = null;
  let validatedPiiMap = null;
  if (args.execute) {
    if (!args['preflight-report']) {
      fail(EXIT_CODES.PREFLIGHT_REQUIRED, {
        client: clientCode,
        reason: '--execute requires --preflight-report pointing at a PASS, <24h-old preflight.js machine-JSON for this client'
      });
      return;
    }
    const preflightCheck = await validatePreflightReport(path.resolve(args['preflight-report']), clientCode, reportPath);
    if (!preflightCheck.ok) {
      fail(preflightCheck.code, { client: clientCode, stage: 'preflight-gate', reason: preflightCheck.reason });
      return;
    }
    preflightCheckReport = preflightCheck.report;
    validatedPiiMap = preflightCheck.piiMapCheck;
  }

  const classifyReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (classifyReport.client !== clientCode) {
    fail(EXIT_CODES.CLASSIFY_MISMATCH, {
      client: clientCode,
      stage: 'classify-report',
      reason: `--classify-report is for client "${classifyReport.client}", not "${clientCode}"`
    });
    return;
  }
  const reviewResolution = validateClassifyReportSemantics(classifyReport);
  if (!reviewResolution.ok) {
    fail(EXIT_CODES.CLASSIFY_MISMATCH, {
      client: clientCode,
      stage: 'classification-review',
      reason: reviewResolution.reason
    });
    return;
  }
  if (!validatedPiiMap) {
    validatedPiiMap = await validatePiiPathMapBinding(clientCode, classifyReport.pii_path_map_binding);
    if (!validatedPiiMap.ok) {
      fail(validatedPiiMap.code, { client: clientCode, stage: 'pii-path-map-binding', reason: validatedPiiMap.reason });
      return;
    }
  }
  const piiMembership = validatePiiPublicMembership(classifyReport.entries, validatedPiiMap.index);
  if (!piiMembership.ok) {
    fail(piiMembership.code, { client: clientCode, stage: 'pii-public-membership', reason: piiMembership.reason });
    return;
  }
  const migratable = (classifyReport.entries || []).filter((e) => e.klass === 'MOVE' || e.klass === 'PII-MOVE');

  const resolved = resolveStorageRoot(clientCode);
  if (!resolved.ok) {
    fail(resolved.code, { client: clientCode, stage: 'resolve', reason: resolved.reason });
    return;
  }

  const clientRoot = clientRootPath(clientCode);
  const piiIndex = validatedPiiMap.index;
  const preflightRenameRequired = args.execute && preflightCheckReport.rename_map_binding.required;
  const renameMap = preflightRenameRequired || !args.execute ? loadRenameMap(clientCode) : null;
  if (
    renameMap &&
    (renameMap.schema !== 'ClientStorageRenameMap/1.0' || renameMap.client !== clientCode || !Array.isArray(renameMap.renames))
  ) {
    fail(EXIT_CODES.RENAME_MAP_DRIFT, {
      client: clientCode,
      stage: 'rename-map',
      reason: 'rename-map.json must have schema ClientStorageRenameMap/1.0, the requested client, and a renames array'
    });
    return;
  }
  const renameLookup = new Map((renameMap && renameMap.renames || []).map((r) => [r.repo_relpath, r.renamed_relpath]));

  const plan = [];
  const driveTargetOwners = new Map();
  for (const entry of migratable) {
    let located;
    try {
      located = recoverEntryPath(entry, clientRoot, piiIndex);
    } catch (err) {
      fail(EXIT_CODES.USAGE_ERROR, { client: clientCode, stage: 'locate-entry', reason: err.message });
      return;
    }
    const driveRelPath = renameLookup.get(located.relPath) || located.relPath;
    if (entry.klass === 'PII-MOVE' && driveRelPath !== located.relPath) {
      fail(EXIT_CODES.RENAME_MAP_DRIFT, {
        client: clientCode,
        stage: 'rename-map',
        reason: 'private filename redirects are not supported; rename the local source deliberately, then reclassify'
      });
      return;
    }
    const driveIdentity = normalizedMacPathIdentity(path.normalize(driveRelPath));
    if (driveTargetOwners.has(driveIdentity)) {
      const firstOwner = driveTargetOwners.get(driveIdentity);
      fail(EXIT_CODES.TARGET_COLLISION, {
        client: clientCode,
        stage: 'plan-target-collision',
        reason: 'multiple migration entries resolve to the same case-insensitive drive target',
        first_repo_relpath: firstOwner.klass === 'PII-MOVE' ? undefined : firstOwner.relPath,
        second_repo_relpath: entry.klass === 'PII-MOVE' ? undefined : located.relPath
      });
      return;
    }
    driveTargetOwners.set(driveIdentity, { relPath: located.relPath, klass: entry.klass });
    plan.push({
      klass: entry.klass,
      piiId: entry.klass === 'PII-MOVE' ? entry.pii_id : null,
      relPath: located.relPath,
      driveRelPath,
      renamed: driveRelPath !== located.relPath,
      absPath: located.absPath,
      expectedSha256: located.expectedSha256 || null,
      size: entry.size
    });
  }

  if (!args.execute) {
    const displayPlan = [];
    for (const p of plan) {
      if (p.klass === 'PII-MOVE') {
        displayPlan.push({ klass: p.klass, size: p.size, renamed: p.renamed });
      } else {
        displayPlan.push({ klass: p.klass, repo_relpath: p.relPath, drive_relpath: p.driveRelPath, size: p.size });
      }
    }
    emitStatus({ ok: true, client: clientCode, dry_run: true, plan_entries: plan.length, batch_size: batchSize });
    process.stdout.write(
      JSON.stringify(
        {
          dry_run: true,
          client: clientCode,
          batch_size: batchSize,
          note: '--execute will require --preflight-report (a PASS, <24h-old preflight.js machine-JSON for this client)',
          plan: displayPlan
        },
        null,
        2
      ) + '\n'
    );
    process.exit(EXIT_CODES.OK);
    return;
  }

  // --execute path.
  const storageLock = acquireStorageMapLock(clientRoot);
  if (!storageLock.ok) {
    fail(EXIT_CODES.TARGET_CONFLICT, {
      client: clientCode,
      stage: 'storage-map-lock',
      reason: storageLock.reason
    });
    return;
  }
  const initialConflicts = shallowConflictScan(resolved.mountedPath, Infinity);
  if (initialConflicts.length > 0) {
    fail(EXIT_CODES.CONFLICT_FILES_PRESENT, { client: clientCode, stage: 'pre-batch-conflict-scan', conflicts: initialConflicts.slice(0, 20) });
    return;
  }

  const storageMapPath = path.join(clientRoot, 'storage-map.json');
  let expectedStorageMapBytes = fs.existsSync(storageMapPath) ? fs.readFileSync(storageMapPath) : null;
  let storageMap = expectedStorageMapBytes
    ? JSON.parse(expectedStorageMapBytes.toString('utf8'))
    : newStorageMap(clientCode, resolved);
  if (
    storageMap.client !== clientCode ||
    !storageMap.drive ||
    storageMap.drive.mounted_path !== resolved.mountedPath ||
    storageMap.drive.provider !== resolved.provider ||
    !Array.isArray(storageMap.entries)
  ) {
    fail(EXIT_CODES.TARGET_CONFLICT, {
      client: clientCode,
      stage: 'resume-validation',
      reason: 'storage-map.json client/drive identity is invalid for the resolved migration lane'
    });
    return;
  }
  const manifestResumeKey = (entry) =>
    entry.pii_id ? `PII:${entry.pii_id}:${entry.sha256}` : `PATH:${entry.repo_relpath}:${entry.sha256}`;
  const planResumeKey = (item, sha256) =>
    item.klass === 'PII-MOVE' ? `PII:${item.piiId}:${sha256}` : `PATH:${item.relPath}:${sha256}`;
  const alreadyMigrated = new Map(storageMap.entries.map((e) => [manifestResumeKey(e), e]));

  // Whole-plan safety gate: hash sources and inspect every target/tmp before
  // the first cloud write. Resume is allowed only when both the manifest
  // identity and the existing target content match the current source.
  for (const item of plan) {
    try {
      item.sourceSha256 = await sha256File(item.absPath);
      item.sourceMd5 = await hashFile(item.absPath, 'md5');
      item.sourceQuickXorHash = await quickXorHashFile(item.absPath);
      if (item.klass === 'PII-MOVE' && item.sourceSha256 !== item.expectedSha256) {
        fail(EXIT_CODES.PII_MAP_DRIFT, {
          client: clientCode,
          stage: 'pii-source-binding',
          reason: 'PII source checksum changed after classification; regenerate classify and preflight evidence'
        });
        return;
      }
      item.targetPath = assertUnderRoot(path.join(resolved.mountedPath, item.driveRelPath), resolved.mountedPath);
      item.tmpPath = `${item.targetPath}.tmp-migrate`;
      const manifestEntry = alreadyMigrated.get(planResumeKey(item, item.sourceSha256));
      if (fs.existsSync(item.tmpPath)) {
        fail(EXIT_CODES.TARGET_CONFLICT, {
          client: clientCode,
          stage: 'pre-write-target-scan',
          reason: 'temporary migration target already exists; refusing to overwrite it'
        });
        return;
      }
      if (fs.existsSync(item.targetPath)) {
        const manifestTargetMatches =
          manifestEntry &&
          (item.klass === 'PII-MOVE'
            ? manifestEntry.pii_id === item.piiId
            : manifestEntry.drive_relpath === item.driveRelPath);
        if (!manifestTargetMatches) {
          fail(EXIT_CODES.TARGET_CONFLICT, {
            client: clientCode,
            stage: 'pre-write-target-scan',
            reason: 'drive target already exists without an exact manifest identity; refusing to overwrite it'
          });
          return;
        }
        const existingSha256 = await sha256File(item.targetPath);
        if (existingSha256 !== item.sourceSha256) {
          fail(EXIT_CODES.TARGET_CONFLICT, {
            client: clientCode,
            stage: 'resume-validation',
            reason: 'manifest resume target checksum does not match the source'
          });
          return;
        }
        item.verifiedResume = true;
      } else if (manifestEntry) {
        fail(EXIT_CODES.TARGET_CONFLICT, {
          client: clientCode,
          stage: 'resume-validation',
          reason: 'manifest claims migration complete but the bound drive target is missing'
        });
        return;
      }
    } catch (error) {
      fail(EXIT_CODES.USAGE_ERROR, {
        client: clientCode,
        stage: 'pre-write-target-scan',
        reason: sanitizeMigrationError(error, item)
      });
      return;
    }
  }

  const batchGroups = batches(plan, batchSize);
  const verifyResults = [];

  for (let b = 0; b < batchGroups.length; b++) {
    const group = batchGroups[b];

    const batchConflicts = shallowConflictScan(resolved.mountedPath, Infinity);
    if (batchConflicts.length > 0) {
      writeStorageMap();
      writeVerifyReport();
      fail(EXIT_CODES.CONFLICT_FILES_PRESENT, {
        client: clientCode,
        stage: `batch-${b}-conflict-scan`,
        conflicts: batchConflicts.slice(0, 20)
      });
      return;
    }

    for (const item of group) {
      const sourceSha256 = item.sourceSha256;
      const resumeKey = planResumeKey(item, sourceSha256);
      if (item.verifiedResume) {
        verifyResults.push({
          klass: item.klass,
          relPath: item.relPath,
          size: item.size,
          sha256: sourceSha256,
          md5: item.sourceMd5,
          quick_xor_hash: item.sourceQuickXorHash,
          status: 'ALREADY_MIGRATED'
        });
        continue;
      }

      let targetPath, tmpPath;
      try {
        targetPath = item.targetPath;
        tmpPath = item.tmpPath;
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(item.absPath, tmpPath, fs.constants.COPYFILE_EXCL);
        // copyFileSync preserves the source mode. Historical client records
        // may intentionally be read-only, and flushing the completed copy
        // does not require write access to its descriptor.
        const fd = fs.openSync(tmpPath, 'r');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        // Node's rename replaces an existing destination on macOS. A
        // same-volume hard link publishes the fully fsynced temp atomically
        // and fails with EEXIST rather than clobbering a concurrent/ordinary
        // target. Filesystems without hard-link support fail closed here.
        fs.linkSync(tmpPath, targetPath);
        fs.unlinkSync(tmpPath);

        const driveSha256 = await sha256File(targetPath);
        if (driveSha256 !== sourceSha256) {
          writeStorageMap();
          writeVerifyReport();
          fail(EXIT_CODES.CHECKSUM_MISMATCH, {
            client: clientCode,
            stage: 'read-back-verify',
            repo_relpath: item.klass === 'PII-MOVE' ? undefined : item.relPath,
            sha256_prefix: item.klass === 'PII-MOVE' ? sourceSha256.slice(0, 8) : undefined,
            expected: sourceSha256,
            actual: driveSha256
          });
          return;
        }

        const stat = fs.statSync(item.absPath);
        const targetStat = fs.statSync(targetPath);
        const manifestEntry = {
          repo_relpath: item.klass === 'PII-MOVE' ? undefined : item.relPath,
          pii_id: item.klass === 'PII-MOVE' ? item.piiId : undefined,
          drive_relpath: item.klass === 'PII-MOVE' ? undefined : item.driveRelPath,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          drive_mtime: targetStat.mtime.toISOString(),
          sha256: sourceSha256,
          md5: item.sourceMd5,
          quick_xor_hash: item.sourceQuickXorHash,
          batch: b,
          migrated_at: new Date().toISOString(),
          renamed_to: item.klass === 'PII-MOVE' ? undefined : item.renamed ? item.driveRelPath : null,
          local_deleted_at: null
        };
        storageMap.entries.push(manifestEntry);
        alreadyMigrated.set(resumeKey, manifestEntry);
        verifyResults.push({ klass: item.klass, relPath: item.relPath, size: item.size, sha256: sourceSha256, status: 'MIGRATED' });
        // Checkpoint every verified publication immediately. This keeps a
        // normal SIGINT/session disconnect from stranding a cloud target
        // outside the resume manifest for the remainder of a large batch.
        writeStorageMap();
      } catch (err) {
        if (tmpPath) {
          try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
          } catch {
            /* best-effort cleanup */
          }
        }
        writeStorageMap();
        writeVerifyReport();
        fail(EXIT_CODES.USAGE_ERROR, {
          client: clientCode,
          stage: 'copy-and-verify',
          reason: sanitizeMigrationError(err, item)
        });
        return;
      }
    }
  }

  writeStorageMap();
  writeVerifyReport();
  storageLock.release();
  emitStatus({ ok: true, client: clientCode, migrated: verifyResults.filter((r) => r.status === 'MIGRATED').length });
  process.exit(EXIT_CODES.OK);

  function writeStorageMap() {
    const currentBytes = fs.existsSync(storageMapPath) ? fs.readFileSync(storageMapPath) : null;
    const unchanged =
      expectedStorageMapBytes === null
        ? currentBytes === null
        : currentBytes !== null && currentBytes.equals(expectedStorageMapBytes);
    if (!unchanged) {
      throw Object.assign(new Error('storage-map changed concurrently'), { code: 'STORAGE_MAP_CONCURRENT_UPDATE' });
    }
    const nextBytes = Buffer.from(JSON.stringify(storageMap, null, 2) + '\n');
    writeAtomic(storageMapPath, nextBytes.toString('utf8'));
    expectedStorageMapBytes = nextBytes;
  }

  function writeVerifyReport() {
    const stamp = nowUtcStamp();
    const dir = ensureReportsDir();
    const migratedCount = verifyResults.filter((r) => r.status === 'MIGRATED').length;
    const alreadyCount = verifyResults.filter((r) => r.status === 'ALREADY_MIGRATED').length;
    const totalBytes = verifyResults.reduce((sum, r) => sum + r.size, 0);

    const jsonReport = {
      schema: 'ClientStorageVerify/1.0',
      client: clientCode,
      generated_at: new Date().toISOString(),
      migrated: migratedCount,
      already_migrated: alreadyCount,
      total_bytes: totalBytes,
      entries: verifyResults.map((r) =>
        r.klass === 'PII-MOVE'
          ? { klass: r.klass, size: r.size, sha256_prefix: (r.sha256 || '').slice(0, 8) || undefined, status: r.status }
          : { klass: r.klass, repo_relpath: r.relPath, size: r.size, status: r.status }
      )
    };

    const mdLines = [
      `# verify: ${clientCode}`,
      '',
      `Generated: ${jsonReport.generated_at}`,
      `Migrated: ${migratedCount}  Already migrated: ${alreadyCount}  Total bytes: ${totalBytes}`,
      '',
      '| class | path / hash | bytes | status |',
      '|---|---|---|---|'
    ];
    for (const e of jsonReport.entries) {
      const identity = e.klass === 'PII-MOVE' ? `sha256:${e.sha256_prefix}…` : e.repo_relpath;
      mdLines.push(`| ${e.klass} | ${identity} | ${e.size} | ${e.status} |`);
    }

    const stampedMd = path.join(dir, `${clientCode}__verify__${stamp}.md`);
    const stampedJson = path.join(dir, `${clientCode}__verify__${stamp}.json`);
    writeAtomic(stampedMd, mdLines.join('\n') + '\n');
    writeAtomic(stampedJson, JSON.stringify(jsonReport, null, 2) + '\n');
  }
}

if (require.main === module) {
  main().catch((err) => {
    emitStatus({
      ok: false,
      code: 'USAGE_ERROR',
      exit_code: EXIT_CODES.USAGE_ERROR,
      reason: sanitizeMigrationError(err)
    });
    process.exit(EXIT_CODES.USAGE_ERROR);
  });
}

module.exports = { main, validatePreflightReport, sanitizeMigrationError };
