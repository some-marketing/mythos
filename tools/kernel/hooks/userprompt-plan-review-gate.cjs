#!/usr/bin/env node
'use strict';

/**
 * userprompt-plan-review-gate.cjs — ADVISORY gate on the plan lifecycle:
 *   plan -> codex (distinct-mind) review -> operator stamp -> (if BIG) /convene -> /run-plan
 *
 * CAPABILITY CLASS: ADVISORY, not BLOCKING. This hook always exits 0 (see
 * BLOCKING SEMANTICS below), so it injects an unmissable directive into model
 * context rather than halting the turn. Enforcement depends on the coordinator
 * honouring that directive. Do not describe it as mechanical enforcement.
 *
 * PURPOSE
 *   2026-06-10 failure case: sdag-ads-approval-portal-mvp reached operator
 *   approval with ZERO distinct-mind review. Operator rule: the gate must be a
 *   hook, not memory/instructions. This hook fires on every
 *   UserPromptSubmit, short-circuits instantly on non-/run-plan prompts, and on
 *   /run-plan checks durable artifacts for (a) a distinct-mind (codex) review
 *   and (b) for BIG plans, a convene artifact.
 *
 * BLOCKING SEMANTICS (verified from this repo, not assumption)
 *   In-repo evidence verifies exit-2 blocking ONLY for PreToolUse
 *   (tools/kernel/hooks/pretool-delegation-altitude.cjs). Both existing
 *   UserPromptSubmit hooks (userprompt-owl-altitude.cjs,
 *   userpromptsubmit-ambient-router.cjs) use stdout-injection + exit 0; no
 *   local doc/test verifies UserPromptSubmit exit-2 or JSON-decision blocking.
 *   => This hook ships the LOUD-INJECTION variant: it emits an unmissable
 *   BLOCKING-STYLE directive into model context and always exits 0. The model
 *   (coordinator) is instructed not to proceed; the operator override below is
 *   always available.
 *
 * AUTHORITATIVE ARTIFACT CONVENTION (chosen + documented here)
 *   The plan-task-review-state marker
 *     _dev/state/plan-task-review-state/<plan-id>.json   (system scope)
 *     clients/<CODE>/state/plan-task-review-state/<plan-id>.json (client scope)
 *   is extended with:
 *     "distinct_reviews": [ { "actor": "codex gpt-5.5", "artifact": "<path>",
 *                             "at": "<ISO>", "verdict": "approve|reject|..." } ]
 *     "distinct_reviews_pending": [ { "actor", "artifact", "dispatched_at", "note" } ]
 *     "convene_review": { "artifact": "<path>", "at": "<ISO>" }   // BIG plans
 *     "big": true            // optional explicit BIG flag (client-facing /
 *                            // always-on-infra / multi-actor criteria)
 *   distinct_reviews is the ONLY AUTHORITY. A satisfying entry carries an
 *   approving verdict (see classifyVerdict) AND postdates the most recent
 *   blocking verdict — approval does not survive a later block. Blocking,
 *   pending, negated, and unrecognized verdicts all fail closed.
 *
 *   There is NO legacy filename fallback. It was removed 2026-08-20 (convene run
 *   20260820T153136Z-plan-review-gate-verdict-vocabulary): it satisfied the gate
 *   from a filename alone, never opening the file, and since those artifacts are
 *   written by every bridge run INCLUDING failed ones, a failed review deposited
 *   the file that then authorized the plan. A review is evidence only once it is
 *   recorded in the marker with a verdict.
 *
 * BIG DETECTION (mechanical)
 *   BIG = plan JSON routing_expectations.risk_tier === "high"
 *         OR marker.big === true
 *         OR plan JSON routing_expectations.big === true
 *   (Client-facing surface / new always-on infrastructure / multi-actor are
 *   judgment calls: the reviewer/coordinator records them as marker.big=true
 *   at review time; risk_tier high is auto-detected.)
 *   BIG additionally requires a convene artifact:
 *   marker.convene_review OR _dev/reports/analysis/convene-runs/*<plan-id>*.
 *
 * OPERATOR OVERRIDE (the operator is the gate owner; never imprisoned)
 *   Include `--skip-distinct-review` in the /run-plan prompt. The hook injects
 *   an acknowledgment, appends a record to
 *   _dev/state/plan-review-gate/overrides.jsonl, and lets the run pass.
 *
 * KILL SWITCH: touch _dev/state/plan-review-gate/disabled  => silent no-op.
 * PERFORMANCE: regex short-circuit BEFORE any fs/require work on the plan
 *   surfaces; non-matching prompts exit silently in well under 200ms.
 * CONTRACT: never throws, never blocks the turn; always exit 0.
 *
 * Stdin: UserPromptSubmit JSON payload ({ prompt, session_id, cwd, ... }).
 * Stdout: nothing (no match) | pass note | WARN | loud blocking-style directive.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// MYTHOS_* is authoritative. The SMOS names remain a read-only compatibility
// fallback for existing launchd or shell callers.
function readCompatEnv(currentName, legacyName) {
  if (Object.prototype.hasOwnProperty.call(process.env, currentName)) return process.env[currentName];
  return process.env[legacyName];
}

// Prompt matchers: a /run-plan invocation at start of prompt (with or without
// the leading slash) or an explicit /run-plan anywhere in the prompt.
const RUN_PLAN_LEAD = /^\s*\/?run-plan\b(?:\s+([a-z0-9][a-z0-9_-]*))?/i;
const RUN_PLAN_ANYWHERE = /(?<![`'"\w])\/run-plan\b(?:\s+([a-z0-9][a-z0-9_-]*))?/i;
const OVERRIDE_FLAG = '--skip-distinct-review';

// Verdict vocabulary. Authorized by convene run
// _dev/reports/analysis/convene-runs/20260820T153136Z-plan-review-gate-verdict-vocabulary/.
//
// The declared enum is APPROVE | AMEND_REQUIRED | REJECT | NO_VERDICT, but
// reviewers write prose. An audit of every recorded verdict in this repo also
// found: CHANGES_REQUIRED, CHANGES_REQUESTED, "changes-required",
// REJECT_PENDING_AMENDMENT, NEEDS_AMENDMENT, AMENDED, "blocked for amendment",
// SOUND, "APPROVED WITH NONBLOCKING FOLLOW-UPS".
//
// The defect this replaces: approval was matched first, with unanchored
// substrings, and anything matching neither pattern fell THROUGH both buckets
// into a filename-glob fallback that opened the gate. AMEND_REQUIRED matched
// neither, so "amend this plan" read as authorization. Of the 26 plans that
// reached the gate through that fallback, 25 should not have been passing and
// 20 carried artifacts declaring an explicitly blocking verdict.
//
// Rules, in order:
//   1. Match anchored TOKENS, never substrings ("bypass" is not "pass").
//   2. Blocking and negated-approval beat an approving word in the same string,
//      so "APPROVE or AMEND_REQUIRED" blocks. The safe direction is closed.
//   3. An unrecognized verdict is UNCLASSIFIED and fails closed. On an
//      authorization gate, an unknown value is absence of authorization.
// AUTHORIZATION IS NOT PROSE. An earlier revision searched arbitrary narrative
// for an approval word, and distinct-family review broke it with real corpus
// entries: "PASS on 3 of 4 ... NEW MAJOR ... NEW MAJOR" authorized while
// carrying unresolved major findings, and "...final /review-task-plan pass
// required before /run-plan" authorized while explicitly demanding another
// review. Corpus compatibility is not authorization semantics.
//
// So approval now requires a CANONICAL VERDICT FORM: the whole string is an
// approval token, optionally followed by a short hyphenated/spaced qualifier
// (APPROVE-FOR-RUN, PASS-WITH-CONDITIONS, APPROVED-WITH-MINOR). Narrative
// verdicts no longer authorize — they fall to `unclassified` and fail closed,
// and are migrated deliberately rather than normalized automatically.
// CLOSED ENUMERATION, not a pattern. Three review rounds each broke a regex I
// had convinced myself was tight: `approv\w*` admitted APPROVAL, `accept\w*`
// admitted ACCEPTABLE, and three free qualifier words admitted APPROVE-UNSAFE
// and APPROVE-WITH-MAJOR-FINDINGS. Wildcards cannot express "these exact
// verdicts authorize and nothing else", so the head and the qualifier are both
// enumerated. Adding a form is a deliberate edit here, reviewed like any other.
const APPROVAL_HEADS = [
  'APPROVE', 'APPROVED', 'ACCEPT', 'ACCEPTED',
  'PASS', 'PASSED', 'LGTM', 'OK', 'SOUND', 'CLEAN', 'CLEAR'
];
// Qualifiers observed on real approving verdicts in this repository. A verdict
// whose qualifier is not on this list does not authorize — it is unclassified
// and fails closed, to be re-recorded in a recognized form.
const APPROVAL_QUALIFIERS = [
  'FOR-RUN', 'WITH-CHANGES', 'WITH-CHANGES-APPLIED', 'WITH-MINOR',
  'WITH-CONDITIONS', 'WITH-NONBLOCKING-FOLLOW-UPS', 'WITH-NONBLOCKING-FOLLOWUPS'
];
const APPROVAL_TOKEN = '(?:' + APPROVAL_HEADS.join('|') + ')';
const SATISFYING_VERDICT = new RegExp(
  '^\\s*' + APPROVAL_TOKEN
  + '(?:[-_\\s](?:' + APPROVAL_QUALIFIERS.join('|').replace(/-/g, '[-_\\s]') + '))?'
  + '\\s*[.!]?\\s*$',
  'i'
);
// Blocking stays prose-TOLERANT: a false block is the safe direction, and
// blocking verdicts in the corpus routinely carry their findings inline.
// Narrowed twice after review. Bare `needs\w*` blocked "APPROVED; a follow-up
// needs documentation" and bare `hold` blocked "stakeholders hold no
// objections"; both are now specific phrases. Bare `block\w*` matched inside
// "non-blocking" and "no blocking findings", so those two forms are excluded.
const BLOCKING_VERDICT = /\b(amend\w*|reject\w*|fail\w*|(?<!non[-\s])(?<!no\s)block\w*|denied|deny|no[_\s-]?verdict|changes?[_\s-]?(?:required|requested)|needs[_\s-]?(?:amendment|revision|rework|changes|work)|revise|revision|on[_\s-]hold)\b/i;
const PENDING_VERDICT = /pending|in.flight/i;
// Negation must cover EVERY approval token, not just approve/accept — "not OK",
// "not LGTM", "not sound" and "not clean" all read as approvals otherwise.
//
// The refusal idiom "pass on" is matched ONLY when it governs an authorization
// word ("I pass on authorizing this plan"). A bare `pass on` guard is wrong:
// "PASS on 3 of 4 round-1 findings" is a real recorded APPROVAL in this repo,
// and blocking it was a regression caught against the live corpus.
// Order-independent: a negation word ANYWHERE alongside an approval token
// ANYWHERE disqualifies. Written as two lookaheads so "not OK" and "OK-not-
// really" are both caught — a one-directional pattern only caught the first.
const NEGATED_APPROVAL = new RegExp(
  '(?:^(?=[\\s\\S]*\\b(?:not|never|cannot|can\'t|no|without|isn\'t|aren\'t|nor)\\b)'
  + '(?=[\\s\\S]*\\b' + APPROVAL_TOKEN + '\\b))'
  + '|(?:\\bpass(?:es|ed)?\\s+on\\s+(?:approv|authoriz|accept|sign))',
  'i'
);

/**
 * Classify one recorded verdict string.
 *
 * @returns {'approving'|'blocking'|'pending'|'unclassified'}
 */
