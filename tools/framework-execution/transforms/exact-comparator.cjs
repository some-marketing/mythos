'use strict';

const { makeRecord, sha256, stableJson } = require('./utils.cjs');

function compareExact(left, right, options = {}) {
  const sourceRefs = [options.left_ref || 'left', options.right_ref || 'right'].map((value) => `sha256:${sha256(value)}`);
  if (options.supported === false) {
    return makeRecord({ transform: 'exact_comparator', state: 'unsupported', source_refs: sourceRefs, reason: 'comparison_unsupported' });
  }
  if (options.uncertain === true || left === undefined || right === undefined) {
    return makeRecord({ transform: 'exact_comparator', state: 'unknown', source_refs: sourceRefs, reason: options.uncertain ? 'comparison_uncertain' : 'comparison_value_missing' });
  }
  let leftCanonical;
  let rightCanonical;
  try {
    leftCanonical = stableJson(left);
    rightCanonical = stableJson(right);
  } catch (error) {
    return makeRecord({ transform: 'exact_comparator', state: 'unsupported', source_refs: sourceRefs, reason: String(error.message || 'non_json_value_unsupported') });
  }
  const matches = leftCanonical === rightCanonical;
  const leftSha256 = sha256(leftCanonical);
  const rightSha256 = sha256(rightCanonical);
  return makeRecord({
    transform: 'exact_comparator',
    state: matches ? 'exact' : 'mismatch',
    source_refs: sourceRefs,
    input_sha256: [leftSha256, rightSha256],
    observation: { matches, left_sha256: leftSha256, right_sha256: rightSha256 }
  });
}

module.exports = { compareExact };
