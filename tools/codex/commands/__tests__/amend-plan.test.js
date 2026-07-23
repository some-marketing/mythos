'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const runner = path.resolve(__dirname, '..', '..', '..', 'commands', 'smos-command-runner.cjs');

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amend-plan-'));
  const id = `fixture-${path.basename(root)}`;
  const planDir = path.join(root, '_dev', 'reports', 'analysis', 'task-plans');
  const commandDir = path.join(root, 'instructions', 'canonical', 'commands');
  fs.mkdirSync(planDir, { recursive: true });
  fs.mkdirSync(commandDir, { recursive: true });
  fs.writeFileSync(path.join(commandDir, 'amend-plan.yaml'), JSON.stringify({ id: 'amend-plan', mode: 'REVIEW_ONLY' }));
  const jsonPath = path.join(planDir, id + '__plan.json');
  const mdPath = path.join(planDir, id + '__plan.md');
  fs.writeFileSync(jsonPath, JSON.stringify({
    task_id: id,
    description: 'fixture',
    source: 'operator',
    requested_by: 'test',
    timestamp: '2026-07-14T00:00:00Z',
    scope_type: 'system',
    storage_root: '_dev/reports/analysis/task-plans',
    bounded_plan: { steps: [] },
    routing_expectations: { risk_tier: 'low', review_lane: 'verify-local' }
  }, null, 2) + '\n');
  fs.writeFileSync(mdPath, '# Fixture Plan\n');
  return { root, id, planDir, jsonPath, mdPath };
}

test('authority-field mutation is refused and routed to repair-plan', () => {
  const f = fixture();
  const child = spawnSync(process.execPath, [runner, `/amend-plan ${f.id} --field bounded_plan.required_gates`], {
    env: { ...process.env, MYTHOS_PROJECT_ROOT: f.root },
    encoding: 'utf8'
  });
  assert.equal(child.status, 2);
  assert.match(child.stdout, new RegExp(`/repair-plan ${f.id}`));
  assert.equal(fs.readdirSync(f.planDir).filter((name) => name.includes('__amendment__')).length, 0);
});

