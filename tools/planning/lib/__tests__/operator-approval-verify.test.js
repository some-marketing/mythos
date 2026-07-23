'use strict';

/**
 * B2 / B3 / G-COND-2 / G-COND-3 (plan-approval-surface) — the operator approval
 * verifier (identity-based Dart proof PRIMARY, HMAC fallback), the HMAC stamp
 * helpers, and the Dart-identity precondition monitor.
 *
 * NO LIVE NETWORK / NO LIVE SECRET STORE: the Dart API is an injected stub and
 * the HMAC secret is injected directly.
 *
 * Run: node --test tools/planning/lib/__tests__/operator-approval-verify.test.js
 */

const test = require('node:test');
const assert = require('node:assert');

const verify = require('../operator-approval-verify');
const stamp = require('../../stamp-plan');
const precondition = require('../../../kernel/lib/dart-identity-precondition');

const PLAN_ID = 'plan-x';
const PLAN_TEXT = JSON.stringify({ task_id: PLAN_ID, bounded_plan: { steps: [{ step_id: 's1' }] } });
const SHA = verify.computePlanSha256(PLAN_TEXT);
const CONVENTION = verify.buildApprovalConventionString(PLAN_ID, SHA); // "APPROVE-RUN plan-x <sha12>"
const OPERATOR = { duid: 'usr_{OPERATOR_NAME}', name: '{OPERATOR_NAME}', email: 'get@example-agency.com' };

function dartStub(comment) {
  return { getCommentAuthor: async () => comment };
}
const dartUnreachable = {
  getCommentAuthor: async () => { throw new Error('ENOTFOUND app.dartai.com'); }
};

// ── computePlanSha256 ────────────────────────────────────────────────────────

test('computePlanSha256 is deterministic and changes when the plan is edited', () => {
  assert.strictEqual(verify.computePlanSha256(PLAN_TEXT), SHA);
  assert.notStrictEqual(verify.computePlanSha256(PLAN_TEXT + ' '), SHA);
});

// ── B2: Dart-authorship path ─────────────────────────────────────────────────

test('(1) operator-authored + convention + sha-bound comment -> verified:true (dart)', async () => {
  const comment = { commentId: 'c1', authorDuid: 'usr_{OPERATOR_NAME}', authorName: '{OPERATOR_NAME}', text: CONVENTION };
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, taskId: 't1', citedCommentId: 'c1',
    operatorIdentity: OPERATOR, dartApi: dartStub(comment)
  });
  assert.strictEqual(r.verified, true, r.reason);
  assert.strictEqual(r.mechanism, 'dart');
});

test('(2) non-operator author -> verified:false', async () => {
  const comment = { commentId: 'c1', authorDuid: 'usr_smos', authorName: 'Mythos', text: CONVENTION };
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, taskId: 't1', citedCommentId: 'c1',
    operatorIdentity: OPERATOR, dartApi: dartStub(comment)
  });
  assert.strictEqual(r.verified, false);
  assert.match(r.reason, /not the allowlisted operator|not operator-authored/);
});

test('(3) plan edited after approval (sha256 mismatch) -> verified:false', async () => {
  // Comment cites the prefix of an OLD digest; current plan digest differs.
  const staleConvention = verify.buildApprovalConventionString(PLAN_ID, verify.computePlanSha256('OLD PLAN BODY'));
  const comment = { commentId: 'c1', authorDuid: 'usr_{OPERATOR_NAME}', text: staleConvention };
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, taskId: 't1', citedCommentId: 'c1',
    operatorIdentity: OPERATOR, dartApi: dartStub(comment)
  });
  assert.strictEqual(r.verified, false);
  assert.match(r.reason, /not a prefix of the current plan digest|edited/);
});

