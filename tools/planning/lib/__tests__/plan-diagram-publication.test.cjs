'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  assertEvent,
  pendingDrawioCorrections,
  writePlanDiagramPublication
} = require('../plan-diagram-publication.cjs');
const { writeDrawioExport } = require('../drawio-plan-corrections.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-diagram-publication-'));
  const planRoot = path.join(root, '_dev/reports/analysis/task-plans');
  writeJson(path.join(planRoot, 'parent-plan__plan.json'), {
    schema: 'TaskPlan/1.0',
    task_id: 'parent-plan',
    title: 'Parent Plan',
    scope_type: 'system',
    bounded_plan: { steps: [{ step_id: 'p1', status: 'completed' }] }
  });
  writeJson(path.join(planRoot, 'demo-plan__plan.json'), {
    schema: 'TaskPlan/1.0',
    task_id: 'demo-plan',
    title: 'Demo Plan',
    scope_type: 'system',
    parent_task_id: 'parent-plan',
    dart_task_id: 'DART123',
    status: 'completed',
    routing_expectations: { review_lane: 'codex-bridge', risk_tier: 'medium' },
    bounded_plan: {
      steps: [
        { step_id: 's1', status: 'completed', mode: 'PATCH_ALLOWED', description: 'Build it' },
        { step_id: 's2', status: 'completed', mode: 'RUN_ONLY', description: 'Test it' }
      ],
      required_gates: ['review before implementation']
    }
  });
  fs.writeFileSync(path.join(planRoot, 'demo-plan__plan.md'), '# Demo Plan\n');
  return root;
}

test('assertEvent rejects unknown lifecycle labels', () => {
  assert.equal(assertEvent('manual'), 'manual');
  assert.throws(() => assertEvent('surprise'), /Unknown lifecycle event/);
});

test('publication writes drawio, baseline, packet, and Dart comment draft', () => {
  const root = makeRoot();
  const result = writePlanDiagramPublication(root, {
    taskId: 'demo-plan',
    event: 'plan_completed',
    publishUrl: 'https://example.com/demo-plan.drawio'
  });

  assert.ok(fs.existsSync(path.join(root, result.paths.diagramPath)));
  assert.ok(fs.existsSync(path.join(root, result.paths.baselinePath)));
  assert.ok(fs.existsSync(path.join(root, result.paths.publicationPath)));
  assert.ok(fs.existsSync(path.join(root, result.paths.commentPath)));
  assert.equal(result.publication.schema, 'PlanDiagramPublication/1.0');
  assert.equal(result.publication.lifecycle_event, 'plan_completed');
  assert.equal(result.publication.dart.apply_comment_allowed, true);
  assert.equal(result.publication.links.attachment_request.executable_in_v1, false);
  assert.equal(result.publication.plan.step_status_summary.counts.completed, 2);
  assert.match(result.comment, /Artifact Index:/);
  assert.match(result.comment, /https:\/\/example\.com\/demo-plan\.drawio/);
});

test('publication rejects local publish URLs', () => {
  const root = makeRoot();
  const diagramPath = path.join(root, '_dev/reports/analysis/visual-plans/demo-plan.drawio');
  fs.mkdirSync(path.dirname(diagramPath), { recursive: true });
  fs.writeFileSync(diagramPath, 'operator draft');
  assert.throws(() => writePlanDiagramPublication(root, {
    taskId: 'demo-plan',
    publishUrl: '{MYTHOS_ROOT}/_dev/reports/analysis/visual-plans/demo.drawio'
  }), /local-path-not-allowed/);
  assert.equal(fs.readFileSync(diagramPath, 'utf8'), 'operator draft');
});

test('missing dart_task_id still writes packet and marks apply-comment as disallowed', () => {
  const root = makeRoot();
  const planPath = path.join(root, '_dev/reports/analysis/task-plans/demo-plan__plan.json');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  delete plan.dart_task_id;
  writeJson(planPath, plan);
  const result = writePlanDiagramPublication(root, {
    taskId: 'demo-plan',
    event: 'manual'
  });
  assert.equal(result.publication.dart.task_id, null);
  assert.equal(result.publication.dart.apply_comment_allowed, false);
  assert.equal(result.publication.links.attachment_request, null);
});

test('pending drawio corrections block overwrite unless forced', () => {
  const root = makeRoot();
  const exported = writeDrawioExport(root, { taskId: 'demo-plan' });
  const diagramPath = path.join(root, exported.diagramPath);
  let xml = fs.readFileSync(diagramPath, 'utf8');
  xml = xml.replace('value="Demo Plan"', 'value="[WRONG] Demo Plan"');
  fs.writeFileSync(diagramPath, xml);

  const pending = pendingDrawioCorrections(root, {
    diagramPath: exported.diagramPath,
    baselinePath: exported.baselinePath
  });
  assert.equal(pending.pending, true);

  assert.throws(() => writePlanDiagramPublication(root, {
    taskId: 'demo-plan',
    event: 'manual'
  }), /Refusing to overwrite/);

  const forced = writePlanDiagramPublication(root, {
    taskId: 'demo-plan',
    event: 'manual',
    force: true
  });
  assert.equal(forced.publication.task_id, 'demo-plan');
});
