'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  buildHarnessRoutingAdvisory,
  coverageSummary,
  formatHarnessRoutingAdvisory,
  modelFreshness,
  rankForRole,
  validateModelShape
} = require('../harness-routing-advisory');

function makeRoot(model) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-routing-advisory-'));
  const dir = path.join(root, '_dev', 'reports', 'analysis');
  fs.mkdirSync(dir, { recursive: true });
  if (model !== undefined) {
    fs.writeFileSync(path.join(dir, 'harness-capability-comparison.json'), JSON.stringify(model, null, 2));
  }
  return root;
}

function capability(id, state, evidencePath = `evidence/${id}.json`) {
  return {
    id,
    label: id,
    state,
    evidence_kind: 'observed',
    evidence_path: evidencePath,
    freshness: '2026-06-25T00:00:00.000Z'
  };
}

function model(timestamp = '2026-06-25T00:00:00.000Z') {
  return {
    schema: 'HarnessCapabilityComparison/1.0',
    timestamp,
    comparison_coverage: {
      required_subjects: ['claude', 'codex', 'gemini'],
      present_subjects: ['claude', 'codex', 'gemini'],
      missing_subjects: [],
      findings: []
    },
    columns: [{ id: 'plan_authority' }],
    matrix: [
      {
        harness: 'codex',
        capabilities: [
          capability('runtime_entrypoints', 'repo_emulated', 'tools/codex/smos-launcher.js'),
          capability('lifecycle_hooks', 'repo_emulated', 'tools/codex/hook-emulator.js'),
          capability('mcp_tools', 'repo_emulated'),
          capability('plan_authority', 'repo_emulated', 'tools/planning/validate-task-plan.js'),
          capability('context_cross_session', 'repo_emulated'),
          capability('operator_surfaces', 'repo_emulated'),
          capability('bridge_convene_suitability', 'adapter_mediated'),
          capability('delegation_orchestration', 'review_only')
        ]
      },
      {
        harness: 'gemini',
        capabilities: [
          capability('runtime_entrypoints', 'adapter_mediated'),
          capability('lifecycle_hooks', 'unsupported'),
          capability('mcp_tools', 'unknown'),
          capability('plan_authority', 'candidate_only', 'tools/planning/translate-gemini-plan-output.js'),
          capability('context_cross_session', 'unknown'),
          capability('operator_surfaces', 'review_only'),
          capability('bridge_convene_suitability', 'review_only'),
          capability('delegation_orchestration', 'review_only')
        ]
      },
      {
        harness: 'claude',
        capabilities: [
          capability('runtime_entrypoints', 'adapter_mediated'),
          capability('lifecycle_hooks', 'adapter_mediated'),
          capability('mcp_tools', 'adapter_mediated'),
          capability('plan_authority', 'repo_emulated'),
          capability('context_cross_session', 'repo_emulated'),
          capability('operator_surfaces', 'adapter_mediated'),
          capability('bridge_convene_suitability', 'adapter_mediated'),
          capability('delegation_orchestration', 'adapter_mediated')
        ]
      }
    ]
  };
}

test('validateModelShape requires comparison schema and matrix', () => {
  assert.deepEqual(validateModelShape(model()), []);
  assert.match(validateModelShape({ schema: 'Other' }).join('\n'), /schema is not HarnessCapabilityComparison/);
  assert.match(validateModelShape({ schema: 'HarnessCapabilityComparison\/1.0' }).join('\n'), /matrix is missing/);
});

test('modelFreshness reports stale comparison models', () => {
  const freshness = modelFreshness(model('2026-06-20T00:00:00.000Z'), '/tmp/model.json', {
    now: '2026-06-25T00:00:00.000Z',
    staleHours: 48,
    projectRoot: '/tmp'
  });
  assert.equal(freshness.state, 'stale');
  assert.match(freshness.warnings[0], /stale/);
});

