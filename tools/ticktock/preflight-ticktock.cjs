#!/usr/bin/env node
'use strict';

// tools/ticktock/preflight-ticktock.cjs -- the executable phase-entry precondition
// for /ticktock. Plan: ticktock-skill S2, repair of review finding F1 (and F3, F4)
// in _dev/reports/analysis/review-task-plan__ticktock-s2-review__20260805.md.
//
// WHAT THIS IS, STATED HONESTLY AND FIRST.
//
// This file is a deterministic, fail-closed precondition that /ticktock MUST run
// before entering any unattended or remote-capable mode. It reads real artifacts,
// returns a machine-readable verdict, and exits non-zero on REFUSE.
//
// It is NOT a harness hook. Nothing in the Claude Code harness compels a caller to
// invoke it. A caller that simply never runs it is not stopped by anything here.
// Therefore its honest capability tier is ADVISORY at the harness level -- stronger
// than prose, because the verdict is computed by code from artifacts rather than
// asserted by an agent about itself, and weaker than a registered PreToolUse hook,
// because the harness does not force the call. The BLOCKING version of this check
// is a hook under tools/kernel/hooks/, which sits inside the convene authority
// perimeter and cannot be written from this workstream's write surface.
//
// TWO GATES ARE EVALUATED, both fail-closed:
//
//   pretooluse-live      REDESIGNED 2026-08-11 (enforcement-evidence-integrity,
//                        round 4/4b). No longer reads a stored boolean -- see
//                        ./lib/live-probe.cjs and the gate's own comment block
//                        below for why a stored boolean was forgeable and what
//                        replaced it. Every call re-derives the verdict live
//                        from three probe legs against the governance-protected
//                        G-REMOTE-MUTATION gate module and the .claude/settings.json
//                        PreToolUse wiring; anything less than all three legs
//                        denying a synthetic canary this run is REFUSE.
//
//   G-TICKTOCK-REVIEW    reads the S4 decision artifact named below. Its cleared
//                        status is decision.cleared === true AND
//                        decision.unresolved_findings_total === 0 AND every locked
//                        reviewer entry carrying status "clean" AND pin_verified
//                        strictly true AND verdict APPROVE AND zero unresolved
//                        findings. Those four are INDEPENDENT: a lane whose status
//                        is timeout, substituted, or pin_mismatch is not clean no
//                        matter what its verdict says, and a missing status or a
//                        missing pin_verified fails closed. The artifact EXISTS and is
//                        read every call (header corrected 2026-08-12, S4-C codewhale
//                        F2 — it predated the artifact); while decision.cleared is
//                        false the gate refuses DECISION-NOT-CLEARED, and it also
//                        enforces charter-hash binding and exact roster coverage.
//                        A missing artifact still fails closed as ARTIFACT-ABSENT.
//
// The refusal predicate for pretooluse-live is REMOTE REACHABILITY, not operator
// attendance. "Attended" describes how an operator watches a run; it says nothing
// about whether the run can reach the orwell host. An attended single cycle whose
// resolved phase path includes tt.tick is remote-capable and is refused exactly like
// an unattended one.

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const REVIEW_DECISION_SCHEMA = require('./ticktock-review-decision-schema.json');
// Codex PR#20 review: charter artifacts consulted for G-TICKTOCK-REVIEW's
// self-binding and run-roster checks were read via readJsonArtifact() (a
// bare JSON.parse), never through charterMod.readCharter()/validateCharter().
// If reviewer_roster.lanes is edited after charter creation while the stored
// charter_hash/lane_binding_hash fields are left unchanged, a bare parse
// cannot detect that -- readCharter() recomputes both hashes from the actual
// content and refuses on mismatch, which a bare parse never attempts.
const charterMod = require('./charter.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const EVIDENCE_PATH = '_dev/state/ticktock/ticktock-dryrun-evidence.json';
const REVIEW_DECISION_PATH = '_dev/state/ticktock/g-ticktock-review-decision.json';

const PROCEED = 'PROCEED';
const REFUSE = 'REFUSE';

const NINE_PHASES = [
  'tt.orient', 'tt.tick', 'tt.observe', 'tt.text', 'tt.research',
  'tt.tock', 'tt.improve', 'tt.ship', 'tt.schedule'
];

// The phases whose resolved path can reach the orwell host. tt.observe is a
// READ-ONLY lane against the host and needs no stamp, so it is NOT remote-capable
// for the purposes of this precondition; the three below can issue remote-MUTATING
// actions.
const REMOTE_CAPABLE_PHASES = ['tt.tick', 'tt.ship', 'tt.schedule'];

// Which phases each argument form resolves to. This is the table that makes the
// attended/remote-capable boundary decidable rather than a judgement call.
const PHASES_BY_FORM = {
  bare: NINE_PHASES,
  deep: NINE_PHASES,
  N: NINE_PHASES,
  '--until': NINE_PHASES,
  quick: ['tt.orient', 'tt.tick', 'tt.observe', 'tt.text'],
  tock: ['tt.orient', 'tt.tock']
};

// ---------------------------------------------------------------------------
// Invocation classification
// ---------------------------------------------------------------------------

/**
 * Classify a /ticktock invocation into the facts the gates need: which phases it
 * resolves to, whether it is unattended, and whether any resolved phase can reach
 * a remote-mutating action.
 *
 * `--dry-run` is the ONLY modifier that makes an otherwise remote-capable form
 * local: it asserts that no phase will issue an effectful remote command. It is a
 * declared mode, not an inference.
 */
function classifyInvocation(argTokens) {
  const tokens = (argTokens || []).map(String).filter((t) => t.length > 0);
  const dryRun = tokens.includes('--dry-run');

  let form = 'bare';
  let generations = 1;

  if (tokens.includes('--until')) {
    form = '--until';
  } else if (tokens.includes('tock')) {
    form = 'tock';
  } else if (tokens.includes('deep')) {
    form = 'deep';
  } else if (tokens.includes('quick')) {
    form = 'quick';
  } else {
    const n = tokens.find((t) => /^[0-9]+$/.test(t));
    if (n !== undefined) {
      form = 'N';
      generations = Number(n);
    }
  }

  const unattended = form === '--until' || (form === 'N' && generations > 1);
  const phases = PHASES_BY_FORM[form];
  const remoteCapablePhases = dryRun
    ? []
    : phases.filter((p) => REMOTE_CAPABLE_PHASES.includes(p));

  return {
    form,
    generations,
    dry_run: dryRun,
    unattended,
    attended: !unattended,
    phases,
    remote_capable: remoteCapablePhases.length > 0,
    remote_capable_phases: remoteCapablePhases
  };
}

// ---------------------------------------------------------------------------
// Artifact reading -- every failure mode is a distinct, named REFUSE reason
// ---------------------------------------------------------------------------

function readJsonArtifact(relPath) {
  const abs = path.resolve(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    return { ok: false, reason_code: 'ARTIFACT-ABSENT', path: relPath, abs };
  }
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    return { ok: false, reason_code: 'ARTIFACT-UNREADABLE', path: relPath, abs, detail: err.message };
  }
  try {
    return { ok: true, path: relPath, abs, doc: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, reason_code: 'ARTIFACT-UNPARSEABLE', path: relPath, abs, detail: err.message };
  }
}

