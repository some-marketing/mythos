'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  eventForPlan,
  isPlanJsonPath,
  runPostWritePlanDiagramPublication
} = require('../post-write-plan-diagram-publication.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeRoot(plan = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-diagram-hook-'));
  const planPath = path.join(root, '_dev/reports/analysis/task-plans/demo-plan__plan.json');
  writeJson(planPath, {
    schema: 'TaskPlan/1.0',
    task_id: 'demo-plan',
    title: 'Demo Plan',
    scope_type: 'system',
    status: 'planned',
    bounded_plan: { steps: [{ step_id: 's1', status: 'planned' }] },
    ...plan
  });
  return { root, planPath };
}

function payloadFor(planPath) {
  return {
    tool_name: 'Write',
    tool_input: { file_path: planPath }
  };
}

function fakePublisher(calls) {
  return (root, options) => {
    calls.push({ type: 'publisher', options });
    const visualRoot = path.join(root, '_dev/reports/analysis/visual-plans');
    fs.mkdirSync(visualRoot, { recursive: true });
    fs.writeFileSync(path.join(visualRoot, 'demo-plan.dart-comment.md'), 'Artifact Index for demo-plan\n');
    return {
      paths: {
        publicationPath: '_dev/reports/analysis/visual-plans/demo-plan.publication.json'
      }
    };
  };
}

test('isPlanJsonPath includes task plans and excludes visual outputs', () => {
  assert.equal(isPlanJsonPath('_dev/reports/analysis/task-plans/demo__plan.json'), true);
  assert.equal(isPlanJsonPath('clients/ABC/plans/demo__plan.json'), true);
  assert.equal(isPlanJsonPath('_dev/reports/analysis/visual-plans/demo.publication.json'), false);
});

test('eventForPlan maps completed plans and amendments', () => {
  assert.equal(eventForPlan({ status: 'completed' }, '_dev/reports/analysis/task-plans/demo__plan.json'), 'plan_completed');
  assert.equal(eventForPlan({}, '_dev/reports/analysis/task-plans/demo__amendment__20260623.json'), 'plan_amended');
  assert.equal(eventForPlan({}, '_dev/reports/analysis/task-plans/demo__repair__20260623.json'), 'plan_repaired');
  assert.equal(eventForPlan({ status: 'planned' }, '_dev/reports/analysis/task-plans/demo__plan.json'), 'plan_created');
});

