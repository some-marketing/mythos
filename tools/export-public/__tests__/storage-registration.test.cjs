#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { exportFramework, globToRegex, walk } = require('../export-public.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const mapPath = path.join(repoRoot, 'tools', 'export-public', 'config', 'mythos-export-map.json');
const denylistPath = path.join(repoRoot, 'tools', 'export-public', 'config', 'denylist-mythos.json');
const exportMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const denylist = JSON.parse(fs.readFileSync(denylistPath, 'utf8'));

for (const [declarationKind, declarations] of [
  ['framework', exportMap.frameworks || {}],
  ['unit', exportMap.units || {}]
]) {
  for (const [declarationId, declaration] of Object.entries(declarations)) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, declaration.source)),
      `${declarationKind} ${declarationId} declares a missing source: ${declaration.source}`
    );
    assert.ok(
      fs.existsSync(path.join(repoRoot, declaration.target)),
      `${declarationKind} ${declarationId} declares a missing target: ${declaration.target}`
    );
  }
}

function matches(relPath, globs) {
  return (globs || []).filter((glob) => globToRegex(glob).test(relPath));
}

function decisionsFor(unit, relPath) {
  const exports = matches(relPath, unit.files.export);
  const excludes = matches(relPath, unit.files.exclude);
  const mocks = Object.prototype.hasOwnProperty.call(unit.files.mock || {}, relPath)
    ? [relPath]
    : [];
  return { exports, excludes, mocks, count: exports.length + excludes.length + mocks.length };
}

function classifyUnit(unitId) {
  const unit = exportMap.units && exportMap.units[unitId];
  assert.ok(unit, `${unitId} must be registered in mythos-export-map.json`);

  const sourceDir = path.join(repoRoot, unit.source);
  const sourceFiles = walk(sourceDir).sort();
  const unclassified = [];
  const ambiguous = [];

  for (const relPath of sourceFiles) {
    const decision = decisionsFor(unit, relPath);
    if (decision.count === 0) unclassified.push(relPath);
    if (decision.count > 1) ambiguous.push({ relPath, ...decision });
  }

  assert.deepStrictEqual(unclassified, [], `${unitId} has unregistered source files`);
  assert.deepStrictEqual(ambiguous, [], `${unitId} has overlapping export decisions`);
  return { unit, sourceFiles };
}

const clientStorage = classifyUnit('client-storage');
const googleAuthorization = classifyUnit('google-drive-authorization');
const storageRuntimeSupport = classifyUnit('storage-runtime-support');
const microsoftGraphRuntime = classifyUnit('microsoft-graph-storage-runtime');

assert.strictEqual(
  decisionsFor(clientStorage.unit, 'new-portable-storage-tool.js').count,
  0,
  'regression probe: a new portable storage file must fail registration until explicitly classified'
);

assert.ok(
  clientStorage.unit.files.export.includes('__tests__/safety.test.js'),
  'generic client-storage tests are part of the approved publication surface'
);
assert.ok(
  googleAuthorization.unit.files.export.includes('authorize.test.js'),
  'the Google authorization test is part of the approved publication surface'
);
assert.ok(
  googleAuthorization.unit.files.exclude.includes('.oauth-creds*.json'),
  'Google OAuth credential caches must remain outside the publication surface'
);

function stagedDigest(result) {
  const digest = crypto.createHash('sha256');
  for (const relPath of walk(result.staging).sort()) {
    digest.update(relPath);
    digest.update('\0');
    digest.update(fs.readFileSync(path.join(result.staging, relPath)));
    digest.update('\0');
  }
  return digest.digest('hex');
}

const storageUnitIds = [
  'client-storage',
  'google-drive-authorization',
  'storage-runtime-support',
  'microsoft-graph-storage-runtime'
];

for (const unitId of storageUnitIds) {
  const first = exportFramework(unitId, exportMap, denylist, {});
  const second = exportFramework(unitId, exportMap, denylist, {});
  try {
    assert.strictEqual(first.ok, true, `${unitId} first export must be clean`);
    assert.strictEqual(second.ok, true, `${unitId} second export must be clean`);
    assert.strictEqual(stagedDigest(first), stagedDigest(second), `${unitId} export must be idempotent`);
  } finally {
    fs.rmSync(first.staging, { recursive: true, force: true });
    fs.rmSync(second.staging, { recursive: true, force: true });
  }
}

function exportedRepoPaths() {
  const exported = new Set();
  for (const unitId of storageUnitIds) {
    const unit = exportMap.units[unitId];
    for (const relPath of walk(path.join(repoRoot, unit.source))) {
      if (matches(relPath, unit.files.export).length > 0) {
        exported.add(path.posix.join(unit.source, relPath.split(path.sep).join('/')));
      }
    }
  }
  return exported;
}