/**
 * Same shape as readJsonArtifact(), but for charter artifacts specifically:
 * after the bare parse, runs charterMod.checkImmutability() to RECOMPUTE
 * charter_hash and reviewer_roster.lane_binding_hash from the actual loaded
 * content and refuse on mismatch. Deliberately checkImmutability() (a narrow,
 * two-hash recompute-and-compare), NOT the full charterMod.readCharter() /
 * validateCharter() schema pipeline -- this call site only ever needs the
 * roster/charter hash fields, and full-schema fixtures (cycle_ceiling,
 * evaluator_versions, allowed_write_surfaces, etc.) are not part of what
 * G-TICKTOCK-REVIEW is checking here. An edited roster with stale hash
 * fields left in place cannot pass silently (codex PR#20 review).
 */
function readValidatedCharterArtifact(relPath) {
  const abs = path.resolve(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    return { ok: false, reason_code: 'ARTIFACT-ABSENT', path: relPath, abs };
  }
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    return { ok: false, reason_code: 'ARTIFACT-UNREADABLE', path: relPath, abs, detail: err.message };
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason_code: 'ARTIFACT-UNPARSEABLE', path: relPath, abs, detail: err.message };
  }
  const immut = charterMod.checkImmutability(doc);
  if (!immut.ok) {
    return { ok: false, reason_code: `CHARTER-${immut.halt_state}`, path: relPath, abs, detail: immut.detail };
  }
  return { ok: true, path: relPath, abs, doc };
}

// ---------------------------------------------------------------------------
// Gate: pretooluse-live
// ---------------------------------------------------------------------------

// REDESIGNED 2026-08-11 (enforcement-evidence-integrity, round 4/4b). This gate
// USED TO read a strict boolean, remote_mutation_gate_test.enforcement_path_
// observed_live, out of _dev/state/ticktock/ticktock-dryrun-evidence.json -- an
// ordinary, ungoverned JSON file. Editing that one boolean flipped this gate's
// verdict with nothing re-verified. Round 4 found the natural "fix" (a
// Keychain-HMAC-signed receipt) was not actually a trust root either: the
// Bash-command-text classifier that would need to stop an agent reading the
// signing secret is proven blind to the identical action wrapped in `node -e`
// (see the plan's Round 4 section) -- so no secret reachable by a process this
// agent can spawn is a real trust root in this sandbox, regardless of
// MYTHOS_SECRET_ACCESS_GATE's enforcement state.
//
// Instead: NOTHING IS STORED. Every call re-derives the verdict live, this
// instant, against the two artifacts that actually sit behind write protection
// this agent cannot self-grant (both confirmed live via
// tools/verify/hooks/pre-write-convene-required.cjs's PROTECTED_PREFIXES /
// PROTECTED_FILES): tools/kernel/hooks/ (where the real gate module and
// dispatcher live) and .claude/settings.json (which wires the dispatcher as the
// PreToolUse hook). Three legs, all must deny a synthetic canary for this gate
// to PROCEED:
//   1. wiring   -- .claude/settings.json really does register dispatch-pretool.cjs
//                  as the PreToolUse hook (exact resolved-path equality, not a
//                  substring match).
//   2. direct   -- require()-ing the live tools/kernel/hooks/
//                  pretool-remote-mutation-gate.cjs and calling its exported
//                  evaluate() against the canary returns a deny.
//   3. spawn    -- spawning the REGISTERED entrypoint itself
//                  (node tools/kernel/hooks/dispatch-pretool.cjs) with a
//                  synthetic PreToolUse stdin payload, exactly as the harness
//                  would deliver one, also returns a deny.
// The canary command is TEXT INSIDE A JSON PAYLOAD ONLY in legs 2 and 3 -- it is
// never executed as a shell command by this file. Full design and the empirical
// bypass proof: _dev/reports/analysis/task-plans/enforcement-evidence-integrity__plan.md.
//
// The probe implementation lives in ./lib/live-probe.cjs, DELIBERATELY NOT
// INLINE HERE: the canary text contains a literal PowerShell mutation token,
// and G-REMOTE-MUTATION's own script-body scanner denies any file directly
// invoked as `node <file>` whose body contains one. If that string lived in
// this file, every `node tools/ticktock/preflight-ticktock.cjs` invocation
// would itself become a denied action requiring an operator stamp -- breaking
// /ticktock. require()-ing a sibling module is not scanned; only the literal
// script argument of a Bash tool call is.
const liveProbe = require('./lib/live-probe.cjs');

