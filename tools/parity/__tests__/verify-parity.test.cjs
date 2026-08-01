'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { spawnSync } = require('child_process');
const { fileSha, sha256, treeDigest } = require('../lib.cjs');

const verifier = path.join(__dirname, '..', 'verify-parity.cjs');
const graphBuilder = path.join(__dirname, '..', 'build-wiring-graph.cjs');

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
    runtime_exclusions: ['.git/**', 'Mythos-memories/**', 'sm_os-memories/**', 'parity/reconciliation-ledger.json', 'private-denylist.json'],
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

test('wiring graph excludes linked-worktree .git control files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wiring-graph-'));
  fs.mkdirSync(path.join(root, 'parity'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: /machine-specific/worktree\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: {} }));
  fs.writeFileSync(path.join(root, 'tools', 'demo.js'), 'module.exports = true;\n');

  const result = spawnSync(process.execPath, [graphBuilder, '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const graph = JSON.parse(fs.readFileSync(path.join(root, 'parity', 'wiring-graph.json'), 'utf8'));
  assert.equal(graph.nodes.some(node => node.path === '.git'), false);
  fs.rmSync(root, { recursive: true, force: true });
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

test('repository ignore policy protects exact canonical and legacy memory roots on case-sensitive Git', () => {
  const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
  for (const protectedPath of ['Mythos-memories/private.md', 'sm_os-memories/private.md']) {
    const result = spawnSync('git', ['-C', repositoryRoot, '-c', 'core.ignoreCase=false', 'check-ignore', '--no-index', '-q', '--', protectedPath]);
    assert.equal(result.status, 0, `${protectedPath} must be ignored`);
  }
  const lookalike = spawnSync('git', ['-C', repositoryRoot, '-c', 'core.ignoreCase=false', 'check-ignore', '--no-index', '-q', '--', 'mythos-memories/private.md']);
  assert.equal(lookalike.status, 1, 'lowercase lookalike must stay visible to Git and blocked by the gate');
});
