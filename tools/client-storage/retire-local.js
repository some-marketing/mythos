#!/usr/bin/env node
'use strict';

// Irreversible local retirement gate. Default is a read-only plan. Execution
// requires explicit --approve plus two independently bound PASS reports:
// mounted migration verification and T0 provider-remote truth.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  parseArgs,
  emitStatus,
  fail,
  EXIT_CODES,
  resolveStorageRoot,
  assertUnderRoot,
  sha256File,
  clientRootPath,
  loadPiiPathMap,
  writeAtomic,
  ensureReportsDir,
  nowUtcStamp,
  CLIENT_STORAGE_REPORTS_DIR,
  REPO_ROOT
} = require('./lib.js');
const {
  canonicalEntrySet,
  validateStorageState,
  validateOneDriveAttestation
} = require('./verify-remote.js');

const MAX_REPORT_AGE_MS = 24 * 60 * 60 * 1000;

function hashBoundPath(filePath, hooks = {}) {
  return new Promise((resolve, reject) => {
    let fd;
    try {
      const noFollow = fs.constants.O_NOFOLLOW || 0;
      fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
      const opened = fs.fstatSync(fd, { bigint: true });
      const onOpened = typeof hooks === 'function' ? hooks : hooks.onOpened;
      const onChunk = typeof hooks === 'object' && hooks.onChunk;
      if (onOpened) onOpened();
      const hash = require('crypto').createHash('sha256');
      const stream = fs.createReadStream(null, { fd, autoClose: false, start: 0 });
      let settled = false;
      function closeAndReject(error) {
        if (settled) return;
        settled = true;
        try { fs.closeSync(fd); } catch { /* already closed */ }
        reject(error);
      }
      stream.on('data', (chunk) => {
        hash.update(chunk);
        if (onChunk) onChunk(chunk);
      });
      stream.on('error', closeAndReject);
      stream.on('end', () => {
        if (settled) return;
        settled = true;
        try {
          const finished = fs.fstatSync(fd, { bigint: true });
          const pathStat = fs.lstatSync(filePath, { bigint: true });
          resolve({
            sha256: hash.digest('hex'),
            stat: {
              dev: finished.dev.toString(),
              ino: finished.ino.toString(),
              size: Number(finished.size)
            },
            stable:
              opened.dev === finished.dev &&
              opened.ino === finished.ino &&
              opened.size === finished.size &&
              opened.mtimeNs === finished.mtimeNs &&
              opened.ctimeNs === finished.ctimeNs,
            pathBound:
              !pathStat.isSymbolicLink() &&
              pathStat.isFile() &&
              pathStat.dev === finished.dev &&
              pathStat.ino === finished.ino
          });
        } catch (error) {
          reject(error);
        } finally {
          try { fs.closeSync(fd); } catch { /* already closed */ }
        }
      });
    } catch (error) {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { /* already closed */ }
      }
      reject(error);
    }
  });
}

function loadJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error(`${label} is missing or invalid JSON`);
  }
}