function classifyVerdict(verdict) {
  const text = String(verdict || '').trim();
  if (!text) return 'pending';
  if (BLOCKING_VERDICT.test(text)) return 'blocking';
  if (PENDING_VERDICT.test(text)) return 'pending';
  // Negation is checked ONLY against a canonical-form approval. Applied to
  // arbitrary prose it misfires — "CLEAN - two non-blocking advisories, not
  // scoped to this plan" contains both a negation word and an approval word
  // while being neither an approval nor a block. Prose cannot authorize at all
  // now, so it needs no negation guard: it simply falls through and fails
  // closed as unclassified.
  if (SATISFYING_VERDICT.test(text)) {
    return NEGATED_APPROVAL.test(text) ? 'unclassified' : 'approving';
  }
  return 'unclassified';
}

/**
 * Order two review entries, where each is a WRAPPER { review, index } and never
 * the marker object itself. The sequence number lives outside the caller's data
 * on purpose: a marker is untrusted input, so an entry carrying its own
 * `__index` must not be able to overwrite its position in the ordering.
 *
 * Ordering provenance must be UNIFORM. If both entries carry a parseable `at`,
 * timestamps decide. If NEITHER does, append order stands in. If exactly one
 * does, the two are not comparable and this returns false — fail closed —
 * because mixing the two modes let a stale approval with a real timestamp
 * jump ahead of a later block whose timestamp was missing or malformed.
 */
