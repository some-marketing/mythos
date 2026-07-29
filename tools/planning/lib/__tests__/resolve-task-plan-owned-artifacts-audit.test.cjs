/* eslint-disable */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  resolveTaskPlanPaths,
  classifyOwnedArtifacts,
  auditOwnedArtifacts
} = require('../resolve-task-plan.js');

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-audit-'));
  fs.mkdirSync(path.join(root, '_dev/reports/analysis/task-plans'), { recursive: true });
  return root;
}

function writePlan(root, taskId, plan) {
  const dir = path.join(root, '_dev/reports/analysis/task-plans');
  const jsonPath = path.join(dir, taskId + '__plan.json');
  fs.writeFileSync(jsonPath, JSON.stringify(plan));
  fs.writeFileSync(path.join(dir, taskId + '__plan.md'), '# ' + taskId);
  return jsonPath;
}

function touch(root, rel) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, '');
}

test('a) all owned files exist → missing[] empty', () => {
  const root = tmpProject();
  touch(root, 'src/a.js');
  touch(root, 'src/b.js');
  writePlan(root, 'task-a', {
    task_id: 'task-a',
    scope_identity: { owned_artifacts: ['src/a.js', 'src/b.js'] },
    bounded_plan: { steps: [] }
  });
  const r = resolveTaskPlanPaths(root, 'task-a');
  assert.deepEqual(r.owned_artifacts_audit.missing, []);
  assert.equal(r.owned_artifacts_audit.existing.length, 2);
});

test('b) (NEW) marker in files_touched → moves to planned_new[], not missing', () => {
  const root = tmpProject();
  // Note: NOT touching src/new.js — it's planned to be created
  writePlan(root, 'task-b', {
    task_id: 'task-b',
    scope_identity: { owned_artifacts: ['src/new.js'] },
    bounded_plan: { steps: [{ step_id: 's1', files_touched: ['src/new.js (NEW)'] }] }
  });
  const r = resolveTaskPlanPaths(root, 'task-b');
  assert.deepEqual(r.owned_artifacts_audit.missing, []);
  assert.deepEqual(r.owned_artifacts_audit.planned_new, ['src/new.js']);
  assert.deepEqual(r.owned_artifacts_audit.existing, []);
});

test('c) [DRIFT-SIMULATION] missing-on-disk + no (NEW) marker → missing[] populated', () => {
  const root = tmpProject();
  // NOT touching src/lost.js; not declared NEW — this is the drift case
  writePlan(root, 'task-c', {
    task_id: 'task-c',
    scope_identity: { owned_artifacts: ['src/lost.js'] },
    bounded_plan: { steps: [{ step_id: 's1', files_touched: ['src/lost.js'] }] }
  });
  const r = resolveTaskPlanPaths(root, 'task-c');
  assert.deepEqual(r.owned_artifacts_audit.missing, ['src/lost.js']);
  assert.deepEqual(r.owned_artifacts_audit.existing, []);
  assert.deepEqual(r.owned_artifacts_audit.planned_new, []);
});

test('d) plan with no scope_identity.owned_artifacts → audit:null', () => {
  const root = tmpProject();
  writePlan(root, 'task-d', { task_id: 'task-d', bounded_plan: { steps: [] } });
  const r = resolveTaskPlanPaths(root, 'task-d');
  assert.equal(r.owned_artifacts_audit, null);
});

test('e) malformed plan JSON → resolver still returns paths, audit:null', () => {
  const root = tmpProject();
  const dir = path.join(root, '_dev/reports/analysis/task-plans');
  const jsonPath = path.join(dir, 'task-e__plan.json');
  fs.writeFileSync(jsonPath, '{ this is not valid json');
  fs.writeFileSync(path.join(dir, 'task-e__plan.md'), '# task-e');
  const r = resolveTaskPlanPaths(root, 'task-e');
  assert.equal(typeof r.jsonPath, 'string');
  assert.equal(r.owned_artifacts_audit, null);
});