async function buildRetirementPlan(clientCode, migrateVerifyPath, remoteVerifyPath) {
  const resolved = resolveStorageRoot(clientCode);
  if (!resolved.ok) return resolved;
  const clientRoot = clientRootPath(clientCode);
  const storageMapPath = path.join(clientRoot, 'storage-map.json');
  let storageMap;
  let originalStorageBytes;
  let migrateVerify;
  let remoteVerify;
  try {
    originalStorageBytes = fs.readFileSync(storageMapPath);
    storageMap = JSON.parse(originalStorageBytes.toString('utf8'));
    migrateVerify = loadJson(migrateVerifyPath, 'migrate verify report');
    remoteVerify = loadJson(remoteVerifyPath, 'remote verify report');
  } catch (error) {
    return { ok: false, code: EXIT_CODES.REPORT_MISSING, reason: error.message };
  }
  const storageSha256 = await sha256File(storageMapPath);
  const state = validateStorageState(clientCode, resolved);
  if (!state.ok) return state;
  const entrySetSha256 = require('crypto')
    .createHash('sha256')
    .update(canonicalEntrySet(state.all))
    .digest('hex');
  const migrationReportSha256 = await sha256File(migrateVerifyPath);
  const totalRemoteBytes = state.all.reduce((sum, item) => sum + item.entry.size, 0);
  const migrateGeneratedAt = Date.parse(migrateVerify.generated_at);
  const remoteGeneratedAt = Date.parse(remoteVerify.generated_at);
  const now = Date.now();
  const migrationFresh = Number.isFinite(migrateGeneratedAt) &&
    migrateGeneratedAt <= now && now - migrateGeneratedAt <= MAX_REPORT_AGE_MS;
  const remoteFresh = Number.isFinite(remoteGeneratedAt) &&
    remoteGeneratedAt <= now && now - remoteGeneratedAt <= MAX_REPORT_AGE_MS;
  let providerIdentityValid = true;
  if (remoteVerify.assurance === 'provider_checksum') {
    const remoteIdentityPath = path.join(clientRoot, 'remote-identity-map.json');
    try {
      const remoteIdentityMap = JSON.parse(fs.readFileSync(remoteIdentityPath, 'utf8'));
      providerIdentityValid =
        remoteIdentityMap.schema === 'ClientStorageRemoteIdentityMap/1.0' &&
        remoteIdentityMap.client === clientCode &&
        remoteIdentityMap.provider === resolved.provider &&
        remoteIdentityMap.entry_set_sha256 === entrySetSha256 &&
        Array.isArray(remoteIdentityMap.entries) &&
        remoteIdentityMap.entries.length === state.all.length &&
        remoteVerify.remote_identity_map_sha256 === await sha256File(remoteIdentityPath);
    } catch {
      providerIdentityValid = false;
    }
  }
  let operatorAttestationValid = true;
  if (remoteVerify.assurance === 'operator_attestation') {
    const attestationPath = path.join(clientRoot, 'remote-attestation.json');
    const checked = await validateOneDriveAttestation(
      attestationPath,
      clientCode,
      state,
      { storageMapSha256: storageSha256, report: migrateVerify },
      migrateVerifyPath
    );
    operatorAttestationValid =
      checked.ok &&
      remoteVerify.attestation &&
      remoteVerify.attestation.challenge_sha256 === await sha256File(attestationPath) &&
      remoteVerify.attestation.observed_listing_count === state.all.length &&
      remoteVerify.attestation.sampled_count === checked.attestation.samples.length &&
      remoteVerify.attestation.sync_settled_at === checked.attestation.sync_settled_at;
  }
  const providerMethodValid =
    (
      resolved.provider === 'gdrive' &&
      remoteVerify.truth_domain === 'provider_remote' &&
      remoteVerify.method === 'gdrive_api_md5' &&
      remoteVerify.assurance === 'provider_checksum' &&
      remoteVerify.verified_remote_item_count === state.all.length &&
      remoteVerify.verified_remote_bytes === totalRemoteBytes
    ) ||
    (
      resolved.provider === 'onedrive' &&
      (
        (
          remoteVerify.truth_domain === 'provider_remote' &&
          remoteVerify.method === 'onedrive_graph_quickxor' &&
          remoteVerify.assurance === 'provider_checksum' &&
          remoteVerify.verified_remote_item_count === state.all.length &&
          remoteVerify.verified_remote_bytes === totalRemoteBytes
        ) ||
        (
          remoteVerify.truth_domain === 'provider_remote_operator_attestation' &&
          remoteVerify.method === 'onedrive_web_ui_spot_check' &&
          remoteVerify.assurance === 'operator_attestation' &&
          remoteVerify.attestation &&
          Number.isInteger(remoteVerify.attestation.sampled_count)
        )
      )
    );
  if (
    !storageMap ||
    storageMap.client !== clientCode ||
    !Array.isArray(storageMap.entries) ||
    migrateVerify.client !== clientCode ||
    migrateVerify.snapshot_status !== 'PASS' ||
    migrateVerify.source_currency_status !== 'CURRENT' ||
    migrateVerify.u4_closure_ready !== true ||
    migrateVerify.storage_map_sha256 !== storageSha256 ||
    remoteVerify.client !== clientCode ||
    remoteVerify.schema !== 'ClientStorageRemoteVerify/1.0' ||
    remoteVerify.provider !== resolved.provider ||
    remoteVerify.status !== 'PASS' ||
    remoteVerify.tier !== 0 ||
    remoteVerify.retirement_eligible !== true ||
    !providerMethodValid ||
    remoteVerify.storage_map_sha256 !== storageSha256 ||
    remoteVerify.migration_report_sha256 !== migrationReportSha256 ||
    remoteVerify.classify_report_sha256 !== migrateVerify.classify_report_sha256 ||
    remoteVerify.expected_remote_item_count !==
      storageMap.entries.length + (storageMap.preserved_snapshots || []).length ||
    remoteVerify.active_entry_count !== storageMap.entries.length ||
    remoteVerify.preserved_snapshot_count !== (storageMap.preserved_snapshots || []).length ||
    remoteVerify.active_bytes !== storageMap.entries.reduce((sum, entry) => sum + entry.size, 0) ||
    remoteVerify.preserved_snapshot_bytes !==
      (storageMap.preserved_snapshots || []).reduce((sum, entry) => sum + entry.size, 0) ||
    remoteVerify.mismatch_count !== 0 ||
    remoteVerify.entry_set_sha256 !== entrySetSha256 ||
    !providerIdentityValid ||
    !operatorAttestationValid ||
    !migrationFresh ||
    !remoteFresh
  ) {
    return {
      ok: false,
      code: EXIT_CODES.PREFLIGHT_FAILED,
      reason: 'retirement reports do not exactly authorize the current storage-map state'
    };
  }
  const privateMap = loadPiiPathMap(clientCode);
  const privateMapPath = path.join(clientRoot, 'pii-path-map.json');
  const originalPrivateBytes = fs.readFileSync(privateMapPath);
  const privateById = new Map(
    [
      ...((privateMap && privateMap.entries) || []),
      ...((privateMap && privateMap.retained_entries) || [])
    ].map((entry) => [entry.pii_id, entry])
  );
  const items = [];
  const localTargets = new Set();
  for (let index = 0; index < storageMap.entries.length; index += 1) {
    const entry = storageMap.entries[index];
    if (entry.local_deleted_at) continue;
    const locator = entry.pii_id ? privateById.get(entry.pii_id) : null;
    const relPath = entry.pii_id ? locator && locator.repo_relpath : entry.repo_relpath;
    if (!relPath) {
      return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'an active retirement identity has no private locator' };
    }
    let absPath;
    try {
      absPath = assertUnderRoot(path.join(clientRoot, relPath), clientRoot);
    } catch {
      return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'a retirement source escapes the client root' };
    }
    const pendingMissing = Boolean(entry.retirement_pending_at) && !fs.existsSync(absPath);
    if (!pendingMissing) {
      if (
        !fs.existsSync(absPath) ||
        !fs.lstatSync(absPath).isFile() ||
        fs.lstatSync(absPath).isSymbolicLink() ||
        fs.statSync(absPath).size !== entry.size ||
        await sha256File(absPath) !== entry.sha256
      ) {
        return {
          ok: false,
          code: EXIT_CODES.CLASSIFY_DRIFT,
          reason: 'a local source changed after deletion authorization; retirement halted'
        };
      }
    }
    if (localTargets.has(absPath)) {
      return { ok: false, code: EXIT_CODES.TARGET_COLLISION, reason: 'retirement contains duplicate local targets' };
    }
    localTargets.add(absPath);
    const repoRelPath = path.relative(REPO_ROOT, absPath);
    if (repoRelPath.startsWith('..' + path.sep) || path.isAbsolute(repoRelPath)) {
      return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'retirement source is outside the repository' };
    }
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', repoRelPath], {
      cwd: REPO_ROOT,
      stdio: 'ignore'
    }).status === 0;
    if (tracked) {
      const dirty = spawnSync('git', ['status', '--porcelain', '--', repoRelPath], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
      });
      if (dirty.status !== 0 || dirty.stdout.trim()) {
        return { ok: false, code: EXIT_CODES.CLASSIFY_DRIFT, reason: 'a tracked retirement source is dirty' };
      }
    }
    items.push({ index, entry, relPath, repoRelPath, absPath, isPii: Boolean(entry.pii_id), pendingMissing, tracked });
  }
  return {
    ok: true,
    clientRoot,
    storageMapPath,
    storageMap,
    originalStorageBytes,
    privateMap,
    privateMapPath,
    originalPrivateBytes,
    storageSha256,
    items,
    migrateVerifyPath,
    remoteVerifyPath,
    entrySetSha256
  };
}