const PRETOOLUSE_LIVE_HALT_TEXT = [
  'HALT pretooluse-live -- /ticktock refuses this invocation.',
  '',
  'The live three-part probe did not confirm, THIS RUN, that G-REMOTE-MUTATION',
  'denies a synthetic remote-mutating canary. Nothing is read from a stored',
  'boolean -- see gates[0].probe in the JSON output for exactly which of the',
  'three legs (wiring / direct-module / spawn) failed and why.',
  '',
  'wiring   -- .claude/settings.json must register dispatch-pretool.cjs as the',
  '            PreToolUse hook, resolved to an exact path match.',
  'direct   -- tools/kernel/hooks/pretool-remote-mutation-gate.cjs, required',
  '            live, must deny the canary via its exported evaluate().',
  'spawn    -- spawning tools/kernel/hooks/dispatch-pretool.cjs with a synthetic',
  '            PreToolUse payload must exit 2 naming G-REMOTE-MUTATION.',
  '',
  'If tools/kernel/hooks/ or .claude/settings.json were edited, that edit',
  'required a live ConveneReceipt/1.0 (both are governance-perimeter protected);',
  'if this gate now refuses, re-verify that change against a live denial before',
  'treating this as a false refusal.'
].join('\n');

function evaluatePretooluseLive(invocation, opts) {
  const applies = invocation.unattended || invocation.remote_capable;

  if (!applies) {
    return {
      gate_id: 'pretooluse-live',
      applies: false,
      verdict: PROCEED,
      reason_code: 'NOT-APPLICABLE',
      reason: 'Neither unattended nor remote-capable: no resolved phase can issue a remote-mutating action.',
      probe: null
    };
  }

  const probe = liveProbe.runLiveProbe(REPO_ROOT, opts || {});

  if (probe.ok) {
    return {
      gate_id: 'pretooluse-live',
      applies: true,
      verdict: PROCEED,
      reason_code: 'LIVE-ENFORCEMENT-PROBED',
      reason: 'All four probe legs (settings wiring, direct gate-module evaluate(), independently-authored stamp verifier, spawned dispatch-pretool.cjs) denied a synthetic remote-mutation canary this run. Nothing was read from a stored boolean.',
      probe
    };
  }

  // Leg 4 (plan pretooluse-live-second-verifier) gets its OWN distinct halt
  // path, checked before the legacy wiring/direct/spawn ordering: a
  // DISAGREEMENT or CONFLICTING-TERMINAL-STATE finding from the independent
  // leg is never folded into the generic 'direct-module'/'spawn' failure
  // text, per AC2 -- both verdicts (primary and independent) must be named
  // explicitly so a human reading the halt immediately sees WHICH leg said
  // what, not just that something disagreed.
  if (probe.independent && !probe.independent.ok
    && (probe.independent.reason_code === 'DISAGREEMENT' || probe.independent.reason_code === 'CONFLICTING-TERMINAL-STATE')) {
    return {
      gate_id: 'pretooluse-live',
      applies: true,
      verdict: REFUSE,
      reason_code: probe.independent.reason_code,
      reason: `The primary path and the independently-authored second verifier (tools/kernel/hooks/verify-stamp-independently.cjs) DISAGREE on whether a stamp covers the canary: ${probe.independent.detail}. This is exactly the class of finding the second verifier exists to catch -- fail-closed, do not proceed.`,
      probe,
      halt_text: [
        PRETOOLUSE_LIVE_HALT_TEXT,
        '',
        `SECOND-VERIFIER DISAGREEMENT: primary_covered=${probe.independent.primary_covered} independent_covered=${probe.independent.independent_covered}`,
        `Detail: ${probe.independent.detail}`,
        '',
        'This does NOT necessarily mean either check is wrong -- it means the two',
        'implementations of stamp validity/scope-matching reached different',
        'conclusions over the same stamp files. Investigate both',
        'tools/kernel/hooks/pretool-remote-mutation-gate.cjs and',
        'tools/kernel/hooks/verify-stamp-independently.cjs against the live',
        'stamp files before resuming /tt.'
      ].join('\n')
    };
  }

  const failedLeg = !probe.wiring.ok
    ? 'wiring'
    : (!probe.direct || !probe.direct.ok)
      ? 'direct-module'
      : (!probe.independent || !probe.independent.ok)
        ? 'independent-verifier'
        : 'spawn';
  const failedDetail = !probe.wiring.ok
    ? probe.wiring
    : (!probe.direct || !probe.direct.ok)
      ? probe.direct
      : (!probe.independent || !probe.independent.ok)
        ? probe.independent
        : probe.spawn;
  const reasonCode = (failedDetail && failedDetail.reason_code) || 'PROBE-FAILED';

  return {
    gate_id: 'pretooluse-live',
    applies: true,
    verdict: REFUSE,
    reason_code: reasonCode,
    reason: `Live probe leg '${failedLeg}' did not confirm G-REMOTE-MUTATION denies a canary this run: ${(failedDetail && failedDetail.detail) || 'no detail'}. Fail-closed.`,
    probe,
    halt_text: buildPretoolUseLiveHaltText(reasonCode, failedDetail)
  };
}

