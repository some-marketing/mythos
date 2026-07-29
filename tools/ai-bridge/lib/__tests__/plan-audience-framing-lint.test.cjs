'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { validate } = require('../../../verify/lib/schema.cjs');
const {
  lintPlanAudienceFraming,
  normalizeAudienceField,
  splitSentences
} = require('../plan-audience-framing-lint.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function basePlan(step) {
  return {
    task_id: 'audience-lint-fixture',
    description: 'Fixture plan for audience linting. Source mentions $15/day and {CLIENT_CODE} only when tests need them.',
    source: 'operator',
    requested_by: 'test',
    timestamp: '2026-06-24T00:00:00Z',
    scope_type: 'system',
    storage_root: '_dev/reports/analysis/task-plans',
    bounded_plan: {
      steps: [
        {
          step_id: 'S1',
          description: 'Review current plan language and expose risk before publication.',
          framework_step: 'paid-media/ad-creative',
          mode: 'PATCH_ALLOWED',
          is_gap: true,
          ...step
        }
      ],
      required_gates: [],
      expected_outcomes: [],
      risk_notes: 'fixture'
    }
  };
}

test('normalizes nested and transitional flat audience fields', () => {
  assert.deepEqual(
    normalizeAudienceField({
      what: {
        text: 'Show what changes.',
        provenance_handle: 'bounded_plan.steps.S1.description',
        source_field: 'description',
        provenance_state: 'authored'
      }
    }, 'what'),
    {
      text: 'Show what changes.',
      provenance_handle: 'bounded_plan.steps.S1.description',
      source_field: 'description',
      provenance_state: 'authored',
      shape: 'nested'
    }
  );

  assert.equal(
    normalizeAudienceField({
      what: 'Show what changes.',
      what_provenance: 'bounded_plan.steps.S1.description',
      source: 'authored'
    }, 'what').shape,
    'flat'
  );
});

test('linter catches known prototype framing violations', () => {
  const plan = basePlan({
    audiences: {
      owner: {
        what: {
          text: 'This is the highest-leverage move and a textbook refresh trigger.',
          provenance_handle: 'bounded_plan.steps.S1.description',
          source_field: 'description',
          provenance_state: 'authored'
        },
        why: {
          text: '$15/day likely captures 2-4 more leads.',
          provenance_handle: 'bounded_plan.steps.S1.description',
          source_field: 'description',
          provenance_state: 'authored'
        }
      }
    }
  });

  const result = lintPlanAudienceFraming(plan);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'non_observational_framing' && /highest-leverage/.test(finding.text)));
  assert.ok(result.findings.some((finding) => finding.code === 'non_observational_framing' && /\$15\/day/.test(finding.text)));
  assert.ok(result.findings.some((finding) => finding.code === 'unsupported_number' && finding.value.includes('2-4')));
});

test('observational sourced voicing with nested provenance passes', () => {
  const plan = basePlan({
    description: 'Review {CLIENT_CODE} language. The source says $15/day appears in the source plan as an observed budget input.',
    audiences: {
      owner: {
        what: {
          text: 'This is intended to show {CLIENT_CODE} where the $15/day budget appears before publication.',
          provenance_handle: 'bounded_plan.steps.S1.description',
          source_field: 'description',
          provenance_state: 'source-derived'
        },
        why: {
          text: 'The hypothesis is that the owner can approve from the observed budget input.',
          provenance_handle: 'bounded_plan.steps.S1.description',
          source_field: 'description',
          provenance_state: 'source-derived'
        }
      },
      media_buyer: {
        what: {
          text: 'This is intended to show {CLIENT_CODE} where the $15/day budget appears before publication.',
          provenance_handle: 'bounded_plan.steps.S1.description',
          source_field: 'description',
          provenance_state: 'source-derived'
        },
        why: {
          text: 'The hypothesis is that the media buyer can approve from the observed budget input.',
          provenance_handle: 'bounded_plan.steps.S1.description',
          source_field: 'description',
          provenance_state: 'source-derived'
        }
      }
    }
  });

  const result = lintPlanAudienceFraming(plan);
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
});

test('linter flags missing provenance and claim-type changes across lenses', () => {
  const plan = basePlan({
    audiences: {
      owner: {
        what: 'Show the owner the publication step.',
        why: 'So the owner can approve the plan.'
      },
      media_buyer: {
        what: {
          text: 'Show the buyer the publication step.',
          provenance_handle: 'bounded_plan.steps.S1.description',
          source_field: 'description',
          provenance_state: 'authored'
        },
        why: {
          text: 'This is intended to reduce wasted spend before approval.',
          provenance_handle: 'bounded_plan.steps.S1.description',
          source_field: 'description',
          provenance_state: 'authored'
        }
      }
    }
  });

  const result = lintPlanAudienceFraming(plan);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'missing_provenance_handle'));
  assert.ok(result.findings.some((finding) => finding.code === 'claim_type_mismatch'));
});

test('observational marker only covers the sentence where it appears', () => {
  const plan = basePlan({
    description: 'Review publication risk.',
    audiences: {
      owner: {
        what: {
          text: 'The hypothesis is that the publication step may reduce confusion. This will guarantee approval.',
          provenance_handle: 'bounded_plan.steps.S1.description',
          source_field: 'description',
          provenance_state: 'authored'
        }
      }
    }
  });

  assert.deepEqual(splitSentences('One sentence. Second sentence!'), ['One sentence.', 'Second sentence!']);
  const result = lintPlanAudienceFraming(plan);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'non_observational_framing' && /guarantee approval/.test(finding.text)));
});

test('claim-type mismatch uses owner as canonical baseline when present', () => {
  const plan = basePlan({
    audiences: {
      media_buyer: {
        what: {
          text: 'Show the buyer the publication step.',
          provenance_handle: 'bounded_plan.steps.S1.description',
          source_field: 'description',
          provenance_state: 'authored'
        }
      },
      owner: {
        what: {
          text: 'This is intended to reduce approval risk.',
          provenance_handle: 'bounded_plan.steps.S1.description',
          source_field: 'description',
          provenance_state: 'authored'
        }
      }
    }
  });

  const result = lintPlanAudienceFraming(plan);
  const mismatch = result.findings.find((finding) => finding.code === 'claim_type_mismatch');
  assert.ok(mismatch);
  assert.match(mismatch.value, /^owner:/);
});

test('task-intake schema accepts nested per-item audience provenance', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'tools/planning/task-intake.schema.json'), 'utf8'));
  const plan = basePlan({
    stage_title: 'Publication readiness',
    domain: 'paid_media',
    audiences: {
      owner: {
        what: {
          text: 'Show the owner what will change.',
          provenance_handle: 'bounded_plan.steps.S1.description',
          source_field: 'description',
          provenance_state: 'authored'
        },
        why: {
          text: 'So approval is based on the actual work.',
          provenance_handle: 'bounded_plan.steps.S1.description',
          source_field: 'description',
          provenance_state: 'authored'
        }
      }
    }
  });

  assert.deepEqual(validate(plan, schema, { rootSchema: schema, path: '' }), []);
});