test('f) generic glob path (`*`) → glob_patterns_not_validated[]', () => {
  const root = tmpProject();
  writePlan(root, 'task-f', {
    task_id: 'task-f',
    scope_identity: { owned_artifacts: ['src/*.js', 'docs/**/*.md'] },
    bounded_plan: { steps: [] }
  });
  const r = resolveTaskPlanPaths(root, 'task-f');
  assert.equal(r.owned_artifacts_audit.glob_patterns_not_validated.length, 2);
  assert.deepEqual(r.owned_artifacts_audit.missing, []);
});

test('f2) extglob negation (`!(...)`) → glob_patterns_not_validated[]', () => {
  const root = tmpProject();
  writePlan(root, 'task-f2', {
    task_id: 'task-f2',
    scope_identity: { owned_artifacts: ['_dev/reports/analysis/task-plans/!(convene*)', 'src/!(foo|bar).js'] },
    bounded_plan: { steps: [] }
  });
  const r = resolveTaskPlanPaths(root, 'task-f2');
  assert.equal(r.owned_artifacts_audit.glob_patterns_not_validated.length, 2);
  assert.deepEqual(r.owned_artifacts_audit.missing, []);
});

test('g) classifyOwnedArtifacts callable standalone — pure, no fs', () => {
  // Build a plan referencing a path that does NOT exist anywhere — pure classifier
  // shouldn't care.
  const planJson = {
    scope_identity: { owned_artifacts: ['/totally/imaginary/path.js', 'src/exists.js'] },
    bounded_plan: { steps: [{ files_touched: ['/totally/imaginary/path.js (NEW)'] }] }
  };
  const c = classifyOwnedArtifacts(planJson);
  assert.deepEqual(c.planned_new, ['/totally/imaginary/path.js']);
  assert.deepEqual(c.existing_required, ['src/exists.js']);
  // No 'existing' or 'missing' fields — those come from auditOwnedArtifacts
  assert.equal(c.existing, undefined);
  assert.equal(c.missing, undefined);
});

test('h) non-NEW annotation stripping (modified, additive section, etc.)', () => {
  const root = tmpProject();
  touch(root, 'concept.md');
  touch(root, 'tools/foo.js');
  writePlan(root, 'task-h', {
    task_id: 'task-h',
    scope_identity: { owned_artifacts: ['concept.md (additive section 7 only)', 'tools/foo.js (modified)'] },
    bounded_plan: { steps: [] }
  });
  const r = resolveTaskPlanPaths(root, 'task-h');
  assert.deepEqual(r.owned_artifacts_audit.missing, []);
  assert.equal(r.owned_artifacts_audit.existing.length, 2);
  assert.ok(r.owned_artifacts_audit.existing.includes('concept.md'));
  assert.ok(r.owned_artifacts_audit.existing.includes('tools/foo.js'));
});

test('i) NEW marker takes precedence when path appears in both NEW and non-NEW contexts', () => {
  const root = tmpProject();
  // src/dual.js does NOT exist on disk
  writePlan(root, 'task-i', {
    task_id: 'task-i',
    scope_identity: { owned_artifacts: ['src/dual.js'] },
    bounded_plan: {
      steps: [
        { step_id: 's1', files_touched: ['src/dual.js (NEW)'] },
        { step_id: 's2', files_touched: ['src/dual.js'] }
      ]
    }
  });
  const r = resolveTaskPlanPaths(root, 'task-i');
  assert.deepEqual(r.owned_artifacts_audit.planned_new, ['src/dual.js']);
  assert.deepEqual(r.owned_artifacts_audit.missing, []);
});

test('j) auditOwnedArtifacts standalone with absolute paths', () => {
  const root = tmpProject();
  const abs = path.join(root, 'src/abs.js');
  touch(root, 'src/abs.js');
  const planJson = {
    scope_identity: { owned_artifacts: [abs] },
    bounded_plan: { steps: [] }
  };
  const a = auditOwnedArtifacts(planJson, root);
  assert.deepEqual(a.missing, []);
  assert.deepEqual(a.existing, [abs]);
});

