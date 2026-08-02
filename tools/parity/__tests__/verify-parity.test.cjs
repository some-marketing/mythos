'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { spawnSync } = require('child_process');
const { fileSha, sha256, treeDigest } = require('../lib.cjs');
const { PRIVATE_LOCAL_EXCLUSIONS, PRIVATE_MEMORY_EXCLUSIONS } = require('../private-memory-policy.cjs');

const verifier = path.join(__dirname, '..', 'verify-parity.cjs');
const graphBuilder = path.join(__dirname, '..', 'build-wiring-graph.cjs');
const baselineBuilder = path.join(__dirname, '..', 'build-baseline.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-verify-parity-'));
  fs.mkdirSync(path.join(root, 'tools/unit'), { recursive: true });
  fs.mkdirSync(path.join(root, 'parity'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/unit/index.js'), 'module.exports = true;\n');
  fs.writeFileSync(path.join(root, 'tools/unit/fixture.txt'), 'private-client-marker\n');
  const privateDenylistPath = path.join(root, 'private-denylist.json');
  fs.writeFileSync(privateDenylistPath, JSON.stringify({
    client_codes: [],
    domains: [],
    identifiers: [],
    patterns: [{ regex: 'LEAK-[0-9]{4}', flags: '', description: 'synthetic regex-only rule' }],
    forbidden: [],
  }));
  fs.writeFileSync(path.join(root, 'aliases.yaml'), 'aliases: {}\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { unit: 'node tools/unit/index.js' } }));
  const graph = {
    schema: 'MythosWiringGraph/1.0',
    nodes: ['aliases.yaml', 'package.json', 'tools/unit/fixture.txt', 'tools/unit/index.js'].map(file => ({
      id: `file:${file}`,
      type: 'file',
      path: file,
      sha256: fileSha(path.join(root, file)),
      mode: fs.statSync(path.join(root, file)).mode & 0o777,
    })),
    edges: [],
    counts: { nodes: 4, edges: 0 },
  };
  fs.writeFileSync(path.join(root, 'parity/wiring-graph.json'), JSON.stringify(graph));
  const files = ['aliases.yaml', 'package.json', 'parity/wiring-graph.json', 'tools/unit/fixture.txt', 'tools/unit/index.js'];
  const privateMarkerHash = sha256('private client marker');
  fs.writeFileSync(path.join(root, 'parity/baseline.json'), JSON.stringify({
    schema: 'MythosParityBaseline/2.0',
    source: {
      private_denylist_sha256: fileSha(privateDenylistPath),
      units: [{ id: 'unit', target: 'tools/unit' }],
    },
    target: {
      expected_files: files.map(file => ({
        path: file,
        sha256: fileSha(path.join(root, file)),
        mode: fs.statSync(path.join(root, file)).mode & 0o777,
      })),
      expected_tree_sha256: treeDigest(root, files),
    },
    wiring: {
      package_script_count: 1,
      command_alias_registry_sha256: null,
      graph_path: 'parity/wiring-graph.json',
      graph_sha256: fileSha(path.join(root, 'parity/wiring-graph.json')),
      graph_nodes: 4,
      graph_edges: 0,
    },
    runtime_exclusions: ['.git/**', ...PRIVATE_LOCAL_EXCLUSIONS, 'parity/reconciliation-ledger.json', 'private-denylist.json'],
    prohibited_paths: ['clients/**'],
    prohibited_content_regexes: ['/Users' + '/'],
    prohibited_token_hashes: [privateMarkerHash],
    prohibited_case_token_hashes: [],
    prohibited_token_max_words: 3,
    prohibited_token_allowlist: {
      [privateMarkerHash]: ['tools/unit/fixture.txt'],
    },
    security_evidence_artifacts: ['parity/reconciliation-ledger.json'],
  }));
  fs.writeFileSync(path.join(root, 'parity/reconciliation-ledger.json'), '{"rows":[]}\n');
  assert.equal(spawnSync('git', ['init', root], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['-C', root, 'add', '.'], { encoding: 'utf8' }).status, 0);
  return root;
}

function run(root, options = {}) {
  const args = [verifier, '--root', root];
  if (options.requirePrivateDenylist !== false) args.push('--require-private-denylist');
  if (options.includePrivateDenylist !== false) {
    args.push('--private-denylist', path.join(root, 'private-denylist.json'));
  }
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

test('passes an exact registered portable tree', () => {
  const root = fixture();
  const result = run(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ignores untracked private memory roots while retaining tracked-memory enforcement', () => {
  const root = fixture();
  for (const rootName of ['Mythos-memories', 'sm_os-memories']) {
    const memoryPath = path.join(root, rootName, 'memory', 'MEMORY.md');
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(memoryPath, 'private local memory\n');
  }
  const result = run(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed when baseline metadata omits a required private-local exclusion', () => {
  const root = fixture();
  const baselinePath = path.join(root, 'parity/baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  baseline.runtime_exclusions = baseline.runtime_exclusions.filter(pattern => pattern !== '_dev/desktop/work/personal/**');
  fs.writeFileSync(baselinePath, JSON.stringify(baseline));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /missing required private-local runtime exclusion: _dev\/desktop\/work\/personal\/\*\*/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails missing files, dead scripts, leakage, and unregistered extras', () => {
  const root = fixture();
  fs.unlinkSync(path.join(root, 'tools/unit/index.js'));
  fs.writeFileSync(path.join(root, 'extra.txt'), '/Users' + '/private\nprivate-client-marker\n');
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /missing expected file/);
  assert.match(result.stdout, /dead package script target/);
  assert.match(result.stdout, /unregistered extra/);
  assert.match(result.stdout, /prohibited content/);
  assert.match(result.stdout, /prohibited private token/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed for unknown and stale token allowlist entries', () => {
  const root = fixture();
  const baselinePath = path.join(root, 'parity/baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  baseline.prohibited_token_allowlist[sha256('not a prohibited token')] = ['tools/unit/fixture.txt'];
  baseline.prohibited_token_allowlist[baseline.prohibited_token_hashes[0]] = ['tools/unit/missing-fixture.txt'];
  fs.writeFileSync(baselinePath, JSON.stringify(baseline));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /unknown prohibited token allowlist hash/);
  assert.match(result.stdout, /prohibited private token in content: tools\/unit\/fixture\.txt/);
  assert.match(result.stdout, /stale prohibited token allowlist entry/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('scans excluded reconciliation evidence for private tokens', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'parity/reconciliation-ledger.json'), '{"path":"private-client-marker"}\n');
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /prohibited private token in security evidence artifact/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('applies regex-only authoritative rules to excluded evidence', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'parity/reconciliation-ledger.json'), '{"opaque":"LEAK-1234"}\n');
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /authoritative private denylist hit in security evidence artifact/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails required private verification for absent or mismatched authoritative input', () => {
  const root = fixture();
  const absent = run(root, { includePrivateDenylist: false });
  assert.equal(absent.status, 1);
  assert.match(absent.stdout, /authoritative private denylist input is required/);

  fs.writeFileSync(path.join(root, 'private-denylist.json'), '{"patterns":[]}\n');
  const mismatched = run(root);
  assert.equal(mismatched.status, 1);
  assert.match(mismatched.stdout, /authoritative private denylist binding mismatch/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('cannot disable canonical ledger security scanning through baseline metadata', () => {
  const root = fixture();
  const baselinePath = path.join(root, 'parity/baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  baseline.security_evidence_artifacts = [];
  fs.writeFileSync(baselinePath, JSON.stringify(baseline));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /security evidence artifact registry must contain only the canonical reconciliation ledger/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('parity generators share exact canonical and legacy private-memory exclusions', () => {
  assert.deepEqual(PRIVATE_MEMORY_EXCLUSIONS, [
    'Mythos-memories/**',
    'sm_os-memories/**',
  ]);
  assert.deepEqual(PRIVATE_LOCAL_EXCLUSIONS, [
    ...PRIVATE_MEMORY_EXCLUSIONS,
    '_dev/desktop/work/personal/**',
  ]);
});

test('wiring graph excludes linked-worktree control data and private memory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wiring-graph-'));
  fs.mkdirSync(path.join(root, 'parity'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: /machine-specific/worktree\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: {} }));
  fs.writeFileSync(path.join(root, 'tools', 'demo.js'), 'module.exports = true;\n');
  const privateMarkers = [];
  for (const rootName of ['Mythos-memories', 'sm_os-memories']) {
    const marker = `private-${rootName}-marker`;
    const memoryPath = path.join(root, rootName, 'memory', 'MEMORY.md');
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(memoryPath, `${marker}\n`);
    privateMarkers.push(marker);
  }
  const turnMarker = 'private-local-turn-marker';
  const turnPath = path.join(root, '_dev', 'desktop', 'work', 'personal', 'turns', 'turn.jsonl');
  fs.mkdirSync(path.dirname(turnPath), { recursive: true });
  fs.writeFileSync(turnPath, `${turnMarker}\n`);
  privateMarkers.push(turnMarker);

  const result = spawnSync(process.execPath, [graphBuilder, '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const graph = JSON.parse(fs.readFileSync(path.join(root, 'parity', 'wiring-graph.json'), 'utf8'));
  assert.equal(graph.nodes.some(node => node.path === '.git'), false);
  assert.equal(graph.nodes.some(node => /^(?:Mythos-memories|sm_os-memories)(?:\/|$)/.test(node.path || '')), false);
  const serialized = JSON.stringify(graph);
  for (const marker of privateMarkers) {
    assert.equal(serialized.includes(marker), false);
    assert.equal(serialized.includes(sha256(`${marker}\n`)), false);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('baseline regeneration excludes private memory paths and content hashes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-baseline-target-'));
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-baseline-source-'));
  const configRoot = path.join(sourceRoot, 'tools', 'export-public', 'config');
  fs.mkdirSync(configRoot, { recursive: true });
  fs.writeFileSync(path.join(configRoot, 'mythos-export-map.json'), JSON.stringify({ frameworks: {}, units: {} }));
  fs.writeFileSync(path.join(configRoot, 'denylist-mythos.json'), JSON.stringify({
    client_codes: [], domains: [], identifiers: [], forbidden: [],
  }));
  const privateDenylistPath = path.join(sourceRoot, 'private-denylist.json');
  fs.writeFileSync(privateDenylistPath, JSON.stringify({
    client_codes: [], domains: [], identifiers: [], forbidden: [],
  }));
  assert.equal(spawnSync('git', ['init', sourceRoot], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['-C', sourceRoot, 'add', '.'], { encoding: 'utf8' }).status, 0);
  const commit = spawnSync('git', [
    '-C', sourceRoot,
    '-c', 'user.name=Mythos Test',
    '-c', 'user.email=mythos-test@example.invalid',
    'commit', '-m', 'fixture',
  ], { encoding: 'utf8' });
  assert.equal(commit.status, 0, commit.stdout + commit.stderr);
  const sourceCommit = spawnSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

  fs.mkdirSync(path.join(root, 'parity'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: {} }));
  fs.writeFileSync(path.join(root, 'parity', 'wiring-graph.json'), JSON.stringify({
    counts: { nodes: 0, edges: 0 },
  }));
  const privateMarkers = [];
  for (const rootName of ['Mythos-memories', 'sm_os-memories']) {
    const marker = `baseline-private-${rootName}-marker`;
    const memoryPath = path.join(root, rootName, 'memory', 'MEMORY.md');
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(memoryPath, `${marker}\n`);
    privateMarkers.push(marker);
  }
  const turnMarker = 'baseline-private-local-turn-marker';
  const turnPath = path.join(root, '_dev', 'desktop', 'work', 'personal', 'turns', 'turn.jsonl');
  fs.mkdirSync(path.dirname(turnPath), { recursive: true });
  fs.writeFileSync(turnPath, `${turnMarker}\n`);
  privateMarkers.push(turnMarker);

  const result = spawnSync(process.execPath, [
    baselineBuilder,
    '--root', root,
    '--source-root', sourceRoot,
    '--source-commit', sourceCommit,
    '--target-base-commit', 'fixture-target-base',
    '--private-denylist', privateDenylistPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'parity', 'baseline.json'), 'utf8'));
  assert.deepEqual(
    baseline.runtime_exclusions.filter(pattern => PRIVATE_LOCAL_EXCLUSIONS.includes(pattern)),
    PRIVATE_LOCAL_EXCLUSIONS,
  );
  assert.equal(baseline.target.expected_files.some(row => /^(?:Mythos-memories|sm_os-memories)(?:\/|$)/.test(row.path)), false);
  const serialized = JSON.stringify(baseline);
  for (const marker of privateMarkers) {
    assert.equal(serialized.includes(marker), false);
    assert.equal(serialized.includes(sha256(`${marker}\n`)), false);
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(sourceRoot, { recursive: true, force: true });
});

test('fails closed when a memory-family path is force-tracked with any casing', () => {
  const root = fixture();
  const memoryPath = path.join(root, 'nested', 'MyThOs-MeMoRiEs', 'private.md');
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  fs.writeFileSync(memoryPath, 'private fixture\n');
  assert.equal(spawnSync('git', ['-C', root, 'add', '-f', 'nested/MyThOs-MeMoRiEs/private.md'], { encoding: 'utf8' }).status, 0);
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /prohibited tracked memory path: nested\/MyThOs-MeMoRiEs\/private\.md/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed when a private local session path is force-tracked', () => {
  const root = fixture();
  const turnPath = path.join(root, '_dev', 'desktop', 'work', 'personal', 'turns', 'turn.jsonl');
  fs.mkdirSync(path.dirname(turnPath), { recursive: true });
  fs.writeFileSync(turnPath, 'private fixture\n');
  assert.equal(spawnSync('git', ['-C', root, 'add', '-f', '_dev/desktop/work/personal/turns/turn.jsonl'], { encoding: 'utf8' }).status, 0);
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /prohibited tracked private-local path: _dev\/desktop\/work\/personal\/turns\/turn\.jsonl/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('repository ignore policy protects exact canonical and legacy memory roots on case-sensitive Git', () => {
  const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
  for (const protectedPath of ['Mythos-memories/private.md', 'sm_os-memories/private.md']) {
    const result = spawnSync('git', ['-C', repositoryRoot, '-c', 'core.ignoreCase=false', 'check-ignore', '--no-index', '-q', '--', protectedPath]);
    assert.equal(result.status, 0, `${protectedPath} must be ignored`);
  }
  const lookalike = spawnSync('git', ['-C', repositoryRoot, '-c', 'core.ignoreCase=false', 'check-ignore', '--no-index', '-q', '--', 'mythos-memories/private.md']);
  assert.equal(lookalike.status, 1, 'lowercase lookalike must stay visible to Git and blocked by the gate');
});
