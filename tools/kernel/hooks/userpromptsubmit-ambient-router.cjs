#!/usr/bin/env node
'use strict';

/**
 * userpromptsubmit-ambient-router.cjs — Want 1 of the ambient-orchestrator
 * autonomy contract (kernel scope).
 *
 * ENFORCEMENT_FAMILY: quality-process
 *   (tier-s2a-safety-family-lint — this hook consumes session tier state and
 *   is quality/process scaffolding, never a safety gate.)
 *
 * PURPOSE
 *   Remove the friction of typing /owl, /oc, etc. at every interaction. When a
 *   submitted prompt reads as multi-step *work* (not a one-shot question), this
 *   hook injects a short context line that engages the orchestrate-loop
 *   discipline BY DEFAULT. The operator no longer has to type the command for
 *   the orchestrator layer to engage.
 *
 * HARD INVARIANT — PROPOSE ONLY
 *   This hook NEVER executes anything. Its only effect is emitting advisory
 *   context to stdout, which the UserPromptSubmit hook surface routes into the
 *   model's context. The model still decides; all bubble-up gates, execution
 *   modes, and confirmation rules remain in force. This is the safe Want-1
 *   layer: it does not grant autonomy, it only changes the default posture.
 *
 * COUNCIL PROVENANCE
 *   _dev/reports/analysis/convene-runs/20260603T190810Z-ambient-orchestrator-autonomy/synthesis.md
 *   (kernel triad: ship Want 1 first, propose-only, cheap no-op on trivial turns.)
 *
 * DESIGN RULES (all survived the council)
 *   - Cheap: pure string heuristics on the prompt. No git, no network, no heavy IO.
 *   - Conservative: err toward NO-OP. Wrapping trivial turns in orchestration
 *     ceremony is itself a failure mode. Only fire on clear multi-step work.
 *   - No-op when the operator is already explicit: prompt starting with `/`
 *     (slash command) or `!` (bash passthrough).
 *   - Kill switch: presence of _dev/state/ambient-router/disabled => silent no-op.
 *   - Never break the turn: wrapped in try/catch, always exit 0.
 *
 * I/O CONTRACT
 *   stdin:  Claude Code UserPromptSubmit JSON payload, including { prompt, session_id }.
 *   stdout: either nothing (no-op) or a single advisory block.
 *
 * Stdlib-only. Exit 0 always.
 */