test('(4) convention mismatch -> false AND reason carries the EXACT phrase to use (grounding #1)', async () => {
  const comment = { commentId: 'c1', authorDuid: 'usr_{OPERATOR_NAME}', text: 'looks good, approved' };
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, taskId: 't1', citedCommentId: 'c1',
    operatorIdentity: OPERATOR, dartApi: dartStub(comment)
  });
  assert.strictEqual(r.verified, false);
  // The legible-scribe guidance must contain the exact literal the operator should type.
  assert.ok(r.reason.includes(CONVENTION), 'reason must include the exact phrase: ' + CONVENTION);
});

test('(5) hand-written operator_stamp with no backing real comment -> verified:false', async () => {
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, taskId: 't1', citedCommentId: 'c_ghost',
    operatorIdentity: OPERATOR, dartApi: dartStub(null) // comment not found
  });
  assert.strictEqual(r.verified, false);
  assert.match(r.reason, /was not found on Dart task/);
});

// ── G-COND-2: fail-closed on Dart unreachable ────────────────────────────────

test('G-COND-2: Dart unreachable + NO HMAC -> verified:false (fail-closed)', async () => {
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, taskId: 't1', citedCommentId: 'c1',
    operatorIdentity: OPERATOR, dartApi: dartUnreachable
  });
  assert.strictEqual(r.verified, false);
  assert.match(r.reason, /unreachable.*FAIL-CLOSED|FAIL-CLOSED/);
});

test('G-COND-2: Dart unreachable + VALID HMAC stamp -> verified:true (hmac fallback)', async () => {
  const secret = 'operator-secret-1234567890';
  const hmacStamp = stamp.buildStamp(secret, { planId: PLAN_ID, planSha256: SHA });
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, taskId: 't1', citedCommentId: 'c1',
    operatorIdentity: OPERATOR, dartApi: dartUnreachable,
    hmacStamp, hmacSecret: secret
  });
  assert.strictEqual(r.verified, true, r.reason);
  assert.strictEqual(r.mechanism, 'hmac');
});

// ── G-COND-3: operator-token-present forces fallback ─────────────────────────

test('G-COND-3: forceFallback precondition disables the Dart path; valid Dart comment alone is NOT enough', async () => {
  const comment = { commentId: 'c1', authorDuid: 'usr_{OPERATOR_NAME}', text: CONVENTION };
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, taskId: 't1', citedCommentId: 'c1',
    operatorIdentity: OPERATOR, dartApi: dartStub(comment),
    dartPrecondition: { forceFallback: true, reason: 'resident Dart token is NOT the Mythos identity' }
  });
  assert.strictEqual(r.verified, false);
  assert.match(r.reason, /HMAC|fallback/);
});

test('G-COND-3: forceFallback + valid HMAC stamp -> verified:true', async () => {
  const secret = 'operator-secret-1234567890';
  const hmacStamp = stamp.buildStamp(secret, { planId: PLAN_ID, planSha256: SHA });
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, taskId: 't1', citedCommentId: 'c1',
    operatorIdentity: OPERATOR, dartApi: dartStub({ commentId: 'c1', authorDuid: 'usr_{OPERATOR_NAME}', text: CONVENTION }),
    dartPrecondition: { forceFallback: true, reason: 'forced' },
    hmacStamp, hmacSecret: secret
  });
  assert.strictEqual(r.verified, true, r.reason);
  assert.strictEqual(r.mechanism, 'hmac');
});

// ── B3: HMAC stamp helpers (un-forgeable without the secret) ──────────────────

test('B3: valid HMAC stamp verifies; mutating plan_id / plan_sha256 / secret fails', () => {
  const secret = 's3cr3t-operator-key-abcdef';
  const s = stamp.buildStamp(secret, { planId: PLAN_ID, planSha256: SHA });
  assert.strictEqual(stamp.verifyHmacStamp(secret, s, { planId: PLAN_ID, planSha256: SHA }).ok, true);
  // wrong expected plan_id
  assert.strictEqual(stamp.verifyHmacStamp(secret, s, { planId: 'other', planSha256: SHA }).ok, false);
  // wrong expected sha (plan edited)
  assert.strictEqual(stamp.verifyHmacStamp(secret, s, { planId: PLAN_ID, planSha256: 'deadbeef' }).ok, false);
  // wrong secret (agent without the secret cannot forge)
  assert.strictEqual(stamp.verifyHmacStamp('not-the-secret', s, { planId: PLAN_ID, planSha256: SHA }).ok, false);
  // tampered mac
  const tampered = Object.assign({}, s, { mac: 'f'.repeat(64) });
  assert.strictEqual(stamp.verifyHmacStamp(secret, tampered, { planId: PLAN_ID, planSha256: SHA }).ok, false);
});

