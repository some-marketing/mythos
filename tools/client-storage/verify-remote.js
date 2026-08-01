#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { URLSearchParams } = require('url');
const { spawnSync } = require('child_process');
const {
  parseArgs,
  emitStatus,
  fail,
  EXIT_CODES,
  resolveStorageRoot,
  assertUnderRoot,
  sha256File,
  quickXorHashFile,
  getLocalFreeDiskGB,
  DEFAULT_MIN_FREE_DISK_GB,
  clientRootPath,
  readClientJson,
  loadStorageMap,
  loadPiiPathMap,
  validatePiiPathMapBinding,
  hasGraphCredentialsConfigured,
  ensureReportsDir,
  writeAtomic,
  nowUtcStamp,
  REPO_ROOT
} = require('./lib.js');

const MAX_REPORT_AGE_MS = 24 * 60 * 60 * 1000;

function stableHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function freshTimestamp(value, { notBefore = null } = {}) {
  const timestamp = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(timestamp)) return false;
  if (timestamp > now || now - timestamp > MAX_REPORT_AGE_MS) return false;
  if (notBefore !== null && timestamp < notBefore) return false;
  return true;
}

function canonicalEntrySet(items) {
  return items
    .map((item) => [
      item.identity,
      item.entry.size,
      item.entry.sha256,
      item.entry.md5 || '',
      item.relPath,
      item.preserved ? 'preserved' : 'active'
    ].join('\0'))
    .sort()
    .join('\n');
}

function validateStorageState(clientCode, resolved) {
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
    return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'storage-map identity is invalid' };
  }
  const privateMap = loadPiiPathMap(clientCode);
  const privateById = new Map(
    [
      ...((privateMap && privateMap.entries) || []),
      ...((privateMap && privateMap.retained_entries) || []),
      ...((privateMap && privateMap.retired_entries) || []).map((entry) => ({
        ...entry,
        repo_relpath: entry.private_remote_relpath
      }))
    ].map((entry) => [entry.pii_id, entry])
  );
  const identities = new Set();
  const all = [];
  for (const [collection, preserved] of [
    [storageMap.entries, false],
    [storageMap.preserved_snapshots || [], true]
  ]) {
    for (const entry of collection) {
      const isPii = Boolean(entry && entry.pii_id);
      const identity = isPii ? `PII:${entry.pii_id}` : `PATH:${entry.repo_relpath}`;
      const locator = isPii ? privateById.get(entry.pii_id) : null;
      const relPath = isPii ? locator && locator.repo_relpath : entry.drive_relpath;
      if (
        !entry ||
        identities.has(identity) ||
        !relPath ||
        !Number.isFinite(entry.size) ||
        !/^[a-f0-9]{64}$/.test(entry.sha256 || '') ||
        (isPii && (!locator || locator.size !== entry.size || locator.sha256 !== entry.sha256))
      ) {
        return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'storage identity cannot be resolved safely' };
      }
      identities.add(identity);
      let targetPath;
      try {
        targetPath = assertUnderRoot(path.join(resolved.mountedPath, relPath), resolved.mountedPath);
      } catch {
        return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'storage target escapes the registered root' };
      }
      all.push({ entry, identity, relPath, targetPath, isPii, preserved });
    }
  }
  return { ok: true, storageMap, all };
}