const fs = require('fs');
const path = require('path');
const { readRuleSafe, readSessionAdds, readSessionStamp } = require('./lib/process-tier.cjs');
const { formatRouteLine, routeIntent } = require('../../commands/lib/operator-route.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const KILL_SWITCH = path.join(PROJECT_ROOT, '_dev/state/ambient-router/disabled');

// tier-s2b-injection-consumers (convene 20260611T130035Z condition 4): the
// router is a TWO-WAY add-ID consumer of ProcessTierRule/1.1 —
//   * sessions carrying the kernel-normalization-injection add (scaffold tier
//     via the add_registry, resolved LIVE by readSessionAdds) FORCE-FIRE the
//     normalization notice on engage-class prompts; never suppressed by the
//     shed lookup. Per-add operator kill-switch honored
//     (_dev/state/kill-switches/kernel-normalization-injection.off).
//   * sessions whose stamped tier SHEDS ambient-router injections in the rule
//     (frontier) stay suppressed — derived from the rule's machine-readable
//     sheds list, NOT a hardcoded tier-name conditional.
//   * everything else (associate, unstamped sessions, prompt-only harnesses)
//     keeps the default classify()-based behavior unchanged.
const NORMALIZATION_ADD_ID = 'kernel-normalization-injection';

function addKillSwitchPath(add) {
  const rel = (add && add.bypass_policy && add.bypass_policy.kill_switch) ||
    `_dev/state/kill-switches/${NORMALIZATION_ADD_ID}.off`;
  return path.isAbsolute(rel) ? rel : path.join(PROJECT_ROOT, rel);
}

// Does the stamped tier shed ambient-router injections? Resolved live from the
// canonical rule's sheds list — tier names are data here, never conditionals.
function sessionShedsAmbientInjections(stamp, rule) {
  if (!stamp || typeof stamp.tier !== 'string') return false;
  const activeRule = rule === undefined ? readRuleSafe() : rule;
  if (!activeRule || !Array.isArray(activeRule.tiers)) return false;
  const tierEntry = activeRule.tiers.find((t) => t && t.tier === stamp.tier);
  if (!tierEntry || !Array.isArray(tierEntry.sheds)) return false;
  return tierEntry.sheds.some((shed) => /ambient-router/i.test(String(shed)));
}

// Imperative work verbs — strong signal the turn is actionable multi-step work.
const WORK_VERBS = [
  'build', 'implement', 'create', 'add', 'fix', 'refactor', 'migrate', 'wire',
  'scaffold', 'ship', 'run', 'update', 'change', 'rewrite', 'remove', 'delete',
  'rename', 'move', 'audit', 'review', 'plan', 'design', 'investigate',
  'debug', 'repair', 'integrate', 'deploy', 'generate', 'normalize', 'reconcile',
  'set up', 'hook up', 'route', 'dispatch', 'orchestrate', 'extract', 'promote',
  'write', 'make', 'provide', 'draft', 'prepare', 'prep',
];

// Greeting / acknowledgement — always trivial, never work.
const ACK_PATTERN = /^(hi|hey|hello|yo|sup|thanks|thank you|ty|ok|okay|kk|cool|nice|great|got it|sounds good|perfect|yep|yes|no|nope|sure)[\s!.?]*$/i;

// Informational-question leads. A turn that BOTH starts with one of these AND is
// phrased as a question is information-seeking — it stays NO-OP even if it happens
// to contain a work verb ("does the router run on every prompt?").
// NOTE: can / could / would / will are deliberately EXCLUDED — those lead polite
// *requests* ("can you build X?"), which should engage when they carry work verbs.
// (Codex review 2026-06-03: the old broad interrogative pattern no-op'd polite
// work requests ending in "?" before work-verb logic ran — the operator's most
// common phrasing. Fixed by counting work signals first + this narrower guard.)
const INFO_QUESTION_LEAD = /^(what|who|whom|whose|when|where|why|how|which|is|are|am|was|were|do|does|did|should|may|might)\b/i;

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function extractPrompt(raw) {
  if (!raw || !raw.trim()) return null;
  // Primary path: JSON payload from the hook surface.
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.prompt === 'string') return obj.prompt;
    // Some payloads nest under different keys; be tolerant.
    if (obj && typeof obj.user_prompt === 'string') return obj.user_prompt;
    if (obj && obj.input && typeof obj.input.prompt === 'string') return obj.input.prompt;
  } catch {
    // Fall back: treat the raw stdin as the prompt text.
    return raw;
  }
  return null;
}