test('hook skips under NODE_ENV=test unless explicitly enabled', () => {
  const { root, planPath } = makeRoot();
  const result = runPostWritePlanDiagramPublication(payloadFor(planPath), {
    projectRoot: root,
    env: { NODE_ENV: 'test' }
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'node-env-test');
});

test('hook publishes, creates Dart task, refreshes packet, and posts artifact comment', () => {
  const { root, planPath } = makeRoot();
  const calls = [];
  const result = runPostWritePlanDiagramPublication(payloadFor(planPath), {
    projectRoot: root,
    env: { NODE_ENV: 'test', SMOS_PLAN_DIAGRAM_HOOKS_TEST: '1' },
    publisher: fakePublisher(calls),
    runCommand(command, args, opts) {
      calls.push({ type: 'command', command, args, env: opts.env });
      const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
      if (!args.includes('--comment-file')) {
        plan.dart_task_id = 'DART123';
        fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
      }
      return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
    }
  });

  assert.equal(result.skipped, false);
  assert.equal(result.taskId, 'demo-plan');
  assert.equal(result.event, 'plan_created');
  assert.equal(calls.filter((call) => call.type === 'publisher').length, 2);
  const commandCalls = calls.filter((call) => call.type === 'command');
  assert.equal(commandCalls.length, 2);
  assert.equal(commandCalls[0].args.includes('--comment-file'), false);
  assert.equal(commandCalls[1].args.includes('--comment-file'), true);
  assert.equal(commandCalls[0].env.CLAUDE_PROJECT_DIR, root);
  assert.equal(commandCalls[1].env.CLAUDE_PROJECT_DIR, root);
});

test('hook emits readable-doc-written alongside publication-written without clobbering it', () => {
  const { root, planPath } = makeRoot();
  const calls = [];
  const result = runPostWritePlanDiagramPublication(payloadFor(planPath), {
    projectRoot: root,
    env: { NODE_ENV: 'test', SMOS_PLAN_DIAGRAM_HOOKS_TEST: '1' },
    publisher: fakePublisher(calls),
    readableDocRenderer: () => '<!doctype html><title>readable demo-plan</title>',
    runCommand(command, args, opts) {
      calls.push({ type: 'command', command, args, env: opts.env });
      const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
      if (!args.includes('--comment-file')) {
        plan.dart_task_id = 'DART123';
        fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
      }
      return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
    }
  });

  assert.equal(result.skipped, false);
  const actionNames = result.actions.map((action) => action.action);
  assert.ok(actionNames.includes('publication-written'), 'existing publication still fires');
  assert.ok(actionNames.includes('readable-doc-written'), 'readable doc is emitted');
  // The readable doc is written next to the diagram at <taskId>.plan.html.
  const readableAction = result.actions.find((action) => action.action === 'readable-doc-written');
  assert.equal(readableAction.readable_doc, '_dev/reports/analysis/visual-plans/demo-plan.plan.html');
  const docPath = path.join(root, '_dev/reports/analysis/visual-plans/demo-plan.plan.html');
  assert.equal(fs.existsSync(docPath), true);
  assert.match(fs.readFileSync(docPath, 'utf8'), /readable demo-plan/);
});

test('hook emits step-plan-written alongside publication and readable doc', () => {
  const { root, planPath } = makeRoot();
  const calls = [];
  const result = runPostWritePlanDiagramPublication(payloadFor(planPath), {
    projectRoot: root,
    env: { NODE_ENV: 'test', SMOS_PLAN_DIAGRAM_HOOKS_TEST: '1' },
    publisher: fakePublisher(calls),
    readableDocRenderer: () => '<!doctype html><title>readable demo-plan</title>',
    stepPlanWriter(projectRootPath, options) {
      calls.push({ type: 'step-plan', options });
      const visualRoot = path.join(projectRootPath, '_dev/reports/analysis/visual-plans');
      fs.mkdirSync(visualRoot, { recursive: true });
      fs.writeFileSync(path.join(visualRoot, 'demo-plan.steps.html'), '<!doctype html><title>steps</title>');
      return {
        paths: {
          mmd: '_dev/reports/analysis/visual-plans/demo-plan.steps.mmd',
          md: '_dev/reports/analysis/visual-plans/demo-plan.steps.md',
          html: '_dev/reports/analysis/visual-plans/demo-plan.steps.html'
        }
      };
    },
    runCommand(command, args, opts) {
      calls.push({ type: 'command', command, args, env: opts.env });
      const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
      if (!args.includes('--comment-file')) {
        plan.dart_task_id = 'DART123';
        fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
      }
      return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
    }
  });

  assert.equal(result.skipped, false);
  const actionNames = result.actions.map((action) => action.action);
  assert.ok(actionNames.includes('publication-written'));
  assert.ok(actionNames.includes('readable-doc-written'));
  assert.ok(actionNames.includes('step-plan-written'));
  const stepAction = result.actions.find((action) => action.action === 'step-plan-written');
  assert.equal(stepAction.step_plan.html, '_dev/reports/analysis/visual-plans/demo-plan.steps.html');
  assert.equal(calls.some((call) => call.type === 'step-plan' && call.options.plan === 'demo-plan'), true);
});

test('hook fails open to step-plan-skipped when step renderer refuses', () => {
  const { root, planPath } = makeRoot();
  const calls = [];
  const result = runPostWritePlanDiagramPublication(payloadFor(planPath), {
    projectRoot: root,
    env: { NODE_ENV: 'test', SMOS_PLAN_DIAGRAM_HOOKS_TEST: '1' },
    publisher: fakePublisher(calls),
    readableDocRenderer: () => '<!doctype html><title>readable demo-plan</title>',
    stepPlanWriter() { throw new Error('step lint failed'); },
    runCommand(command, args, opts) {
      calls.push({ type: 'command', command, args, env: opts.env });
      const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
      if (!args.includes('--comment-file')) {
        plan.dart_task_id = 'DART123';
        fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
      }
      return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
    }
  });

  assert.equal(result.skipped, false);
  assert.equal(result.error, undefined);
  const actionNames = result.actions.map((action) => action.action);
  assert.ok(actionNames.includes('publication-written'));
  assert.ok(actionNames.includes('readable-doc-written'));
  assert.ok(actionNames.includes('step-plan-skipped'));
  const skipped = result.actions.find((action) => action.action === 'step-plan-skipped');
  assert.match(skipped.reason, /step lint failed/);
});

test('hook fails open to readable-doc-skipped when the readable renderer throws', () => {
  const { root, planPath } = makeRoot();
  const calls = [];
  const result = runPostWritePlanDiagramPublication(payloadFor(planPath), {
    projectRoot: root,
    env: { NODE_ENV: 'test', SMOS_PLAN_DIAGRAM_HOOKS_TEST: '1' },
    publisher: fakePublisher(calls),
    readableDocRenderer: () => { throw new Error('renderer boom'); },
    runCommand(command, args, opts) {
      calls.push({ type: 'command', command, args, env: opts.env });
      const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
      if (!args.includes('--comment-file')) {
        plan.dart_task_id = 'DART123';
        fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
      }
      return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
    }
  });

  // Fail-open: hook returns cleanly, no error surfaced, no throw escapes.
  assert.equal(result.skipped, false);
  assert.equal(result.error, undefined);
  const actionNames = result.actions.map((action) => action.action);
  // Publication still happened despite the readable-doc failure.
  assert.ok(actionNames.includes('publication-written'), 'publication is unaffected by readable-doc failure');
  // The readable doc was skipped, not written, and the failure reason is recorded.
  assert.ok(actionNames.includes('readable-doc-skipped'), 'readable doc reports skipped');
  assert.equal(actionNames.includes('readable-doc-written'), false);
  const skipped = result.actions.find((action) => action.action === 'readable-doc-skipped');
  assert.match(skipped.reason, /renderer boom/);
  // No partial readable doc left on disk.
  assert.equal(fs.existsSync(path.join(root, '_dev/reports/analysis/visual-plans/demo-plan.plan.html')), false);
});

// ── Plandoc-specific tests ────────────────────────────────────────────────────

test('plandoc: SMOS_PLANDOC_ENABLED absent → no plandoc-written action', () => {
  const { root, planPath } = makeRoot();
  const calls = [];
  const result = runPostWritePlanDiagramPublication(payloadFor(planPath), {
    projectRoot: root,
    env: { NODE_ENV: 'test', SMOS_PLAN_DIAGRAM_HOOKS_TEST: '1' },
    publisher: fakePublisher(calls),
    readableDocRenderer: () => '<!doctype html><title>readable</title>',
    stepPlanWriter: () => ({ paths: {} }),
    runCommand(command, args) {
      const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
      if (!args.includes('--comment-file')) {
        plan.dart_task_id = 'DART123';
        fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
      }
      return { status: 0, stdout: '', stderr: '' };
    }
  });
  assert.equal(result.skipped, false);
  const actionNames = result.actions.map((a) => a.action);
  assert.equal(actionNames.includes('plandoc-written'), false);
  assert.equal(actionNames.includes('plandoc-skipped'), false);
});

test('plandoc: SMOS_PLANDOC_ENABLED=1 with working renderer writes .plandoc.html and records plandoc_path', () => {
  const { root, planPath } = makeRoot();
  const calls = [];
  const result = runPostWritePlanDiagramPublication(payloadFor(planPath), {
    projectRoot: root,
    env: { NODE_ENV: 'test', SMOS_PLAN_DIAGRAM_HOOKS_TEST: '1', SMOS_PLANDOC_ENABLED: '1' },
    publisher: fakePublisher(calls),
    readableDocRenderer: () => '<!doctype html><title>readable</title>',
    plandocRenderer: () => '<!doctype html><title>plandoc demo-plan</title>',
    stepPlanWriter: () => ({ paths: {} }),
    runCommand(command, args) {
      const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
      if (!args.includes('--comment-file')) {
        plan.dart_task_id = 'DART123';
        fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
      }
      return { status: 0, stdout: '', stderr: '' };
    }
  });
  assert.equal(result.skipped, false);
  const plandocAction = result.actions.find((a) => a.action === 'plandoc-written');
  assert.ok(plandocAction, 'plandoc-written action should be present');
  assert.equal(plandocAction.plandoc, '_dev/reports/analysis/visual-plans/demo-plan.plandoc.html');
  const htmlPath = path.join(root, '_dev/reports/analysis/visual-plans/demo-plan.plandoc.html');
  assert.equal(fs.existsSync(htmlPath), true);
  assert.match(fs.readFileSync(htmlPath, 'utf8'), /plandoc demo-plan/);
});

test('plandoc: render throws → fail-open, records plandoc_error, emits blocked signal, preserves readable-doc and step-plan actions', () => {
  const { root, planPath } = makeRoot();
  const calls = [];
  const result = runPostWritePlanDiagramPublication(payloadFor(planPath), {
    projectRoot: root,
    env: { NODE_ENV: 'test', SMOS_PLAN_DIAGRAM_HOOKS_TEST: '1', SMOS_PLANDOC_ENABLED: '1' },
    publisher: fakePublisher(calls),
    readableDocRenderer: () => '<!doctype html><title>readable</title>',
    plandocRenderer: () => { throw new Error('plandoc render boom'); },
    stepPlanWriter(projectRootPath) {
      const visualRoot = path.join(projectRootPath, '_dev/reports/analysis/visual-plans');
      fs.mkdirSync(visualRoot, { recursive: true });
      fs.writeFileSync(path.join(visualRoot, 'demo-plan.steps.html'), '<!doctype html>');
      return { paths: { html: '_dev/reports/analysis/visual-plans/demo-plan.steps.html' } };
    },
    runCommand(command, args) {
      const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
      if (!args.includes('--comment-file')) {
        plan.dart_task_id = 'DART123';
        fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
      }
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result.skipped, false);
  assert.equal(result.error, undefined);

  const actionNames = result.actions.map((a) => a.action);
  assert.ok(actionNames.includes('publication-written'), 'publication still fires');
  assert.ok(actionNames.includes('readable-doc-written'), 'readable-doc still fires');
  assert.ok(actionNames.includes('step-plan-written'), 'step-plan still fires');
  assert.ok(actionNames.includes('plandoc-skipped'), 'plandoc-skipped action recorded');

  const plandocSkipped = result.actions.find((a) => a.action === 'plandoc-skipped');
  assert.match(plandocSkipped.reason, /plandoc render boom/);

  assert.equal(
    fs.existsSync(path.join(root, '_dev/reports/analysis/visual-plans/demo-plan.plandoc.html')),
    false,
    'no partial .plandoc.html left on disk'
  );

  // Blocked signal emitted with canonical type and correct scope
  const signalDir = path.join(root, '_dev/reports/signals');
  const signalFiles = fs.existsSync(signalDir)
    ? fs.readdirSync(signalDir).filter((f) => f.startsWith('blocked__') && f.includes('plandoc-hook-failures'))
    : [];
  assert.ok(signalFiles.length > 0, 'blocked plandoc-hook-failures signal file emitted');
  const signal = JSON.parse(fs.readFileSync(path.join(signalDir, signalFiles[0]), 'utf8'));
  assert.equal(signal.signal_type, 'blocked');
  assert.match(signal.scope, /plandoc-hook-failures:demo-plan/);
});

test('hook dedupes unchanged Dart artifact comments', () => {
  const { root, planPath } = makeRoot({ dart_task_id: 'DART123' });
  const calls = [];
  const options = {
    projectRoot: root,
    env: { NODE_ENV: 'test', SMOS_PLAN_DIAGRAM_HOOKS_TEST: '1' },
    publisher: fakePublisher(calls),
    runCommand(command, args, opts) {
      calls.push({ type: 'command', command, args, env: opts.env });
      return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
    }
  };

  const first = runPostWritePlanDiagramPublication(payloadFor(planPath), options);
  const second = runPostWritePlanDiagramPublication(payloadFor(planPath), options);

  assert.equal(first.actions.some((action) => action.action === 'dart-comment-attempted'), true);
  assert.equal(second.actions.some((action) => action.action === 'dart-comment-skipped'), true);
  assert.equal(calls.filter((call) => call.type === 'command').length, 1);
});