// Round-4 review finding (MAJOR): raw Date.parse() accepts calendar-invalid
// dates by silently normalizing them (2026-02-30T00:00:00Z parses as
// 2026-03-02T00:00:00.000Z), which let a malformed "approval" timestamp
// masquerade as later than a real block. The marker's ISO timestamp contract
// requires a real calendar date, so ordering must validate the calendar
// fields itself rather than trust JS Date normalization.
const ISO_TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function parseStrictIsoTimestamp(value) {
  const text = String(value || '');
  const m = ISO_TIMESTAMP_RE.exec(text);
  if (!m) return NaN;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12) return NaN;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return NaN;
  if (hour > 23 || minute > 59 || second > 59) return NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function reviewIsAfter(candidate, reference) {
  const a = parseStrictIsoTimestamp(candidate.review && candidate.review.at);
  const b = parseStrictIsoTimestamp(reference.review && reference.review.at);
  const aOk = Number.isFinite(a);
  const bOk = Number.isFinite(b);
  if (aOk && bOk) return a > b;
  if (!aOk && !bOk) return candidate.index > reference.index;
  return false;
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

/** Extract { matched, planRef, override } from the prompt. Pure string work. */
function parsePrompt(prompt) {
  const p = String(prompt || '');
  if (!p.trim()) return { matched: false };

  // Strip override flags before matching so the plan ref is the first real token.
  const pClean = p.split(OVERRIDE_FLAG).join(' ');
  let m = RUN_PLAN_LEAD.exec(pClean);
  if (!m) m = RUN_PLAN_ANYWHERE.exec(pClean);
  if (!m) return { matched: false };

  const override = p.includes(OVERRIDE_FLAG);
  // First non-flag token after run-plan is the plan ref (may be absent).
  let planRef = null;
  const rest = (m[1] || '').trim();
  if (rest) {
    const tokens = rest.split(/\s+/);
    for (const t of tokens) {
      if (t.startsWith('--')) continue;
      planRef = t;
      break;
    }
  }
  return { matched: true, planRef, override };
}

function readJsonSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { return null; }
}

/** Locate the review-state marker (system scope first, then any client scope). */
function findMarker(projectRoot, planId, clientCode) {
  const candidates = [
    path.join(projectRoot, '_dev', 'state', 'plan-task-review-state', planId + '.json')
  ];
  if (clientCode) {
    candidates.push(path.join(projectRoot, 'clients', clientCode, 'state', 'plan-task-review-state', planId + '.json'));
  }
  for (const c of candidates) {
    const parsed = readJsonSafe(c);
    if (parsed) return { path: c, marker: parsed };
  }
  return { path: candidates[0], marker: null };
}

// The legacy artifact-glob fallback was REMOVED here (convene run
// 20260820T153136Z-plan-review-gate-verdict-vocabulary, unanimous).
//
// It satisfied the gate whenever a file in _dev/reports/analysis/ merely had the
// plan id in its NAME and a codex-run prefix. It never opened the file. Those
// artifacts are written by every bridge run INCLUDING runs that fail, so a
// failed review deposited the file that then authorized the plan.
//
// Body-parsing was considered and rejected: prompt echoes ("give APPROVE or
// AMEND_REQUIRED") are structurally indistinguishable from real verdict
// declarations, so a body regex cannot be authoritative. A review is evidence
// only when it is recorded in the marker's distinct_reviews[] with a verdict.

