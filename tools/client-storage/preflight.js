#!/usr/bin/env node
'use strict';

// CLI: preflight.js --client CODE --classify-report FILE [--batch-bytes N]
//                    [--renames-approved] [--attest-headroom-bytes M]
//
// Pre-migration safety gate for one client's cloud-storage lane. Runs
// resolve.js's checks plus: a writable atomic probe, a deep .conflict
// re-scan, a local free-disk floor, an ALWAYS-ON quota check (batch size is
// derived from the classify report's MOVE+PII-MOVE byte total, not left to
// operator discretion), and a OneDrive filename-compatibility lint scoped to
// exactly the files the classify report says will move. Writes a report to
// _dev/reports/analysis/client-storage/CODE__preflight__<UTCts>.{md,json} --
// the JSON is the machine gate migrate.js's --preflight-report reads.
//
// A classify report is now a hard requirement: the quota check must always
// run against a real batch-bytes figure, so a client cannot reach migrate.js
// without ever having been classified. Never writes into the client's cloud
// mount except the transient atomic probe file, which it always cleans up.

const fs = require('fs');
const path = require('path');
const {
  parseArgs,
  resolveStorageRoot,
  emitStatus,
  fail,
  EXIT_CODES,
  atomicWritableProbe,
  shallowConflictScan,
  getLocalFreeDiskGB,
  DEFAULT_MIN_FREE_DISK_GB,
  clientRootPath,
  readClientJson,
  lintOneDriveTargetPath,
  ensureReportsDir,
  writeAtomic,
  writeRenameMap,
  loadRenameMap,
  validatePiiPathMapBinding,
  validatePiiPublicMembership,
  recoverEntryPath,
  findClassifyReports,
  validateClassifyReportSemantics,
  hasGraphCredentialsConfigured,
  sha256File,
  nowUtcStamp,
  REPO_ROOT
} = require('./lib.js');
const { createProductionAdapters, probeClientStorageCapabilities } = require('./capability-probe.js');

