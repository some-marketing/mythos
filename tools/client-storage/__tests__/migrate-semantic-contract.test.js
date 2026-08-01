'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  CLASSIFY_V1_SCHEMA,
  CLASSIFY_V2_SCHEMA,
  validateClassifyReportSemantics
} = require('../lib.js');

const MIGRATE_SCRIPT = path.resolve(__dirname, '..', 'migrate.js');
const SNAPSHOT_SOURCE_SCRIPT = path.resolve(__dirname, '..', 'snapshot-source.js');

function semanticReport(entries) {
  const counts = {};
  const bytes = {};
  const semantic_counts = {};
  const semantic_bytes = {};
  for (const entry of entries) {
    counts[entry.klass] = (counts[entry.klass] || 0) + 1;
    bytes[entry.klass] = (bytes[entry.klass] || 0) + entry.size;
    semantic_counts[entry.semantic_bucket] = (semantic_counts[entry.semantic_bucket] || 0) + 1;
    semantic_bytes[entry.semantic_bucket] = (semantic_bytes[entry.semantic_bucket] || 0) + entry.size;
  }
  return {
    schema: CLASSIFY_V2_SCHEMA,
    client: 'TEST',
    entries,
    counts,
    bytes,
    semantic_counts,
    semantic_bytes,
    total_files: entries.length,
    total_bytes: entries.reduce((sum, entry) => sum + entry.size, 0)
  };
}