function extractPayload(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Classify the prompt into 'noop' or 'engage'. Conservative: default to noop.
 */
function classify(prompt) {
  const p = (prompt || '').trim();
  if (!p) return 'noop';

  // Operator is already explicit — do not second-guess.
  if (p.startsWith('/')) return 'noop';
  if (p.startsWith('!')) return 'noop';

  const lower = p.toLowerCase();
  const words = p.split(/\s+/).filter(Boolean);

  // Very short turns are almost never multi-step work.
  if (words.length < 4) return 'noop';

  // Greeting / acknowledgement — always trivial.
  if (ACK_PATTERN.test(p)) return 'noop';

  // Count work signals BEFORE any question no-op (Codex review 2026-06-03):
  // engagement must not be pre-empted by a trailing "?".
  let verbHits = 0;
  for (const v of WORK_VERBS) {
    // word-boundary-ish match; allow multi-word verbs too.
    const re = new RegExp(`(^|[^a-z])${v.replace(/\s/g, '\\s')}([^a-z]|$)`, 'i');
    if (re.test(lower)) verbHits++;
  }

  // Multi-step markers: enumerated lists, conjunctions joining clauses, "then".
  const hasEnumeration = /(^|\n)\s*(\d+[.)]|[-*])\s+/.test(p) || /\b(1\.|2\.|3\.)/.test(p);
  const hasThen = /\bthen\b/i.test(lower);
  const longTurn = words.length >= 25;

  // A pure informational question (info-lead AND ends with "?") stays NO-OP even
  // if it contains a work verb — the operator wants an answer, not orchestration.
  const isQuestion = /\?\s*$/.test(p);
  const isInfoQuestion = isQuestion && INFO_QUESTION_LEAD.test(p);

  // Engage on clear multi-step work:
  //  - two+ distinct work verbs (strong actionable intent), OR
  //  - one work verb plus a multi-step marker or a long turn.
  // A single work verb with no multi-step marker stays NO-OP — even imperative
  // or polite ("can you update X?"). Convene 20260610T161625Z (fable-process-tier
  // review) ratified restoring the header invariant "err toward NO-OP": single-verb
  // one-shots were summoning full orchestration ceremony (finding F2), and
  // under-trigger is recoverable (operator types /owl) while over-trigger taxes
  // every session. Supersedes the 2026-06-03 single-verb branch for this case;
  // polite multi-step requests still engage (they carry 2+ verbs or markers).
  if (verbHits >= 2) return 'engage';
  if (verbHits >= 1 && (hasEnumeration || hasThen || longTurn)) return 'engage';

  return 'noop';
}

// One line by design (convene 20260610T161625Z): the gate list this used to
// restate is already in the always-loaded continuity contract, and repeated
// long injections teach the model to skim ALL injections (finding F3).
function buildNotice() {
  return '[ambient-router] Multi-step work detected — normalize to the task kernel '
    + '(Current State / one Question / Desired State); bubble up only true gates. '
    + 'Proposal only: skip if the operator wants a direct one-shot answer.';
}

function noticeForPayload(payload, opts = {}) {
  if (fs.existsSync(KILL_SWITCH)) return '';
  const p = payload && typeof payload.prompt === 'string' ? payload.prompt : null;
  if (p == null) return '';

  const sessionId = payload && payload.session_id;
  const stamp = readSessionStamp(sessionId, opts);
  const adds = readSessionAdds(sessionId, opts);
  const normalizationAdd = adds.find((a) => a && a.id === NORMALIZATION_ADD_ID);

  if (normalizationAdd && !fs.existsSync(addKillSwitchPath(normalizationAdd))) {
    // Force path (add-carried, e.g. scaffold): fire unconditionally on
    // engage-class prompts; the shed lookup never suppresses this lane.
    return classify(p) === 'engage' ? buildNotice() : '';
  }

  // Rule-shed suppression (frontier sheds ambient-router injections).
  if (sessionShedsAmbientInjections(stamp, opts.rule)) return '';

  const route = routeIntent(PROJECT_ROOT, p);
  if (route.matched && route.validation && route.validation.ok) {
    return formatRouteLine(route);
  }

  // Default lane (associate, unstamped sessions): unchanged classify behavior.
  return classify(p) === 'engage' ? buildNotice() : '';
}

function main() {
  // Kill switch — silent, reversible disable.
  if (fs.existsSync(KILL_SWITCH)) return;

  const raw = readStdin();
  const payload = extractPayload(raw);
  const prompt = extractPrompt(raw);
  if (prompt == null) return; // nothing to classify

  const notice = noticeForPayload({ ...payload, prompt });
  if (notice) process.stdout.write(notice + '\n');
  // else: silent no-op — do not add noise to trivial turns.
}

// Exposed for unit testing.
module.exports = {
  NORMALIZATION_ADD_ID,
  buildNotice,
  classify,
  extractPayload,
  extractPrompt,
  noticeForPayload,
  sessionShedsAmbientInjections
};

if (require.main === module) {
  try {
    main();
  } catch {
    // Never break the turn. Silent — a broken router must not degrade every prompt.
    process.exit(0);
  }
}
