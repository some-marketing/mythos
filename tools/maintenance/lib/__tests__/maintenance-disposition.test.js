'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const { classifyMaintenanceDisposition } = require('../spider-council.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-disposition-'));
  fs.writeFileSync(path.join(root, 'evidence.json'), '{"state":"old"}');
  const finding = { id: 'spider:item', spider_id: 'spider', diet_class: 'drift', severity: 'warning', actionability: 'review', evidence_paths: ['evidence.json'] };
  return { root, finding };
}

test('exact recurrence is duplicate but resolved recurrence reopens', () => {
  const { root, finding } = fixture();
  const first = classifyMaintenanceDisposition({ projectRoot: root, finding });
  assert.equal(classifyMaintenanceDisposition({ projectRoot: root, finding, prior_dispositions: [first] }).state, 'duplicate');
  assert.equal(classifyMaintenanceDisposition({ projectRoot: root, finding, prior_dispositions: [{ ...first, state: 'resolved' }] }).state, 'reopened');
});

test('changed evidence invalidates suppression and collision inconsistency needs semantic review', () => {
  const { root, finding } = fixture();
  const first = classifyMaintenanceDisposition({ projectRoot: root, finding });
  fs.writeFileSync(path.join(root, 'evidence.json'), '{"state":"new"}');
  assert.equal(classifyMaintenanceDisposition({ projectRoot: root, finding, prior_dispositions: [{ ...first, state: 'resolved' }] }).state, 'reopened');
  assert.equal(classifyMaintenanceDisposition({ projectRoot: root, finding, prior_dispositions: [{ ...first, finding_content_sha256: 'f'.repeat(64) }] }).state, 'semantic_review');
});

test('dispositions are advisory append-only and schema rejects suppression authority', () => {
  const { root, finding } = fixture();
  const result = classifyMaintenanceDisposition({ projectRoot: root, finding });
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../maintenance-disposition.schema.json')));
  const ajv = new Ajv2020({ strict: false });
  assert.equal(ajv.validate(schema, result), true, JSON.stringify(ajv.errors));
  assert.equal(ajv.validate(schema, { ...result, can_delete_or_suppress: true }), false);
  assert.equal(result.can_dispatch, false);
});

test('repeated missing evidence remains semantic review and is never duplicate', () => {
  const { root, finding } = fixture();
  finding.evidence_paths = ['missing.json'];
  const first = classifyMaintenanceDisposition({ projectRoot: root, finding });
  assert.equal(first.state, 'semantic_review');
  const repeated = classifyMaintenanceDisposition({ projectRoot: root, finding, prior_dispositions: [first] });
  assert.equal(repeated.state, 'semantic_review');
  assert.notEqual(repeated.state, 'duplicate');
});
