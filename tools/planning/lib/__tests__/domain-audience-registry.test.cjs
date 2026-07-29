'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { validate } = require('../../../verify/lib/schema.cjs');
const {
  inferDomainFromFrameworkStep,
  lensForDomain,
  normalizeAudienceKey,
  validateLensCoverage
} = require('../domain-audience-registry');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

test('inferDomainFromFrameworkStep maps paid media and technical domains', () => {
  assert.equal(inferDomainFromFrameworkStep('paid-media/google-ads-search-campaign-build'), 'paid_media');
  assert.equal(inferDomainFromFrameworkStep('system/planning-tooling'), 'developer');
  assert.equal(inferDomainFromFrameworkStep('wordpress/analytics-tracking'), 'analytics');
});

test('lensForDomain supports owner and media buyer, falls back visibly for unpromoted domains', () => {
  assert.equal(lensForDomain('owner').id, 'owner');
  assert.equal(lensForDomain('paid_media').id, 'media_buyer');
  const fallback = lensForDomain('developer');
  assert.equal(fallback.status, 'fallback');
  assert.match(fallback.visible_marker, /not yet voiced/);
});

test('validateLensCoverage requires visible fallback instead of silent omission', () => {
  const coverage = validateLensCoverage([
    { step_id: 's1', framework_step: 'paid-media/ad-creative' },
    { step_id: 's2', framework_step: 'system/planning-tooling' },
    { step_id: 's3', framework_step: 'owner-summary' }
  ]);

  assert.equal(coverage.schema, 'PlanAudienceLensCoverage/1.0');
  assert.equal(coverage.ok, true);
  assert.equal(coverage.rows[0].lens_id, 'media_buyer');
  assert.equal(coverage.rows[1].lens_status, 'fallback');
  assert.match(coverage.rows[1].visible_fallback, /technical fallback/);
  assert.equal(coverage.rows[2].lens_id, 'owner');
});

test('normalizeAudienceKey produces stable additive schema keys', () => {
  assert.equal(normalizeAudienceKey('Media Buyer'), 'media_buyer');
  assert.equal(normalizeAudienceKey(' Owner '), 'owner');
});

test('task-intake schema accepts additive audience fields on bounded steps', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'tools/planning/task-intake.schema.json'), 'utf8'));
  const plan = {
    task_id: 'audience-schema-fixture',
    description: 'Fixture proving additive audience fields.',
    source: 'operator',
    requested_by: 'test',
    timestamp: '2026-06-24T00:00:00Z',
    scope_type: 'system',
    storage_root: '_dev/reports/analysis/task-plans',
    bounded_plan: {
      steps: [
        {
          step_id: 's1',
          stage: 'Discovery',
          depends_on: ['s0'],
          description: 'Render audience-aware plan text.',
          framework_step: 'paid-media/ad-creative',
          mode: 'PATCH_ALLOWED',
          is_gap: true,
          audiences: {
            owner: {
              what: 'Show the owner what will change.',
              why: 'So approval is based on the actual work.',
              what_provenance: 'bounded_plan.steps.s1.description',
              why_provenance: 'bounded_plan.steps.s1.description',
              source: 'authored'
            }
          }
        }
      ],
      required_gates: [],
      expected_outcomes: [],
      risk_notes: 'fixture'
    }
  };

  assert.deepEqual(validate(plan, schema, { rootSchema: schema, path: '' }), []);
});
