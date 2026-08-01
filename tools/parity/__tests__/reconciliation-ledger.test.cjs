'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { spawnSync } = require('child_process');
const { generateLedger } = require('../generate-reconciliation-ledger.cjs');
const { sha256 } = require('../lib.cjs');

const checker = path.join(__dirname, '..', 'check-ledger.cjs');

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ledger-'));
  const sourceExportRoot = path.join(root, 'source-export');
  const targetBaseRoot = path.join(root, 'target-base');
  const targetCurrentRoot = path.join(root, 'target-current');
  for (const dir of [sourceExportRoot, targetBaseRoot, targetCurrentRoot]) fs.mkdirSync(dir);

  write(sourceExportRoot, 'identical.txt', 'same\n');
  write(targetBaseRoot, 'identical.txt', 'old\n');
  write(targetCurrentRoot, 'identical.txt', 'same\n');
  write(sourceExportRoot, 'adapted.txt', 'portable source\n');
  write(targetCurrentRoot, 'adapted.txt', 'portable target adaptation\n');
  write(sourceExportRoot, 'withheld.txt', 'not exported to current\n');
  write(targetBaseRoot, 'retired.txt', 'old target file\n');
  write(targetBaseRoot, 'overlay.txt', 'old overlay\n');
  write(targetCurrentRoot, 'overlay.txt', 'current overlay\n');

  const semantic_mapping = Object.fromEntries(
    ['commands', 'skills', 'agents', 'hooks', 'mcp', 'launchd'].map(family => [
      family,
      { source_nodes: 1, mapped: 1, substituted_or_quarantined: 0, unresolved: 0 },
    ]),
  );
  const decisions = {
    operator_ratification: 'pending',
    behavior_evidence_catalog: { portable: ['node --test focused.test.cjs'] },
    semantic_mapping,
    decisions: [
      {
        path: 'adapted.txt',
        disposition: 'export-adapted',
        adaptation_class: 'portable-transformation',
        behavior_equivalence_evidence: 'portable',
      },
      { path: 'withheld.txt', disposition: 'merge-upstream', behavior_equivalence_evidence: 'portable' },
      { path: 'retired.txt', disposition: 'remove-or-quarantine', behavior_equivalence_evidence: 'portable' },
      {
        path: 'overlay.txt',
        disposition: 'target-owned',
        overlay_authority: 'target-maintainers',
        behavior_equivalence_evidence: 'portable',
      },
    ],
  };
  return { root, sourceExportRoot, targetBaseRoot, targetCurrentRoot, decisions };
}

function generate(input) {
  return generateLedger({
    sourceExportRoot: input.sourceExportRoot,
    targetBaseRoot: input.targetBaseRoot,
    targetCurrentRoot: input.targetCurrentRoot,
    decisions: input.decisions,
  });
}

function check(input, ledger) {
  const file = path.join(input.root, 'ledger.json');
  fs.writeFileSync(file, JSON.stringify(ledger));
  return spawnSync(process.execPath, [
    checker,
    file,
    '--source-export-root', input.sourceExportRoot,
    '--target-base-root', input.targetBaseRoot,
    '--target-current-root', input.targetCurrentRoot,
  ], { encoding: 'utf8' });
}

function checkWithoutRoots(input, ledger) {
  const file = path.join(input.root, 'ledger-without-roots.json');
  fs.writeFileSync(file, JSON.stringify(ledger));
  return spawnSync(process.execPath, [checker, file], { encoding: 'utf8' });
}

test('generates one deterministic ordered disposition for every inventoried path', () => {
  const input = fixture();
  const first = generate(input);
  const second = generate(input);

  assert.deepEqual(second, first);
  assert.deepEqual(first.rows.map(row => row.path), [
    'adapted.txt',
    'identical.txt',
    'overlay.txt',
    undefined,
    'withheld.txt',
  ]);
  assert.equal(first.rows.find(row => row.disposition === 'remove-or-quarantine').path_sha256, sha256('retired.txt'));
  assert.equal(first.coverage.files, 5);
  assert.equal(new Set(first.rows.map(row => row.coverage_key)).size, 5);
  assert.equal(first.rows.find(row => row.path === 'identical.txt').disposition, 'export-identical');
  assert.equal(check(input, first).status, 0);
  fs.rmSync(input.root, { recursive: true, force: true });
});

test('generation and authoritative checking ignore private memory paths and hashes', () => {
  const input = fixture();
  const withoutMemory = generate(input);
  const privateMarkers = [];
  for (const surfaceRoot of [input.sourceExportRoot, input.targetBaseRoot, input.targetCurrentRoot]) {
    for (const rootName of ['Mythos-memories', 'sm_os-memories']) {
      const marker = `ledger-private-${path.basename(surfaceRoot)}-${rootName}-marker`;
      write(surfaceRoot, `${rootName}/memory/MEMORY.md`, `${marker}\n`);
      privateMarkers.push(marker);
    }
    const turnMarker = `ledger-private-${path.basename(surfaceRoot)}-local-turn-marker`;
    write(surfaceRoot, '_dev/desktop/work/personal/turns/turn.jsonl', `${turnMarker}\n`);
    privateMarkers.push(turnMarker);
  }

  const withMemory = generate(input);
  assert.deepEqual(withMemory, withoutMemory);
  const serialized = JSON.stringify(withMemory);
  for (const marker of privateMarkers) {
    assert.equal(serialized.includes(marker), false);
    assert.equal(serialized.includes(sha256(`${marker}\n`)), false);
  }
  assert.equal(check(input, withMemory).status, 0);
  fs.rmSync(input.root, { recursive: true, force: true });
});