test('B3: no secret available -> verify fails closed (agent env has no secret)', () => {
  const s = stamp.buildStamp('the-secret', { planId: PLAN_ID, planSha256: SHA });
  assert.strictEqual(stamp.verifyHmacStamp(null, s, { planId: PLAN_ID, planSha256: SHA }).ok, false);
  assert.strictEqual(stamp.verifyHmacStamp('', s, { planId: PLAN_ID, planSha256: SHA }).ok, false);
});

// ── G-COND-3 monitor: dart-identity-precondition ─────────────────────────────

test('precondition: resident token IS Mythos -> ok, Dart path permitted', async () => {
  const r = await precondition.assertDartIdentityPrecondition({
    getConfig: async () => ({ user: { name: 'Mythos', email: 'user@example.com' } })
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.forceFallback, false);
  assert.strictEqual(r.dartAuthorshipPermitted, true);
});

test('precondition: resident token is NOT Mythos (operator token on-machine) -> forceFallback', async () => {
  const r = await precondition.assertDartIdentityPrecondition({
    getConfig: async () => ({ user: { name: '{OPERATOR_NAME}', email: 'get@example-agency.com' } })
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.forceFallback, true);
  assert.match(r.reason, /NOT the Mythos identity/);
});

test('precondition: Dart config unreadable -> fail-closed (forceFallback)', async () => {
  const r = await precondition.assertDartIdentityPrecondition({
    getConfig: async () => { throw new Error('network down'); }
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.forceFallback, true);
  assert.match(r.reason, /FAIL-CLOSED/);
});

// ── Stage E REJECT repairs: F1 / F2 / F3 ─────────────────────────────────────

// F1 — the default verifier path must NOT accept an env-only HMAC secret.
test('F1: env-only secret -> verifyOperatorApproval does NOT verify (agent cannot forge via process.env)', async () => {
  const secret = 'env-planted-secret-1234567890';
  const prev = process.env.MYTHOS_OPERATOR_APPROVAL_SECRET;
  process.env.MYTHOS_OPERATOR_APPROVAL_SECRET = secret;
  try {
    const hmacStamp = stamp.buildStamp(secret, { planId: PLAN_ID, planSha256: SHA });
    // NOTE: no hmacSecret injected -> default resolver runs (Keychain-only).
    const r = await verify.verifyOperatorApproval({
      planId: PLAN_ID, planText: PLAN_TEXT, taskId: 't1', citedCommentId: 'c1',
      operatorIdentity: OPERATOR, dartApi: dartUnreachable, hmacStamp
    });
    assert.strictEqual(r.verified, false, 'env-only secret must not authorize: ' + r.reason);
  } finally {
    if (prev === undefined) delete process.env.MYTHOS_OPERATOR_APPROVAL_SECRET;
    else process.env.MYTHOS_OPERATOR_APPROVAL_SECRET = prev;
  }
});

test('F1: resolveOperatorSecret ignores env by default; reads it ONLY under allowEnvSecret', () => {
  const env = { MYTHOS_OPERATOR_APPROVAL_SECRET: 'x-secret-123' };
  // runSecurity stub returns nothing so Keychain yields null.
  const noKeychain = () => '';
  assert.strictEqual(stamp.resolveOperatorSecret({ env, runSecurity: noKeychain }), null, 'default must not read env');
  assert.strictEqual(stamp.resolveOperatorSecret({ env, runSecurity: noKeychain, allowEnvSecret: true }), 'x-secret-123');
});

// F2 — convention matcher must be LINE-EXACT.
test('F2: prefixed instructional text is rejected (not authority)', () => {
  const m = verify.matchApprovalConvention('Please type ' + CONVENTION + ' in the approval box', PLAN_ID, SHA);
  assert.strictEqual(m.ok, false);
  assert.ok(m.reason.includes(CONVENTION), 'rejection still carries exact-phrase guidance (#1)');
});

test('F2: suffixed instructional text is rejected (not authority)', () => {
  const m = verify.matchApprovalConvention(CONVENTION + ' and then continue', PLAN_ID, SHA);
  assert.strictEqual(m.ok, false);
});

test('F2: ONLY the exact line is accepted (incl. as its own line amid other text)', () => {
  assert.strictEqual(verify.matchApprovalConvention(CONVENTION, PLAN_ID, SHA).ok, true);
  assert.strictEqual(verify.matchApprovalConvention('  ' + CONVENTION + '  ', PLAN_ID, SHA).ok, true);
  assert.strictEqual(
    verify.matchApprovalConvention('Approving now:\n' + CONVENTION + '\nthanks', PLAN_ID, SHA).ok,
    true,
    'exact line on its own line is authority even with surrounding lines'
  );
});

test('F2 (end-to-end): prefixed instructional comment -> verifyOperatorApproval false + guidance', async () => {
  const comment = { commentId: 'c1', authorDuid: 'usr_{OPERATOR_NAME}', text: 'Please type ' + CONVENTION + ' here' };
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, taskId: 't1', citedCommentId: 'c1',
    operatorIdentity: OPERATOR, dartApi: dartStub(comment)
  });
  assert.strictEqual(r.verified, false);
  assert.ok(r.reason.includes(CONVENTION));
});

// F3 — name-only author is never authority.
test('F3: name-only author (no duid/email) -> verified:false (spoofable, insufficient)', async () => {
  const comment = { commentId: 'c1', authorName: '{OPERATOR_NAME}', text: CONVENTION }; // no duid, no email
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, taskId: 't1', citedCommentId: 'c1',
    operatorIdentity: OPERATOR, dartApi: dartStub(comment)
  });
  assert.strictEqual(r.verified, false);
  assert.match(r.reason, /display-name|strong identifier|duid or email/i);
});