test('overlay write preserves base plan JSON and Markdown byte identity', () => {
  const f = fixture();
  const before = { json: hash(f.jsonPath), md: hash(f.mdPath) };
  const child = spawnSync(process.execPath, [runner, `/amend-plan ${f.id}`], {
    env: { ...process.env, MYTHOS_PROJECT_ROOT: f.root },
    encoding: 'utf8'
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.strictEqual(hash(f.jsonPath), before.json);
  assert.strictEqual(hash(f.mdPath), before.md);
  const overlays = fs.readdirSync(f.planDir).filter((name) => name.includes('__amendment__'));
  assert.equal(overlays.length, 2);
  const json = JSON.parse(fs.readFileSync(path.join(f.planDir, overlays.find((name) => name.endsWith('.json'))), 'utf8'));
  assert.equal(json.plan_id, f.id);
  assert.deepEqual(json.divergences, []);
  assert.equal(json.plan_still_executable, true);
});

test('runner registers exactly one amend-plan handler addition', () => {
  const source = fs.readFileSync(runner, 'utf8');
  const block = source.match(/const HANDLERS = Object\.freeze\(\{([\s\S]*?)\n\}\);/)[1];
  const entries = block.match(/^\s*['a-z][^:]*:/gm) || [];
  assert.equal(entries.length, 15);
  assert.equal(entries.filter((entry) => entry.includes("'amend-plan'" )).length, 1);
});

test('gate flags write a PlanAmendment/1.1 overlay with an open operator gate', () => {
  const f = fixture();
  const child = spawnSync(process.execPath, [runner, `/amend-plan ${f.id} --gate-id s0-candidate-choice --gate-status open --gate-question "Which candidate fix?"`], {
    env: { ...process.env, MYTHOS_PROJECT_ROOT: f.root },
    encoding: 'utf8'
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const overlays = fs.readdirSync(f.planDir).filter((name) => name.includes('__amendment__') && name.endsWith('.json'));
  assert.equal(overlays.length, 1);
  const json = JSON.parse(fs.readFileSync(path.join(f.planDir, overlays[0]), 'utf8'));
  assert.equal(json.schema, 'PlanAmendment/1.1');
  assert.equal(json.operator_gates.length, 1);
  assert.equal(json.operator_gates[0].id, 's0-candidate-choice');
  assert.equal(json.operator_gates[0].status, 'open');
  assert.equal(json.operator_gates[0].decided_at, null);
  const md = fs.readFileSync(path.join(f.planDir, overlays[0].replace(/\.json$/, '.md')), 'utf8');
  assert.match(md, /## Operator Gates/);
  assert.match(md, /s0-candidate-choice/);
});

test('resolved gate carries decided_at and resolution', () => {
  const f = fixture();
  const child = spawnSync(process.execPath, [runner, `/amend-plan ${f.id} --gate-id s0-candidate-choice --gate-status resolved --gate-resolution "probability cap; floor=0.05" --gate-supersedes old-gate`], {
    env: { ...process.env, MYTHOS_PROJECT_ROOT: f.root },
    encoding: 'utf8'
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const overlays = fs.readdirSync(f.planDir).filter((name) => name.includes('__amendment__') && name.endsWith('.json'));
  const json = JSON.parse(fs.readFileSync(path.join(f.planDir, overlays[0]), 'utf8'));
  const gate = json.operator_gates[0];
  assert.equal(gate.status, 'resolved');
  assert.match(gate.decided_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(gate.resolution, 'probability cap; floor=0.05');
  assert.equal(gate.supersedes_gate_id, 'old-gate');
});

test('invalid gate status fails closed without writing an overlay', () => {
  const f = fixture();
  const child = spawnSync(process.execPath, [runner, `/amend-plan ${f.id} --gate-id g1 --gate-status bogus`], {
    env: { ...process.env, MYTHOS_PROJECT_ROOT: f.root },
    encoding: 'utf8'
  });
  assert.equal(child.status, 2);
  assert.match(child.stderr + child.stdout, /Invalid --gate-status/);
  assert.equal(fs.readdirSync(f.planDir).filter((name) => name.includes('__amendment__')).length, 0);
});

test('gate-status without gate-id fails closed', () => {
  const f = fixture();
  const child = spawnSync(process.execPath, [runner, `/amend-plan ${f.id} --gate-status open`], {
    env: { ...process.env, MYTHOS_PROJECT_ROOT: f.root },
    encoding: 'utf8'
  });
  assert.equal(child.status, 2);
  assert.match(child.stderr + child.stdout, /--gate-status requires --gate-id/);
  assert.equal(fs.readdirSync(f.planDir).filter((name) => name.includes('__amendment__')).length, 0);
});

test('gate-resolution-file reads resolution content verbatim (quoting-hazard payloads)', () => {
  const f = fixture();
  const resPath = path.join(f.root, 'resolution.txt');
  const payload = `operator's choice: (b); fixture: {"k":"v","n":1}`;
  fs.writeFileSync(resPath, payload + '\n');
  const child = spawnSync(process.execPath, [runner, `/amend-plan ${f.id} --gate-id g1 --gate-status resolved --gate-resolution-file ${resPath}`], {
    env: { ...process.env, MYTHOS_PROJECT_ROOT: f.root },
    encoding: 'utf8'
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const overlays = fs.readdirSync(f.planDir).filter((name) => name.includes('__amendment__') && name.endsWith('.json'));
  const json = JSON.parse(fs.readFileSync(path.join(f.planDir, overlays[0]), 'utf8'));
  assert.equal(json.operator_gates[0].resolution, payload);
});

test('same-second amendment writes do not silently overwrite (collision suffix)', () => {
  const f = fixture();
  const { amendPlan } = require('../amend-plan.js');
  const r1 = amendPlan(f.root, `${f.id} --gate-id g1 --gate-status open`);
  const r2 = amendPlan(f.root, `${f.id} --gate-id g2 --gate-status open`);
  assert.equal(r1.exitCode, 0);
  assert.equal(r2.exitCode, 0);
  const overlays = fs.readdirSync(f.planDir).filter((name) => name.includes('__amendment__') && name.endsWith('.json'));
  assert.equal(overlays.length, 2);
  const ids = overlays.map((name) => JSON.parse(fs.readFileSync(path.join(f.planDir, name), 'utf8')).operator_gates[0].id).sort();
  assert.deepEqual(ids, ['g1', 'g2']);
});