// ticktock-remote-mutation-canary-stamp-collision S3 (2026-08-16): a
// CANARY-COVERED-BY-STAMP refusal used to render the SAME static generic
// text as every other refusal reason, leaving a reader to dig through
// gates[0].probe JSON to find out WHICH stamp is responsible. Interpolate
// the covering stamp's id (now present in live-probe.cjs's own detail
// string as of S0/S3's live-probe.cjs fix) and point at the scope-broadness
// guard (tools/kernel/hooks/validate-stamp-scope.cjs) as the actual remedy
// for an overly broad stamp -- narrowing or voiding is the remedy for a
// stamp that is merely stale/no-longer-needed.
function buildPretoolUseLiveHaltText(reasonCode, failedDetail) {
  if (reasonCode !== 'CANARY-COVERED-BY-STAMP') return PRETOOLUSE_LIVE_HALT_TEXT;
  const detail = (failedDetail && failedDetail.detail) || '';
  return [
    PRETOOLUSE_LIVE_HALT_TEXT,
    '',
    `COVERING STAMP: ${detail}`,
    '',
    'This is not necessarily a broken gate -- a stamp currently authorizes a',
    'command shape that also matches this probe\'s synthetic canary. Remedy:',
    '  - If the stamp is stale or no longer needed: void or narrow it',
    '    (_dev/state/remote-mutation-stamps/<stamp-id>.json, set voided: true).',
    '  - If the stamp\'s scope is unintentionally broad (a bare shell verb or an',
    '    unanchored wildcard regex): tools/kernel/hooks/validate-stamp-scope.cjs',
    '    documents what "too broad" means and rejects that shape at the source',
    '    -- re-grant the stamp with a narrower scope.',
    '  - Voiding alone only helps if the gate module\'s stampInvalidReason() is',
    '    the one being consulted (it is, as of this fix) -- confirm by',
    '    re-running this exact preflight command after voiding.'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Gate: G-TICKTOCK-REVIEW
// ---------------------------------------------------------------------------

// The ONLY reviewer status that is clean. Everything else in the schema's enum --
// findings, timeout, substituted, pin_mismatch, unavailable, error -- independently
// marks the merge not-clean, and so does a status this evaluator does not recognise.
const CLEAN_REVIEWER_STATUS = 'clean';

/**
 * Why this reviewer entry is not clean. Empty array == clean.
 *
 * FOUR INDEPENDENT CONDITIONS, each sufficient on its own:
 *
 *   status          must be exactly "clean". A timed-out, substituted, or
 *                   pin-mismatched lane is not clean NO MATTER WHAT ITS VERDICT
 *                   SAYS. This is the laundered-APPROVE case: status "timeout"
 *                   with verdict APPROVE and zero findings used to clear the gate
 *                   because nothing read status. It no longer does.
 *   pin_verified    must be the strict boolean true. A lane that did not verify
 *                   which model actually answered has not been verified at all.
 *   verdict         must be APPROVE.
 *   unresolved      must be exactly 0.
 *
 * FAIL CLOSED on absence: a missing, null, non-string, or unrecognised status, and
 * a missing or non-true pin_verified, are NOT clean. A reviewer that did not report
 * its own status has not been verified, and an unverified lane is never evidence.
 */
function reviewerNotCleanReasons(r) {
  if (!r || typeof r !== 'object') {
    return ['reviewer entry is not an object; a roster slot with no entry is never an implicit pass'];
  }
  const lane = typeof r.lane_id === 'string' && r.lane_id.length > 0 ? r.lane_id : '<unnamed lane>';
  const reasons = [];

  if (typeof r.status !== 'string' || r.status.length === 0) {
    reasons.push(`${lane}: status is ${JSON.stringify(r.status)} -- a reviewer that did not report its own status has not been verified (fail closed)`);
  } else if (r.status !== CLEAN_REVIEWER_STATUS) {
    reasons.push(`${lane}: status is "${r.status}" -- only "clean" is clean; timeout, substituted, pin_mismatch, unavailable, error and findings each independently mark the merge not-clean regardless of verdict`);
  }

  if (r.pin_verified !== true) {
    reasons.push(`${lane}: pin_verified is ${JSON.stringify(r.pin_verified)} -- only the strict boolean true counts as a verified model pin (fail closed)`);
  }

  if (r.verdict !== 'APPROVE') {
    reasons.push(`${lane}: verdict is ${JSON.stringify(r.verdict)}, not APPROVE`);
  }

  if (r.unresolved_findings !== 0) {
    reasons.push(`${lane}: unresolved_findings is ${JSON.stringify(r.unresolved_findings)}, not 0`);
  }

  return reasons;
}

/**
 * Evaluate a whole roster. Returns the not-clean lanes with their reasons, so the
 * refusal names WHICH lane failed WHICH condition rather than asserting uncleanliness.
 */
function evaluateReviewerRoster(reviewers) {
  const list = Array.isArray(reviewers) ? reviewers : [];
  const lanes = list.map((r, i) => ({
    index: i,
    lane_id: r && typeof r.lane_id === 'string' ? r.lane_id : null,
    status: r ? r.status : undefined,
    pin_verified: r ? r.pin_verified : undefined,
    verdict: r ? r.verdict : undefined,
    unresolved_findings: r ? r.unresolved_findings : undefined,
    not_clean_reasons: reviewerNotCleanReasons(r)
  }));
  const failing = lanes.filter((l) => l.not_clean_reasons.length > 0);
  return { lanes, failing, clean: list.length > 0 && failing.length === 0 };
}

function evaluateTicktockReview(invocation, opts) {
  const decisionPath = (opts && opts.reviewDecisionPath) || REVIEW_DECISION_PATH;

  // Binding per the plan's inherited_gate_matrix: tt.tick and tt.schedule. The gate
  // fires on an attempt to run a real (non-dry-run) cycle or to activate SCHEDULE.
  const gatedPhases = invocation.phases.filter(
    (p) => p === 'tt.tick' || p === 'tt.schedule'
  );
  if (invocation.dry_run || gatedPhases.length === 0) {
    return {
      gate_id: 'G-TICKTOCK-REVIEW',
      applies: false,
      verdict: PROCEED,
      reason_code: 'NOT-APPLICABLE',
      reason: invocation.dry_run
        ? 'Dry-run cycle. This gate governs non-dry-run cycles and SCHEDULE activation.'
        : 'No resolved phase is tt.tick or tt.schedule, the gate\'s only bindings.',
      decision_artifact: decisionPath
    };
  }

  const read = readJsonArtifact(decisionPath);
  if (!read.ok) {
    return {
      gate_id: 'G-TICKTOCK-REVIEW',
      applies: true,
      verdict: REFUSE,
      reason_code: read.reason_code,
      reason: `Decision artifact ${decisionPath}: ${read.reason_code}. S4 must produce it (schema TickTockReviewDecision/1.0). Until it exists this gate is ABSENT and every non-dry-run cycle is refused. Fail-closed.`,
      decision_artifact: decisionPath,
      halt_text: `HALT G-TICKTOCK-REVIEW -- no decision artifact at ${decisionPath}. The S4 max-roster trial has not produced a machine-readable cleared decision, so there is nothing to read. This gate has no harness checker anywhere in the repo; this file's read is the only mechanism, and it fails closed.`
    };
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(REVIEW_DECISION_SCHEMA);
  if (!validate(read.doc)) {
    return {
      gate_id: 'G-TICKTOCK-REVIEW',
      applies: true,
      verdict: REFUSE,
      reason_code: 'DECISION-SCHEMA-INVALID',
      reason: `Decision artifact fails TickTockReviewDecision/1.0: ${ajv.errorsText(validate.errors)}. Fail-closed.`,
      decision_artifact: decisionPath
    };
  }

  // Charter binding (2026-08-12, S4 re-run codex finding 4; hardened same night
  // per S4-C codex findings 1-2): the schema requires charter_hash/roster_hash,
  // but nothing verified them against the charter the decision claims to belong
  // to — a schema-valid cleared artifact from ANOTHER charter (or a stale
  // roster) would have cleared this gate. Resolve a charter and require both
  // hashes to match. TWO MODES: opts.runCharterPath (the RUN's charter, passed
  // by callers like preflight-and-journal that know which run they guard) binds
  // the decision to THAT charter — a decision validly bound to some other
  // charter must still refuse here; without it, fall back to resolving the
  // decision's self-claimed charter_id (opts.charterPath is the test seam).
  // Fail-closed: an unresolvable charter is a refusal, not a skip.
  //
  // SEMANTICS CORRECTION (2026-08-12, caught live by run-001's own preflight):
  // the decision self-binds to the TRIAL charter that produced it (charter_id →
  // hash check below). opts.runCharterPath does NOT demand the decision's
  // charter equal the run's charter — trial charter ≠ run charter is the
  // designed lifecycle — it instead demands the decision's reviewer set match
  // the RUN charter's locked lanes by lane_id+family+model_pin (checked after
  // the self-binding passes): the minds that cleared the implementation must be
  // the minds this run's merge contract binds.
  const charterRelPath = (opts && opts.charterPath) ||
    `_dev/state/ticktock/charter__${read.doc.charter_id}.json`;
  const charterRead = readValidatedCharterArtifact(charterRelPath);
  if (!charterRead.ok) {
    return {
      gate_id: 'G-TICKTOCK-REVIEW',
      applies: true,
      verdict: REFUSE,
      reason_code: 'CHARTER-BINDING-UNRESOLVED',
      reason: `Decision claims charter_id ${JSON.stringify(read.doc.charter_id)} but its charter could not be read at ${charterRelPath} (${charterRead.reason_code}). A decision that cannot be bound to its charter proves nothing. Fail-closed.`,
      decision_artifact: decisionPath
    };
  }
  const boundCharter = charterRead.doc;
  const expectedRosterHash = boundCharter.reviewer_roster && boundCharter.reviewer_roster.lane_binding_hash;
  if (read.doc.charter_hash !== boundCharter.charter_hash || read.doc.roster_hash !== expectedRosterHash) {
    return {
      gate_id: 'G-TICKTOCK-REVIEW',
      applies: true,
      verdict: REFUSE,
      reason_code: 'CHARTER-BINDING-MISMATCH',
      reason: `Decision does not bind to charter ${read.doc.charter_id}: charter_hash ${read.doc.charter_hash === boundCharter.charter_hash ? 'matches' : 'MISMATCH'}, roster_hash ${read.doc.roster_hash === expectedRosterHash ? 'matches' : 'MISMATCH'}. A cleared decision bound to a different charter or roster does not clear this run's gate. Fail-closed.`,
      decision_artifact: decisionPath
    };
  }

  // Run-roster binding: when the caller supplies the RUN's charter, the
  // decision's reviewer set must cover that charter's locked lanes exactly, by
  // lane_id + family + model_pin — a review by different minds (or the same
  // minds under different pins) does not authorize this run's merge contract.
  if (opts && opts.runCharterPath) {
    const runCharterRead = readValidatedCharterArtifact(opts.runCharterPath);
    if (!runCharterRead.ok) {
      return {
        gate_id: 'G-TICKTOCK-REVIEW',
        applies: true,
        verdict: REFUSE,
        reason_code: 'CHARTER-BINDING-UNRESOLVED',
        reason: `The run's charter could not be read at ${opts.runCharterPath} (${runCharterRead.reason_code}). Fail-closed.`,
        decision_artifact: decisionPath
      };
    }
    const runLanes = runCharterRead.doc.reviewer_roster && Array.isArray(runCharterRead.doc.reviewer_roster.lanes)
      ? runCharterRead.doc.reviewer_roster.lanes
      : null;
    if (!runLanes) {
      return {
        gate_id: 'G-TICKTOCK-REVIEW',
        applies: true,
        verdict: REFUSE,
        reason_code: 'ROSTER-COVERAGE-UNRESOLVED',
        reason: `The run's charter ${runCharterRead.doc.charter_id} carries no reviewer_roster.lanes[] array; run-roster binding cannot be proven. Fail-closed.`,
        decision_artifact: decisionPath
      };
    }
    // TUPLE RULE (B3, plan v3 delta finding 5): reviewer records on the decision
    // carry no assignment_order field, and the decision schema is deliberately
    // left untouched -- so the comparison is NOT decision.reviewers against the
    // run charter. It is the TRIAL charter's OWN locked lanes (boundCharter,
    // already resolved and hash-verified above) against the RUN charter's
    // locked lanes, both of which carry assignment_order as a hash-covered
    // roster field (charter.cjs's LANE_BINDING_PROJECTION_FIELDS). Comparing
    // lane_id + family + model_pin alone left a reorder gap: two charters with
    // an identical three-field lane SET but different assignment_order pass as
    // equal under a set comparison, even though assignment_order is exactly
    // what "pre-output assignment" pins down -- reordering the roster changes
    // which lane produces which output, which the three-field comparison
    // cannot see.
    const trialLanes = boundCharter.reviewer_roster && Array.isArray(boundCharter.reviewer_roster.lanes)
      ? boundCharter.reviewer_roster.lanes
      : null;
    if (!trialLanes) {
      return {
        gate_id: 'G-TICKTOCK-REVIEW',
        applies: true,
        verdict: REFUSE,
        reason_code: 'ROSTER-COVERAGE-UNRESOLVED',
        reason: `Trial charter ${boundCharter.charter_id} carries no reviewer_roster.lanes[] array; run-roster binding cannot be proven against it. Fail-closed.`,
        decision_artifact: decisionPath
      };
    }
    const laneTuple = (l) => `${l.lane_id}|${l.family}|${l.model_pin !== undefined ? l.model_pin : l.model_pin_requested}|${l.assignment_order}`;
    const runKeys = runLanes.map(laneTuple).sort();
    const trialKeys = trialLanes.map(laneTuple).sort();
    if (JSON.stringify(runKeys) !== JSON.stringify(trialKeys)) {
      return {
        gate_id: 'G-TICKTOCK-REVIEW',
        applies: true,
        verdict: REFUSE,
        reason_code: 'RUN-ROSTER-MISMATCH',
        reason: `The trial charter's locked lanes [${trialKeys.join('; ')}] do not match this run's locked lanes [${runKeys.join('; ')}] by lane_id+family+model_pin+assignment_order. The minds (and their assignment order) that cleared the implementation must be the minds this run's merge contract binds. Fail-closed.`,
        decision_artifact: decisionPath
      };
    }
  }

  const decision = read.doc.decision;
  const reviewers = Array.isArray(read.doc.reviewers) ? read.doc.reviewers : [];

  // Roster coverage (2026-08-12, S4-C codex finding 2): the read path accepted
  // ANY non-empty clean reviewer set — a schema-valid decision carrying one
  // clean lane would have cleared a three-lane roster. The reviewers must cover
  // the bound charter's locked lanes EXACTLY: no missing lane, no extra lane,
  // no duplicates. A charter whose roster carries no lanes array cannot prove
  // coverage and refuses (fail-closed), mirroring write-review-decision.cjs's
  // write-time guard so a hand-authored artifact cannot bypass it at read time.
  const lockedLaneObjects = boundCharter.reviewer_roster && Array.isArray(boundCharter.reviewer_roster.lanes)
    ? boundCharter.reviewer_roster.lanes
    : null;
  if (!lockedLaneObjects) {
    return {
      gate_id: 'G-TICKTOCK-REVIEW',
      applies: true,
      verdict: REFUSE,
      reason_code: 'ROSTER-COVERAGE-UNRESOLVED',
      reason: `Charter ${boundCharter.charter_id} carries no reviewer_roster.lanes[] array, so reviewer coverage cannot be proven. Fail-closed.`,
      decision_artifact: decisionPath
    };
  }
  const lockedLanes = lockedLaneObjects.map((l) => l.lane_id);
  const reportedLanes = reviewers.map((r) => r.lane_id);
  const dupLanes = [...new Set(reportedLanes.filter((id, i) => reportedLanes.indexOf(id) !== i))];
  const missingLanes = lockedLanes.filter((id) => !reportedLanes.includes(id));
  const extraLanes = reportedLanes.filter((id) => !lockedLanes.includes(id));
  if (dupLanes.length || missingLanes.length || extraLanes.length) {
    return {
      gate_id: 'G-TICKTOCK-REVIEW',
      applies: true,
      verdict: REFUSE,
      reason_code: 'ROSTER-COVERAGE-MISMATCH',
      reason: `Reviewers do not exactly cover the locked roster of ${boundCharter.charter_id}. Missing: ${missingLanes.join(', ') || 'none'}. Not in roster: ${extraLanes.join(', ') || 'none'}. Duplicated: ${dupLanes.join(', ') || 'none'}. A partial or padded roster is how an unconsulted reviewer passes for a satisfied one. Fail-closed.`,
      decision_artifact: decisionPath
    };
  }

  // REVIEWER-LANE BINDING (B6 amendment, codex finding 2 / codewhale finding
  // 3): the coverage check above only proved `lane_id`s match one-for-one —
  // it never checked that a reviewer entry actually IDENTIFIES the mind the
  // locked lane names. A forged reviewer entry (lane_id "codex-1", but family
  // "gemini" and an invented model_pin) passed coverage cleanly, because
  // coverage is a set-equality check over lane_id alone. Each reviewer must
  // additionally match its SAME-lane_id locked charter lane on `family` and
  // on `model_pin_requested === lockedLane.model_pin`; if the reviewer also
  // reports `model_pin_observed`, that must match too (a lane whose observed
  // pin drifted from the locked pin is exactly a pin_mismatch shape, and must
  // not be laundered past this check by omitting it from the not-clean
  // reasons below).
  const lockedByLaneId = new Map(lockedLaneObjects.map((l) => [l.lane_id, l]));
  const forgedLaneReasons = [];
  for (const r of reviewers) {
    const lockedLane = lockedByLaneId.get(r.lane_id);
    if (!lockedLane) continue; // already refused above (extraLanes)
    if (r.family !== lockedLane.family) {
      forgedLaneReasons.push(`${r.lane_id}: reviewer family "${r.family}" does not match the locked charter lane's family "${lockedLane.family}"`);
    }
    if (r.model_pin_requested !== lockedLane.model_pin) {
      forgedLaneReasons.push(`${r.lane_id}: reviewer model_pin_requested "${r.model_pin_requested}" does not match the locked charter lane's model_pin "${lockedLane.model_pin}"`);
    }
    if (r.model_pin_observed !== undefined && r.model_pin_observed !== null && r.model_pin_observed !== lockedLane.model_pin) {
      forgedLaneReasons.push(`${r.lane_id}: reviewer model_pin_observed "${r.model_pin_observed}" does not match the locked charter lane's model_pin "${lockedLane.model_pin}"`);
    }
    // B6 round-2 amendment (codex, 20260814T0012Z): model_pin_observed is
    // schema-legal as null (ticktock-review-decision-schema.json:67), and the
    // three checks above SKIP a null/absent observed pin entirely -- so a
    // schema-valid reviewer entry with matching family, matching
    // model_pin_requested, model_pin_observed:null, and pin_verified:true
    // passed this function untouched and cleared the gate. That combination
    // is self-contradictory on its face: pin_verified claims the model pin
    // WAS verified by reading it from the response (see
    // reviewerNotCleanReasons's own doc comment), and there is no response to
    // have read from a null observation. A reviewer cannot claim "verified"
    // and "unobserved" at once. This is checked here, independently of
    // reviewerNotCleanReasons's own pin_verified handling (which only checks
    // the boolean's strict-true-ness, not its consistency with what was
    // observed), because THIS function is the one with the locked lane's
    // model_pin in scope to compare against.
    if (r.pin_verified === true && (r.model_pin_observed === null || r.model_pin_observed === undefined)) {
      forgedLaneReasons.push(`${r.lane_id}: pin_verified is true but model_pin_observed is ${JSON.stringify(r.model_pin_observed)} -- a pin cannot be verified without an observation; this is self-contradictory and fails closed`);
    }
  }
  if (forgedLaneReasons.length) {
    return {
      gate_id: 'G-TICKTOCK-REVIEW',
      applies: true,
      verdict: REFUSE,
      reason_code: 'REVIEWER-LANE-MISMATCH',
      reason: `A reviewer entry does not identify the mind its locked charter lane names: ${forgedLaneReasons.join('; ')}. lane_id coverage alone is not identity -- a reviewer entry must match its lane's family and model pin, or the reviewer that "cleared" the gate was never the mind the roster locked. Fail-closed.`,
      decision_artifact: decisionPath
    };
  }

  const roster = evaluateReviewerRoster(reviewers);
  const failing = roster.failing;

  if (decision.cleared !== true) {
    return {
      gate_id: 'G-TICKTOCK-REVIEW',
      applies: true,
      verdict: REFUSE,
      reason_code: 'DECISION-NOT-CLEARED',
      reason: `decision.cleared is ${JSON.stringify(decision.cleared)}; only strict true clears this gate.`,
      decision_artifact: decisionPath
    };
  }
  if (decision.unresolved_findings_total !== 0) {
    return {
      gate_id: 'G-TICKTOCK-REVIEW',
      applies: true,
      verdict: REFUSE,
      reason_code: 'UNRESOLVED-FINDINGS',
      reason: `decision.unresolved_findings_total is ${decision.unresolved_findings_total}; the gate clears at zero from every locked reviewer.`,
      decision_artifact: decisionPath
    };
  }
  if (reviewers.length === 0 || failing.length > 0) {
    return {
      gate_id: 'G-TICKTOCK-REVIEW',
      applies: true,
      verdict: REFUSE,
      reason_code: 'ROSTER-NOT-CLEAN',
      reason: reviewers.length === 0
        ? 'reviewers[] is empty; a cleared decision with no roster is not evidence.'
        : `Not clean from every locked reviewer: ${failing.map((l) => l.not_clean_reasons.join('; ')).join(' | ')}.`,
      not_clean_lanes: failing,
      decision_artifact: decisionPath
    };
  }

  return {
    gate_id: 'G-TICKTOCK-REVIEW',
    applies: true,
    verdict: PROCEED,
    reason_code: 'CLEARED',
    reason: `decision.cleared is true, and all ${reviewers.length} locked reviewers report status "clean" with pin_verified true, verdict APPROVE, and zero unresolved findings.`,
    decision_artifact: decisionPath,
    decision_id: read.doc.decision_id
  };
}

// ---------------------------------------------------------------------------
// Combined preflight
// ---------------------------------------------------------------------------

/**
 * Run every phase-entry precondition this module owns. Returns a verdict object;
 * never throws for an artifact problem -- an artifact problem is a REFUSE.
 */
function preflight(argTokens, opts) {
  const invocation = classifyInvocation(argTokens);
  const gates = [
    evaluatePretooluseLive(invocation, opts),
    evaluateTicktockReview(invocation, opts)
  ];
  const refusals = gates.filter((g) => g.verdict === REFUSE);
  return {
    schema: 'TickTockPreflight/1.0',
    checked_at: new Date().toISOString(),
    honest_tier: 'ADVISORY (executable, fail-closed; not a harness hook -- nothing compels this call)',
    invocation,
    gates,
    verdict: refusals.length === 0 ? PROCEED : REFUSE,
    refused_by: refusals.map((g) => g.gate_id),
    halt_reason: refusals.length === 0 ? null : refusals[0].gate_id,
    halt_text: refusals.length === 0 ? null : (refusals[0].halt_text || refusals[0].reason)
  };
}

module.exports = {
  EVIDENCE_PATH,
  REVIEW_DECISION_PATH,
  NINE_PHASES,
  REMOTE_CAPABLE_PHASES,
  PHASES_BY_FORM,
  PROCEED,
  REFUSE,
  classifyInvocation,
  parseCliArgs,
  CLEAN_REVIEWER_STATUS,
  reviewerNotCleanReasons,
  evaluateReviewerRoster,
  evaluatePretooluseLive,
  evaluateTicktockReview,
  preflight,
  // pretooluse-live live-probe internals, exported for fixtures (S5-REDESIGNED).
  // Bound to REPO_ROOT so callers (tests) don't need to pass it explicitly.
  DISPATCH_ENTRYPOINT_REL: liveProbe.DISPATCH_ENTRYPOINT_REL,
  GATE_MODULE_REL: liveProbe.GATE_MODULE_REL,
  SETTINGS_PATH_REL: liveProbe.SETTINGS_PATH_REL,
  STAMPS_DIR_REL: liveProbe.STAMPS_DIR_REL,
  CANARY_COMMAND: liveProbe.CANARY_COMMAND,
  defaultReadSettings: () => liveProbe.defaultReadSettings(REPO_ROOT),
  defaultRequireGateModule: () => liveProbe.defaultRequireGateModule(REPO_ROOT),
  defaultSpawnDispatcher: (payload) => liveProbe.defaultSpawnDispatcher(REPO_ROOT, payload),
  enumerateStamps: () => liveProbe.enumerateStamps(REPO_ROOT),
  checkWiring: (readSettings) => liveProbe.checkWiring(REPO_ROOT, readSettings && (() => readSettings())),
  directModuleProbe: (requireGateModule) => liveProbe.directModuleProbe(REPO_ROOT, requireGateModule && (() => requireGateModule())),
  spawnProbe: (spawnDispatcher) => liveProbe.spawnProbe(REPO_ROOT, spawnDispatcher && ((r, p) => spawnDispatcher(p)))
};

// ---------------------------------------------------------------------------
// CLI -- exit 0 PROCEED, exit 1 REFUSE, exit 2 internal error (also a refusal)
// ---------------------------------------------------------------------------
//
// B3 (F2 repair): --charter <path> -- <invocation args> IS NOW MANDATORY at
// this boundary. Before this change, the bare CLI (the ONLY invocation the
// docs directed callers to) never supplied opts.runCharterPath, so
// evaluateTicktockReview() validated a decision solely against its
// self-claimed TRIAL charter -- run-roster binding never fired here, and a
// cleared decision from a stale or differently-rostered trial could clear a
// run it was never bound to. Auto-resolving a charter (e.g. "newest file in
// _dev/state/ticktock/") was considered and rejected: that is silent magic,
// exactly the kind of inferred behavior this repair plan exists to remove
// elsewhere (see journal.cjs's JOURNAL-ABSENT refusal for the same principle).
// A caller that does not know which run charter it is bound to has not
// answered the question, and RUN-CHARTER-UNRESOLVED says so.
function parseCliArgs(argv) {
  const charterFlagIdx = argv.indexOf('--charter');
  const charterPath = charterFlagIdx !== -1 ? argv[charterFlagIdx + 1] : undefined;
  const sepIdx = argv.indexOf('--');
  const invocationTokens = sepIdx !== -1 ? argv.slice(sepIdx + 1) : [];
  return { charterPath, invocationTokens, hasCharterFlag: charterFlagIdx !== -1 && Boolean(charterPath) };
}

const RUN_CHARTER_UNRESOLVED_HALT_TEXT = [
  'HALT RUN-CHARTER-UNRESOLVED -- no --charter <path> supplied.',
  '',
  'The bare preflight executable must be bound to the RUN charter so',
  'G-TICKTOCK-REVIEW can enforce run-roster binding (lane_id+family+model_pin+',
  'assignment_order between the decision\'s trial charter and this run\'s',
  'charter). A cleared decision from a stale or differently-rostered charter',
  'must never silently PROCEED because no run charter was named.',
  '',
  'Auto-resolution (e.g. "newest charter file") is deliberately not offered --',
  'that is silent magic, not a refusal.',
  '',
  'Usage: preflight-ticktock.cjs --charter <path> -- <invocation args>'
].join('\n');

if (require.main === module) {
  try {
    const { charterPath, invocationTokens, hasCharterFlag } = parseCliArgs(process.argv.slice(2));
    if (!hasCharterFlag) {
      const result = {
        schema: 'TickTockPreflight/1.0',
        checked_at: new Date().toISOString(),
        verdict: REFUSE,
        reason_code: 'RUN-CHARTER-UNRESOLVED',
        reason: 'No --charter <path> supplied at the CLI boundary. Invoke as: preflight-ticktock.cjs --charter <path> -- <invocation args>',
        halt_reason: 'RUN-CHARTER-UNRESOLVED',
        halt_text: RUN_CHARTER_UNRESOLVED_HALT_TEXT
      };
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.stderr.write('\n' + result.halt_text + '\n');
      process.exit(1);
    }
    const result = preflight(invocationTokens, { runCharterPath: path.resolve(charterPath) });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.verdict === REFUSE) {
      process.stderr.write('\n' + result.halt_text + '\n');
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    process.stdout.write(JSON.stringify({
      schema: 'TickTockPreflight/1.0',
      verdict: REFUSE,
      reason_code: 'PREFLIGHT-INTERNAL-ERROR',
      reason: err && err.message ? err.message : String(err)
    }, null, 2) + '\n');
    process.exit(2);
  }
}