function formatBytes(bytes) {
  if (bytes === Infinity) return 'unlimited';
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  const units = ['bytes', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}

function printHelp() {
  process.stdout.write(`preflight.js -- pre-migration safety gate for one client's cloud-storage lane

Usage:
  node preflight.js --client CODE --classify-report FILE [--batch-bytes N]
                     [--renames-approved] [--attest-headroom-bytes M]

--classify-report is required. Its MOVE+PII-MOVE byte total becomes the
batch-bytes figure the quota check enforces; --batch-bytes may increase that
figure but can never reduce it. All quota inputs must be finite,
nonnegative numbers. The quota check itself is never optional.

Checks (in order): resolve.js passes; mount is writable (atomic probe);
deep .conflict re-scan (hard stop); local free disk >= ${DEFAULT_MIN_FREE_DISK_GB} GB;
quota check (gdrive: Drive API storageQuota, except an exactly enrolled
mounted-volume fallback, which requires a structured --attest-headroom-bytes value;
onedrive: Microsoft Graph if configured -- it is not, in this repo, today --
else the same structured attestation); OneDrive filename lint scoped to the
classify report's MOVE/PII-MOVE entries, with rename-proposal output gated
by --renames-approved (approved renames are written to
clients/CODE/rename-map.json, not into this report).

Exit codes beyond resolve.js's (2/3/4/5/6/8/1):
  7   NOT_WRITABLE          atomic write/read-back/delete probe failed
  9   LOW_DISK              local free disk below the ${DEFAULT_MIN_FREE_DISK_GB} GB floor
  10  QUOTA_UNKNOWN         quota API call failed -- never silently passed
  11  QUOTA_INSUFFICIENT    provider free space < 2x batch-bytes
  12  ATTESTATION_REQUIRED  mounted copy-only lane needs --attest-headroom-bytes
  13  RENAMES_REQUIRED      OneDrive-incompatible filenames need approval
  15  REPORT_MISSING        --classify-report path does not exist
  19  CLASSIFY_REQUIRED     no --classify-report given (see message for why)
  20  CLASSIFY_MISMATCH     --classify-report's "client" field != --client

Rename proposals sanitize every path segment (directories included), not
just the basename -- a deterministic function of each segment string, so
files sharing an offending directory get the same renamed directory name.
`);
}

// Deterministic, per-segment sanitizer -- a pure function of the segment
// string itself, so two files sharing a directory always get the SAME
// sanitized directory segment (no per-file uniquification, no counters).
// Idempotent on already-clean segments, so it is safe to apply to every
// segment of a path unconditionally.
function sanitizeOneDriveSegment(segment) {
  let sanitized = segment.replace(/["*:<>?\\|]/g, '_').trim();
  sanitized = sanitized.replace(/\.+$/, '');
  const base = sanitized.split('.')[0].toUpperCase();
  const RESERVED = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
  ]);
  if (RESERVED.has(base)) sanitized = `_${sanitized}`;
  return sanitized || '_renamed';
}

// Full relpath -> full renamed relpath, sanitizing EVERY segment (directory
// segments included), not just the basename. Because sanitizeOneDriveSegment
// is a pure function of its input, the same offending directory name always
// renames the same way across every file under it.
function proposeOneDriveRenamedRelPath(relPath) {
  return relPath
    .split(path.sep)
    .map((segment) => sanitizeOneDriveSegment(segment))
    .join(path.sep);
}

async function getGoogleDriveFreeBytes(credentialProfile) {
  // Read the existing tools/google-drive module's exports rather than
  // duplicating its OAuth/refresh logic. If this call fails for any reason
  // (missing creds, network, API error), the caller treats it as
  // QUOTA_UNKNOWN and halts -- it never silently proceeds as if quota were
  // fine.
  const { resolveCreds } = require('../google-drive/config.js');
  const { getAccessToken, apiRequest } = require('../google-drive/client.js');
  const creds = resolveCreds(credentialProfile);
  const accessToken = await getAccessToken(creds);
  const res = await apiRequest({ accessToken, method: 'GET', path: '/drive/v3/about?fields=storageQuota' });
  const quota = res && res.storageQuota;
  if (!quota || quota.limit === undefined || quota.limit === null) {
    // No numeric limit reported (e.g. unlimited-storage account) -- treat as
    // no ceiling rather than as a failure.
    return Infinity;
  }
  const limit = Number(quota.limit);
  const usage = Number(quota.usage || 0);
  if (!Number.isFinite(limit) || !Number.isFinite(usage)) {
    throw new Error(`unexpected storageQuota shape: ${JSON.stringify(quota)}`);
  }
  return limit - usage;
}

async function main(dependencies = {}) {
  const args = parseArgs(process.argv, {
    flags: ['renames-approved'],
    valued: ['client', 'classify-report', 'batch-bytes', 'attest-headroom-bytes']
  });
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (!args.client) {
    process.stderr.write('Usage: node preflight.js --client CODE --classify-report FILE [...] (see --help)\n');
    process.exit(EXIT_CODES.USAGE_ERROR);
  }

  const clientCode = args.client;
  const reportLines = [`# preflight: ${clientCode}`, '', `Generated: ${new Date().toISOString()}`, ''];
  const jsonReport = {
    schema: 'ClientStoragePreflight/1.0',
    client: clientCode,
    generated_at: new Date().toISOString(),
    status: 'FAIL',
    checks: []
  };

  function writeReports() {
    const stamp = nowUtcStamp();
    const dir = ensureReportsDir();
    const mdPath = path.join(dir, `${clientCode}__preflight__${stamp}.md`);
    const jsonPath = path.join(dir, `${clientCode}__preflight__${stamp}.json`);
    writeAtomic(mdPath, reportLines.join('\n') + '\n');
    writeAtomic(jsonPath, JSON.stringify(jsonReport, null, 2) + '\n');
    return { mdPath, jsonPath };
  }

  function haltFail(code, extra) {
    const privatePathRiskStages = new Set(['resolve', 'writable', 'conflict-scan']);
    const safeExtra = { ...extra };
    if (privatePathRiskStages.has(safeExtra.stage)) {
      safeExtra.reason = `${safeExtra.stage} check failed without exposing private path details`;
      delete safeExtra.conflicts;
      delete safeExtra.path;
      delete safeExtra.mounted_path;
    }
    jsonReport.status = 'FAIL';
    jsonReport.halt_stage = safeExtra && safeExtra.stage;
    jsonReport.halt_reason = safeExtra && safeExtra.reason;
    writeReports();
    fail(code, { client: clientCode, ...safeExtra });
  }

  function haltBeforePreflightReport(code, extra) {
    fail(code, { client: clientCode, ...extra });
  }

  // --- classify report: now a hard requirement -------------------------
  const existingReports = findClassifyReports(clientCode);
  let classifyReportPath;
  if (args['classify-report']) {
    classifyReportPath = path.resolve(args['classify-report']);
    if (!fs.existsSync(classifyReportPath)) {
      haltFail(EXIT_CODES.REPORT_MISSING, { stage: 'classify-report', reason: `--classify-report path does not exist: ${classifyReportPath}` });
      return;
    }
  } else if (existingReports.length > 0) {
    haltFail(EXIT_CODES.CLASSIFY_REQUIRED, {
      stage: 'classify-report',
      reason: `classify report(s) already exist for ${clientCode} -- pass --classify-report pointing at one`,
      candidates: existingReports.map((p) => path.relative(REPO_ROOT, p))
    });
    return;
  } else {
    haltFail(EXIT_CODES.CLASSIFY_REQUIRED, {
      stage: 'classify-report',
      reason: `no classify report found for ${clientCode} -- run classify.js --client ${clientCode} first`
    });
    return;
  }

  const classifyReport = JSON.parse(fs.readFileSync(classifyReportPath, 'utf8'));
  if (classifyReport.client !== clientCode) {
    haltFail(EXIT_CODES.CLASSIFY_MISMATCH, {
      stage: 'classify-report',
      reason: `classify report is for client "${classifyReport.client}", not "${clientCode}"`
    });
    return;
  }
  // Validate the complete versioned semantic contract before resolving or
  // touching the mount. REVIEW, malformed/missing semantic fields, and count
  // drift all halt here.
  const semanticCheck = validateClassifyReportSemantics(classifyReport);
  if (!semanticCheck.ok) {
    haltBeforePreflightReport(EXIT_CODES.CLASSIFY_MISMATCH, {
      stage: 'classification-review',
      reason: semanticCheck.reason
    });
    return;
  }
  jsonReport.classification_contract = semanticCheck.contract;
  const piiMapCheck = await validatePiiPathMapBinding(clientCode, classifyReport.pii_path_map_binding);
  if (!piiMapCheck.ok) {
    haltFail(piiMapCheck.code, { stage: 'pii-path-map-binding', reason: piiMapCheck.reason });
    return;
  }
  const piiMembership = validatePiiPublicMembership(classifyReport.entries, piiMapCheck.index);
  if (!piiMembership.ok) {
    haltFail(piiMembership.code, { stage: 'pii-public-membership', reason: piiMembership.reason });
    return;
  }
  jsonReport.pii_path_map_binding = { ...classifyReport.pii_path_map_binding };
  const migratable = (classifyReport.entries || []).filter((e) => e.klass === 'MOVE' || e.klass === 'PII-MOVE');
  const moveBytes = classifyReport.bytes && classifyReport.bytes.MOVE !== undefined ? Number(classifyReport.bytes.MOVE) : 0;
  const piiMoveBytes =
    classifyReport.bytes && classifyReport.bytes['PII-MOVE'] !== undefined ? Number(classifyReport.bytes['PII-MOVE']) : 0;
  if (!Number.isFinite(moveBytes) || moveBytes < 0 || !Number.isFinite(piiMoveBytes) || piiMoveBytes < 0) {
    haltFail(EXIT_CODES.USAGE_ERROR, {
      stage: 'classify-report',
      reason: 'classify report MOVE and PII-MOVE byte totals must be finite, nonnegative numbers'
    });
    return;
  }
  const computedBatchBytes = moveBytes + piiMoveBytes;
  if (!Number.isFinite(computedBatchBytes)) {
    haltFail(EXIT_CODES.USAGE_ERROR, {
      stage: 'classify-report',
      reason: 'classify report MOVE+PII-MOVE byte total must be finite'
    });
    return;
  }
  let entryBatchBytes = 0;
  for (const entry of migratable) {
    const entrySize = Number(entry.size);
    if (!Number.isFinite(entrySize) || entrySize < 0) {
      haltFail(EXIT_CODES.USAGE_ERROR, {
        stage: 'classify-report',
        reason: 'every MOVE and PII-MOVE entry size must be a finite, nonnegative number'
      });
      return;
    }
    entryBatchBytes += entrySize;
  }
  if (!Number.isFinite(entryBatchBytes) || entryBatchBytes !== computedBatchBytes) {
    haltFail(EXIT_CODES.USAGE_ERROR, {
      stage: 'classify-report',
      reason: `classify report byte totals (${computedBatchBytes}) do not equal its MOVE+PII-MOVE entry sizes (${entryBatchBytes})`
    });
    return;
  }
  // Content-hash the classify report bytes (not just its path) so migrate.js
  // can later detect a classify re-run between preflight and migrate, even
  // within the 24h freshness window -- a re-classify could change which
  // files are MOVE/PII-MOVE without the path or timestamp changing.
  const classifyReportSha256 = await sha256File(classifyReportPath);
  jsonReport.classify_report = path.relative(REPO_ROOT, classifyReportPath);
  jsonReport.classify_report_sha256 = classifyReportSha256;
  jsonReport.computed_batch_bytes = computedBatchBytes;
  reportLines.push(`- classify report: ${jsonReport.classify_report} (sha256 ${classifyReportSha256.slice(0, 8)}…, computed batch bytes: ${computedBatchBytes})`);

  // --- resolve / writable / conflict / disk ----------------------------
  const resolved = resolveStorageRoot(clientCode);
  if (!resolved.ok) {
    haltFail(resolved.code, {
      stage: 'resolve',
      reason: resolved.reason,
      conflict_count: Array.isArray(resolved.conflicts) ? resolved.conflicts.length : 0
    });
    return;
  }
  jsonReport.checks.push({ check: 'resolve', ok: true, registered_mount: true, provider: resolved.provider });
  reportLines.push(`- resolve: PASS (registered mount, provider=${resolved.provider})`);

  // Readiness/account binding is distinct from quota and from provider-side
  // T0 remote truth. The CLI uses the established named-profile resolver and
  // provider identity APIs; tests inject synthetic adapters. No credential,
  // account, or root identifier is included in the resulting report.
  const client = readClientJson(clientCode);
  const runtimeAdapters = dependencies.credentialSourceProbe || dependencies.providerIdentityProbe
    ? dependencies
    : createProductionAdapters();
  const capability = await probeClientStorageCapabilities({
    clientCode,
    client,
    resolved,
    credentialSourceProbe: runtimeAdapters.credentialSourceProbe,
    providerIdentityProbe: runtimeAdapters.providerIdentityProbe
  });
  jsonReport.capability_probe = capability;
  jsonReport.checks.push({ check: 'capability-readiness', ok: capability.ok });
  reportLines.push(`- capability readiness (${capability.readiness_mode || 'unknown'}): ${capability.ok ? 'PASS' : 'FAIL'}`);
  reportLines.push('- mounted evidence is not provider T0 remote truth and grants no retirement or deletion authority');
  if (!capability.ok) {
    let remediation;
    if (capability.registration_upgrade_required) {
      remediation = capability.readiness_mode === 'mounted-volume-copy-only'
        ? 'The mounted-volume registration is incomplete. Register the exact mount_dir alongside mounted_path before any copy. This enables copy-only readiness and never provider-remote truth, retirement, or deletion.'
        : 'The legacy storage registration remains valid for resolution, but identity enrollment is incomplete. Add the named profile, expected-account hash, and canonical remote-root ID before any write; this is a registration upgrade, not proof that credentials are missing.';
    } else if (capability.setup_required) {
      remediation = 'The full named-profile resolver chain reported the configured profile unavailable. Configure or authorize that profile, then retry; do not paste credentials into chat or reports.';
    } else {
      remediation = `Readiness halted with ${capability.blocker_code || 'READINESS_BINDING_FAILED'}. Correct the account/root binding or provider probe before retrying; do not reconfigure credentials merely because an identity or network gate failed.`;
    }
    haltFail(EXIT_CODES.PREFLIGHT_FAILED, {
      stage: 'capability-readiness',
      reason: capability.blocker_code || 'READINESS_BINDING_FAILED',
      setup_required: capability.setup_required,
      remediation
    });
    return;
  }

  const writable = atomicWritableProbe(resolved.mountedPath);
  const writableReason = writable.ok
    ? null
    : 'writable check failed without exposing private path details';
  jsonReport.checks.push({ check: 'writable', ok: writable.ok, reason: writableReason });
  reportLines.push(`- writable (atomic probe): ${writable.ok ? 'PASS' : `FAIL (${writableReason})`}`);
  if (!writable.ok) {
    haltFail(EXIT_CODES.NOT_WRITABLE, { stage: 'writable', reason: writable.reason });
    return;
  }

  const conflicts = shallowConflictScan(resolved.mountedPath, Infinity);
  jsonReport.checks.push({ check: 'conflict-scan', ok: conflicts.length === 0, count: conflicts.length });
  reportLines.push(`- conflict scan: ${conflicts.length === 0 ? 'PASS' : `FAIL (${conflicts.length} found)`}`);
  if (conflicts.length > 0) {
    haltFail(EXIT_CODES.CONFLICT_FILES_PRESENT, { stage: 'conflict-scan', conflict_count: conflicts.length });
    return;
  }

  const freeGB = (dependencies.getLocalFreeDiskGB || getLocalFreeDiskGB)(REPO_ROOT);
  const diskOk = freeGB >= 0 && freeGB >= DEFAULT_MIN_FREE_DISK_GB;
  jsonReport.checks.push({ check: 'local-free-disk', ok: diskOk, free_gb: freeGB, floor_gb: DEFAULT_MIN_FREE_DISK_GB });
  reportLines.push(`- local free disk: ${diskOk ? 'PASS' : 'FAIL'} (${freeGB.toFixed(2)} GB, floor ${DEFAULT_MIN_FREE_DISK_GB} GB)`);
  if (!diskOk) {
    haltFail(EXIT_CODES.LOW_DISK, { stage: 'local-free-disk', free_gb: freeGB });
    return;
  }

  // --- quota: always runs now, batch-bytes overridable but not skippable ---
  const hasBatchOverride = Object.prototype.hasOwnProperty.call(args, 'batch-bytes');
  const batchBytes = hasBatchOverride ? Number(args['batch-bytes']) : computedBatchBytes;
  if (!Number.isFinite(batchBytes) || batchBytes < 0) {
    haltFail(EXIT_CODES.USAGE_ERROR, {
      stage: 'quota',
      reason: '--batch-bytes must be a finite, nonnegative number'
    });
    return;
  }
  if (batchBytes < computedBatchBytes) {
    haltFail(EXIT_CODES.USAGE_ERROR, {
      stage: 'quota',
      reason: `--batch-bytes (${batchBytes}) cannot be less than the classified MOVE+PII-MOVE total (${computedBatchBytes})`
    });
    return;
  }
  const requiredFree = 2 * batchBytes;

  if (resolved.provider === 'gdrive' && capability.readiness_mode === 'api-bound') {
    let freeBytes;
    try {
      const credentialProfile = client && client.file_storage && client.file_storage.credential_profile;
      if (!credentialProfile) throw new Error('registered Google credential_profile is required');
      freeBytes = await getGoogleDriveFreeBytes(credentialProfile);
    } catch (err) {
      jsonReport.checks.push({ check: 'quota', ok: false, code: 'QUOTA_UNKNOWN', reason: err.message });
      haltFail(EXIT_CODES.QUOTA_UNKNOWN, {
        stage: 'quota',
        reason: err.message,
        remediation:
          'Could not read Drive API storageQuota via tools/google-drive. Run `node authorize.js` in tools/google-drive/ to (re)mint OAuth credentials, verify network access, then retry. Quota is never silently assumed sufficient.'
      });
      return;
    }
    const quotaOk = freeBytes >= requiredFree;
    jsonReport.checks.push({
      check: 'quota',
      ok: quotaOk,
      provider: 'gdrive',
      free_bytes: freeBytes,
      free_human: formatBytes(freeBytes),
      required_free_bytes: requiredFree,
      required_free_human: formatBytes(requiredFree)
    });
    reportLines.push(`- quota (gdrive): ${quotaOk ? 'PASS' : 'FAIL'} (free=${formatBytes(freeBytes)}; required>=${formatBytes(requiredFree)})`);
    if (!quotaOk) {
      haltFail(EXIT_CODES.QUOTA_INSUFFICIENT, { stage: 'quota', free_bytes: freeBytes, required_free_bytes: requiredFree });
      return;
    }
  } else if (resolved.provider === 'gdrive' && capability.readiness_mode === 'mounted-volume-copy-only') {
    if (!Object.prototype.hasOwnProperty.call(args, 'attest-headroom-bytes')) {
      haltFail(EXIT_CODES.ATTESTATION_REQUIRED, {
        stage: 'quota',
        reason: 'The mounted personal Google Drive does not expose provider quota without an API profile.',
        required_free_bytes: requiredFree
      });
      return;
    }
    const attested = Number(args['attest-headroom-bytes']);
    if (!Number.isFinite(attested) || attested < 0) {
      haltFail(EXIT_CODES.USAGE_ERROR, {
        stage: 'quota',
        reason: '--attest-headroom-bytes must be a finite, nonnegative number'
      });
      return;
    }
    const quotaOk = attested >= requiredFree;
    jsonReport.checks.push({
      check: 'quota',
      ok: quotaOk,
      provider: 'gdrive',
      evidence: 'operator_attestation',
      attested_free_bytes: attested,
      required_free_bytes: requiredFree
    });
    reportLines.push(`- quota (gdrive mounted-volume, attested): ${quotaOk ? 'PASS' : 'FAIL'}`);
    if (!quotaOk) {
      haltFail(EXIT_CODES.QUOTA_INSUFFICIENT, { stage: 'quota', required_free_bytes: requiredFree });
      return;
    }
  } else if (resolved.provider === 'onedrive') {
    const storage = client && client.file_storage ? client.file_storage : {};
    const credentialProfile = storage.credential_profile;
    const graphEnv = dependencies.env || process.env;
    const graphConfigured = hasGraphCredentialsConfigured(credentialProfile, graphEnv);
    jsonReport.checks.push({ check: 'graph-credentials-probe', configured: graphConfigured });
    if (graphConfigured) {
      try {
        // eslint-disable-next-line global-require
        const graphClient = dependencies.graphClient || require('../ms-graph/client.js');
        const freeBytes = await graphClient.getOneDriveFreeBytes({
          profile: credentialProfile,
          expectedAccountIdentitySha256: storage.expected_account_identity_sha256,
          remoteRootId: storage.remote_root_id,
          env: graphEnv
        });
        const quotaOk = freeBytes >= requiredFree;
        jsonReport.checks.push({
          check: 'quota',
          ok: quotaOk,
          provider: 'onedrive',
          free_bytes: freeBytes,
          free_human: formatBytes(freeBytes),
          required_free_bytes: requiredFree,
          required_free_human: formatBytes(requiredFree)
        });
        reportLines.push(`- quota (onedrive, graph): ${quotaOk ? 'PASS' : 'FAIL'} (free=${formatBytes(freeBytes)}; required>=${formatBytes(requiredFree)})`);
        if (!quotaOk) {
          haltFail(EXIT_CODES.QUOTA_INSUFFICIENT, { stage: 'quota', free_bytes: freeBytes, required_free_bytes: requiredFree });
          return;
        }
      } catch (err) {
        const graphCode = err && /^[A-Z0-9_]{1,64}$/.test(err.code || '') ? err.code : 'GRAPH_QUOTA_ERROR';
        const reason = `Microsoft Graph quota verification failed (${graphCode})`;
        jsonReport.checks.push({ check: 'quota', ok: false, code: 'QUOTA_UNKNOWN', graph_code: graphCode, reason });
        haltFail(EXIT_CODES.QUOTA_UNKNOWN, { stage: 'quota', reason });
        return;
      }
    } else if (!Object.prototype.hasOwnProperty.call(args, 'attest-headroom-bytes')) {
      const attestationRequest = {
        schema: 'AttestationRequest/1.0',
        client: clientCode,
        provider: 'onedrive',
        reason: 'The registered OneDrive credential profile is not fully configured; free space cannot be checked via API.',
        required_free_bytes: requiredFree,
        required_free_human: formatBytes(requiredFree),
        instruction: 'Check the OneDrive web UI or account settings for free space, then re-run with --attest-headroom-bytes <bytes-free> (must be >= 2x batch-bytes).'
      };
      jsonReport.checks.push({ check: 'quota', ok: false, code: 'ATTESTATION_REQUIRED', ...attestationRequest });
      reportLines.push('- quota (onedrive): ATTESTATION_REQUIRED');
      reportLines.push('  ' + JSON.stringify(attestationRequest));
      haltFail(EXIT_CODES.ATTESTATION_REQUIRED, attestationRequest);
      return;
    } else {
      const attested = Number(args['attest-headroom-bytes']);
      if (!Number.isFinite(attested) || attested < 0) {
        haltFail(EXIT_CODES.USAGE_ERROR, {
          stage: 'quota',
          reason: '--attest-headroom-bytes must be a finite, nonnegative number'
        });
        return;
      }
      const quotaOk = attested >= requiredFree;
      jsonReport.checks.push({
        check: 'quota',
        ok: quotaOk,
        provider: 'onedrive',
        evidence: 'operator_attestation',
        attested_free_bytes: attested,
        attested_free_human: formatBytes(attested),
        required_free_bytes: requiredFree,
        required_free_human: formatBytes(requiredFree)
      });
      reportLines.push(`- quota (onedrive, attested): ${quotaOk ? 'PASS' : 'FAIL'} (attested=${formatBytes(attested)}; required>=${formatBytes(requiredFree)})`);
      if (!quotaOk) {
        haltFail(EXIT_CODES.QUOTA_INSUFFICIENT, { stage: 'quota', attested_free_bytes: attested, required_free_bytes: requiredFree });
        return;
      }
    }
  }

  // --- OneDrive filename lint, scoped to the classify report's own entries ---
  let renameProposals = [];
  let approvedRenameMapPath = null;
  if (resolved.provider === 'onedrive' && migratable.length > 0) {
    const clientRoot = clientRootPath(clientCode);
    const piiIndex = piiMapCheck.index;

    for (const entry of migratable) {
      let located;
      try {
        located = recoverEntryPath(entry, clientRoot, piiIndex);
      } catch (err) {
        haltFail(EXIT_CODES.USAGE_ERROR, { stage: 'onedrive-filename-lint', reason: err.message });
        return;
      }
      const targetPath = path.join(resolved.mountedPath, located.relPath);
      const violations = lintOneDriveTargetPath(targetPath);
      if (violations.length === 0) continue;

      const renamedRelPath = proposeOneDriveRenamedRelPath(located.relPath);
      renameProposals.push({
        klass: entry.klass,
        relPath: located.relPath,
        sha256Prefix: entry.sha256_prefix || null,
        renamedRelPath,
        violations
      });
    }
  }

  jsonReport.rename_proposal_count = renameProposals.length;
  if (renameProposals.length > 0) {
    reportLines.push('', `## OneDrive filename rename proposals (${renameProposals.length})`, '');
    reportLines.push('| class | identity | violations |');
    reportLines.push('|---|---|---|');
    for (const p of renameProposals) {
      // PII redaction: never show the real relpath in a committed report
      // surface. Show only the sha256 prefix + extension + violation type.
      const identity =
        p.klass === 'PII-MOVE'
          ? `sha256:${p.sha256Prefix || 'unknown'}${path.extname(p.relPath) || ''}`
          : p.relPath;
      reportLines.push(`| ${p.klass} | ${identity} | ${p.violations.join('; ')} |`);
    }

    const privateRenameCount = renameProposals.filter((proposal) => proposal.klass === 'PII-MOVE').length;
    if (privateRenameCount > 0) {
      jsonReport.rename_proposals_redacted = renameProposals.map((p) => ({
        klass: p.klass,
        identity: p.klass === 'PII-MOVE' ? { extension: path.extname(p.relPath) || null } : { repo_relpath: p.relPath },
        violations: p.violations
      }));
      haltFail(EXIT_CODES.RENAMES_REQUIRED, {
        stage: 'onedrive-filename-lint',
        reason: 'private filenames cannot be redirected safely; rename the local source deliberately, then reclassify',
        private_rename_count: privateRenameCount
      });
      return;
    }

    if (!args['renames-approved']) {
      jsonReport.rename_proposals_redacted = renameProposals.map((p) => ({
        klass: p.klass,
        identity: p.klass === 'PII-MOVE' ? { extension: path.extname(p.relPath) || null } : { repo_relpath: p.relPath },
        violations: p.violations
      }));
      haltFail(EXIT_CODES.RENAMES_REQUIRED, { stage: 'onedrive-filename-lint', rename_proposal_count: renameProposals.length });
      return;
    }

    // Approved: write the FULL (real-filename) rename map into the client
    // directory, never into the committed _dev/reports surface.
    const renameMap = {
      schema: 'ClientStorageRenameMap/1.0',
      client: clientCode,
      generated_at: new Date().toISOString(),
      renames: renameProposals.map((p) => ({
        repo_relpath: p.relPath,
        renamed_relpath: p.renamedRelPath
      }))
    };
    approvedRenameMapPath = writeRenameMap(clientCode, renameMap);
    jsonReport.rename_map = path.relative(REPO_ROOT, approvedRenameMapPath);
    reportLines.push('', `(renames approved via --renames-approved; full map written to ${jsonReport.rename_map})`);
  }

  // Bind the PASS gate to the exact rename-map state. A no-rename PASS binds
  // absence, preventing a stale map from silently redirecting migrate.js.
  if (renameProposals.length > 0) {
    const boundRenameMap = loadRenameMap(clientCode);
    if (
      !boundRenameMap ||
      boundRenameMap.schema !== 'ClientStorageRenameMap/1.0' ||
      boundRenameMap.client !== clientCode
    ) {
      haltFail(EXIT_CODES.RENAME_MAP_DRIFT, {
        stage: 'rename-map-binding',
        reason: 'approved rename map has the wrong schema or client'
      });
      return;
    }
    jsonReport.rename_map_binding = {
      required: true,
      schema: boundRenameMap.schema,
      client: boundRenameMap.client,
      sha256: await sha256File(approvedRenameMapPath)
    };
  } else {
    let staleRenameMap;
    try {
      staleRenameMap = loadRenameMap(clientCode);
    } catch (err) {
      haltFail(EXIT_CODES.RENAME_MAP_DRIFT, {
        stage: 'rename-map-binding',
        reason: `stale rename-map.json is not valid JSON: ${err.message}`
      });
      return;
    }
    if (staleRenameMap) {
      haltFail(EXIT_CODES.RENAME_MAP_DRIFT, {
        stage: 'rename-map-binding',
        reason: 'no renames are required, but a stale rename-map.json is present; remove or archive it before preflight'
      });
      return;
    }
    jsonReport.rename_map_binding = {
      required: false,
      schema: null,
      client: clientCode,
      sha256: null
    };
  }

  jsonReport.status = 'PASS';
  writeReports();
  emitStatus({ ok: true, client: clientCode, provider: resolved.provider, registered_mount: true, status: 'PASS' });
  process.exit(EXIT_CODES.OK);
}

if (require.main === module) {
  main().catch((err) => {
    emitStatus({ ok: false, code: 'USAGE_ERROR', exit_code: EXIT_CODES.USAGE_ERROR, reason: err.message });
    process.exit(EXIT_CODES.USAGE_ERROR);
  });
}

module.exports = { main };