/** Convene evidence: marker.convene_review OR convene-runs dir containing plan id. */
function findConveneEvidence(projectRoot, planId, marker) {
  if (marker && marker.convene_review &&
      (typeof marker.convene_review === 'object' || typeof marker.convene_review === 'string')) {
    return { source: 'marker.convene_review', ref: JSON.stringify(marker.convene_review) };
  }
  try {
    const dir = path.join(projectRoot, '_dev', 'reports', 'analysis', 'convene-runs');
    if (fs.existsSync(dir)) {
      const entries = fs.readdirSync(dir);
      for (const e of entries) {
        if (e.includes(planId)) return { source: 'convene-runs', ref: path.join('_dev/reports/analysis/convene-runs', e) };
      }
    }
  } catch (_) { /* best-effort */ }
  return null;
}

/**
 * Resolve the convene-run DIRECTORY referenced by a marker.convene_review field,
 * for synthesis validation. Returns an absolute dir path or null when the field
 * is opaque (not a filesystem path) — opaque records are left unassessed so we do
 * not false-block a deliberately operator-authored note. A path-like ref that
 * points at a file (e.g. .../synthesis.md) resolves to its containing dir; a
 * path-like ref to a missing location resolves to that (missing) dir so the
 * validator fail-closes it (a marker pointing at a vanished convene is hollow).
 */
function resolveConveneReviewDir(projectRoot, conveneReview) {
  let raw = null;
  if (typeof conveneReview === 'string') {
    raw = conveneReview;
  } else if (conveneReview && typeof conveneReview === 'object') {
    raw = conveneReview.dir || conveneReview.artifact || conveneReview.path || conveneReview.ref || null;
  }
  if (!raw || typeof raw !== 'string') return null;
  // Only treat as a convene-run dir if the ref is path-like (a slash) or clearly
  // names a convene run; otherwise it is an opaque operator note → leave unassessed.
  if (!raw.includes('/') && !/convene/i.test(raw)) return null;
  const abs = path.isAbsolute(raw) ? raw : path.join(projectRoot, raw);
  try {
    const st = fs.statSync(abs);
    if (st.isDirectory()) return abs;
    if (st.isFile()) return path.dirname(abs);
  } catch (_) {
    // Does not exist. If it looks like a file ref, validate the parent dir; else
    // validate the (missing) path itself so the validator fail-closes it.
    return /\.[a-z0-9]+$/i.test(abs) ? path.dirname(abs) : abs;
  }
  return null;
}

/**
 * Classify the distinct-review state from the marker. The marker is the ONLY
 * evidence source; there is no filename fallback (see the note above).
 *
 * Approval is not immortal. A satisfying entry authorizes the plan only if it
 * POSTDATES the most recent blocking verdict — otherwise an old APPROVE would
 * survive a later CHANGES_REQUIRED and re-authorize a plan that was just told to
 * amend. Falsifier pair: [APPROVE, CHANGES_REQUIRED] must block;
 * [AMEND_REQUIRED, APPROVE] must pass.
 */
function assessDistinctReview(projectRoot, planId, marker) {
  const raw = (marker && Array.isArray(marker.distinct_reviews)) ? marker.distinct_reviews : [];
  // Wrap, never decorate: the sequence number lives OUTSIDE the marker object so
  // untrusted marker data cannot supply its own index and reorder itself.
  const reviews = raw
    .filter(function (r) { return r && typeof r === 'object'; })
    .map(function (r, index) { return { review: r, index: index }; });

  const byClass = { approving: [], blocking: [], pending: [], unclassified: [] };
  for (const r of reviews) byClass[classifyVerdict(r.review.verdict)].push(r);

  const describe = function (r) {
    return (r.review.actor || 'unknown actor') + ' verdict "' + String(r.review.verdict || '') + '" ('
      + (r.review.artifact || 'no artifact ref') + ')';
  };

  const pendingList = (marker && Array.isArray(marker.distinct_reviews_pending)) ? marker.distinct_reviews_pending : [];

  // Authorization is proven against EVERY NON-AUTHORIZING entry — blocking,
  // pending, AND unclassified alike. Two separate mistakes were made here:
  //
  //   - Folding the blocking set to one "latest" member. reviewIsAfter reports
  //     incomparable pairs as false, so that set is only PARTIALLY ordered and a
  //     maximum silently discarded blocks an approval could then slip past.
  //     `every` is the only safe quantifier over a partial order.
  //   - Quantifying over blocking ONLY, so [APPROVE, pending] and
  //     [APPROVE, "see major findings"] both authorized — contradicting this
  //     hook's own contract that pending and unrecognized verdicts fail closed.
  //
  // A populated distinct_reviews_pending[] carries no ordering at all, so it
  // blocks outright rather than being compared.
  const nonAuthorizing = byClass.blocking.concat(byClass.pending, byClass.unclassified);
  const liveApproval = pendingList.length > 0 ? undefined : byClass.approving.find(function (approval) {
    return nonAuthorizing.every(function (other) { return reviewIsAfter(approval, other); });
  });

  if (liveApproval) {
    return { status: 'satisfied', source: 'marker.distinct_reviews', detail: describe(liveApproval) };
  }

  // Round-4 review finding (MODERATE): reporting always blamed the blocking
  // verdict and always claimed "PREDATES this block" whenever ANY approval
  // existed, even when that approval actually postdated the block and the
  // real withholding entry was a later pending/unclassified one. Only a
  // blocking entry that no approval postdates is still the reason
  // authorization fails; a blocking entry an approval already postdates is
  // resolved and must fall through to whichever entry is genuinely
  // withholding (handled by the pending/unclassified branches below).
  const unresolvedBlocking = byClass.blocking.filter(function (r) {
    return !byClass.approving.some(function (a) { return reviewIsAfter(a, r); });
  });
  const latestBlocking = unresolvedBlocking.reduce(function (acc, r) {
    return acc === null || reviewIsAfter(r, acc) ? r : acc;
  }, null) || unresolvedBlocking[0] || null;

  if (latestBlocking) {
    // latestBlocking is drawn only from unresolvedBlocking, so by
    // construction no approval postdates it — any approval that exists
    // genuinely PREDATES it, so the claim below is always true.
    const superseded = byClass.approving.length > 0
      ? ' (an earlier approving verdict exists but PREDATES this block and does not revive)'
      : '';
    return { status: 'rejected', source: 'marker.distinct_reviews', detail: describe(latestBlocking) + superseded };
  }

  if (byClass.pending.length > 0 || pendingList.length > 0) {
    const p = byClass.pending.length > 0 ? byClass.pending[0].review : pendingList[0];
    return { status: 'pending', source: 'marker', detail: (p.actor || 'unknown actor') + ' review in flight (' + (p.artifact || p.note || 'no ref') + ')' };
  }

  // Fail closed: a verdict we cannot classify is not an approval.
  if (byClass.unclassified.length > 0) {
    const u = byClass.unclassified[0];
    return {
      status: 'unclassified',
      source: 'marker.distinct_reviews',
      detail: describe(u) + ' — this verdict string is not recognized as an approval, so it does not open the gate'
    };
  }

  return { status: 'missing', source: null, detail: null };
}