test('semantic V2 contract validates complete reports and rejects downgrade shapes', async (t) => {
  const resolved = semanticReport([
    {
      klass: 'KEEP',
      semantic_bucket: 'CORE-METADATA',
      basis: 'inviolable root control metadata',
      relpath: 'client.json',
      size: 1
    },
    {
      klass: 'MOVE',
      semantic_bucket: 'HISTORICAL-REFERENCE',
      basis: 'non-operational reference material',
      relpath: 'reference.txt',
      size: 2
    }
  ]);

  await t.test('complete V2 proceeds and authentic marker-free V1 requires reclassification', () => {
    assert.deepEqual(validateClassifyReportSemantics(resolved), { ok: true, contract: 'semantic-v2' });
    const legacy = validateClassifyReportSemantics({
      schema: CLASSIFY_V1_SCHEMA,
      entries: [{ klass: 'MOVE', relpath: 'reference.txt', size: 2 }]
    });
    assert.equal(legacy.ok, false);
    assert.equal(legacy.code, 'LEGACY_RECLASSIFICATION_REQUIRED');
    assert.match(legacy.reason, /^LEGACY_RECLASSIFICATION_REQUIRED:/);
  });

  await t.test('missing, stripped, malformed, and count-drifted V2 fields reject', () => {
    const cases = [
      { ...resolved, schema: undefined },
      { ...resolved, semantic_counts: undefined },
      { ...resolved, semantic_bytes: undefined },
      { ...resolved, counts: { KEEP: 99, MOVE: 1 } },
      { ...resolved, total_bytes: 999 },
      {
        ...resolved,
        entries: resolved.entries.map((entry, index) => index === 0 ? { ...entry, basis: undefined } : entry)
      },
      {
        ...resolved,
        entries: resolved.entries.map((entry, index) => index === 0 ? { ...entry, semantic_bucket: 'HISTORICAL-REFERENCE' } : entry)
      }
    ];
    for (const report of cases) assert.equal(validateClassifyReportSemantics(report).ok, false);
  });

  await t.test('declaring V1 cannot preserve any V2 marker', () => {
    const downgraded = { ...resolved, schema: CLASSIFY_V1_SCHEMA };
    assert.equal(validateClassifyReportSemantics(downgraded).ok, false);
    const entryMarkerOnly = {
      schema: CLASSIFY_V1_SCHEMA,
      entries: [{ klass: 'MOVE', semantic_bucket: 'HISTORICAL-REFERENCE', relpath: 'reference.txt', size: 2 }]
    };
    assert.equal(validateClassifyReportSemantics(entryMarkerOnly).ok, false);
  });

  await t.test('complete stripping and relabeling of a V2 REVIEW report cannot enter a V1 lane', () => {
    const stripped = {
      schema: CLASSIFY_V1_SCHEMA,
      client: 'TEST',
      generated_at: new Date().toISOString(),
      entries: [{ klass: 'MOVE', relpath: 'ambiguous.html', size: 1 }],
      bytes: { MOVE: 1 }
    };
    const result = validateClassifyReportSemantics(stripped);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'LEGACY_RECLASSIFICATION_REQUIRED');
  });

  await t.test('internally consistent REVIEW remains unresolved and rejects', () => {
    const review = semanticReport([{
      klass: 'REVIEW',
      semantic_bucket: 'REVIEW',
      basis: 'standalone HTML role is ambiguous',
      relpath: 'ambiguous.html',
      size: 1
    }]);
    const result = validateClassifyReportSemantics(review);
    assert.equal(result.ok, false);
    assert.match(result.reason, /unresolved REVIEW/);
  });

  await t.test('DEFERRED-DIRTY semantic REVIEW is valid when class REVIEW is zero', () => {
    const deferred = semanticReport([{
      klass: 'DEFERRED-DIRTY',
      semantic_bucket: 'REVIEW',
      basis: 'working-tree state is dirty or untracked',
      report_id: '77777777-7777-4777-8777-777777777777',
      identity_redacted: true,
      size: 17
    }]);
    assert.deepEqual(validateClassifyReportSemantics(deferred), { ok: true, contract: 'semantic-v2' });
    assert.equal(deferred.counts.REVIEW, undefined);
    assert.equal(deferred.semantic_counts.REVIEW, 1);
  });

  await t.test('class/bucket remapping attacks remain invalid', () => {
    const remapped = semanticReport([{
      klass: 'MOVE',
      semantic_bucket: 'HISTORICAL-REFERENCE',
      basis: 'reference',
      relpath: 'reference.txt',
      size: 1
    }]);
    remapped.entries[0].semantic_bucket = 'REVIEW';
    remapped.semantic_counts = { REVIEW: 1 };
    remapped.semantic_bytes = { REVIEW: 1 };
    assert.equal(validateClassifyReportSemantics(remapped).ok, false);
  });

  await t.test('classification decision binding must match the current decision file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-decision-binding-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const clientRoot = path.join(root, 'clients', 'TEST');
    fs.mkdirSync(clientRoot, { recursive: true });
    const decisions = Buffer.from(JSON.stringify({
      schema: 'ClientStorageClassificationDecisions/1.0',
      client: 'TEST',
      decisions: [{
        relpath: 'reference.txt',
        disposition: 'MOVE',
        semantic_bucket: 'HISTORICAL-REFERENCE',
        rationale: 'operator decision'
      }]
    }));
    fs.writeFileSync(path.join(clientRoot, 'classification-decisions.json'), decisions);
    const bound = structuredClone(resolved);
    bound.classification_decisions_binding = {
      required: true,
      schema: 'ClientStorageClassificationDecisions/1.0',
      client: 'TEST',
      entry_count: 1,
      sha256: require('node:crypto').createHash('sha256').update(decisions).digest('hex')
    };
    assert.deepEqual(
      validateClassifyReportSemantics(bound, { repoRoot: root }),
      { ok: true, contract: 'semantic-v2' }
    );
    bound.classification_decisions_binding.sha256 = '0'.repeat(64);
    assert.equal(validateClassifyReportSemantics(bound, { repoRoot: root }).ok, false);
  });

  await t.test('private ignored-source snapshot is content-bound and cannot authorize drift', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-source-snapshot-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const clientRoot = path.join(root, 'clients', 'CLIENT_BETA');
    fs.mkdirSync(clientRoot, { recursive: true });
    fs.writeFileSync(path.join(clientRoot, 'client.json'), JSON.stringify({
      code: 'CLIENT_BETA',
      client_storage_policy: { private_source_snapshot: { enabled: true } }
    }));
    fs.writeFileSync(path.join(root, '.gitignore'), 'clients/CLIENT_BETA/private.bin\nclients/CLIENT_BETA/source-snapshot.json\n');
    fs.writeFileSync(path.join(clientRoot, 'private.bin'), 'stable private intake');
    const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    const payload = fs.readFileSync(path.join(clientRoot, 'private.bin'));
    const snapshot = Buffer.from(JSON.stringify({
      schema: 'ClientStorageSourceSnapshot/1.0',
      client: 'CLIENT_BETA',
      entries: [{
        relpath: 'private.bin',
        size: payload.length,
        sha256: require('node:crypto').createHash('sha256').update(payload).digest('hex')
      }]
    }));
    fs.writeFileSync(path.join(clientRoot, 'source-snapshot.json'), snapshot);
    const bound = structuredClone(resolved);
    bound.client = 'CLIENT_BETA';
    bound.source_snapshot_binding = {
      required: true,
      schema: 'ClientStorageSourceSnapshot/1.0',
      client: 'CLIENT_BETA',
      entry_count: 1,
      total_bytes: payload.length,
      sha256: require('node:crypto').createHash('sha256').update(snapshot).digest('hex')
    };
    assert.deepEqual(
      validateClassifyReportSemantics(bound, { repoRoot: root }),
      { ok: true, contract: 'semantic-v2' }
    );
    fs.appendFileSync(path.join(clientRoot, 'private.bin'), ' drift');
    assert.equal(validateClassifyReportSemantics(bound, { repoRoot: root }).ok, false);
  });

  await t.test('private ignored-source snapshots are rejected when policy is disabled', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-source-snapshot-scope-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const clientRoot = path.join(root, 'clients', 'CLIENT_PLAIN');
    fs.mkdirSync(clientRoot, { recursive: true });
    fs.writeFileSync(path.join(clientRoot, 'source-snapshot.json'), JSON.stringify({
      schema: 'ClientStorageSourceSnapshot/1.0',
      client: 'CLIENT_PLAIN',
      entries: []
    }));
    const report = structuredClone(resolved);
    report.client = 'CLIENT_PLAIN';
    assert.equal(validateClassifyReportSemantics(report, { repoRoot: root }).ok, false);
  });
});