function acquireLock(clientRoot) {
  const lockPath = path.join(clientRoot, '.storage-map.lock');
  let fd;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, `${process.pid}\n`);
      break;
    } catch {
      if (attempt > 0) {
        return { ok: false, reason: 'storage-map mutation lock is already held' };
      }
      let stale = false;
      try {
        const pid = Number(fs.readFileSync(lockPath, 'utf8').trim());
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
          } catch (error) {
            stale = error && error.code === 'ESRCH';
          }
        }
      } catch {
        stale = false;
      }
      if (!stale) {
        return { ok: false, reason: 'storage-map mutation lock is already held' };
      }
      try {
        fs.unlinkSync(lockPath);
      } catch {
        return { ok: false, reason: 'stale storage-map lock could not be recovered' };
      }
    }
  }
  return {
    ok: true,
    release() {
      try { fs.closeSync(fd); } catch { /* already closed */ }
      try { fs.unlinkSync(lockPath); } catch { /* fail closed on next run */ }
    }
  };
}

function hashBuffer(value) {
  return require('crypto').createHash('sha256').update(value).digest('hex');
}

function buildRetiredControls(storageMapBytes, privateMapBytes, journal) {
  const nextStorageMap = JSON.parse(storageMapBytes.toString('utf8'));
  const nextPrivateMap = JSON.parse(privateMapBytes.toString('utf8'));
  const retiredIds = new Set();
  let totalBytes = 0;
  for (const entry of journal.entries) {
    const manifestEntry = nextStorageMap.entries[entry.index];
    manifestEntry.local_deleted_at = journal.retired_at;
    totalBytes += manifestEntry.size;
    if (manifestEntry.pii_id) retiredIds.add(manifestEntry.pii_id);
  }
  const record = {
    retirement_id: journal.retirement_id,
    local_deleted_at: journal.retired_at,
    migration_report_sha256: journal.migration_report_sha256,
    remote_report_sha256: journal.remote_report_sha256,
    storage_map_before_sha256: journal.storage_map_before_sha256,
    entry_set_sha256: journal.entry_set_sha256,
    entry_count: journal.entries.length,
    total_bytes: totalBytes,
    status: 'PASS'
  };
  nextStorageMap.retirement_records = [...(nextStorageMap.retirement_records || []), record];
  const retiringPrivate = (nextPrivateMap.entries || []).filter((entry) => retiredIds.has(entry.pii_id));
  nextPrivateMap.entries = (nextPrivateMap.entries || []).filter((entry) => !retiredIds.has(entry.pii_id));
  nextPrivateMap.retired_entries = [
    ...(nextPrivateMap.retired_entries || []),
    ...retiringPrivate.map((entry) => ({
      pii_id: entry.pii_id,
      size: entry.size,
      sha256: entry.sha256,
      private_remote_relpath: entry.repo_relpath,
      retired_at: journal.retired_at
    }))
  ];
  return {
    storageMap: nextStorageMap,
    privateMap: nextPrivateMap,
    storageBytes: Buffer.from(JSON.stringify(nextStorageMap, null, 2) + '\n'),
    privateBytes: Buffer.from(JSON.stringify(nextPrivateMap, null, 2) + '\n'),
    record
  };
}

function retirementReportMarkdown(report) {
  return [
    `# local retirement: ${report.client}`,
    '',
    `Generated: ${report.generated_at}`,
    `Status: ${report.status}`,
    `Files deleted: ${report.files_deleted}`,
    `Bytes deleted: ${report.bytes_deleted}`,
    'Preserved snapshots deleted: 0',
    ''
  ].join('\n');
}

function publishRetirementReport(journal) {
  const jsonPath = assertUnderRoot(path.join(REPO_ROOT, journal.report_json_relpath), ensureReportsDir());
  const mdPath = assertUnderRoot(path.join(REPO_ROOT, journal.report_md_relpath), ensureReportsDir());
  const jsonText = JSON.stringify(journal.public_report, null, 2) + '\n';
  const mdText = retirementReportMarkdown(journal.public_report);
  writeAtomic(jsonPath, jsonText);
  writeAtomic(mdPath, mdText);
  if (
    hashBuffer(fs.readFileSync(jsonPath)) !== hashBuffer(Buffer.from(jsonText)) ||
    hashBuffer(fs.readFileSync(mdPath)) !== hashBuffer(Buffer.from(mdText))
  ) {
    throw new Error('retirement report publication did not verify');
  }
  return { jsonPath, mdPath };
}

