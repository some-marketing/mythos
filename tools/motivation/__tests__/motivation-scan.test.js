'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  scan,
  validateLedger,
  LEDGER_PATH,
  REPORT_PATH,
  PROJECT_ROOT
} = require('../motivation-scan');

describe('motivation-scan (read-only, dry-run against the real repo)', () => {
  it('produces a schema-valid ledger object', () => {
    const { ledger, validation } = scan();
    assert.equal(validation.valid, true, `ledger should be schema-valid; errors: ${validation.errors.join('; ')}`);
    assert.equal(ledger.schema, 'MotivationHomeostasisLedger/1.0');
    assert.ok(Array.isArray(ledger.pressures) && ledger.pressures.length > 0);
    // Re-validate independently to be sure the validator agrees.
    const v2 = validateLedger(ledger, []);
    assert.equal(v2.valid, true, `independent validation failed: ${v2.errors.join('; ')}`);
  });

  it('sets uncategorized_signal_count as an integer', () => {
    const { ledger } = scan();
    assert.equal(typeof ledger.uncategorized_signal_count, 'number');
    assert.ok(Number.isInteger(ledger.uncategorized_signal_count));
    assert.ok(ledger.uncategorized_signal_count >= 0);
  });

  it('every pressure carries class, raw_components and keep_open (no label-only output)', () => {
    const { ledger } = scan();
    for (const p of ledger.pressures) {
      assert.ok(['artifact_countable', 'interpretive_assessment'].includes(p.pressure_class));
      assert.equal(typeof p.computed_pressure, 'number');
      assert.equal(typeof p.keep_open, 'boolean');
      assert.ok(p.raw_components && typeof p.raw_components === 'object');
      assert.equal(typeof p.raw_components.observed_count, 'number');
      assert.ok('pre_suppression_pressure' in p.raw_components);
    }
  });

  it('quarantines interpretive pressures from being marked artifact_countable', () => {
    const { ledger } = scan();
    const coverage = ledger.pressures.find((p) => p.id === 'coverage_gaps');
    assert.ok(coverage, 'coverage_gaps pressure should exist');
    assert.equal(coverage.pressure_class, 'interpretive_assessment');
  });

  it('writes nothing when invoked in dry-run (scan() is pure; no output files mutated)', () => {
    const ledgerExistedBefore = fs.existsSync(LEDGER_PATH);
    const reportExistedBefore = fs.existsSync(REPORT_PATH);
    const ledgerStatBefore = ledgerExistedBefore ? fs.statSync(LEDGER_PATH).mtimeMs : null;
    const reportStatBefore = reportExistedBefore ? fs.statSync(REPORT_PATH).mtimeMs : null;

    // scan() performs no writes by contract.
    scan();

    assert.equal(fs.existsSync(LEDGER_PATH), ledgerExistedBefore, 'scan() must not create/remove the ledger file');
    assert.equal(fs.existsSync(REPORT_PATH), reportExistedBefore, 'scan() must not create/remove the report file');
    if (ledgerExistedBefore) {
      assert.equal(fs.statSync(LEDGER_PATH).mtimeMs, ledgerStatBefore, 'scan() must not modify the ledger file');
    }
    if (reportExistedBefore) {
      assert.equal(fs.statSync(REPORT_PATH).mtimeMs, reportStatBefore, 'scan() must not modify the report file');
    }
  });

  it('resolves the repo root from the script location, not cwd', () => {
    assert.equal(PROJECT_ROOT, path.resolve(__dirname, '..', '..', '..'));
    assert.ok(fs.existsSync(path.join(PROJECT_ROOT, '_dev', 'reports', 'analysis', 'task-plans')));
  });
});