test('F3: email-matched author (strong id) still verifies', async () => {
  const comment = { commentId: 'c1', authorEmail: 'get@example-agency.com', text: CONVENTION };
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, taskId: 't1', citedCommentId: 'c1',
    operatorIdentity: OPERATOR, dartApi: dartStub(comment)
  });
  assert.strictEqual(r.verified, true, r.reason);
  assert.strictEqual(r.mechanism, 'dart');
});

test('F3: authorMatchesOperator + hasStrongAuthorId reject name-only evidence', () => {
  assert.strictEqual(verify.hasStrongAuthorId({ authorName: '{OPERATOR_NAME}' }), false);
  assert.strictEqual(verify.hasStrongAuthorId({ authorDuid: 'usr_{OPERATOR_NAME}' }), true);
  assert.strictEqual(verify.hasStrongAuthorId({ authorEmail: 'x@y.z' }), true);
  assert.strictEqual(verify.authorMatchesOperator({ authorName: '{OPERATOR_NAME}' }, { name: '{OPERATOR_NAME}' }), false);
  assert.strictEqual(verify.authorMatchesOperator({ authorDuid: 'usr_{OPERATOR_NAME}' }, { duid: 'usr_{OPERATOR_NAME}' }), true);
});

// ── Friendly approval path: Dart status move + directory-resolved comment ─────