async function validateRetirementTopology(journal, storageMap, clientRoot, stagingRoot, mode) {
  const actualStageNames = new Set(
    fs.existsSync(stagingRoot) ? fs.readdirSync(stagingRoot) : []
  );
  const expectedStageNames = new Set();
  for (const entry of journal.entries) {
    const original = path.join(REPO_ROOT, entry.repo_relpath);
    const staged = path.join(stagingRoot, entry.stage_id);
    const liveExists = fs.existsSync(original);
    const stagedExists = fs.existsSync(staged);
    const manifestEntry = storageMap.entries[entry.index];
    if (stagedExists) expectedStageNames.add(entry.stage_id);
    if (mode === 'staged' && (liveExists || !stagedExists)) {
      throw new Error('retirement topology is not fully staged');
    }
    if (mode === 'rollback' && liveExists === stagedExists) {
      throw new Error('retirement rollback topology is ambiguous');
    }
    if (mode === 'published') {
      if (liveExists) throw new Error('published retirement has an unexpected live source');
      if (entry.phase === 'complete' && stagedExists) {
        throw new Error('completed retirement entry still has staged content');
      }
      if (entry.phase === 'staged' && !stagedExists) {
        throw new Error('published retirement is missing unexplained staged content');
      }
    }
    if (stagedExists) {
      const bound = await hashBoundPath(staged);
      if (
        !bound.stable ||
        !bound.pathBound ||
        bound.stat.size !== manifestEntry.size ||
        bound.sha256 !== manifestEntry.sha256
      ) {
        throw new Error('staged retirement content changed after authorization');
      }
    } else if (mode === 'staged') {
      throw new Error('staged retirement content is missing');
    }
  }
  if (
    actualStageNames.size !== expectedStageNames.size ||
    [...actualStageNames].some((name) => !expectedStageNames.has(name))
  ) {
    throw new Error('retirement staging contains unexplained residue');
  }
}

