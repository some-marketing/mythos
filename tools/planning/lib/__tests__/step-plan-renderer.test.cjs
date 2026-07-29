'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildStepPlanArtifacts,
  renderStepPlanHtml,
  renderStepPlanMermaid,
  writeStepPlanArtifacts
} = require('../step-plan-renderer.cjs');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-step-plan-'));
  fs.mkdirSync(path.join(root, '_dev/reports/analysis/task-plans'), { recursive: true });
  return root;
}

function writePlan(root, plan) {
  const file = path.join(root, '_dev/reports/analysis/task-plans', `${plan.task_id}__plan.json`);
  fs.writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`);
  return file;
}

function fixturePlan(overrides = {}) {
  return {
    schema: 'TaskPlan/1.0',
    task_id: 'step-render-fixture',
    title: 'Step render fixture',
    task_summary: 'Fixture for step renderer.',
    description: 'A deterministic plan render fixture.',
    source: 'operator',
    requested_by: 'test',
    timestamp: '2026-06-24T00:00:00Z',
    scope_type: 'system',
    storage_root: '_dev/reports/analysis/task-plans',
    bounded_plan: {
      steps: [
        {
          step_id: 'S1',
          stage: 'Prep',
          description: 'Collect source claims before rendering.',
          framework_step: 'paid-media/ad-creative',
          mode: 'BUILD',
          is_gap: true,
          audiences: {
            owner: {
              what: {
                text: 'This is intended to collect source claims before rendering.',
                provenance_handle: 'bounded_plan.steps.S1.description',
                source_field: 'description',
                provenance_state: 'source-derived'
              },
              why: {
                text: 'The hypothesis is that source claims keep approval grounded.',
                provenance_handle: 'bounded_plan.steps.S1.description',
                source_field: 'description',
                provenance_state: 'source-derived'
              }
            },
            media_buyer: {
              what: {
                text: 'This is intended to collect source claims before rendering.',
                provenance_handle: 'bounded_plan.steps.S1.description',
                source_field: 'description',
                provenance_state: 'source-derived'
              },
              why: {
                text: 'The hypothesis is that source claims keep approval grounded.',
                provenance_handle: 'bounded_plan.steps.S1.description',
                source_field: 'description',
                provenance_state: 'source-derived'
              }
            }
          }
        },
        {
          step_id: 'S2',
          stage: 'Build',
          depends_on: ['S1'],
          description: 'Render the step plan.',
          framework_step: 'system/planning-tooling',
          mode: 'PATCH_ALLOWED',
          is_gap: true,
          required_gates: ['Operator reviews the rendered plan'],
          risk_notes: ['Renderer must not call an LLM'],
          expected_outcomes: ['HTML and Mermaid are written']
        }
      ],
      required_gates: ['Decision/risk invariant is visible in every lens'],
      expected_outcomes: ['Step plan artifacts exist'],
      risk_notes: 'Do not hide risk from owner lens'
    },
    ...overrides
  };
}

test('renders deterministic Mermaid and HTML with audience toggles and invariant content', () => {
  const plan = fixturePlan();
  const first = renderStepPlanMermaid(plan);
  const second = renderStepPlanMermaid(plan);
  assert.equal(first, second);
  assert.match(first, /flowchart TD/);
  assert.match(first, /S1/);
  assert.match(first, /S1 -->/);

  const html = renderStepPlanHtml(plan, { generatedAt: '2026-06-24T00:00:00Z' });
  assert.match(html, /data-audience="owner"/);
  assert.match(html, /data-audience="media_buyer"/);
  assert.match(html, /Operator reviews the rendered plan/);
  assert.match(html, /your decision/);
  assert.match(html, /Renderer must not call an LLM/);
  assert.match(html, /technical fallback - not yet voiced/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /cdn/i);
});

test('writes .steps.mmd, .steps.md, and .steps.html artifacts', () => {
  const root = makeRoot();
  const plan = fixturePlan();
  writePlan(root, plan);

  const built = writeStepPlanArtifacts(root, {
    plan: plan.task_id,
    generatedAt: '2026-06-24T00:00:00Z'
  });

  assert.equal(built.schema, 'StepPlanArtifacts/1.0');
  assert.equal(built.lint.ok, true);
  for (const relPath of Object.values(built.paths)) {
    assert.equal(fs.existsSync(path.join(root, relPath)), true, relPath);
  }
  assert.match(fs.readFileSync(path.join(root, built.paths.md), 'utf8'), /```mermaid/);
});

test('artifact build is byte-identical for the same plan input by default', () => {
  const root = makeRoot();
  const plan = fixturePlan();
  writePlan(root, plan);

  const first = buildStepPlanArtifacts(root, { plan: plan.task_id });
  const second = buildStepPlanArtifacts(root, { plan: plan.task_id });

  assert.equal(first.mermaid, second.mermaid);
  assert.equal(first.markdown, second.markdown);
  assert.equal(first.html, second.html);
  assert.match(first.html, /2026-06-24T00:00:00Z/);
});

test('refuses to render when S3 audience lint fails', () => {
  const root = makeRoot();
  const plan = fixturePlan({
    bounded_plan: {
      ...fixturePlan().bounded_plan,
      steps: [
        {
          step_id: 'S1',
          description: 'Render source.',
          framework_step: 'paid-media/ad-creative',
          mode: 'BUILD',
          is_gap: true,
          audiences: {
            owner: {
              what: {
                text: 'This is the highest-leverage move.',
                provenance_handle: 'bounded_plan.steps.S1.description',
                source_field: 'description',
                provenance_state: 'authored'
              }
            }
          }
        }
      ]
    }
  });
  writePlan(root, plan);

  assert.throws(
    () => buildStepPlanArtifacts(root, { plan: plan.task_id }),
    /Plan audience framing lint failed/
  );
});