const DART_CONFIG = {
  user: { name: 'Mythos', email: 'user@example.com' }, // automation identity
  assignees: [
    { name: '{OPERATOR_NAME}', email: 'get@example-agency.com' },
    { name: 'Mythos', email: 'user@example.com' }
  ]
};
const approvedTask = async () => ({ status: 'Approved to Run' });
// F1 (Stage E repair): the friendly path now REQUIRES the exact APPROVE-RUN line
// in the operator comment text — not a bare "Approved". Default fixtures use it.
const commentsBy = (author, text = CONVENTION) => async () => ({ results: [{ id: 'k1', author, taskId: 'T1', text }] });

function statusApproval(overrides = {}) {
  return Object.assign({
    dartTaskId: 'T1',
    boundSha256: SHA,
    dartConfig: DART_CONFIG,
    getTask: approvedTask,
    listComments: commentsBy('{OPERATOR_NAME}')
  }, overrides);
}

test('directory: resolveAuthorToAccount unique match -> email; 0 or >1 -> fail closed', () => {
  assert.strictEqual(verify.resolveAuthorToAccount('{OPERATOR_NAME}', DART_CONFIG).email, 'get@example-agency.com');
  assert.strictEqual(verify.resolveAuthorToAccount('Ghost', DART_CONFIG).ok, false);
  const ambig = { assignees: [{ name: '{OPERATOR_NAME}', email: 'a@x' }, { name: '{OPERATOR_NAME}', email: 'b@x' }] };
  assert.strictEqual(verify.resolveAuthorToAccount('{OPERATOR_NAME}', ambig).ok, false);
});

test('F3/Q3: directory match is case-/whitespace-insensitive but still unique-guarded', () => {
  // "{OPERATOR_NAME}" / " {OPERATOR_NAME} " resolve to the "{OPERATOR_NAME}" directory entry.
  assert.strictEqual(verify.resolveAuthorToAccount('{OPERATOR_NAME}', DART_CONFIG).email, 'get@example-agency.com');
  assert.strictEqual(verify.resolveAuthorToAccount('  {OPERATOR_NAME}  ', DART_CONFIG).email, 'get@example-agency.com');
  // Collision is still detected after normalization.
  const ambig = { assignees: [{ name: '{OPERATOR_NAME}', email: 'a@x' }, { name: '{OPERATOR_NAME}', email: 'b@x' }] };
  assert.strictEqual(verify.resolveAuthorToAccount('{OPERATOR_NAME}', ambig).ok, false);
});

test('friendly: operator {OPERATOR_NAME} comment + status Approved to Run + hash match + EXACT line -> verified:true (dart-status)', async () => {
  const r = await verify.verifyOperatorApproval({ planId: PLAN_ID, planText: PLAN_TEXT, statusApproval: statusApproval() });
  assert.strictEqual(r.verified, true, r.reason);
  assert.strictEqual(r.mechanism, 'dart-status');
});

test('F1: status approved + operator author + bound hash but comment text "Approved" (not the exact line) -> verified:false WITH guidance', async () => {
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT,
    statusApproval: statusApproval({ listComments: commentsBy('{OPERATOR_NAME}', 'Approved') })
  });
  assert.strictEqual(r.verified, false);
  // exact-phrase guidance must be present so the operator can paste the right line.
  assert.ok(r.reason.includes(CONVENTION), 'reason must carry the exact phrase: ' + CONVENTION);
});

test('F1: same card with the EXACT APPROVE-RUN line in the comment -> verified:true', async () => {
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT,
    statusApproval: statusApproval({ listComments: commentsBy('{OPERATOR_NAME}', CONVENTION) })
  });
  assert.strictEqual(r.verified, true, r.reason);
  assert.strictEqual(r.mechanism, 'dart-status');
});

test('F3/Q3 (end-to-end): lowercase author "{OPERATOR_NAME}" still resolves + verifies', async () => {
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT,
    statusApproval: statusApproval({ listComments: commentsBy('{OPERATOR_NAME}', CONVENTION) })
  });
  assert.strictEqual(r.verified, true, r.reason);
});