function resolveLocalDependency(fromRepoPath, request) {
  const fromAbs = path.join(repoRoot, fromRepoPath);
  const unresolved = path.resolve(path.dirname(fromAbs), request);
  const candidates = [
    unresolved,
    `${unresolved}.js`,
    `${unresolved}.cjs`,
    `${unresolved}.json`,
    path.join(unresolved, 'index.js'),
    path.join(unresolved, 'index.cjs')
  ];
  const resolved = candidates.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
  assert.ok(resolved, `missing local runtime dependency: ${fromRepoPath} -> ${request}`);
  return path.relative(repoRoot, resolved).split(path.sep).join('/');
}

const exported = exportedRepoPaths();
const queue = [...exported].filter((file) => /\.(?:c?js)$/.test(file));
const visited = new Set();
while (queue.length > 0) {
  const fromRepoPath = queue.shift();
  if (visited.has(fromRepoPath)) continue;
  visited.add(fromRepoPath);
  const source = fs.readFileSync(path.join(repoRoot, fromRepoPath), 'utf8');
  const requirePattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(requirePattern)) {
    const request = match[1];
    if (!request.startsWith('.')) continue;
    const dependency = resolveLocalDependency(fromRepoPath, request);
    assert.ok(exported.has(dependency), `unexported local runtime dependency: ${fromRepoPath} -> ${dependency}`);
    if (/\.(?:c?js)$/.test(dependency)) queue.push(dependency);
  }
}

function runSmokeCommand(targetRepo, args) {
  const result = spawnSync(process.execPath, args, { cwd: targetRepo, encoding: 'utf8' });
  assert.strictEqual(
    result.status,
    0,
    `clean-base smoke failed: node ${args.join(' ')}\n${result.stderr || result.stdout}`
  );
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /MODULE_NOT_FOUND|Cannot find module/);
}

const liveBase = '6d6a3380470cee5bcc772cfb6921091cf7c62e2d';
const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-export-live-base-'));
const smokeRepo = path.join(smokeRoot, 'repo');
const stagedResults = [];
try {
  execFileSync('git', ['clone', '--shared', '--no-checkout', repoRoot, smokeRepo], { stdio: 'pipe' });
  execFileSync('git', ['checkout', '--detach', liveBase], { cwd: smokeRepo, stdio: 'pipe' });
  for (const unitId of storageUnitIds) {
    const result = exportFramework(unitId, exportMap, denylist, {});
    stagedResults.push(result);
    assert.strictEqual(result.ok, true, `${unitId} must stage cleanly for the live-base smoke test`);
    const targetDir = path.join(smokeRepo, exportMap.units[unitId].target);
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(result.staging, targetDir, { recursive: true });
  }

  runSmokeCommand(smokeRepo, ['tools/client-storage/preflight.js', '--help']);
  runSmokeCommand(smokeRepo, ['tools/google-drive/authorize.js', '--help']);
  runSmokeCommand(smokeRepo, [
    '-e',
    "const g=require('./tools/google-drive/client.js');" +
      "const m=require('./tools/ms-graph/client.js');" +
      "const c=require('./tools/lib/canonical-root.cjs');" +
      "if(typeof g.apiRequest!=='function'||typeof m.getOneDriveFreeBytes!=='function'||typeof c.resolveCanonicalRoot!=='function')process.exit(1)"
  ]);
  runSmokeCommand(smokeRepo, [
    '-e',
    "const m=require('./tools/ms-graph/client.js');" +
      "m.getAccessToken({profile:'work',env:{}}).then(()=>process.exit(1)).catch(e=>process.exit(e.code==='GRAPH_CREDENTIALS_MISSING'?0:1))"
  ]);
  runSmokeCommand(smokeRepo, ['--test', '--test-concurrency=1', 'tools/google-drive/authorize.test.js']);
  runSmokeCommand(smokeRepo, ['--test', '--test-concurrency=1', 'tools/client-storage/__tests__/capability-probe.test.js']);
  runSmokeCommand(smokeRepo, ['--test', '--test-concurrency=1', 'tools/client-storage/__tests__/graph-quota.test.js']);
  runSmokeCommand(smokeRepo, [
    '--test',
    '--test-concurrency=1',
    '--test-name-pattern=mounted-volume preflight grants|named Graph quota path|named Graph identity failure',
    'tools/client-storage/__tests__/safety.test.js'
  ]);
} finally {
  for (const result of stagedResults) {
    if (result.staging) fs.rmSync(result.staging, { recursive: true, force: true });
  }
  fs.rmSync(smokeRoot, { recursive: true, force: true });
}

console.log(
  `storage-registration: classified ${clientStorage.sourceFiles.length} client-storage files ` +
  `${googleAuthorization.sourceFiles.length} Google Drive files, ` +
  `${storageRuntimeSupport.sourceFiles.length} shared support files, and ` +
  `${microsoftGraphRuntime.sourceFiles.length} Microsoft Graph files`
);
