#!/usr/bin/env node
'use strict';

/**
 * Unit tests for the propose-only ambient router classifier.
 * Stdlib-only assertion harness — run: node tools/kernel/hooks/__tests__/userpromptsubmit-ambient-router.test.cjs
 */

const assert = require('assert');
const { classify, extractPrompt } = require('../userpromptsubmit-ambient-router.cjs');

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  try {
    assert.strictEqual(actual, expected);
    pass++;
  } catch {
    fail++;
    console.error(`  FAIL: ${label} — got "${actual}", expected "${expected}"`);
  }
}

// --- NO-OP cases: must not add ceremony ---
check('empty', classify(''), 'noop');
check('greeting', classify('hey there'), 'noop');
check('ack', classify('thanks, that works'), 'noop');
check('slash command', classify('/owl active-workstreams'), 'noop');
check('bash passthrough', classify('!git status'), 'noop');
check('short', classify('what now'), 'noop');
check('single question', classify('how does the cadence system work?'), 'noop');
check('explanatory question', classify('which file holds the bubble-up rule?'), 'noop');

// --- ENGAGE cases: clear multi-step work ---
check('two verbs', classify('build the router and wire it into settings'), 'engage');
check('verb + then', classify('fix the validator then re-run the tests'), 'engage');
check('verb + enumeration', classify('implement this:\n1. add schema\n2. add hook'), 'engage');
check('verb + long turn', classify(
  'please implement the propose-only ambient router so that plain text engages the orchestrator without me having to type the command at every single interaction here'
), 'engage');
check('numbered multi-ask', classify('1. add attention-request 2. harden the schema 3. promote the breaker'), 'engage');

// --- borderline: single short verb, no markers => stay conservative (noop) ---
check('bare single verb short', classify('run it'), 'noop');

// --- polite MULTI-STEP requests ending in "?" must ENGAGE (Codex review 2026-06-03) ---
check('polite two-verb question', classify('can you build the router and wire it into settings?'), 'engage');
check('polite verb+then question', classify('could you fix the validator then re-run the tests?'), 'engage');
check('polite write request (write+plan = 2 verbs)', classify('can you write up the layer 2 plan for me?'), 'engage');

// --- single-verb one-shots stay NO-OP, even polite or imperative ---
// Convene 20260610T161625Z (fable-process-tier review, finding F2) supersedes the
// 2026-06-03 expectation for the single-verb case: restores "err toward NO-OP";
// under-trigger is recoverable via /owl, over-trigger taxes every session.
check('polite single-verb request', classify('could you provide me with a document of the flowchart?'), 'noop');
check('imperative single-verb one-shot', classify('fix the typo in the readme'), 'noop');
check('polite single-verb edit', classify('can you update the header copy?'), 'noop');

// --- info questions stay NO-OP even when they contain a work-verb token ---
check('info question w/ verb token', classify('does the router run on every prompt?'), 'noop');
check('info "what does X do"', classify('what does the dispatch command do here?'), 'noop');
check('info "how should I"', classify('how should i refactor this module?'), 'noop');

// --- extractPrompt ---
check('extract json prompt', extractPrompt('{"prompt":"build x"}'), 'build x');
check('extract nested input', extractPrompt('{"input":{"prompt":"fix y"}}'), 'fix y');
check('extract raw fallback', extractPrompt('build z and ship it'), 'build z and ship it');
check('extract empty', extractPrompt(''), null);

// --- DURABLE stdin smoke: spawn the real hook end-to-end (resolves the
//     "validation not carried" review finding by archiving reproducible evidence) ---
const { execFileSync } = require('child_process');
const HOOK = require('path').join(__dirname, '..', 'userpromptsubmit-ambient-router.cjs');

function runHook(payload) {
  try {
    return execFileSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  } catch {
    return '__HOOK_ERROR__';
  }
}

function smoke(label, payload, shouldFire) {
  const out = runHook(payload);
  const fired = out.includes('[ambient-router]');
  check(`smoke: ${label}`, fired, shouldFire);
}

smoke('work payload fires', '{"prompt":"build the router and wire it then test","session_id":"s"}', true);
smoke('polite-question payload fires', '{"prompt":"can you build the router and wire it in?","session_id":"s"}', true);
smoke('info-question payload silent', '{"prompt":"how does the cadence system work?","session_id":"s"}', false);
smoke('slash payload silent', '{"prompt":"/owl active-workstreams","session_id":"s"}', false);
smoke('never errors on garbage stdin', 'not json at all', false);

console.log(`\nambient-router classifier: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