async function validateMigrationReport(clientCode, reportPath, storageMapPath, { allowRetired = false } = {}) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return { ok: false, code: EXIT_CODES.REPORT_MISSING, reason: 'migration report is missing or invalid JSON' };
  }
  const storageMapSha256 = await sha256File(storageMapPath);
  const privateMapPath = path.join(clientRootPath(clientCode), 'pii-path-map.json');
  const privateMapSha256 = fs.existsSync(privateMapPath) ? await sha256File(privateMapPath) : null;
  const piiCheck = await validatePiiPathMapBinding(clientCode, {
    required: true,
    schema: 'ClientStoragePiiPathMap/1.0',
    client: clientCode,
    entry_count: report.pii_active_identity_count,
    sha256: report.pii_path_map_sha256
  });
  const currentSourceState =
    report.source_currency_status === 'CURRENT' &&
    report.u4_closure_ready === true;
  const retiredSourceState =
    allowRetired &&
    report.source_currency_status === 'RETIRED' &&
    report.u4_closure_ready === false &&
    report.post_retirement_audit_ready === true &&
    report.source_missing_count === 0 &&
    report.source_drift_count === 0;
  if (
    report.schema !== 'ClientStorageManifestVerify/1.0' ||
    report.client !== clientCode ||
    report.status !== 'PASS' ||
    report.snapshot_status !== 'PASS' ||
    (!currentSourceState && !retiredSourceState) ||
    report.storage_map_sha256 !== storageMapSha256 ||
    report.target_mismatch_count !== 0 ||
    report.preserved_snapshot_mismatch_count !== 0 ||
    report.source_drift_count !== 0 ||
    report.source_missing_count !== 0 ||
    !freshTimestamp(report.generated_at) ||
    report.pii_path_map_sha256 !== privateMapSha256 ||
    !piiCheck.ok ||
    piiCheck.retainedIndex.size !== report.pii_retained_identity_count ||
    piiCheck.retiredIndex.size !== (report.pii_retired_identity_count || 0)
  ) {
    return { ok: false, code: EXIT_CODES.PREFLIGHT_FAILED, reason: 'migration report does not bind a current complete snapshot' };
  }
  return { ok: true, report, storageMapSha256 };
}

function selectRiskSamples(items, count) {
  const selected = new Map();
  function take(item) {
    if (item && selected.size < count) selected.set(item.identity, item);
  }
  take(items.find((item) => item.isPii && !item.preserved));
  take(items.find((item) => !item.isPii && !item.preserved));
  take(items.find((item) => item.preserved));
  take([...items].sort((a, b) => b.entry.size - a.entry.size)[0]);
  for (const item of [...items].sort((a, b) =>
    stableHash(a.identity).localeCompare(stableHash(b.identity))
  )) take(item);
  return [...selected.values()];
}

function resolveSampleCount(rawValue, entryCount) {
  if (entryCount === 0 && rawValue === undefined) return { ok: true, count: 0 };
  const count = rawValue === undefined ? Math.min(25, entryCount) : Number(rawValue);
  if (!Number.isInteger(count) || count <= 0 || count > entryCount) {
    return { ok: false, count: null };
  }
  return { ok: true, count };
}

function prepareOneDriveAttestation(clientCode, state, migration, sampleCount) {
  const challengePath = path.join(clientRootPath(clientCode), 'remote-attestation.json');
  const samples = selectRiskSamples(state.all, Math.min(sampleCount, state.all.length));
  const challenge = {
    schema: 'ClientStorageOneDriveWebAttestation/1.0',
    client: clientCode,
    challenge_id: crypto.randomUUID(),
    generated_at: new Date().toISOString(),
    storage_map_sha256: migration.storageMapSha256,
    migration_report_sha256: null,
    entry_set_sha256: stableHash(canonicalEntrySet(state.all)),
    expected_listing_count: state.all.length,
    observed_listing_count: null,
    sync_settled_at: null,
    operator_confirmed: false,
    samples: samples.map((item) => ({
      sample_id: stableHash(item.identity).slice(0, 16),
      private_remote_relpath: item.relPath,
      expected_size: item.entry.size,
      present: null,
      observed_size: null,
      opened: null
    }))
  };
  writeAtomic(challengePath, JSON.stringify(challenge, null, 2) + '\n');
  return { challengePath, challenge };
}

async function validateOneDriveAttestation(attestationPath, clientCode, state, migration, migrationReportPath) {
  let attestation;
  try {
    attestation = JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'private OneDrive attestation is missing or invalid' };
  }
  const expectedMigrationSha = await sha256File(migrationReportPath);
  const expectedEntrySetSha = stableHash(canonicalEntrySet(state.all));
  const expectedSamples = new Map(
    selectRiskSamples(state.all, Math.min(25, state.all.length)).map((item) => [
      stableHash(item.identity).slice(0, 16),
      { relPath: item.relPath, size: item.entry.size }
    ])
  );
  const sampleIds = new Set();
  if (
    attestation.schema !== 'ClientStorageOneDriveWebAttestation/1.0' ||
    attestation.client !== clientCode ||
    attestation.storage_map_sha256 !== migration.storageMapSha256 ||
    attestation.migration_report_sha256 !== expectedMigrationSha ||
    attestation.entry_set_sha256 !== expectedEntrySetSha ||
    attestation.expected_listing_count !== state.all.length ||
    attestation.observed_listing_count !== state.all.length ||
    attestation.operator_confirmed !== true ||
    !Array.isArray(attestation.samples) ||
    attestation.samples.length !== expectedSamples.size ||
    !freshTimestamp(attestation.generated_at) ||
    !freshTimestamp(attestation.sync_settled_at, { notBefore: Date.parse(attestation.generated_at) })
  ) {
    return { ok: false, reason: 'OneDrive attestation does not bind the current complete remote set' };
  }
  for (const sample of attestation.samples) {
    const expected = expectedSamples.get(sample.sample_id);
    if (
      !expected ||
      sampleIds.has(sample.sample_id) ||
      sample.private_remote_relpath !== expected.relPath ||
      sample.expected_size !== expected.size ||
      sample.present !== true ||
      sample.opened !== true ||
      sample.observed_size !== sample.expected_size
    ) {
      return { ok: false, reason: 'OneDrive attestation has an incomplete or mismatched sample' };
    }
    sampleIds.add(sample.sample_id);
  }
  return { ok: true, attestation, expectedMigrationSha };
}