async function executeRetirement(plan) {
  const lock = acquireLock(plan.clientRoot);
  if (!lock.ok) return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: lock.reason };
  const journalPath = path.join(plan.clientRoot, 'retirement-journal.json');
  const stagingRoot = path.join(plan.clientRoot, '.retirement-staging');
  const retirementId = require('crypto').randomUUID();
  const retiredAt = new Date().toISOString();
  const reportStamp = nowUtcStamp();
  const reportDir = CLIENT_STORAGE_REPORTS_DIR;
  const journal = {
    schema: 'ClientStorageRetirementJournal/1.0',
    client: plan.storageMap.client,
    retirement_id: retirementId,
    retired_at: retiredAt,
    report_stamp: reportStamp,
    phase: 'planned',
    storage_map_before_sha256: plan.storageSha256,
    storage_map_before_base64: plan.originalStorageBytes.toString('base64'),
    private_map_before_sha256: hashBuffer(plan.originalPrivateBytes),
    private_map_before_base64: plan.originalPrivateBytes.toString('base64'),
    migration_report_sha256: await sha256File(plan.migrateVerifyPath),
    remote_report_sha256: await sha256File(plan.remoteVerifyPath),
    entry_set_sha256: plan.entrySetSha256,
    entries: plan.items.map((item) => ({
      index: item.index,
      private_repo_relpath: item.relPath,
      repo_relpath: item.repoRelPath,
      stage_id: require('crypto').randomUUID(),
      tracked: item.tracked,
      phase: 'planned'
    }))
  };
  const preparedControls = buildRetiredControls(
    plan.originalStorageBytes,
    plan.originalPrivateBytes,
    journal
  );
  journal.storage_map_after_sha256 = hashBuffer(preparedControls.storageBytes);
  journal.private_map_after_sha256 = hashBuffer(preparedControls.privateBytes);
  journal.report_json_relpath = path.relative(
    REPO_ROOT,
    path.join(reportDir, `${plan.storageMap.client}__retirement__${reportStamp}.json`)
  );
  journal.report_md_relpath = path.relative(
    REPO_ROOT,
    path.join(reportDir, `${plan.storageMap.client}__retirement__${reportStamp}.md`)
  );
  journal.public_report = {
    schema: 'ClientStorageRetirement/1.0',
    client: plan.storageMap.client,
    generated_at: retiredAt,
    status: 'PASS',
    approved: true,
    files_deleted: plan.items.length,
    bytes_deleted: preparedControls.record.total_bytes,
    tracked_index_entries_removed: journal.entries.filter((entry) => entry.tracked).length,
    storage_map_before_sha256: journal.storage_map_before_sha256,
    storage_map_after_sha256: journal.storage_map_after_sha256,
    migrate_verify_report_sha256: journal.migration_report_sha256,
    remote_verify_report_sha256: journal.remote_report_sha256,
    entry_set_sha256: journal.entry_set_sha256,
    preserved_snapshots_deleted: 0,
    pii_paths_reported: 0
  };
  function maybeCrash(phase) {
    if (
      process.env.NODE_ENV === 'test' &&
      process.env.CLIENT_STORAGE_TEST_CRASH_PHASE === phase
    ) {
      process.exit(91);
    }
  }
  let operation = 'initial-validation';
  function writeJournal() {
    writeAtomic(journalPath, JSON.stringify(journal, null, 2) + '\n');
  }
  async function restorePrecommit() {
    await validateRetirementTopology(
      journal,
      plan.storageMap,
      plan.clientRoot,
      stagingRoot,
      'rollback'
    );
    for (const entry of journal.entries) {
      const original = path.join(REPO_ROOT, entry.repo_relpath);
      const staged = path.join(stagingRoot, entry.stage_id);
      if (fs.existsSync(staged) && !fs.existsSync(original)) {
        fs.linkSync(staged, original);
        fs.unlinkSync(staged);
      }
    }
    const tracked = journal.entries.filter((entry) => entry.tracked).map((entry) => entry.repo_relpath);
    if (tracked.length > 0) {
      const restored = spawnSync('git', ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], {
        cwd: REPO_ROOT,
        input: Buffer.from(`${tracked.join('\0')}\0`),
        stdio: ['pipe', 'ignore', 'ignore']
      });
      if (restored.status !== 0) throw new Error('Git index restoration failed');
    }
    writeAtomic(plan.privateMapPath, plan.originalPrivateBytes.toString('utf8'));
    writeAtomic(plan.storageMapPath, plan.originalStorageBytes.toString('utf8'));
    try { fs.rmdirSync(stagingRoot); } catch { /* nonempty means recovery must remain visible */ }
    if (fs.existsSync(stagingRoot)) throw new Error('staging restoration is incomplete');
    try { fs.unlinkSync(journalPath); } catch { /* fail closed on next run */ }
  }
  try {
    if (
      fs.existsSync(journalPath) ||
      !fs.readFileSync(plan.storageMapPath).equals(plan.originalStorageBytes) ||
      !fs.readFileSync(plan.privateMapPath).equals(plan.originalPrivateBytes)
    ) {
      return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'storage-map changed before retirement lock acquisition' };
    }
    const realClientRoot = fs.realpathSync(plan.clientRoot);
    for (const item of plan.items) {
      if (item.pendingMissing) {
        return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'pending retirement requires journal recovery' };
      }
      const realPath = fs.realpathSync(item.absPath);
      if (
        assertUnderRoot(realPath, realClientRoot) !== realPath ||
        !fs.lstatSync(item.absPath).isFile() ||
        fs.lstatSync(item.absPath).isSymbolicLink() ||
        fs.statSync(item.absPath).size !== item.entry.size ||
        await sha256File(item.absPath) !== item.entry.sha256
      ) {
        return { ok: false, code: EXIT_CODES.CLASSIFY_DRIFT, reason: 'source changed before the destructive operation' };
      }
      const dirty = item.tracked && spawnSync(
        'git',
        ['status', '--porcelain', '--', item.repoRelPath],
        { cwd: REPO_ROOT, encoding: 'utf8' }
      );
      if (dirty && (dirty.status !== 0 || dirty.stdout.trim())) {
        return { ok: false, code: EXIT_CODES.CLASSIFY_DRIFT, reason: 'tracked source changed before the destructive operation' };
      }
    }

    operation = 'create-staging';
    fs.mkdirSync(stagingRoot, { recursive: false });
    operation = 'write-initial-journal';
    writeJournal();
    maybeCrash('after-journal');
    const tracked = journal.entries.filter((entry) => entry.tracked).map((entry) => entry.repo_relpath);
    if (tracked.length > 0) {
      const removed = spawnSync(
        'git',
        ['rm', '--cached', '--ignore-unmatch', '--pathspec-from-file=-', '--pathspec-file-nul'],
        {
          cwd: REPO_ROOT,
          input: Buffer.from(`${tracked.join('\0')}\0`),
          stdio: ['pipe', 'ignore', 'ignore']
        }
      );
      if (removed.status !== 0) {
        await restorePrecommit();
        return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'tracked sources could not be removed from the index' };
      }
    }
    maybeCrash('after-index-removal');

    for (const entry of journal.entries) {
      operation = 'stage-source';
      const original = path.join(REPO_ROOT, entry.repo_relpath);
      const staged = path.join(stagingRoot, entry.stage_id);
      const planItem = plan.items.find((item) => item.index === entry.index);
      const expectedIndexRemoval = entry.tracked && spawnSync(
        'git',
        ['diff', '--cached', '--diff-filter=D', '--name-only', '-z', '--', entry.repo_relpath],
        { cwd: REPO_ROOT }
      );
      if (
        assertUnderRoot(fs.realpathSync(original), fs.realpathSync(plan.clientRoot)) !== fs.realpathSync(original) ||
        !fs.lstatSync(original).isFile() ||
        fs.lstatSync(original).isSymbolicLink() ||
        fs.statSync(original).size !== planItem.entry.size ||
        (
          expectedIndexRemoval &&
          (
            expectedIndexRemoval.status !== 0 ||
            !expectedIndexRemoval.stdout.equals(Buffer.from(`${entry.repo_relpath}\0`))
          )
        )
      ) {
        throw new Error('source changed immediately before staging');
      }
      const before = fs.lstatSync(original, { bigint: true });
      fs.renameSync(original, staged);
      const bound = await hashBoundPath(staged);
      if (
        fs.existsSync(original) ||
        !bound.stable ||
        !bound.pathBound ||
        before.dev.toString() !== bound.stat.dev ||
        before.ino.toString() !== bound.stat.ino ||
        bound.stat.size !== planItem.entry.size ||
        bound.sha256 !== planItem.entry.sha256
      ) {
        throw new Error('staged source does not match the deletion-authorized inode');
      }
      entry.phase = 'staged';
      operation = 'checkpoint-staged-source';
      writeJournal();
    }
    journal.phase = 'staged';
    writeJournal();
    maybeCrash('after-staging');
    if (
      process.env.NODE_ENV === 'test' &&
      process.env.CLIENT_STORAGE_TEST_RECREATE_BEFORE_PUBLICATION
    ) {
      const first = journal.entries[0];
      fs.writeFileSync(
        path.join(REPO_ROOT, first.repo_relpath),
        process.env.CLIENT_STORAGE_TEST_RECREATE_BEFORE_PUBLICATION
      );
    }

    operation = 'validate-complete-staging';
    await validateRetirementTopology(journal, plan.storageMap, plan.clientRoot, stagingRoot, 'staged');
    const nextStorageMap = preparedControls.storageMap;
    const nextStorageBytes = preparedControls.storageBytes;
    const nextPrivateBytes = preparedControls.privateBytes;
    journal.phase = 'publishing';
    writeJournal();
    try {
      writeAtomic(plan.privateMapPath, nextPrivateBytes.toString('utf8'));
      maybeCrash('after-private-map');
      writeAtomic(plan.storageMapPath, nextStorageBytes.toString('utf8'));
      maybeCrash('after-storage-map');
    } catch (error) {
      await restorePrecommit();
      return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: `retirement publication rolled back (${error && error.code || 'WRITE_ERROR'})` };
    }
    operation = 'revalidate-before-report';
    await validateRetirementTopology(journal, plan.storageMap, plan.clientRoot, stagingRoot, 'staged');
    operation = 'publish-retirement-report';
    publishRetirementReport(journal);
    maybeCrash('after-report-publication');
    journal.phase = 'published';
    writeJournal();
    maybeCrash('after-published-journal');
    operation = 'revalidate-before-cleanup';
    await validateRetirementTopology(journal, plan.storageMap, plan.clientRoot, stagingRoot, 'published');
    for (const entry of journal.entries) {
      const staged = path.join(stagingRoot, entry.stage_id);
      const manifestEntry = plan.storageMap.entries[entry.index];
      const bound = await hashBoundPath(staged);
      if (
        !bound.stable ||
        !bound.pathBound ||
        bound.stat.size !== manifestEntry.size ||
        bound.sha256 !== manifestEntry.sha256
      ) {
        throw new Error('staged retirement content changed immediately before cleanup');
      }
      entry.phase = 'deleting';
      writeJournal();
      fs.unlinkSync(staged);
      entry.phase = 'complete';
      writeJournal();
      maybeCrash('during-cleanup');
    }
    fs.rmdirSync(stagingRoot);
    fs.unlinkSync(journalPath);
    plan.storageMap = nextStorageMap;
    return {
      ok: true,
      deleted: plan.items.length,
      deletedBytes: preparedControls.record.total_bytes,
      trackedRemoved: tracked.length,
      afterBytes: nextStorageBytes,
      retirementId,
      reportJsonPath: path.join(REPO_ROOT, journal.report_json_relpath),
      reportMdPath: path.join(REPO_ROOT, journal.report_md_relpath)
    };
  } catch (error) {
    if (journal.phase !== 'published') {
      try {
        for (const relPath of [journal.report_json_relpath, journal.report_md_relpath]) {
          const reportPath = path.join(REPO_ROOT, relPath);
          try { fs.unlinkSync(reportPath); } catch { /* absent or retained for journal recovery */ }
        }
        await restorePrecommit();
      } catch {
        /* journal remains if restoration is incomplete */
      }
    }
    return {
      ok: false,
      code: EXIT_CODES.TARGET_CONFLICT,
      reason: `retirement transaction requires recovery during ${operation} at ${journal.phase} (${error && error.code || 'LOCAL_ERROR'})`
    };
  } finally {
    lock.release();
  }
}

