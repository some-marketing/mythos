'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  enrichPlanAudiences,
  enrichPlanFile
} = require('../plan-audience-enrichment.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function fixturePlan(step = {}) {
  return {
    schema: 'TaskPlan/1.0',
    task_id: 'audience-enrichment-fixture',
    title: 'Audience enrichment fixture',
    description: 'Fixture plan for deterministic enrichment.',
    source: 'test',
    requested_by: 'test',
    timestamp: '2026-06-24T00:00:00Z',
    scope_type: 'system',
    storage_root: '_dev/reports/analysis/task-plans',
    bounded_plan: {
      steps: [
        {
          step_id: 'S1',
          description: 'Review the source plan and expose gates before publication.',
          framework_step: 'system/planning-tooling',
          mode: 'PATCH_ALLOWED',
          is_gap: true,
          ...step
        }
      ],
      required_gates: [],
      expected_outcomes: [],
      risk_notes: []
    }
  };
}

test('adds missing owner and media buyer what/why fields with per-item provenance', () => {
  const result = enrichPlanAudiences(fixturePlan());
  assert.equal(result.ok, true);
  assert.equal(result.changed, 4);

  const step = result.plan.bounded_plan.steps[0];
  for (const audience of ['owner', 'media_buyer']) {
    for (const field of ['what', 'why']) {
      assert.match(step.audiences[audience][field].text, /source-plan/);
      assert.equal(step.audiences[audience][field].provenance_handle, 'bounded_plan.steps.S1.description');
      assert.equal(step.audiences[audience][field].source_field, 'description');
      assert.equal(step.audiences[audience][field].provenance_state, 'source-derived');
    }
  }
});

test('preserves existing authored fields by default', () => {
  const result = enrichPlanAudiences(fixturePlan({
    audiences: {
      owner: {
        what: {
          text: 'This is intended to keep the existing authored field.',
          provenance_handle: 'bounded_plan.steps.S1.description',
          source_field: 'description',
          provenance_state: 'authored'
        }
      }
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.changed, 3);
  assert.equal(
    result.plan.bounded_plan.steps[0].audiences.owner.what.text,
    'This is intended to keep the existing authored field.'
  );
});

test('fails closed when a candidate does not pass the framing linter', () => {
  const result = enrichPlanAudiences(fixturePlan(), {
    candidateFactory({ field }) {
      return {
        text: field === 'what' ? 'This will guarantee 999 wins.' : 'This will guarantee 999 wins.',
        provenance_handle: 'bounded_plan.steps.S1.description',
        source_field: 'description',
        provenance_state: 'enriched'
      };
    }
  });

  assert.equal(result.ok, false);
  assert.ok(result.lint.findings.some((finding) => finding.code === 'non_observational_framing'));
  assert.ok(result.lint.findings.some((finding) => finding.code === 'unsupported_number'));
});

test('dry-run file enrichment does not mutate source plan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-plan-audience-enrichment-'));
  const planPath = path.join(dir, 'fixture__plan.json');
  const original = fixturePlan();
  fs.writeFileSync(planPath, `${JSON.stringify(original, null, 2)}\n`);

  const result = enrichPlanFile(PROJECT_ROOT, { plan: planPath });
  assert.equal(result.ok, true);
  assert.equal(result.changed, 4);
  assert.deepEqual(JSON.parse(fs.readFileSync(planPath, 'utf8')), original);
});

test('output file writes enriched copy after lint passes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-plan-audience-enrichment-'));
  const planPath = path.join(dir, 'fixture__plan.json');
  const outputPath = path.join(dir, 'fixture-enriched__plan.json');
  fs.writeFileSync(planPath, `${JSON.stringify(fixturePlan(), null, 2)}\n`);

  const result = enrichPlanFile(PROJECT_ROOT, { plan: planPath, outputPath });
  assert.equal(result.ok, true);
  assert.equal(result.output_plan, path.relative(PROJECT_ROOT, outputPath).split(path.sep).join('/'));
  const written = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(written.bounded_plan.steps[0].audiences.owner.what.provenance_state, 'source-derived');
});