async function googleFindChild(accessToken, parentId, name) {
  const { apiRequest } = require('../google-drive/client.js');
  const escaped = String(name).replace(/'/g, "\\'");
  const query = new URLSearchParams({
    q: `'${parentId}' in parents and name = '${escaped}' and trashed = false`,
    fields: 'files(id,name,mimeType,size,md5Checksum,modifiedTime)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true'
  });
  const result = await apiRequest({
    accessToken,
    method: 'GET',
    path: `/drive/v3/files?${query.toString()}`
  });
  if (!Array.isArray(result.files) || result.files.length !== 1) {
    throw new Error('remote item is missing or ambiguous');
  }
  return result.files[0];
}

function loadRemoteIdentityIndex(clientCode, provider, items) {
  const mapPath = path.join(clientRootPath(clientCode), 'remote-identity-map.json');
  if (!fs.existsSync(mapPath)) return new Map();
  try {
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    if (
      map.schema !== 'ClientStorageRemoteIdentityMap/1.0' ||
      map.client !== clientCode ||
      map.provider !== provider ||
      map.entry_set_sha256 !== stableHash(canonicalEntrySet(items)) ||
      !Array.isArray(map.entries)
    ) {
      return new Map();
    }
    const index = new Map();
    for (const entry of map.entries) {
      if (
        !entry ||
        typeof entry.identity !== 'string' ||
        typeof entry.provider_item_id !== 'string' ||
        index.has(entry.identity)
      ) {
        return new Map();
      }
      index.set(entry.identity, entry);
    }
    return index.size === items.length ? index : new Map();
  } catch {
    return new Map();
  }
}

async function verifyGoogleT0(clientCode, items) {
  const client = readClientJson(clientCode);
  const remoteRootId = client.file_storage && client.file_storage.remote_root_id;
  const credentialProfile = client.file_storage && client.file_storage.credential_profile;
  if (!remoteRootId || !credentialProfile) {
    throw new Error('registered Google remote_root_id and credential_profile are required');
  }
  const { resolveCreds } = require('../google-drive/config.js');
  const { getAccessToken, apiRequest } = require('../google-drive/client.js');
  const accessToken = await getAccessToken(resolveCreds(credentialProfile));
  const priorIdentities = loadRemoteIdentityIndex(clientCode, 'gdrive', items);
  let mismatches = 0;
  const remoteIdentities = [];
  for (const item of items) {
    if (!/^[a-f0-9]{32}$/.test(item.entry.md5 || '')) {
      mismatches += 1;
      continue;
    }
    let remote;
    const prior = priorIdentities.get(item.identity);
    if (prior) {
      remote = { id: prior.provider_item_id };
    } else {
      let parentId = remoteRootId;
      for (const segment of item.relPath.split(path.sep)) {
        remote = await googleFindChild(accessToken, parentId, segment);
        parentId = remote.id;
      }
    }
    remote = await apiRequest({
      accessToken,
      method: 'GET',
      path: `/drive/v3/files/${encodeURIComponent(remote.id)}?fields=id,size,md5Checksum,modifiedTime&supportsAllDrives=true`
    });
    if (remote.md5Checksum !== item.entry.md5 || Number(remote.size) !== item.entry.size) {
      mismatches += 1;
    }
    remoteIdentities.push({
      identity: item.identity,
      provider_item_id: remote.id,
      private_remote_relpath: item.relPath,
      size: item.entry.size,
      provider_hash: remote.md5Checksum
    });
  }
  return { method: 'gdrive_api_md5', assurance: 'provider_checksum', mismatches, remoteIdentities };
}

function httpsJson({ hostname, requestPath, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(body) : null;
    const request = https.request({
      hostname,
      path: requestPath,
      method,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Length': payload.length } : {})
      }
    }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(`HTTP ${response.statusCode}`);
          error.code = 'GRAPH_HTTP_ERROR';
          reject(error);
          return;
        }
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          reject(Object.assign(new Error('invalid Graph JSON'), { code: 'GRAPH_JSON_ERROR' }));
        }
      });
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function graphAccessToken(profile, graphClient = require('../ms-graph/client.js')) {
  return graphClient.getAccessToken({ profile });
}