test('k) audit_warnings empty when audit can run and finds everything', () => {
  const root = tmpProject();
  touch(root, 'src/a.js');
  writePlan(root, 'task-k', {
    task_id: 'task-k',
    scope_identity: { owned_artifacts: ['src/a.js'] },
    bounded_plan: { steps: [] }
  });
  const r = resolveTaskPlanPaths(root, 'task-k');
  assert.deepEqual(r.audit_warnings, []);
});

test('l) audit_warnings flags drift-blind plan (no scope_identity at all)', () => {
  // Mirrors the 2026-04-29 handshake-formalization plan shape: top-level keys
  // only, no scope_identity. Today's audit returns null; the warning is the new
  // signal that the audit cannot run against this plan.
  const root = tmpProject();
  writePlan(root, 'task-l', { task_id: 'task-l', bounded_plan: { steps: [] } });
  const r = resolveTaskPlanPaths(root, 'task-l');
  assert.equal(r.owned_artifacts_audit, null);
  assert.equal(r.audit_warnings.length, 1);
  assert.equal(r.audit_warnings[0].code, 'plan-missing-scope-identity-owned-artifacts');
  assert.match(r.audit_warnings[0].detail, /drift-blind/);
});

test('m) audit_warnings flags drift-blind plan (scope_identity present but no owned_artifacts)', () => {
  const root = tmpProject();
  writePlan(root, 'task-m', {
    task_id: 'task-m',
    scope_identity: { workstream_scope: 'task-m' },
    bounded_plan: { steps: [] }
  });
  const r = resolveTaskPlanPaths(root, 'task-m');
  assert.equal(r.owned_artifacts_audit, null);
  assert.equal(r.audit_warnings.length, 1);
  assert.equal(r.audit_warnings[0].code, 'plan-missing-scope-identity-owned-artifacts');
});

test('n) audit_warnings flags drift-blind plan (owned_artifacts present but empty array)', () => {
  const root = tmpProject();
  writePlan(root, 'task-n', {
    task_id: 'task-n',
    scope_identity: { owned_artifacts: [] },
    bounded_plan: { steps: [] }
  });
  const r = resolveTaskPlanPaths(root, 'task-n');
  assert.equal(r.audit_warnings.length, 1);
  assert.equal(r.audit_warnings[0].code, 'plan-missing-scope-identity-owned-artifacts');
});

test('o) audit_warnings flags unreadable plan JSON', () => {
  const root = tmpProject();
  const dir = path.join(root, '_dev/reports/analysis/task-plans');
  const jsonPath = path.join(dir, 'task-o__plan.json');
  fs.writeFileSync(jsonPath, '{ malformed');
  fs.writeFileSync(path.join(dir, 'task-o__plan.md'), '# task-o');
  const r = resolveTaskPlanPaths(root, 'task-o');
  assert.equal(r.owned_artifacts_audit, null);
  assert.equal(r.audit_warnings.length, 1);
  assert.equal(r.audit_warnings[0].code, 'plan-json-unreadable');
});

test('p) audit_warnings empty when only references are missing on disk (separate signal)', () => {
  // Drift in the references is owned_artifacts_audit.missing[]. audit_warnings
  // is about the plan's auditability itself — those are separate signals.
  const root = tmpProject();
  writePlan(root, 'task-p', {
    task_id: 'task-p',
    scope_identity: { owned_artifacts: ['src/lost.js'] },
    bounded_plan: { steps: [] }
  });
  const r = resolveTaskPlanPaths(root, 'task-p');
  assert.deepEqual(r.audit_warnings, []);
  assert.deepEqual(r.owned_artifacts_audit.missing, ['src/lost.js']);
});