test('private source snapshot CLI is authorized by generic client policy', async (t) => {
  await t.test('enabled policy snapshots ignored intake without exposing filenames', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-snapshot-enabled-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const client = 'CLIENT_ENABLED';
    const clientRoot = path.join(root, 'clients', client);
    fs.mkdirSync(clientRoot, { recursive: true });
    fs.writeFileSync(path.join(root, '.gitignore'), `clients/${client}/private.bin\nclients/${client}/source-snapshot.json\n`);
    fs.writeFileSync(path.join(clientRoot, 'private.bin'), 'synthetic private intake');
    fs.writeFileSync(path.join(clientRoot, 'client.json'), JSON.stringify({
      code: client,
      client_storage_policy: { private_source_snapshot: { enabled: true } }
    }));
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);

    const result = spawnSync(process.execPath, [
      SNAPSHOT_SOURCE_SCRIPT,
      '--client', client,
      '--approve-private-intake',
      '--execute'
    ], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr.includes('private.bin'), false);
    const snapshot = JSON.parse(fs.readFileSync(path.join(clientRoot, 'source-snapshot.json'), 'utf8'));
    assert.equal(snapshot.client, client);
    assert.equal(snapshot.entries.length, 1);
  });

  await t.test('disabled policy fails closed before creating a snapshot', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-snapshot-disabled-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const client = 'CLIENT_DISABLED';
    const clientRoot = path.join(root, 'clients', client);
    fs.mkdirSync(clientRoot, { recursive: true });
    fs.writeFileSync(path.join(clientRoot, 'client.json'), JSON.stringify({ code: client }));
    const result = spawnSync(process.execPath, [
      SNAPSHOT_SOURCE_SCRIPT,
      '--client', client,
      '--approve-private-intake',
      '--execute'
    ], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /not enabled by client storage policy/);
    assert.equal(fs.existsSync(path.join(clientRoot, 'source-snapshot.json')), false);
  });
});

test('migrate CLI rejects malformed V2 before resolving a missing mount or mutating a manifest', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-semantic-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const clientRoot = path.join(repo, 'clients', 'TEST');
  const missingMount = path.join(home, 'Library', 'CloudStorage', 'OneDrive-Test', 'TEST');
  fs.mkdirSync(clientRoot, { recursive: true });
  fs.writeFileSync(
    path.join(clientRoot, 'client.json'),
    JSON.stringify({ code: 'TEST', file_storage: { provider: 'onedrive', mounted_path: missingMount } })
  );
  const report = semanticReport([{
    klass: 'MOVE',
    semantic_bucket: 'HISTORICAL-REFERENCE',
    basis: 'non-operational reference material',
    relpath: 'reference.txt',
    size: 1
  }]);
  delete report.semantic_counts;
  const reportPath = path.join(root, 'classify.json');
  fs.writeFileSync(reportPath, JSON.stringify(report));

  const result = spawnSync(process.execPath, [
    MIGRATE_SCRIPT,
    '--client', 'TEST',
    '--classify-report', reportPath
  ], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: repo }
  });
  assert.equal(result.status, 20, result.stderr);
  assert.match(result.stderr, /classification-review/);
  assert.match(result.stderr, /counts|semantic/i);
  assert.equal(fs.existsSync(missingMount), false);
  assert.equal(fs.existsSync(path.join(clientRoot, 'storage-map.json')), false);
});

test('migrate CLI rejects fully stripped V1 downgrade before mount or manifest writes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-v1-reject-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const clientRoot = path.join(repo, 'clients', 'TEST');
  const missingMount = path.join(home, 'Library', 'CloudStorage', 'OneDrive-Test', 'TEST');
  fs.mkdirSync(clientRoot, { recursive: true });
  fs.writeFileSync(
    path.join(clientRoot, 'client.json'),
    JSON.stringify({ code: 'TEST', file_storage: { provider: 'onedrive', mounted_path: missingMount } })
  );
  const reportPath = path.join(root, 'classify-v1.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    schema: CLASSIFY_V1_SCHEMA,
    client: 'TEST',
    entries: [{ klass: 'MOVE', relpath: 'ambiguous.html', size: 1 }],
    bytes: { MOVE: 1 }
  }));

  const result = spawnSync(process.execPath, [
    MIGRATE_SCRIPT,
    '--client', 'TEST',
    '--classify-report', reportPath
  ], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: repo }
  });
  assert.equal(result.status, 20, result.stderr);
  assert.match(result.stderr, /LEGACY_RECLASSIFICATION_REQUIRED/);
  assert.equal(fs.existsSync(missingMount), false);
  assert.equal(fs.existsSync(path.join(clientRoot, 'storage-map.json')), false);
});