async function verifyOneDriveGraphT0(clientCode, items, dependencies = {}) {
  const storage = dependencies.storage || (readClientJson(clientCode).file_storage || {});
  if (
    !storage.credential_profile ||
    !storage.expected_account_identity_sha256 ||
    !storage.remote_root_id ||
    !storage.drive_id ||
    !storage.remote_root_item_id
  ) {
    throw Object.assign(new Error('registered OneDrive profile, account, drive, and remote-root bindings are required'), {
      code: 'GRAPH_BINDING_MISSING'
    });
  }
  const graphClient = dependencies.graphClient || require('../ms-graph/client.js');
  const quotaEvidence = await graphClient.getOneDriveQuotaEvidence({
    profile: storage.credential_profile,
    expectedAccountIdentitySha256: storage.expected_account_identity_sha256,
    remoteRootId: storage.remote_root_id
  });
  if (quotaEvidence.driveId !== storage.drive_id) {
    throw Object.assign(new Error('Microsoft Graph drive does not match registration'), { code: 'GRAPH_DRIVE_MISMATCH' });
  }
  const accessToken = await graphAccessToken(storage.credential_profile, graphClient);
  const request = dependencies.httpsJson || httpsJson;
  const rootItem = await request({
    hostname: 'graph.microsoft.com',
    requestPath: `/v1.0/drives/${encodeURIComponent(storage.drive_id)}/items/${encodeURIComponent(storage.remote_root_item_id)}?$select=id,parentReference`,
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (rootItem.id !== storage.remote_root_item_id) {
    throw Object.assign(new Error('Microsoft Graph root item does not match registration'), { code: 'GRAPH_REMOTE_ITEM_MISMATCH' });
  }
  const priorIdentities = dependencies.priorIdentities || loadRemoteIdentityIndex(clientCode, 'onedrive', items);
  let mismatches = 0;
  const remoteIdentities = [];
  for (const item of items) {
    const prior = priorIdentities.get(item.identity);
    const encodedPath = item.relPath.split(path.sep).map(encodeURIComponent).join('/');
    const remote = await request({
      hostname: 'graph.microsoft.com',
      requestPath:
        `/v1.0/drives/${encodeURIComponent(storage.drive_id)}` +
        (
          prior
            ? `/items/${encodeURIComponent(prior.provider_item_id)}`
            : `/items/${encodeURIComponent(storage.remote_root_item_id)}:/${encodedPath}:`
        ) +
        '?$select=id,size,file',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const remoteHash = remote.file && remote.file.hashes && remote.file.hashes.quickXorHash;
    let expectedHash = item.entry.quick_xor_hash;
    if (!expectedHash && !item.preserved) {
      const sourcePath = path.join(clientRootPath(clientCode), item.relPath);
      if (fs.existsSync(sourcePath)) expectedHash = await quickXorHashFile(sourcePath);
    }
    if (!expectedHash || remoteHash !== expectedHash || Number(remote.size) !== item.entry.size) {
      mismatches += 1;
    }
    remoteIdentities.push({
      identity: item.identity,
      provider_item_id: remote.id,
      private_remote_relpath: item.relPath,
      size: item.entry.size,
      provider_hash: remoteHash
    });
  }
  return {
    method: 'onedrive_graph_quickxor',
    assurance: 'provider_checksum',
    mismatches,
    remoteIdentities,
    provider_remote_truth_established: mismatches === 0,
    deletion_authority: false
  };
}

async function writeRemoteIdentityMap(clientCode, provider, entrySetSha256, identities) {
  const mapPath = path.join(clientRootPath(clientCode), 'remote-identity-map.json');
  const map = {
    schema: 'ClientStorageRemoteIdentityMap/1.0',
    client: clientCode,
    provider,
    generated_at: new Date().toISOString(),
    entry_set_sha256: entrySetSha256,
    entries: identities
  };
  writeAtomic(mapPath, JSON.stringify(map, null, 2) + '\n');
  return { mapPath, sha256: await sha256File(mapPath) };
}

async function verifyMounted(items, tier, sampleCount) {
  const selected = tier === 1 ? items : tier === 2 ? selectRiskSamples(items, sampleCount) : items;
  let mismatches = 0;
  for (const item of selected) {
    if (
      !fs.existsSync(item.targetPath) ||
      !fs.lstatSync(item.targetPath).isFile() ||
      fs.lstatSync(item.targetPath).isSymbolicLink() ||
      fs.statSync(item.targetPath).size !== item.entry.size ||
      (
        tier === 1 &&
        (
          !item.entry.drive_mtime ||
          fs.statSync(item.targetPath).mtime.toISOString() !== item.entry.drive_mtime
        )
      ) ||
      (tier >= 2 && await sha256File(item.targetPath) !== item.entry.sha256)
    ) {
      mismatches += 1;
    }
  }
  return {
    method: tier === 1 ? 'mounted_size_mtime' : tier === 2 ? 'mounted_sampled_sha256' : 'mounted_full_sha256',
    assurance: 'mounted_filesystem',
    checked: selected.length,
    checkedBytes: selected.reduce((sum, item) => sum + item.entry.size, 0),
    mismatches
  };
}

async function main() {
  const args = parseArgs(process.argv, {
    flags: ['all', 'prepare-attestation', 'attest', 'hydration-window'],
    valued: ['client', 'tier', 'migration-report', 'attestation', 'sample-count']
  });
  if (args.help) {
    process.stdout.write(`verify-remote.js -- tiered provider/mounted storage audit

Usage:
  node verify-remote.js --client CODE --migration-report FILE [--tier 1]
  node verify-remote.js --client CODE --migration-report FILE --tier 0
    --prepare-attestation
  node verify-remote.js --client CODE --migration-report FILE --tier 0
    --attestation clients/CODE/remote-attestation.json --attest

Only a passing T0 provider-remote report grants deletion authority. T1 is
metadata-only; T2 samples hashes; T3 hashes all and requires a hydration
window with corpus headroom plus the 15 GB safety floor.
`);
    return;
  }
  if (args.all) {
    const tier = args.tier === undefined ? 1 : Number(args.tier);
    if (tier !== 1 || args.client || args['migration-report']) {
      fail(EXIT_CODES.USAGE_ERROR, {
        stage: 'verify-remote-all',
        reason: '--all is valid only as --all --tier 1 without per-client arguments'
      });
      return;
    }
    const reportsDir = ensureReportsDir();
    const clientsDir = path.join(REPO_ROOT, 'clients');
    const results = [];
    for (const clientCode of fs.readdirSync(clientsDir).sort()) {
      const clientJson = path.join(clientsDir, clientCode, 'client.json');
      const storageMap = path.join(clientsDir, clientCode, 'storage-map.json');
      if (!fs.existsSync(clientJson) || !fs.existsSync(storageMap)) continue;
      let client;
      try { client = JSON.parse(fs.readFileSync(clientJson, 'utf8')); } catch { continue; }
      if (!client.file_storage) continue;
      const prefix = `${clientCode}__manifest-verify__`;
      const candidates = fs.readdirSync(reportsDir)
        .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
        .sort()
        .reverse();
      if (candidates.length === 0) {
        results.push({ client: clientCode, status: 'MISSING_MIGRATION_REPORT' });
        continue;
      }
      const child = spawnSync(process.execPath, [
        __filename,
        '--client', clientCode,
        '--migration-report', path.join(reportsDir, candidates[0]),
        '--tier', '1'
      ], { cwd: process.cwd(), encoding: 'utf8', env: process.env });
      results.push({ client: clientCode, status: child.status === 0 ? 'PASS' : 'FAIL' });
    }
    emitStatus({
      ok: results.every((result) => result.status === 'PASS'),
      tier: 1,
      all: true,
      clients: results
    });
    if (results.some((result) => result.status !== 'PASS')) process.exit(EXIT_CODES.PREFLIGHT_FAILED);
    return;
  }
  const clientCode = args.client;
  const tier = args.tier === undefined ? 1 : Number(args.tier);
  if (!clientCode || !args['migration-report'] || !Number.isInteger(tier) || tier < 0 || tier > 3) {
    fail(EXIT_CODES.USAGE_ERROR, { stage: 'verify-remote', reason: '--client, --migration-report, and tier 0..3 are required' });
    return;
  }
  const migrationReportPath = path.resolve(args['migration-report']);
  const resolved = resolveStorageRoot(clientCode);
  if (!resolved.ok) {
    fail(resolved.code, { client: clientCode, stage: 'verify-remote', reason: resolved.reason });
    return;
  }
  const state = validateStorageState(clientCode, resolved);
  if (!state.ok) {
    fail(state.code, { client: clientCode, stage: 'verify-remote', reason: state.reason });
    return;
  }
  const storageMapPath = path.join(clientRootPath(clientCode), 'storage-map.json');
  const migration = await validateMigrationReport(
    clientCode,
    migrationReportPath,
    storageMapPath,
    { allowRetired: tier > 0 }
  );
  if (!migration.ok) {
    fail(migration.code, { client: clientCode, stage: 'verify-remote', reason: migration.reason });
    return;
  }
  const sampleResolution = resolveSampleCount(args['sample-count'], state.all.length);
  if (!sampleResolution.ok) {
    fail(EXIT_CODES.USAGE_ERROR, {
      client: clientCode,
      stage: 'verify-remote',
      reason: '--sample-count must be a positive integer no greater than the storage entry count'
    });
    return;
  }
  const sampleCount = sampleResolution.count;
  if (tier === 0 && resolved.provider === 'onedrive' && args['prepare-attestation']) {
    const prepared = prepareOneDriveAttestation(clientCode, state, migration, 25);
    prepared.challenge.migration_report_sha256 = await sha256File(migrationReportPath);
    writeAtomic(prepared.challengePath, JSON.stringify(prepared.challenge, null, 2) + '\n');
    emitStatus({
      ok: true,
      client: clientCode,
      status: 'AWAITING_OPERATOR_ATTESTATION',
      private_attestation: path.relative(process.cwd(), prepared.challengePath),
      expected_listing_count: state.all.length,
      sample_count: prepared.challenge.samples.length
    });
    return;
  }
  let result;
  let truthDomain = 'mounted_filesystem';
  let attestationSummary = null;
  try {
    if (tier === 0 && resolved.provider === 'gdrive') {
      result = await verifyGoogleT0(clientCode, state.all);
      truthDomain = 'provider_remote';
    } else if (tier === 0 && resolved.provider === 'onedrive') {
      const storage = readClientJson(clientCode).file_storage || {};
      if (hasGraphCredentialsConfigured(storage.credential_profile)) {
        result = await verifyOneDriveGraphT0(clientCode, state.all);
        truthDomain = 'provider_remote';
      } else if (!args.attest || !args.attestation) {
        fail(EXIT_CODES.ATTESTATION_REQUIRED, {
          client: clientCode,
          stage: 'verify-remote-t0',
          reason: 'prepare and complete the private OneDrive attestation, then pass --attestation FILE --attest'
        });
        return;
      } else {
        const checked = await validateOneDriveAttestation(
        path.resolve(args.attestation),
        clientCode,
        state,
        migration,
        migrationReportPath
      );
        if (!checked.ok) {
          fail(EXIT_CODES.ATTESTATION_REQUIRED, { client: clientCode, stage: 'verify-remote-t0', reason: checked.reason });
          return;
        }
        result = {
          method: 'onedrive_web_ui_spot_check',
          assurance: 'operator_attestation',
          checked: checked.attestation.samples.length,
          checkedBytes: checked.attestation.samples.reduce((sum, sample) => sum + sample.expected_size, 0),
          mismatches: 0
        };
        truthDomain = 'provider_remote_operator_attestation';
        attestationSummary = {
          challenge_sha256: await sha256File(path.resolve(args.attestation)),
          observed_listing_count: checked.attestation.observed_listing_count,
          sampled_count: checked.attestation.samples.length,
          sync_settled_at: checked.attestation.sync_settled_at
        };
      }
    } else {
      if (tier === 3) {
        const corpusGiB = state.all.reduce((sum, item) => sum + item.entry.size, 0) / (1024 ** 3);
        if (
          !args['hydration-window'] ||
          getLocalFreeDiskGB(resolved.mountedPath) < DEFAULT_MIN_FREE_DISK_GB + corpusGiB
        ) {
          fail(EXIT_CODES.LOW_DISK, {
            client: clientCode,
            stage: 'verify-remote-t3',
            reason: 'T3 requires --hydration-window and free disk for the corpus plus the 15 GB floor'
          });
          return;
        }
      }
      result = await verifyMounted(state.all, tier, sampleCount);
    }
  } catch (error) {
    fail(EXIT_CODES.QUOTA_UNKNOWN, {
      client: clientCode,
      stage: 'verify-remote',
      reason: `remote truth could not be established (${error && error.code || 'REMOTE_ERROR'})`
    });
    return;
  }
  const status = result.mismatches === 0 ? 'PASS' : 'FAIL';
  const activeBytes = state.storageMap.entries.reduce((sum, entry) => sum + entry.size, 0);
  const preservedBytes = (state.storageMap.preserved_snapshots || []).reduce((sum, entry) => sum + entry.size, 0);
  const entrySetSha256 = stableHash(canonicalEntrySet(state.all));
  const remoteIdentity = tier === 0 && status === 'PASS' && result.remoteIdentities
    ? await writeRemoteIdentityMap(clientCode, resolved.provider, entrySetSha256, result.remoteIdentities)
    : null;
  const report = {
    schema: 'ClientStorageRemoteVerify/1.0',
    client: clientCode,
    provider: resolved.provider,
    generated_at: new Date().toISOString(),
    status,
    tier,
    truth_domain: truthDomain,
    method: result.method,
    assurance: result.assurance,
    storage_map_sha256: migration.storageMapSha256,
    migration_report_sha256: await sha256File(migrationReportPath),
    classify_report_sha256: migration.report.classify_report_sha256,
    entry_set_sha256: entrySetSha256,
    remote_identity_map_sha256: remoteIdentity && remoteIdentity.sha256,
    active_entry_count: state.storageMap.entries.length,
    active_bytes: activeBytes,
    preserved_snapshot_count: (state.storageMap.preserved_snapshots || []).length,
    preserved_snapshot_bytes: preservedBytes,
    expected_remote_item_count: state.all.length,
    verified_remote_item_count: result.checked || state.all.length,
    verified_remote_bytes: result.checkedBytes === undefined
      ? activeBytes + preservedBytes
      : result.checkedBytes,
    mismatch_count: result.mismatches,
    retirement_eligible: tier === 0 && status === 'PASS',
    attestation: attestationSummary,
    pii_paths_reported: 0
  };
  const stamp = nowUtcStamp();
  const dir = ensureReportsDir();
  const jsonPath = path.join(dir, `${clientCode}__remote-verify-t${tier}__${stamp}.json`);
  const mdPath = path.join(dir, `${clientCode}__remote-verify-t${tier}__${stamp}.md`);
  writeAtomic(jsonPath, JSON.stringify(report, null, 2) + '\n');
  writeAtomic(mdPath, [
    `# remote verification T${tier}: ${clientCode}`,
    '',
    `Generated: ${report.generated_at}`,
    `Status: ${status}`,
    `Truth domain: ${truthDomain}`,
    `Retirement eligible: ${report.retirement_eligible}`,
    `Verified remote items: ${report.verified_remote_item_count}/${report.expected_remote_item_count}`,
    `Mismatches: ${report.mismatch_count}`,
    ''
  ].join('\n'));
  emitStatus({
    ok: status === 'PASS',
    client: clientCode,
    tier,
    status,
    retirement_eligible: report.retirement_eligible,
    report_json: path.relative(process.cwd(), jsonPath),
    report_md: path.relative(process.cwd(), mdPath)
  });
  if (status !== 'PASS') process.exit(EXIT_CODES.CHECKSUM_MISMATCH);
}

if (require.main === module) {
  main().catch((error) => {
    fail(EXIT_CODES.USAGE_ERROR, {
      stage: 'verify-remote',
      reason: `unexpected verification failure (${error && error.code || 'UNKNOWN'})`
    });
  });
}

module.exports = {
  canonicalEntrySet,
  validateStorageState,
  validateMigrationReport,
  selectRiskSamples,
  resolveSampleCount,
  validateOneDriveAttestation,
  verifyOneDriveGraphT0,
  verifyMounted,
  main
};