test('coverageSummary surfaces missing required harness subjects', () => {
  const summary = coverageSummary({
    comparison_coverage: {
      required_subjects: ['claude', 'codex', 'future'],
      present_subjects: ['claude', 'codex'],
      missing_subjects: ['future'],
      findings: [
        {
          harness: 'future',
          observed: 'No inventory rows found for required harness "future".'
        }
      ]
    }
  });

  assert.equal(summary.state, 'warning');
  assert.deepEqual(summary.missing_subjects, ['future']);
  assert.match(summary.warnings.join('\n'), /future/);
});

test('buildHarnessRoutingAdvisory fails soft when model is missing', () => {
  const root = makeRoot(undefined);
  const advisory = buildHarnessRoutingAdvisory(root);
  assert.equal(advisory.status, 'warning');
  assert.match(advisory.warnings[0], /missing/);
  assert.deepEqual(advisory.roles, {});
});

test('buildHarnessRoutingAdvisory fails soft when model JSON is malformed', () => {
  const root = makeRoot(undefined);
  const modelPath = path.join(root, '_dev', 'reports', 'analysis', 'harness-capability-comparison.json');
  fs.writeFileSync(modelPath, '{bad json');
  const advisory = buildHarnessRoutingAdvisory(root);
  assert.equal(advisory.status, 'warning');
  assert.match(advisory.warnings[0], /could not be parsed/);
  assert.deepEqual(advisory.roles, {});
});

test('buildHarnessRoutingAdvisory surfaces stale model warning through formatter', () => {
  const root = makeRoot(model('2026-06-20T00:00:00.000Z'));
  const advisory = buildHarnessRoutingAdvisory(root, {
    now: '2026-06-25T00:00:00.000Z',
    staleHours: 48
  });
  assert.equal(advisory.status, 'warning');
  assert.equal(advisory.freshness.state, 'stale');
  assert.match(formatHarnessRoutingAdvisory(advisory), /Harness comparison is stale/);
});

test('rankForRole preserves evidence and surfaces candidate/repo-emulated caveats', () => {
  const planning = rankForRole(model(), 'planning', { limit: 3 });
  assert.equal(planning[0].harness, 'codex');
  assert.match(planning[0].evidence.evidence_path, /validate-task-plan/);
  assert.equal(planning[0].evidence.freshness, '2026-06-25T00:00:00.000Z');
  assert.ok(planning[0].caveats.some((item) => /repo-emulated/.test(item)));
  const gemini = planning.find((item) => item.harness === 'gemini');
  assert.ok(gemini.caveats.some((item) => /candidate-only/.test(item)));
});

test('formatHarnessRoutingAdvisory renders advisory-only warning and role recommendations', () => {
  const root = makeRoot(model());
  const advisory = buildHarnessRoutingAdvisory(root, {
    task: 'plan a system task',
    now: '2026-06-25T01:00:00.000Z'
  });
  const text = formatHarnessRoutingAdvisory(advisory);
  assert.equal(advisory.status, 'ok');
  assert.match(text, /Coverage: 3\/3 required harness subjects present; missing 0/);
  assert.match(text, /planning:/);
  assert.match(text, /Codex lifecycle hooks are repo-emulated/);
  assert.match(text, /freshness: 2026-06-25T00:00:00.000Z/);
  assert.match(text, /Advisory only: does not dispatch actors/);
});

test('buildHarnessRoutingAdvisory warns when comparison coverage is incomplete', () => {
  const incomplete = model();
  incomplete.comparison_coverage = {
    required_subjects: ['claude', 'codex', 'gemini', 'future'],
    present_subjects: ['claude', 'codex', 'gemini'],
    missing_subjects: ['future'],
    findings: []
  };
  const root = makeRoot(incomplete);
  const advisory = buildHarnessRoutingAdvisory(root, {
    task: 'plan a system task',
    now: '2026-06-25T01:00:00.000Z'
  });
  const text = formatHarnessRoutingAdvisory(advisory);

  assert.equal(advisory.status, 'warning');
  assert.match(advisory.warnings.join('\n'), /future/);
  assert.match(text, /Coverage: 3\/4 required harness subjects present; missing 1/);
  assert.match(text, /required subject "future" is missing/);
  assert.match(text, /planning:/);
});
