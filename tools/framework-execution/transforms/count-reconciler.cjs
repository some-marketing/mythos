'use strict';

const { makeRecord, sha256 } = require('./utils.cjs');

function reconcileCounts(expected, observed, options = {}) {
  const sourceRefs = [options.expected_ref || 'expected', options.observed_ref || 'observed'].map((value) => `sha256:${sha256(value)}`);
  if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(observed) || expected < 0 || observed < 0 || options.uncertain === true) {
    return makeRecord({ transform: 'count_reconciler', state: 'unknown', source_refs: sourceRefs, reason: 'count_not_exact_nonnegative_integer' });
  }
  return makeRecord({
    transform: 'count_reconciler',
    state: expected === observed ? 'exact' : 'mismatch',
    source_refs: sourceRefs,
    input_sha256: [sha256(expected), sha256(observed)],
    observation: { expected, observed, delta: observed - expected }
  });
}

module.exports = { reconcileCounts };