test('friendly: automation Mythos comment (status approved) -> verified:false (self-approval / not operator)', async () => {
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, statusApproval: statusApproval({ listComments: commentsBy('Mythos') })
  });
  assert.strictEqual(r.verified, false);
  assert.match(r.reason, /self-approval|AUTOMATION|not the configured operator/i);
});

test('friendly: ambiguous directory (two users named {OPERATOR_NAME}) -> fail closed', async () => {
  const ambigConfig = {
    user: { name: 'Mythos', email: 'user@example.com' },
    assignees: [{ name: '{OPERATOR_NAME}', email: 'a@x' }, { name: '{OPERATOR_NAME}', email: 'b@x' }]
  };
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, statusApproval: statusApproval({ dartConfig: ambigConfig })
  });
  assert.strictEqual(r.verified, false);
  assert.match(r.reason, /ambiguous|collision/i);
});

test('friendly: author not in directory -> fail closed', async () => {
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT, statusApproval: statusApproval({ listComments: commentsBy('Stranger') })
  });
  assert.strictEqual(r.verified, false);
  assert.match(r.reason, /0 unique-email matches|unknown user/i);
});

test('friendly: resolved email === automation email -> fail closed (self-approval guard, even if mis-configured as operator)', async () => {
  // Mis-configure operatorEmail to the automation identity; the automation guard must still block.
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT,
    operatorEmail: 'user@example.com',
    statusApproval: statusApproval({ listComments: commentsBy('Mythos') })
  });
  assert.strictEqual(r.verified, false);
  assert.match(r.reason, /self-approval|AUTOMATION/i);
});

test('friendly: status NOT "Approved to Run" (Decision Needed) + operator comment -> verified:false', async () => {
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT,
    statusApproval: statusApproval({ getTask: async () => ({ status: 'Decision Needed' }) })
  });
  assert.strictEqual(r.verified, false);
  assert.match(r.reason, /not "Approved to Run"|Decision Needed/);
});

test('friendly: plan edited after approval (bound hash mismatch) -> verified:false', async () => {
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT,
    statusApproval: statusApproval({ boundSha256: verify.computePlanSha256('A DIFFERENT PLAN') })
  });
  assert.strictEqual(r.verified, false);
  assert.match(r.reason, /edited after approval|current plan digest/i);
});

test('friendly: forceFallback (resident token != Mythos) disables the status path; valid status alone is NOT enough', async () => {
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT,
    statusApproval: statusApproval(),
    dartPrecondition: { forceFallback: true, reason: 'resident Dart token is NOT the Mythos identity' }
  });
  assert.strictEqual(r.verified, false);
  assert.match(r.reason, /HMAC|fallback/i);
});

test('friendly: getConfig route (directory fetched live) also works', async () => {
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT,
    statusApproval: statusApproval({ dartConfig: undefined, getConfig: async () => DART_CONFIG })
  });
  assert.strictEqual(r.verified, true, r.reason);
});

test('friendly: Dart getTask unreachable + no HMAC -> verified:false (fail-closed)', async () => {
  const r = await verify.verifyOperatorApproval({
    planId: PLAN_ID, planText: PLAN_TEXT,
    statusApproval: statusApproval({ getTask: async () => { throw new Error('ETIMEDOUT'); } })
  });
  assert.strictEqual(r.verified, false);
  assert.match(r.reason, /FAIL-CLOSED|unreachable/i);
});

test('friendly: configurable operator email via SMOS_OPERATOR_APPROVAL_EMAIL', () => {
  const prev = process.env.SMOS_OPERATOR_APPROVAL_EMAIL;
  process.env.SMOS_OPERATOR_APPROVAL_EMAIL = 'user@example.com';
  try {
    assert.strictEqual(verify.resolveOperatorEmail(), 'user@example.com');
  } finally {
    if (prev === undefined) delete process.env.SMOS_OPERATOR_APPROVAL_EMAIL;
    else process.env.SMOS_OPERATOR_APPROVAL_EMAIL = prev;
  }
  assert.strictEqual(verify.resolveOperatorEmail({}), 'get@example-agency.com');
});