/**
 * A1 operator_stamp enforcement assessment. Lazily requires the planning lib
 * (single source of truth for the flag + presence contract) inside a try/catch
 * so a missing/broken lib NEVER breaks the turn — it degrades to enforcement-OFF
 * (the bootstrap-safe default). Returns { enforced, status, detail }.
 */
function assessOperatorStampEnforcement(marker) {
  try {
    const prs = require(path.join(PROJECT_ROOT, 'tools', 'planning', 'lib', 'plan-review-state.js'));
    if (prs && typeof prs.isOperatorStampEnforcementEnabled === 'function' &&
        prs.isOperatorStampEnforcementEnabled()) {
      const a = prs.assessOperatorStamp(marker);
      return { enforced: true, status: a.status, detail: a.detail };
    }
  } catch (_) {
    // Lib unavailable/broken — default OFF (bootstrap-safe; never break the turn).
  }
  return { enforced: false, status: 'not-enforced', detail: 'enforcement disabled' };
}

/**
 * S5 (plan-execution-autonomy-default-perimeter-gate-and-tracking) perimeter
 * scoping. Does the plan trip the consequential perimeter (=> require the
 * operator GREENLIGHT/stamp)? Lazily requires the S1-backed wiring lib inside a
 * try/catch so a missing/broken lib NEVER breaks the turn. FAIL-CLOSED: any
 * uncertainty (lib unavailable, classifier throw) => TRUE (treat as perimeter =>
 * keep requiring the stamp). Consulted ONLY inside the already-enforced branch,
 * so the default (flag-OFF) path is byte-unchanged.
 */
function planTripsConsequentialPerimeter(planJson) {
  try {
    const wiring = require(path.join(PROJECT_ROOT, 'tools', 'kernel', 'lib', 'autonomous-execution-wiring.js'));
    return wiring.planTripsPerimeter(planJson);
  } catch (_) {
    return true; // fail-closed: cannot classify => treat as perimeter => require stamp
  }
}

function isBig(planJson, marker) {
  const reasons = [];
  const re = planJson && planJson.routing_expectations;
  if (re && re.risk_tier === 'high') reasons.push('routing_expectations.risk_tier=high');
  if (re && re.big === true) reasons.push('routing_expectations.big=true');
  if (marker && marker.big === true) reasons.push('marker.big=true (client-facing / always-on infra / multi-actor)');
  return { big: reasons.length > 0, reasons };
}

function logOverride(projectRoot, record) {
  try {
    const dir = path.join(projectRoot, '_dev', 'state', 'plan-review-gate');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'overrides.jsonl'), JSON.stringify(record) + '\n', 'utf8');
    return true;
  } catch (_) { return false; }
}

function sharedGateMode() {
  try {
    return require(path.join(PROJECT_ROOT, 'tools', 'planning', 'lib', 'plan-review-state.js')).planRunGateMode();
  } catch (_) {
    return 'observe';
  }
}

function collectSharedHookGate(projectRoot, planId, parsed, planJson, marker, review, bigness, resolved, convene) {
  const prs = require(path.join(PROJECT_ROOT, 'tools', 'planning', 'lib', 'plan-review-state.js'));
  const stampEnforced = prs.isOperatorStampEnforcementEnabled();
  const tripsPerimeter = stampEnforced ? planTripsConsequentialPerimeter(planJson) : false;
  let stampVerification = tripsPerimeter ? 'missing' : 'not_required';
  if (tripsPerimeter && prs.assessOperatorStamp(marker).status === 'present') {
    try {
      const wiring = require(path.join(PROJECT_ROOT, 'tools', 'kernel', 'lib', 'autonomous-execution-wiring.js'));
      const result = wiring.verifyPresentStampSync({ planId, planJsonPath: resolved.jsonPath, stamp: marker.operator_stamp });
      stampVerification = result && result.verified === true ? 'verified' : 'unverified';
    } catch (_) {
      stampVerification = 'unverified';
    }
  }
  return prs.collectPlanRunGateDecision(projectRoot, planId, {
    // Always false: the legacy artifact-glob fallback was retired, so no review
    // can be "present" on filename evidence alone.
    legacyReviewPresent: false,
    requiresConvene: bigness.big,
    convenePresent: Boolean(convene),
    operatorOverridePresent: parsed.override,
    operatorStampRequired: tripsPerimeter,
    operatorStampVerification: stampVerification
  });
}

