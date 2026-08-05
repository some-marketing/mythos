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
//   pretooluse-live      reads remote_mutation_gate_test.enforcement_path_observed_live
//                        from the S3 evidence artifact. Anything that is not the
//                        strict boolean true -- false, null, wrong type, missing
//                        field, missing artifact, unparseable artifact -- is REFUSE.
//
//   G-TICKTOCK-REVIEW    reads the S4 decision artifact named below. Its cleared
//                        status is decision.cleared === true AND
//                        decision.unresolved_findings_total === 0 AND every locked
//                        reviewer entry carrying verdict APPROVE with zero
//                        unresolved findings. The artifact does not exist yet: S4
//                        must produce it. Until it does, this gate reads ABSENT and
//                        every non-dry-run cycle is REFUSED.
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

// ---------------------------------------------------------------------------
// Gate: pretooluse-live
// ---------------------------------------------------------------------------

const PRETOOLUSE_LIVE_HALT_TEXT = [
  'HALT pretooluse-live -- /ticktock refuses this invocation.',
  '',
  "G-REMOTE-MUTATION's checker is fail-closed but its harness enforcement is ABSENT:",
  '_dev/staged/kernel-hooks/pretool-remote-mutation-gate.cjs is not registered in',
  'tools/kernel/hooks/dispatch-pretool.cjs, and no live PreToolUse denial has been',
  'observed. A module-direct test result is a materially weaker claim and does not',
  'clear this precondition.',
  '',
  'To clear: land _dev/staged/kernel-hooks/REGISTRATION-PATCH.md (requires /convene',
  '+ a ConveneReceipt/1.0 covering tools/kernel/), then observe a live harness denial',
  '-- both an audit.jsonl deny row AND the harness\'s own verbatim denial transcript,',
  'from the same session -- and record',
  'remote_mutation_gate_test.enforcement_path_observed_live: true.'
].join('\n');

function evaluatePretooluseLive(invocation, opts) {
  const evidencePath = (opts && opts.evidencePath) || EVIDENCE_PATH;
  const applies = invocation.unattended || invocation.remote_capable;

  if (!applies) {
    return {
      gate_id: 'pretooluse-live',
      applies: false,
      verdict: PROCEED,
      reason_code: 'NOT-APPLICABLE',
      reason: 'Neither unattended nor remote-capable: no resolved phase can issue a remote-mutating action.',
      enforcement_path_observed_live: null,
      evidence_artifact: evidencePath
    };
  }

  const read = readJsonArtifact(evidencePath);
  if (!read.ok) {
    return {
      gate_id: 'pretooluse-live',
      applies: true,
      verdict: REFUSE,
      reason_code: read.reason_code,
      reason: `Evidence artifact ${evidencePath}: ${read.reason_code}. Fail-closed.`,
      enforcement_path_observed_live: null,
      evidence_artifact: evidencePath,
      halt_text: PRETOOLUSE_LIVE_HALT_TEXT
    };
  }

  const section = read.doc && read.doc.remote_mutation_gate_test;
  const value = section ? section.enforcement_path_observed_live : undefined;

  if (value === true) {
    return {
      gate_id: 'pretooluse-live',
      applies: true,
      verdict: PROCEED,
      reason_code: 'LIVE-ENFORCEMENT-OBSERVED',
      reason: 'remote_mutation_gate_test.enforcement_path_observed_live is strictly true.',
      enforcement_path_observed_live: true,
      evidence_artifact: evidencePath
    };
  }

  const reasonCode = value === undefined
    ? (section === undefined ? 'FIELD-GROUP-ABSENT' : 'FIELD-ABSENT')
    : (value === false ? 'ENFORCEMENT-NOT-LIVE'
      : (value === null ? 'FIELD-NULL' : 'FIELD-NOT-STRICT-BOOLEAN-TRUE'));

  return {
    gate_id: 'pretooluse-live',
    applies: true,
    verdict: REFUSE,
    reason_code: reasonCode,
    reason: `remote_mutation_gate_test.enforcement_path_observed_live is ${JSON.stringify(value)}; only the strict boolean true clears this gate. Fail-closed.`,
    enforcement_path_observed_live: value === undefined ? null : value,
    evidence_artifact: evidencePath,
    halt_text: PRETOOLUSE_LIVE_HALT_TEXT
  };
}

// ---------------------------------------------------------------------------
// Gate: G-TICKTOCK-REVIEW
// ---------------------------------------------------------------------------

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

  const decision = read.doc.decision;
  const reviewers = Array.isArray(read.doc.reviewers) ? read.doc.reviewers : [];
  const failing = reviewers.filter(
    (r) => r.verdict !== 'APPROVE' || r.unresolved_findings !== 0
  );

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
        : `Not clean from every locked reviewer: ${failing.map((r) => `${r.lane_id}=${r.verdict}/${r.unresolved_findings}`).join(', ')}.`,
      decision_artifact: decisionPath
    };
  }

  return {
    gate_id: 'G-TICKTOCK-REVIEW',
    applies: true,
    verdict: PROCEED,
    reason_code: 'CLEARED',
    reason: `decision.cleared is true with zero unresolved findings from ${reviewers.length} locked reviewers.`,
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
  evaluatePretooluseLive,
  evaluateTicktockReview,
  preflight
};

// ---------------------------------------------------------------------------
// CLI -- exit 0 PROCEED, exit 1 REFUSE, exit 2 internal error (also a refusal)
// ---------------------------------------------------------------------------
if (require.main === module) {
  try {
    const result = preflight(process.argv.slice(2));
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