test('blocks an uncovered file from any of the three inventory surfaces', () => {
  const input = fixture();
  write(input.targetCurrentRoot, 'unreviewed-target-file.txt', 'must receive a disposition\n');
  assert.throws(() => generate(input), /uncovered path requires an explicit disposition: unreviewed-target-file\.txt/);
  fs.rmSync(input.root, { recursive: true, force: true });
});

test('authoritative inventory validation blocks an omitted row even if self-reported coverage is recomputed', () => {
  const input = fixture();
  const ledger = generate(input);
  ledger.rows.pop();
  const remainingKeys = ledger.rows.map(row => row.coverage_key).sort();
  ledger.coverage.files = remainingKeys.length;
  ledger.coverage.path_keys_sha256 = sha256(remainingKeys.join('\n'));
  const omitted = check(input, ledger);
  assert.equal(omitted.status, 1);
  assert.match(omitted.stderr, /row path-key set does not match authoritative inventories/);

  const duplicateLedger = generate(input);
  duplicateLedger.rows.push({ ...duplicateLedger.rows[0] });
  const duplicated = check(input, duplicateLedger);
  assert.equal(duplicated.status, 1);
  assert.match(duplicated.stderr, /duplicate coverage_key/);
  fs.rmSync(input.root, { recursive: true, force: true });
});

test('authoritative inventory validation blocks a path added after generation', () => {
  const input = fixture();
  const ledger = generate(input);
  write(input.targetCurrentRoot, 'added-after-generation.txt', 'new target bytes\n');
  const result = check(input, ledger);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /target_current inventory summary does not match authoritative root/);
  assert.match(result.stderr, /row path-key set does not match authoritative inventories/);
  fs.rmSync(input.root, { recursive: true, force: true });
});

test('v4 exhaustive claims cannot be checked without all three authoritative roots', () => {
  const input = fixture();
  const result = checkWithoutRoots(input, generate(input));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires all three authoritative inventory roots/);
  fs.rmSync(input.root, { recursive: true, force: true });
});

test('retains existing disposition semantics for generated ledgers', () => {
  const input = fixture();
  const ledger = generate(input);
  ledger.rows[0].disposition = 'invented-disposition';
  const result = check(input, ledger);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /offenders=1/);
  fs.rmSync(input.root, { recursive: true, force: true });
});

test('rejects duplicate and stale decision entries', () => {
  const input = fixture();
  input.decisions.decisions.push({ path: 'overlay.txt', disposition: 'target-owned', overlay_authority: 'other' });
  assert.throws(() => generate(input), /duplicate decision/);

  input.decisions.decisions.pop();
  input.decisions.decisions.push({ path: 'missing.txt', disposition: 'target-owned', overlay_authority: 'other' });
  assert.throws(() => generate(input), /does not match any inventoried file/);
  fs.rmSync(input.root, { recursive: true, force: true });
});

test('rejects artifact exclusions outside the fixed reviewed allowlist', () => {
  const input = fixture();
  input.decisions.artifact_exclusions = [{ path: 'overlay.txt', reason: 'hide it' }];
  assert.throws(() => generate(input), /not in the reviewed allowlist/);
  fs.rmSync(input.root, { recursive: true, force: true });
});

test('does not allow quarantine dispositions to mask bytes present in source-export', () => {
  const input = fixture();
  write(input.sourceExportRoot, 'leaked-export.txt', 'exported bytes\n');
  input.decisions.decisions.push({
    path: 'leaked-export.txt',
    disposition: 'private-prohibited',
    behavior_equivalence_evidence: 'portable',
  });
  assert.throws(() => generate(input), /cannot mask a file present in source-export/);
  fs.rmSync(input.root, { recursive: true, force: true });
});

test('quarantine rows always redact paths and checker rejects a forged plaintext path', () => {
  const input = fixture();
  const ledger = generate(input);
  const retired = ledger.rows.find(row => row.disposition === 'remove-or-quarantine');
  assert.equal(retired.path, undefined);
  assert.match(retired.path_sha256, /^[a-f0-9]{64}$/);

  retired.path = 'denied-target-name.txt';
  delete retired.path_sha256;
  const result = check(input, ledger);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /offenders=1/);
  fs.rmSync(input.root, { recursive: true, force: true });
});

test('requires catalogued evidence for merge-upstream and target-owned changes', () => {
  const input = fixture();
  delete input.decisions.decisions.find(row => row.path === 'withheld.txt').behavior_equivalence_evidence;
  assert.throws(() => generate(input), /merge-upstream requires catalogued behavior evidence/);

  input.decisions.decisions.find(row => row.path === 'withheld.txt').behavior_equivalence_evidence = 'portable';
  delete input.decisions.decisions.find(row => row.path === 'overlay.txt').behavior_equivalence_evidence;
  assert.throws(() => generate(input), /target-owned requires catalogued behavior evidence/);
  fs.rmSync(input.root, { recursive: true, force: true });
});

test('checker binds changed-row dispositions and evidence to authoritative bytes', () => {
  const input = fixture();
  const ledger = generate(input);
  const merge = ledger.rows.find(row => row.path === 'withheld.txt');
  merge.disposition = 'export-identical';
  merge.row_id = sha256(`${merge.coverage_key}\0${merge.disposition}`);
  delete merge.behavior_equivalence_evidence;
  const result = check(input, ledger);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /export-identical does not match authoritative bytes and mode/);
  assert.match(result.stderr, /changed row lacks catalogued behavior evidence/);
  fs.rmSync(input.root, { recursive: true, force: true });
});