function appendHookComparison(projectRoot, mode, decision, legacyResult) {
  if (!decision) return;
  try {
    require(path.join(PROJECT_ROOT, 'tools', 'planning', 'lib', 'plan-review-state.js')).appendPlanRunGateReceipt(projectRoot, {
      schema: 'PlanRunGateComparisonReceipt/1.0',
      decision_point_id: 'plan-run-authorization',
      at: new Date().toISOString(),
      adapter: 'userprompt-plan-review-gate',
      mode,
      task_id: decision.task_id,
      legacy_result: legacyResult,
      shared_result: decision.status,
      disagreement: ['ready', 'blocked'].includes(legacyResult) ? legacyResult !== decision.status : null,
      json_sha256: decision.json_sha256,
      markdown_sha256: decision.markdown_sha256,
      plan_pair_sha256: decision.plan_pair_sha256,
      marker_sha256: decision.marker_sha256,
      reason_codes: decision.reason_codes,
      trace_id: process.env.MYTHOS_TRACE_ID || null,
      span_id: process.env.MYTHOS_SPAN_ID || null
    });
  } catch (_) { /* receipts never break or pollute the hook */ }
}

/**
 * Core evaluation. Returns { action: 'silent' | 'inject', text? }.
 * projectRoot is injectable for tests; sessionId only feeds the override log.
 */