function validateRetirementJournal(journal, clientCode, clientRoot) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const sha = /^[a-f0-9]{64}$/;
  const phases = new Set(['planned', 'staged', 'publishing', 'published']);
  const entryPhases = new Set(['planned', 'staged', 'deleting', 'complete']);
  const validBase64 = (value) =>
    typeof value === 'string' &&
    Buffer.from(value, 'base64').toString('base64') === value;
  if (
    !journal ||
    journal.schema !== 'ClientStorageRetirementJournal/1.0' ||
    journal.client !== clientCode ||
    !uuid.test(journal.retirement_id || '') ||
    !Number.isFinite(Date.parse(journal.retired_at)) ||
    !/^[0-9TZ-]+$/.test(journal.report_stamp || '') ||
    !phases.has(journal.phase) ||
    !sha.test(journal.storage_map_before_sha256 || '') ||
    !sha.test(journal.private_map_before_sha256 || '') ||
    !sha.test(journal.storage_map_after_sha256 || '') ||
    !sha.test(journal.private_map_after_sha256 || '') ||
    !sha.test(journal.migration_report_sha256 || '') ||
    !sha.test(journal.remote_report_sha256 || '') ||
    !sha.test(journal.entry_set_sha256 || '') ||
    !validBase64(journal.storage_map_before_base64) ||
    !validBase64(journal.private_map_before_base64) ||
    !Array.isArray(journal.entries) ||
    journal.entries.length === 0
  ) {
    throw new Error('retirement journal identity or evidence is invalid');
  }
  const storageBytes = Buffer.from(journal.storage_map_before_base64, 'base64');
  const privateBytes = Buffer.from(journal.private_map_before_base64, 'base64');
  if (
    hashBuffer(storageBytes) !== journal.storage_map_before_sha256 ||
    hashBuffer(privateBytes) !== journal.private_map_before_sha256
  ) {
    throw new Error('retirement journal before-state hashes are invalid');
  }
  const storageMap = JSON.parse(storageBytes.toString('utf8'));
  const privateMap = JSON.parse(privateBytes.toString('utf8'));
  if (
    storageMap.client !== clientCode ||
    !Array.isArray(storageMap.entries) ||
    privateMap.schema !== 'ClientStoragePiiPathMap/1.0' ||
    privateMap.client !== clientCode ||
    !Array.isArray(privateMap.entries)
  ) {
    throw new Error('retirement journal decoded controls are invalid');
  }
  const privateById = new Map(privateMap.entries.map((entry) => [entry.pii_id, entry]));
  const expectedIndexes = storageMap.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.local_deleted_at == null)
    .map(({ index }) => index);
  if (expectedIndexes.length !== journal.entries.length) {
    throw new Error('retirement journal entry coverage is incomplete');
  }
  const seenIndexes = new Set();
  const seenStages = new Set();
  const seenPaths = new Set();
  for (const entry of journal.entries) {
    if (
      !entry ||
      !Number.isInteger(entry.index) ||
      !expectedIndexes.includes(entry.index) ||
      seenIndexes.has(entry.index) ||
      !uuid.test(entry.stage_id || '') ||
      seenStages.has(entry.stage_id) ||
      typeof entry.tracked !== 'boolean' ||
      !entryPhases.has(entry.phase)
    ) {
      throw new Error('retirement journal contains an invalid or duplicate entry');
    }
    const manifestEntry = storageMap.entries[entry.index];
    const locator = manifestEntry.pii_id ? privateById.get(manifestEntry.pii_id) : null;
    const localRelPath = manifestEntry.pii_id ? locator && locator.repo_relpath : manifestEntry.repo_relpath;
    if (!localRelPath || entry.private_repo_relpath !== localRelPath) {
      throw new Error('retirement journal private locator does not match the decoded controls');
    }
    const expectedAbs = assertUnderRoot(path.join(clientRoot, localRelPath), clientRoot);
    const expectedRepoRel = path.relative(REPO_ROOT, expectedAbs);
    if (
      entry.repo_relpath !== expectedRepoRel ||
      path.isAbsolute(entry.repo_relpath) ||
      entry.repo_relpath.startsWith('..' + path.sep) ||
      seenPaths.has(entry.repo_relpath)
    ) {
      throw new Error('retirement journal source path is outside its exact client scope');
    }
    seenIndexes.add(entry.index);
    seenStages.add(entry.stage_id);
    seenPaths.add(entry.repo_relpath);
  }
  const prepared = buildRetiredControls(storageBytes, privateBytes, journal);
  if (
    hashBuffer(prepared.storageBytes) !== journal.storage_map_after_sha256 ||
    hashBuffer(prepared.privateBytes) !== journal.private_map_after_sha256
  ) {
    throw new Error('retirement journal after-state hashes are invalid');
  }
  const reportDir = CLIENT_STORAGE_REPORTS_DIR;
  const expectedJsonPath = path.join(reportDir, `${clientCode}__retirement__${journal.report_stamp}.json`);
  const expectedMdPath = path.join(reportDir, `${clientCode}__retirement__${journal.report_stamp}.md`);
  if (
    journal.report_json_relpath !== path.relative(REPO_ROOT, expectedJsonPath) ||
    journal.report_md_relpath !== path.relative(REPO_ROOT, expectedMdPath)
  ) {
    throw new Error('retirement journal report paths are invalid');
  }
  const expectedReport = {
    schema: 'ClientStorageRetirement/1.0',
    client: clientCode,
    generated_at: journal.retired_at,
    status: 'PASS',
    approved: true,
    files_deleted: journal.entries.length,
    bytes_deleted: prepared.record.total_bytes,
    tracked_index_entries_removed: journal.entries.filter((entry) => entry.tracked).length,
    storage_map_before_sha256: journal.storage_map_before_sha256,
    storage_map_after_sha256: journal.storage_map_after_sha256,
    migrate_verify_report_sha256: journal.migration_report_sha256,
    remote_verify_report_sha256: journal.remote_report_sha256,
    entry_set_sha256: journal.entry_set_sha256,
    preserved_snapshots_deleted: 0,
    pii_paths_reported: 0
  };
  if (JSON.stringify(journal.public_report) !== JSON.stringify(expectedReport)) {
    throw new Error('retirement journal public report payload is invalid');
  }
  return { storageBytes, privateBytes, storageMap, privateMap, prepared };
}

