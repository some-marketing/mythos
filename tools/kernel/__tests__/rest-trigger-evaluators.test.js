'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { 
  evaluateContextBudget, 
  evaluateConsecutiveReviewFailures,
  evaluateAmbiguityLoad,
  evaluateContradictionDensity
} = require('../lib/rest-trigger-evaluators.cjs');

test('rest-trigger-evaluators: context budget', (t) => {
  assert.strictEqual(evaluateContextBudget(69).triggered, false);
  assert.strictEqual(evaluateContextBudget(70).triggered, true);
  assert.strictEqual(evaluateContextBudget(90).triggered, true);
});

test('rest-trigger-evaluators: consecutive review failures', (t) => {
  const history = [
    { verdict: 'PASS' },
    { verdict: 'NEEDS-ADJUSTMENT' },
    { verdict: 'NEEDS-ADJUSTMENT' }
  ];
  assert.strictEqual(evaluateConsecutiveReviewFailures(history).triggered, false);
  
  history.push({ verdict: 'REJECTED' });
  assert.strictEqual(evaluateConsecutiveReviewFailures(history).triggered, true);
});

test('rest-trigger-evaluators: ambiguity load', (t) => {
  assert.strictEqual(evaluateAmbiguityLoad(['action1']).triggered, false);
  assert.strictEqual(evaluateAmbiguityLoad(['action1', 'action2']).triggered, true);
});

test('rest-trigger-evaluators: contradiction density', (t) => {
  assert.strictEqual(evaluateContradictionDensity([{ contradiction: false }]).triggered, false);
  assert.strictEqual(evaluateContradictionDensity(['direct string contradiction']).triggered, false); // Wait, how is this handled?
  
  // Actually, let's check the code:
  // const contradictionCount = artifacts.filter((item) => {
  //   if (typeof item === 'string') return true;
  //   return !!(item && item.contradiction);
  // }).length;
  
  assert.strictEqual(evaluateContradictionDensity(['c1', 'c2']).triggered, true);
});