function evaluateGate(prompt, projectRoot, sessionId) {
  const parsed = parsePrompt(prompt);
  if (!parsed.matched) return { action: 'silent' };
  const gateMode = sharedGateMode();

  // Kill switch — checked only after the cheap regex match.
  try {
    if (fs.existsSync(path.join(projectRoot, '_dev', 'state', 'plan-review-gate', 'disabled'))) {
      return { action: 'silent' };
    }
  } catch (_) { /* fall through */ }

  // Operator override — gate owner is never imprisoned.
  if (parsed.override) {
    const logged = logOverride(projectRoot, {
      at: new Date().toISOString(),
      plan_ref: parsed.planRef || null,
      session_id: sessionId || null,
      flag: OVERRIDE_FLAG,
      prompt_head: String(prompt).slice(0, 200)
    });
    if (gateMode === 'off') {
      return {
        action: 'inject',
        text: [
          '[plan-review-gate] OPERATOR OVERRIDE acknowledged (' + OVERRIDE_FLAG + ').',
          'The distinct-review/convene gate for ' + (parsed.planRef || '(unspecified plan)') + ' was skipped by the gate owner.',
          logged ? 'Override logged to _dev/state/plan-review-gate/overrides.jsonl.' : 'WARNING: override log write failed (gate still passes).',
          'Proceed with /run-plan.'
        ].join('\n')
      };
    }
    parsed.override_logged = logged;
  }

  if (!parsed.planRef) {
    return {
      action: 'inject',
      text: [
        '[plan-review-gate] WARN: /run-plan invoked without a plan reference; the mechanical distinct-review gate cannot check artifacts.',
        'Pipeline rule (operator, 2026-06-10): plan -> codex distinct review -> operator stamp -> (if BIG) /convene -> /run-plan.',
        'Before executing, VERIFY the resolved plan has a satisfying entry in its plan-task-review-state marker distinct_reviews[] (and convene_review for BIG plans).'
      ].join('\n')
    };
  }

  // Resolve the plan (best-effort; never crash the turn).
  let resolved = null;
  let resolveError = null;
  try {
    const resolver = require(path.join(PROJECT_ROOT, 'tools', 'planning', 'lib', 'resolve-task-plan.js'));
    resolved = resolver.resolveTaskPlanPaths(projectRoot, parsed.planRef);
  } catch (err) {
    resolveError = err && err.message ? err.message : String(err);
  }

  if (!resolved) {
    return {
      action: 'inject',
      text: [
        '[plan-review-gate] WARN: could not resolve plan "' + parsed.planRef + '"' + (resolveError ? ' (' + resolveError.split('\n')[0] + ')' : ' (no matching task-plan found)') + '.',
        'The mechanical distinct-review gate could not run. Pipeline rule still applies:',
        'plan -> codex distinct review -> operator stamp -> (if BIG) /convene -> /run-plan.',
        'If /run-plan resolves this plan another way, verify its plan-task-review-state marker distinct_reviews[] before executing.'
      ].join('\n')
    };
  }

  // Derive plan id from the resolved JSON filename.
  const base = path.basename(resolved.jsonPath);
  const planId = base.endsWith('__plan.json') ? base.slice(0, -'__plan.json'.length) : parsed.planRef;
  const planJson = readJsonSafe(resolved.jsonPath);
  const found = findMarker(projectRoot, planId, resolved.clientCode);
  const marker = found.marker;

  const review = assessDistinctReview(projectRoot, planId, marker);
  const bigness = isBig(planJson, marker);
  const convene = bigness.big ? findConveneEvidence(projectRoot, planId, marker) : null;

  // REJECT_HOLLOW_COMPLETION (kernel convene 20260629T214856Z): a convene-run
  // DIRECTORY only counts as evidence if it carries a real synthesis.md (not just
  // the mechanically-written synthesis-skeleton.md, and not a keyword-padded fake).
  // Gated behind the DEFAULT-OFF flag MYTHOS_REQUIRE_CONVENE_SYNTHESIS so the default
  // path is byte-unchanged: the env is read ONLY here, and conveneHollowReason
  // stays null unless the flag is on AND a resolvable convene-run dir fails
  // validation. Covers BOTH evidence sources — the auto-discovered convene-runs dir
  // AND a marker.convene_review that points at a convene-run dir (a marker pointing
  // at a hollow convene must not satisfy the gate either). An opaque
  // marker.convene_review with no resolvable dir path is left as-is (not assessable
  // => preserve the operator-authored record).
  let conveneHollowReason = null;
  if (bigness.big && convene && readCompatEnv('MYTHOS_REQUIRE_CONVENE_SYNTHESIS', 'SMOS_REQUIRE_CONVENE_SYNTHESIS')) {
    let dirToValidate = null;
    if (convene.source === 'convene-runs') {
      dirToValidate = path.join(projectRoot, convene.ref);
    } else if (convene.source === 'marker.convene_review') {
      dirToValidate = resolveConveneReviewDir(projectRoot, marker && marker.convene_review);
    }
    if (dirToValidate) {
      let validation;
      try {
        const { validateConveneSynthesis } = require(path.join(PROJECT_ROOT, 'tools', 'kernel', 'lib', 'validate-convene-synthesis.cjs'));
        validation = validateConveneSynthesis(dirToValidate);
      } catch (_) {
        validation = { valid: false, reason: 'synthesis validator unavailable (fail-closed)' };
      }
      if (!validation.valid) conveneHollowReason = validation.reason;
    }
  }

  let sharedGate = null;
  if (gateMode !== 'off') {
    try {
      sharedGate = collectSharedHookGate(projectRoot, planId, parsed, planJson, marker, review, bigness, resolved, convene);
    } catch (_) {
      sharedGate = { task_id: planId, status: 'blocked', reason_codes: ['shared_gate_collection_failed'] };
    }
    if (gateMode === 'enforce' && sharedGate.status === 'blocked') {
      appendHookComparison(projectRoot, gateMode, sharedGate, 'not_evaluated_due_to_enforce');
      return {
        action: 'inject',
        text: [
          '████ [plan-review-gate] DO NOT EXECUTE /run-plan ' + planId + ' — SHARED GATE FAILED ████',
          'Blocked reasons: ' + sharedGate.reason_codes.join(', ') + '.',
          'Exact next command: /review-task-plan ' + planId
        ].join('\n')
      };
    }
  }

  const missing = [];
  if (!parsed.override && review.status === 'missing') {
    missing.push({
      what: 'DISTINCT-MIND (codex) REVIEW — no distinct_reviews entry in ' + found.path + '. A review artifact sitting in _dev/reports/analysis/ is NOT evidence; only a recorded verdict is.',
      fix: 'Produce it: /dispatch-bridge — dispatch a codex review of ' + planId + ' (target: codex; prompt: review the plan at ' + path.relative(projectRoot, resolved.jsonPath) + '), then record {actor, artifact, at, verdict} in marker.distinct_reviews.'
    });
  } else if (!parsed.override && review.status === 'unclassified') {
    missing.push({
      what: 'DISTINCT-MIND REVIEW VERDICT NOT RECOGNIZED — ' + review.detail + '. An unrecognized verdict is absence of authorization, not approval.',
      fix: 'Record the verdict using recognized wording (APPROVE / AMEND_REQUIRED / REJECT), or obtain a fresh approving distinct review, then re-run /run-plan ' + planId + '.'
    });
  } else if (!parsed.override && review.status === 'pending') {
    missing.push({
      what: 'DISTINCT-MIND REVIEW IS STILL IN FLIGHT — ' + review.detail + '. A pending review does not satisfy the gate.',
      fix: 'Wait for the codex verdict, record it in marker.distinct_reviews with a real verdict, then re-run /run-plan ' + planId + '.'
    });
  } else if (!parsed.override && review.status === 'rejected') {
    missing.push({
      what: 'DISTINCT-MIND REVIEW REJECTED THIS PLAN — ' + review.detail + '.',
      fix: 'Repair the plan (/repair-plan or /amend-plan), obtain a fresh approving distinct review, then re-run.'
    });
  }
  if (!parsed.override && bigness.big && !convene) {
    missing.push({
      what: 'BIG PLAN WITHOUT CONVENE — ' + bigness.reasons.join(', ') + ', but no convene artifact (_dev/reports/analysis/convene-runs/*' + planId + '*) and no convene_review in the marker.',
      fix: 'Produce it: /convene on ' + planId + ' (triadic review), then record convene_review {artifact, at} in the marker.'
    });
  } else if (!parsed.override && bigness.big && conveneHollowReason) {
    // REJECT_HOLLOW_COMPLETION: a convene-run dir exists (auto-discovered OR pointed
    // at by marker.convene_review) but its synthesis is missing/skeleton/padded.
  // Only reachable when MYTHOS_REQUIRE_CONVENE_SYNTHESIS is ON.
    missing.push({
      what: 'REJECT_HOLLOW_COMPLETION — BIG plan convene evidence (' + convene.source + ': ' + convene.ref + ') is HOLLOW: ' + conveneHollowReason + '. A skeleton-only or keyword-padded convene (synthesis skipped/faked) is NOT convene evidence.',
      fix: 'Complete the synthesis: the ORIGIN actor writes a real synthesis.md (NOT synthesis-skeleton.md) — referencing the convened slots with cross-verification catches and net findings — then re-run /run-plan ' + planId + '.'
    });
  }

  // A1 (plan-approval-surface): operator_stamp is a THIRD mechanical requirement,
  // separate from distinct-review and convene (Stamp != convene). It was named in
  // this hook's pipeline text but never CHECKED, so a marker with
  // operator_stamp:null passed. Now enforced — but only when the default-OFF
  // feature flag MYTHOS_ENFORCE_OPERATOR_STAMP is deliberately turned on (bootstrap
  // safety: Stage B, not built yet, is what produces a verifiable stamp; enforcing
  // before that exists would jam every /run-plan). PRESENCE-only here; run-time
  // authenticity re-verification is Stage B/D, not built here.
  // S5 perimeter scoping (amendment: "enforce only at the perimeter"): a missing
  // stamp is a BLOCKING requirement ONLY when the plan trips the consequential
  // perimeter (S1 classifier => 'gate'). Non-perimeter (auto-run) plans pass the
  // stamp requirement even under enforcement. The perimeter consult runs ONLY
  // inside the enforcement-ON branch, so the default flag-OFF path is unchanged.
  const stamp = assessOperatorStampEnforcement(marker);
  if (stamp.enforced && stamp.status !== 'present' && planTripsConsequentialPerimeter(planJson)) {
    missing.push({
      what: 'OPERATOR STAMP — ' + stamp.detail + ' (gate flag MYTHOS_ENFORCE_OPERATOR_STAMP is ON; plan trips the consequential perimeter). Stamp != convene; this is a separate requirement.',
      fix: 'Obtain the operator approval stamp for ' + planId + ' (out-of-band proof: an operator-authored Dart approval comment, or the /stamp HMAC fallback per the plan-approval-surface concept), then re-run /run-plan ' + planId + '. NOTE: presence is necessary but run-time authenticity re-verification is Stage B/D.'
    });
  }

  if (missing.length > 0) {
    const lines = [
      // ADVISORY, not MECHANICAL: this hook exits 0 by contract, so it injects
      // context rather than halting the turn. Claiming "MECHANICAL GATE FAILED"
      // overstated its capability class. Enforcement depends on the coordinator
      // honouring this notice; making /run-plan genuinely unable to execute is a
      // separate change requiring harness-level proof.
      '████ [plan-review-gate] DO NOT EXECUTE /run-plan ' + planId + ' — ADVISORY REVIEW GATE FAILED ████',
      'Operator pipeline rule (2026-06-10): plan -> codex distinct review -> operator stamp -> (if BIG) /convene -> /run-plan.',
      'A producer cannot validate its own acceptance-grade outcome. The following requirements are UNMET:'
    ];
    missing.forEach(function (m, i) {
      lines.push((i + 1) + '. MISSING: ' + m.what);
      lines.push('   PRODUCE IT: ' + m.fix);
    });
    lines.push('Coordinator: treat this as a BLOCK. Do not route to plan execution. Surface this gate result to the operator verbatim.');
    lines.push('Operator review override `' + OVERRIDE_FLAG + '` bypasses distinct-review/convene only. It cannot clear plan drift, repair, perimeter, or operator-stamp invariants.');
    appendHookComparison(projectRoot, gateMode, sharedGate, 'blocked');
    return { action: 'inject', text: lines.join('\n') };
  }

  // All requirements satisfied — short pass note.
  const passLines = parsed.override
    ? ['[plan-review-gate] OPERATOR OVERRIDE acknowledged (' + OVERRIDE_FLAG + '): distinct-review/convene checks bypassed; hard invariants remain active.', parsed.override_logged ? 'Override logged to _dev/state/plan-review-gate/overrides.jsonl.' : 'WARNING: override log write failed.']
    : ['[plan-review-gate] PASS for ' + planId + ': distinct-mind review verified via ' + review.source + ' — ' + review.detail + '.'];
  if (!parsed.override && bigness.big) {
    passLines.push('[plan-review-gate] BIG plan (' + bigness.reasons.join(', ') + '): convene evidence verified — ' + convene.ref + '.');
  }
  if (stamp.enforced && stamp.status === 'present') {
    passLines.push('[plan-review-gate] operator_stamp PRESENT (presence-only; run-time authenticity re-verification is Stage B/D, not this hook).');
  }
  appendHookComparison(projectRoot, gateMode, sharedGate, 'ready');
  return { action: 'inject', text: passLines.join('\n') };
}

function main() {
  let payload = {};
  try { payload = JSON.parse(readStdin() || '{}'); } catch (_) { payload = {}; }
  const prompt = String(payload.prompt || '');

  // FAST PATH: pure-regex short-circuit before any fs/require work.
  if (!parsePrompt(prompt).matched) {
    process.exit(0);
  }

  const result = evaluateGate(prompt, PROJECT_ROOT, payload.session_id || null);
  if (result.action === 'inject' && result.text) {
    process.stdout.write(result.text + '\n');
  }
  process.exit(0);
}

// Exposed for unit testing.
module.exports = { parsePrompt, evaluateGate, assessDistinctReview, classifyVerdict, isBig, findConveneEvidence, assessOperatorStampEnforcement, planTripsConsequentialPerimeter, collectSharedHookGate, appendHookComparison, sharedGateMode };

if (require.main === module) {
  try {
    main();
  } catch (_) {
    // Never break the turn.
    process.exit(0);
  }
}