async function recoverRetirementJournal(clientCode) {
  const clientRoot = clientRootPath(clientCode);
  const journalPath = path.join(clientRoot, 'retirement-journal.json');
  if (!fs.existsSync(journalPath)) return { ok: true, recovered: false };
  const lock = acquireLock(clientRoot);
  if (!lock.ok) return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: lock.reason };
  try {
    const journal = loadJson(journalPath, 'retirement journal');
    const validated = validateRetirementJournal(journal, clientCode, clientRoot);
    const storageMapPath = path.join(clientRoot, 'storage-map.json');
    const privateMapPath = path.join(clientRoot, 'pii-path-map.json');
    const storageBytes = fs.readFileSync(storageMapPath);
    const privateBytes = fs.readFileSync(privateMapPath);
    const published =
      hashBuffer(storageBytes) === journal.storage_map_after_sha256 &&
      hashBuffer(privateBytes) === journal.private_map_after_sha256;
    const stagingRoot = path.join(clientRoot, '.retirement-staging');
    if (published) {
      await validateRetirementTopology(
        journal,
        validated.storageMap,
        clientRoot,
        stagingRoot,
        'published'
      );
      publishRetirementReport(journal);
      for (const entry of journal.entries) {
        const original = path.join(REPO_ROOT, entry.repo_relpath);
        const staged = path.join(stagingRoot, entry.stage_id);
        if (fs.existsSync(staged)) {
          const manifestEntry = validated.storageMap.entries[entry.index];
          const bound = await hashBoundPath(staged);
          if (
            !bound.stable ||
            !bound.pathBound ||
            bound.stat.size !== manifestEntry.size ||
            bound.sha256 !== manifestEntry.sha256
          ) {
            return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'published staged content changed before recovery cleanup' };
          }
          fs.unlinkSync(staged);
        }
      }
      try { fs.rmdirSync(stagingRoot); } catch { /* fail below if residue remains */ }
      if (fs.existsSync(stagingRoot)) {
        return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'retirement staging contains unexplained residue' };
      }
      fs.unlinkSync(journalPath);
      return {
        ok: true,
        recovered: true,
        completed: true,
        retirementId: journal.retirement_id,
        reportJsonPath: path.join(REPO_ROOT, journal.report_json_relpath)
      };
    }

    const currentStorageHash = hashBuffer(storageBytes);
    const currentPrivateHash = hashBuffer(privateBytes);
    const allowedStorageHashes = new Set([
      journal.storage_map_before_sha256,
      journal.storage_map_after_sha256
    ]);
    const allowedPrivateHashes = new Set([
      journal.private_map_before_sha256,
      journal.private_map_after_sha256
    ]);
    if (!allowedStorageHashes.has(currentStorageHash) || !allowedPrivateHashes.has(currentPrivateHash)) {
      return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'retirement controls do not match a recoverable journal state' };
    }
    await validateRetirementTopology(
      journal,
      validated.storageMap,
      clientRoot,
      stagingRoot,
      'rollback'
    );
    for (const entry of journal.entries) {
      const original = path.join(REPO_ROOT, entry.repo_relpath);
      const staged = path.join(stagingRoot, entry.stage_id);
      if (fs.existsSync(staged)) {
        fs.linkSync(staged, original);
        fs.unlinkSync(staged);
      }
    }
    writeAtomic(storageMapPath, validated.storageBytes.toString('utf8'));
    writeAtomic(privateMapPath, validated.privateBytes.toString('utf8'));
    const tracked = journal.entries.filter((entry) => entry.tracked).map((entry) => entry.repo_relpath);
    if (tracked.length > 0) {
      const restored = spawnSync('git', ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], {
        cwd: REPO_ROOT,
        input: Buffer.from(`${tracked.join('\0')}\0`),
        stdio: ['pipe', 'ignore', 'ignore']
      });
      if (restored.status !== 0) {
        return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'retirement rollback could not restore the Git index' };
      }
    }
    try { fs.rmdirSync(stagingRoot); } catch { /* residue checked below */ }
    if (fs.existsSync(stagingRoot)) {
      return { ok: false, code: EXIT_CODES.TARGET_CONFLICT, reason: 'retirement rollback left staging residue' };
    }
    fs.unlinkSync(journalPath);
    return { ok: true, recovered: true, completed: false };
  } catch (error) {
    return {
      ok: false,
      code: EXIT_CODES.TARGET_CONFLICT,
      reason: `retirement journal recovery failed (${error && error.code || 'RECOVERY_ERROR'})`
    };
  } finally {
    lock.release();
  }
}

async function main() {
  const args = parseArgs(process.argv, {
    flags: ['approve'],
    valued: ['client', 'migrate-verify-report', 'remote-verify-report']
  });
  if (args.help) {
    process.stdout.write(`retire-local.js -- gated local source retirement

Usage:
  node retire-local.js --client CODE
    --migrate-verify-report FILE --remote-verify-report FILE [--approve]

Without --approve, validates and prints a deletion plan only. --approve is
irreversible and deletes only active MOVE/PII-MOVE local sources. Preserved
human-workflow snapshots are never retirement candidates.
`);
    return;
  }
  if (!args.client || !args['migrate-verify-report'] || !args['remote-verify-report']) {
    fail(EXIT_CODES.USAGE_ERROR, {
      stage: 'retire-local',
      reason: '--client, --migrate-verify-report, and --remote-verify-report are required'
    });
    return;
  }
  const recovery = await recoverRetirementJournal(args.client);
  if (!recovery.ok) {
    fail(recovery.code, { client: args.client, stage: 'retire-local-recovery', reason: recovery.reason });
    return;
  }
  if (recovery.completed) {
    emitStatus({
      ok: true,
      client: args.client,
      recovered_completed_retirement: true,
      retirement_id: recovery.retirementId,
      report_json: recovery.reportJsonPath
        ? path.relative(process.cwd(), recovery.reportJsonPath)
        : undefined
    });
    return;
  }
  const plan = await buildRetirementPlan(
    args.client,
    path.resolve(args['migrate-verify-report']),
    path.resolve(args['remote-verify-report'])
  );
  if (!plan.ok) {
    fail(plan.code, { client: args.client, stage: 'retire-local', reason: plan.reason });
    return;
  }
  if (!args.approve) {
    emitStatus({
      ok: true,
      client: args.client,
      dry_run: true,
      files_to_delete: plan.items.length,
      bytes_to_delete: plan.items.reduce((sum, item) => sum + item.entry.size, 0),
      approval_required: true
    });
    return;
  }
  const result = await executeRetirement(plan);
  if (!result.ok) {
    fail(result.code, { client: args.client, stage: 'retire-local-execute', reason: result.reason });
    return;
  }
  emitStatus({
    ok: true,
    client: args.client,
    files_deleted: result.deleted,
    bytes_deleted: result.deletedBytes,
    report_json: path.relative(process.cwd(), result.reportJsonPath)
  });
}

if (require.main === module) {
  main().catch((error) => {
    fail(EXIT_CODES.USAGE_ERROR, {
      stage: 'retire-local',
      reason: `unexpected retirement failure (${error && error.code || 'UNKNOWN'})`
    });
  });
}

module.exports = {
  buildRetirementPlan,
  executeRetirement,
  recoverRetirementJournal,
  hashBoundPath,
  main
};
