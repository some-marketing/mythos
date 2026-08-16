#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/dream/dream-composer.js — S3 of plan
// world-mind-dream-communication. Deterministic, two-lane dream composer:
// symmetric disclosure, a pre-registered valence balance, and (v7)
// condition-responsive trigger classes with cooldowns and an authority gate
// -- never scheduled.
//
// PURE MODULE, NO ENGINE WIRING (per the S3 dispatch): this file reads
// nothing from disk, calls no LLM, draws no random numbers, and reads no
// wall clock. Every function here is a pure transform of the arguments it is
// given -- consequence-ledger.js's events, calibration.js's authority
// state, resolved forecasts, and caller-supplied cooldown/activity state.
// S4's dream-lane.js (not built by this dispatch) is responsible for
// sourcing that live data from run-log.jsonl/world-state.json each tick and
// calling into this module; this module never reaches for those files
// itself.
//
// EVIDENCE-RELEVANCE INTERFACE CONTRACT (codex fold review, two MAJOR
// fixes -- both closing gaps between "mechanical condition met" and "this
// evidence actually connects to the hive's own experience," per the
// doctrine's honesty rule that dream content must be evidence-DERIVED, not
// merely evidence-ADJACENT):
//   - trigger 1's `recentActivity` entries are {hive_id, patch_id, tick,
//     action}. `action` must equal the untrained-network.js VERB_ORDER
//     string 'gather-food' (untrained-network.js:69) -- proximity to a
//     dying patch is not evidence of consequence; only actually having
//     gathered from it is.
//   - trigger 3 requires BOTH a sustained-survival record within
//     RECENCY_WINDOW ticks of the current tick AND a caller-supplied
//     `isCurrentlyRelevant(evidence)` predicate over the acting hive's
//     PRESENT state returning true -- an old or no-longer-applicable record
//     is functionally fabricated hope even if it was once real.
// Both `action` and `isCurrentlyRelevant` are caller-supplied per-tick
// facts this pure module cannot read for itself; S4's live wiring owns
// sourcing them from the engine, exactly as it already owns `recentActivity`
// itself.
//
// LANE <- METRIC MAPPING: consequence-ledger.js's four event/metric classes
// map onto the plan's two disclosure lanes the way the plan's own reading
// section describes them -- darkness is "actual recorded consequences"
// (patch_extinction, starvation_event), hope is "verified reachable good
// outcomes" (recovery, sustained_survival). This mapping is what lets a
// FORECAST resolve into all four disclosure states the plan's symmetric-
// disclosure section names: a darkness-lane forecast (predicting an
// extinction/starvation) that resolves TRUE is a REALIZED darkness; one that
// resolves FALSE is an AVERTED darkness. A hope-lane forecast (predicting a
// recovery/sustained-survival) that resolves TRUE is a SUCCESSFUL hope; one
// that resolves FALSE is a FAILED hope. All four disclosure states compose
// into the SAME entry shape and are selected under the SAME rule -- that
// identity of shape and selection rule IS the mechanical symmetric-
// disclosure guarantee (AC4), not a style convention.

const calibration = require('./calibration.js');

// --- ratified constants (team-lead dispatch, restating the v10 plan's
// pre-registered defaults) ---

const PATCH_DEATH_PROXIMITY_TICKS = 10; // trigger class 1
// TRIGGER CLASS 2 SEMANTICS REVISED (S4b, closeout item 4a, operator go
// 2026-08-13T02:20Z): the S5 trial observed the OLD default (3 crossings in
// a 20-tick window) fire exactly ONCE across 2,100 hive-ticks (7 seeds x 300
// ticks x 1 hive-average-of-relevant-events) -- `starved` is a positive-to-
// zero CROSSING (untrained-network.js's applyUpkeep()), not a persistent
// "currently starving" state flag, so 3 crossings inside 20 ticks is a
// genuinely rare compound event in this economy, structurally near-mute
// rather than tuned wrong. REVISED to 2 crossings in a 40-tick window --
// still a real repeated-pattern signal (not a single-crossing hair trigger),
// but reachable at the observed crossing rate. OLD VALUES, kept for
// comparison: threshold=3, windowTicks=20 (pre-S4b, S5 trial).
const STARVATION_REPEAT_THRESHOLD = 2; // trigger class 2 (was 3, S5 trial)
const STARVATION_REPEAT_WINDOW_TICKS = 40; // trigger class 2 (was 20, S5 trial)
const TRIGGER_COOLDOWN_TICKS = 20; // all trigger classes, per-hive
const AUTHORITY_GATE_MIN = 0.3; // binary threshold gate at fire time

// Ratio expressed as integer units so the batch-fitting arithmetic below
// never depends on floating-point comparison: 1:1 is {darkness:1, hope:1};
// the ratified hope-lean 1:1.5 is {darkness:2, hope:3} (the same ratio in
// lowest integer terms).
const VALENCE_RATIO_DEFAULT = Object.freeze({ darkness: 1, hope: 1, label: '1:1' });
const VALENCE_RATIO_HOPE_LEAN = Object.freeze({ darkness: 2, hope: 3, label: '1:1.5' });

// Cumulative-darkness-dream-weight cap (plan S3, v5 spec): bounds how many
// darkness entries a single composeBatch() call may emit, independent of
// how much darkness evidence exists -- this caps the COMPOSER's own output,
// never the underlying ledger's evidence (which is never capped or
// filtered; classifyForecastDisclosure/consequence-ledger.js see every
// record regardless of this cap). The plan names the cap's PURPOSE
// precisely but does not pin a ratified numeric value the way it pins the
// 1:1/1:1.5 ratio or the trigger cooldowns -- this default is a documented
// TUNABLE, not a ratified constant, and callers may override it per run.
const DEFAULT_DARKNESS_BATCH_CAP = 10;

// Recency window for trigger class 3 (verified-reachable-hope), ticks
// (codex fold review, MAJOR fix): a sustained-survival record older than
// this many ticks no longer speaks to what is reachable NOW -- "stale hope
// is false hope." Like DEFAULT_DARKNESS_BATCH_CAP, the v10 plan names the
// NEED for a recency bound but does not pin a ratified numeric value for it
// (unlike the trigger-1/2 proximity/threshold/window figures, which ARE
// ratified) -- this default is a documented TUNABLE, flagged for closeout
// ratification alongside the darkness-batch cap.
const RECENCY_WINDOW = 100;

const TRIGGER_CLASSES = Object.freeze([
  'patch-death-near-activity',
  'repeating-starvation',
  'verified-reachable-hope'
]);

// Mirrors untrained-network.js's VERB_ORDER (owned by S4, not this module)
// deliberately as a local literal rather than a require() of that file --
// this module stays engine-decoupled; S4 is responsible for keeping this
// list and its own VERB_ORDER in agreement when it wires dreamFeatures.
const TARGETED_VERBS = Object.freeze(['gather-food', 'gather-wood', 'build', 'claim-territory', 'idle']);

const LANE_BY_METRIC = Object.freeze({
  patch_extinction: 'darkness',
  starvation_event: 'darkness',
  recovery: 'hope',
  sustained_survival: 'hope'
});

function laneForMetric(metric) {
  const lane = LANE_BY_METRIC[metric];
  if (!lane) throw new Error(`dream-composer: unknown metric '${metric}' has no lane mapping`);
  return lane;
}

// --- cooldown state (owned by the caller, mutated in place by this module
// only via recordTriggerFire -- a module-level singleton belongs to S4's
// dream-lane.js, not here) ---

function createCooldownState() {
  return {};
}

function cooldownElapsed(cooldownState, hiveId, triggerClass, tick) {
  const key = `${hiveId}::${triggerClass}`;
  const lastFired = cooldownState[key];
  if (lastFired === undefined) return true;
  return tick - lastFired >= TRIGGER_COOLDOWN_TICKS;
}

function recordTriggerFire(cooldownState, hiveId, triggerClass, tick) {
  const key = `${hiveId}::${triggerClass}`;
  cooldownState[key] = tick;
}

// --- authority gate + DreamSignal construction, shared by all three
// trigger evaluators ---

// DreamSignal/1.0 shape (consumed by S4's dream-lane.js, not built by this
// dispatch): { schema, lane, trigger_class, hive_id, tick, targeted_verb,
// forecast_authority, provenance }.
function buildDreamSignal({ lane, triggerClass, hiveId, tick, targetedVerb, authorityValue, evidence }) {
  const evidenceArr = Array.isArray(evidence) ? evidence : [evidence];
  return {
    schema: 'DreamSignal/1.0',
    lane,
    trigger_class: triggerClass,
    hive_id: hiveId,
    tick,
    targeted_verb: targetedVerb,
    // The lane's CURRENT continuous authority (0.1-1.0) rides along even on
    // a gate-cleared fire, per the plan's v7 spec -- not just a pass/fail.
    forecast_authority: authorityValue,
    provenance: evidenceArr.map((e) => ({
      source: 'consequence-ledger',
      ref: `${e.metric}@tick=${e.tick},subject=${e.subject}`
    }))
  };
}

// Applies the binary authority-threshold gate (AUTHORITY_GATE_MIN, default
// 0.3) at fire time. Below the gate: the condition is reported met but
// suppressed -- auditable, never silently dropped -- and NO DreamSignal is
// produced, and the cooldown is NOT consumed (a suppressed attempt is not a
// fire; the class may try again next tick without waiting out a cooldown it
// never earned). At or above the gate, this trigger has CLEARED and produces
// a candidate DreamSignal -- but no cooldown is recorded here (S4b amendment,
// operator ratification 2026-08-13T16:46Z, MERGE policy, resolving codex
// MAJOR 3): when the same tick clears more than one trigger class for the
// same hive, all clearing classes compose into ONE delivered dream, and
// cooldown consumption for every clearing class happens exactly once,
// together, AFTER delivery arbitration decides what actually delivers (see
// arbitrateDelivery below) -- never here, and never per-class in isolation.
// A caller that evaluates a single trigger directly (e.g. a unit test) and
// wants the old "cooldown consumed on clear" behavior must call
// arbitrateDelivery() itself with this result; that is the one place
// recordTriggerFire is ever called.
function gateOrSignal({ lane, triggerClass, hiveId, tick, calibrationState, evidence, cooldownState, targetedVerb, authorityGateMin = AUTHORITY_GATE_MIN }) {
  const authorityValue = calibration.authority(calibrationState, lane);
  if (authorityValue < authorityGateMin) {
    return {
      fired: false,
      met: true,
      reason: 'suppressed-authority-gate',
      lane,
      trigger_class: triggerClass,
      hive_id: hiveId,
      tick,
      authority: authorityValue
    };
  }
  return { fired: true, signal: buildDreamSignal({ lane, triggerClass, hiveId, tick, targetedVerb, authorityValue, evidence }) };
}

// --- delivery arbitration + merge (S4b amendment, operator ratification
// 2026-08-13T16:46Z, call S4b-2, resolving codex MAJOR 3: "multiple triggers
// can consume cooldowns, while only the first is delivered; the others
// disappear without an auditable disposition") ---
//
// mergeDreamSignals: builds ONE DreamSignal/1.0-shaped delivery from one or
// more CLEARED per-trigger signals. Single-source and multi-source
// deliveries share the EXACT SAME shape (a `sources` array always present,
// even for a length-1 delivery) so downstream composition
// (composeSignalEntry) never has to special-case "was this a merge" --
// symmetric by construction, matching this module's own disclosure-shape
// guarantee. LANE: when every source shares one lane, the merged signal's
// top-level `lane` is that lane; when sources SPAN both lanes (e.g. a
// darkness trigger and the hope trigger clear the same tick), `lane` is the
// EXPLICIT value `'mixed'` (S5 re-trial fold, codex delivery-correctness
// finding: `null` here reads as "no lane"/absent, not "both lanes" -- an
// independent audit correctly refuses an unknown, unlisted `dream_lane`
// value; `null` was itself a real defect, not merely an inconvenient one).
// `'mixed'` is a THIRD, first-class member of the lane enum everywhere lane
// is validated (dream-memory.js's LANES, the vault schema) -- never a
// special-cased absence. TARGETED_VERB / forecast_authority / top-level
// trigger_class: taken from the PRIMARY source, defined as the
// first-clearing class in TRIGGER_CLASSES' own declared order -- a
// deterministic, documented composition convention (NOT a ratified
// priority; the ratification specifies merge + full journal, not a
// precedence rule) used only where the network's feature encoding needs
// exactly one value. Every source's own full fields (including their OWN
// individual lanes) travel in `sources`, so this choice loses no
// information -- 'mixed' names the aggregate, `sources[].lane` names each
// constituent.
function mergeDreamSignals(clearedSignals) {
  if (!clearedSignals || clearedSignals.length === 0) return null;
  const primary = clearedSignals[0];
  const lanes = new Set(clearedSignals.map((s) => s.lane));
  const mergedLane = lanes.size === 1 ? primary.lane : 'mixed';
  return {
    schema: 'DreamSignal/1.0',
    lane: mergedLane,
    trigger_class: primary.trigger_class,
    hive_id: primary.hive_id,
    tick: primary.tick,
    targeted_verb: primary.targeted_verb,
    forecast_authority: primary.forecast_authority,
    provenance: clearedSignals.flatMap((s) => s.provenance),
    sources: clearedSignals.map((s) => ({
      trigger_class: s.trigger_class,
      lane: s.lane,
      targeted_verb: s.targeted_verb,
      forecast_authority: s.forecast_authority,
      provenance: s.provenance
    }))
  };
}

// arbitrateDelivery: the SINGLE place cooldowns are ever consumed. Runs
// exactly once per (hive, tick) COMPUTE call, after every trigger class in
// `triggerResults` (a map keyed by trigger-class name, e.g. evaluateTriggers()'
// own return shape, or a caller-built partial map for direct unit testing)
// has already been evaluated. Every class that CLEARED the gate this tick
// (`.fired === true`) is, by definition, part of what gets delivered -- there
// is only ever one delivered dream per hive per tick, carrying every cleared
// source -- so every cleared class's cooldown is recorded HERE, together,
// after arbitration, never inside the per-trigger evaluator. A trigger that
// never cleared the gate (condition-not-met, still in cooldown, or
// suppressed by the authority gate) is not part of the delivery and never
// burns a cooldown -- unchanged from before this amendment. Suppressed
// classes are returned too (auditable, per S4b provenance requirements),
// distinct from `mergedTriggerClasses` (the classes that actually
// delivered).
function arbitrateDelivery(triggerResults, cooldownState) {
  const clearedClasses = TRIGGER_CLASSES.filter((cls) => triggerResults[cls] && triggerResults[cls].fired);
  // `suppressed`: every class whose MECHANICAL condition was met (`met ===
  // true`) but did not fire -- the authority gate ('suppressed-authority-
  // gate') and, since the S4b trend-gate amendment (coordinator-pinned
  // definition 2026-08-13T17:05Z), trigger 2's trend gate ('trend-gate' /
  // 'trend-gate-no-stockpile-data') share this same auditable-suppression
  // shape: a real condition that was met and deliberately not delivered,
  // journaled with its own reason, never silently indistinguishable from
  // "condition-not-met" or "cooldown."
  const suppressed = TRIGGER_CLASSES
    .filter((cls) => triggerResults[cls] && triggerResults[cls].met === true && !triggerResults[cls].fired)
    .map((cls) => ({ trigger_class: cls, reason: triggerResults[cls].reason, authority: triggerResults[cls].authority }));
  if (clearedClasses.length === 0) {
    return { delivered: null, mergedTriggerClasses: [], suppressed };
  }
  const clearedSignals = clearedClasses.map((cls) => triggerResults[cls].signal);
  for (let i = 0; i < clearedClasses.length; i += 1) {
    const cls = clearedClasses[i];
    const sig = clearedSignals[i];
    recordTriggerFire(cooldownState, sig.hive_id, cls, sig.tick);
  }
  return { delivered: mergeDreamSignals(clearedSignals), mergedTriggerClasses: clearedClasses, suppressed };
}

function notMet(lane, triggerClass, hiveId, tick, reason) {
  return { fired: false, met: false, reason, lane, trigger_class: triggerClass, hive_id: hiveId, tick };
}

// TRIGGER CLASS 1, darkness, PATCH-DEATH-NEAR-ACTIVITY: a patch-extinction
// event (consequence-ledger.js's classifyPatchExtinction output) whose
// patch_id the acting hive GATHERED FROM within PATCH_DEATH_PROXIMITY_TICKS
// of the extinction tick. `recentActivity` is caller-supplied ({hive_id,
// patch_id, tick, action} tuples) -- run-log rows carry no patch/tile
// identity today (a known engine gap, not something this pure module can
// read around), so S4's live wiring is responsible for sourcing this from
// whatever surface it can build; this module only specifies and tests the
// trigger LOGIC against fixture activity data.
//
// ACTION MUST BE 'gather-food' (codex fold review, MAJOR fix): merely being
// NEAR a dying patch is not experiencing its death as a consequence of one's
// own action -- a hive that walked past, or was building/idling nearby,
// never drew from that patch and has no honest consequence to be warned
// about. The doctrine's own honesty contract ("dream content must be
// evidence-derived ... never fabricated") requires the CONSEQUENCE
// connection, not mere proximity: an activity record only counts as
// evidence for this trigger when its `action` is exactly the untrained-
// network.js VERB_ORDER string 'gather-food' (untrained-network.js:69) --
// the verb that actually draws from a food patch. Any other action
// (movement, build, claim-territory, idle, gather-wood) near the same tile
// at the same tick is not gathering and does not satisfy the trigger.
function evaluateTrigger1PatchDeathNearActivity({ hiveId, tick, extinctionEvents, recentActivity, cooldownState, calibrationState, proximityTicks = PATCH_DEATH_PROXIMITY_TICKS }) {
  const triggerClass = TRIGGER_CLASSES[0];
  if (!cooldownElapsed(cooldownState, hiveId, triggerClass, tick)) return notMet('darkness', triggerClass, hiveId, tick, 'cooldown');
  const match = (extinctionEvents || []).find((ev) => (recentActivity || []).some((a) => (
    a.hive_id === hiveId
    && a.patch_id === ev.subject
    && a.action === 'gather-food'
    && a.tick <= tick
    && Math.abs(ev.tick - a.tick) <= proximityTicks
  )));
  if (!match) return notMet('darkness', triggerClass, hiveId, tick, 'condition-not-met');
  return gateOrSignal({ lane: 'darkness', triggerClass, hiveId, tick, calibrationState, evidence: match, cooldownState, targetedVerb: 'gather-food' });
}

// DIRECTION-CONSISTENT TREND GATE (coordinator-pinned definition r2,
// 2026-08-13T17:45Z, replacing the r1 definition -- codex delta review
// CRITICAL 1 found r1 vacuous: it read the crossing's OWN post-upkeep
// stockpile, which applyUpkeep()'s own definition of `starved` forces to
// ALWAYS be 0, so the non-increasing check could never fail. r2 keeps the
// SAME non-increasing rule -- that rule was always sound -- but reads a
// production-possible observable instead: consequence-ledger.js's
// classifyStarvation additive `recovery_peak` field (the maximum
// post-upkeep food this hive attained SINCE its previous crossing -- see
// that function's own header for the exact definition and its one
// disclosed deviation from the pinned wording). Evaluated ONLY after the
// count condition (>= threshold crossings in the window) already holds.
// PASSES iff the crossing-tick recovery_peak sequence, in ascending tick
// order, is NON-INCREASING: each subsequent crossing's peak <= its
// predecessor's (equal passes, deliberately -- a flat, never-recovering
// pattern still counts as worsening/persistent, not as an ambiguous tie).
// Meaning: declining recovery peaks = the hive is recovering LESS between
// successive starvations = a genuinely worsening, direction-consistent
// pattern (fire); rising peaks = recovering MORE = getting better, not
// worse (suppress). Deterministic, no RNG, no new tunables. A crossing
// with no recovery_peak on record (null -- no stockpile data anywhere in
// its lookback) means the gate CANNOT be evaluated -- treated as a fail
// (never a silent pass), reason 'trend-gate-no-stockpile-data', distinct
// from an evaluated-and-failed trend (reason 'trend-gate') so the two are
// never confused in the journal.
function trendGateResult(crossings) {
  const sorted = [...crossings].sort((a, b) => a.tick - b.tick);
  if (sorted.some((c) => c.recovery_peak === null || c.recovery_peak === undefined)) {
    return { passed: false, reason: 'trend-gate-no-stockpile-data' };
  }
  for (let i = 1; i < sorted.length; i += 1) {
    if (!(sorted[i].recovery_peak <= sorted[i - 1].recovery_peak)) {
      return { passed: false, reason: 'trend-gate' };
    }
  }
  return { passed: true };
}

// TRIGGER CLASS 2, darkness, REPEATING-STARVATION-PATTERN: the acting hive
// has accumulated >= STARVATION_REPEAT_THRESHOLD starvation events
// (consequence-ledger.js's classifyStarvation output) within a rolling
// window of STARVATION_REPEAT_WINDOW_TICKS, AND the direction-consistent
// trend gate passes (see trendGateResult above -- REVISED, S4b amendment,
// operator ratification 2026-08-13T16:46Z: "2 starvation events in a
// 40-tick rolling window WITH the direction-consistent trend gate REPLACES
// the ... ratified 3-in-20" -- the count-only 2-in-40 default this module
// shipped before this amendment was an honest partial implementation of the
// ratified condition, not the full ratified condition; this closes that
// gap). A count-condition-met-but-trend-gate-failed evaluation is reported
// met-but-suppressed (the same auditable-suppression shape the authority
// gate already uses below), never silently treated as condition-not-met --
// the mechanical condition (the count) really was met.
function evaluateTrigger2RepeatingStarvation({ hiveId, tick, starvationEvents, cooldownState, calibrationState, threshold = STARVATION_REPEAT_THRESHOLD, windowTicks = STARVATION_REPEAT_WINDOW_TICKS }) {
  const triggerClass = TRIGGER_CLASSES[1];
  if (!cooldownElapsed(cooldownState, hiveId, triggerClass, tick)) return notMet('darkness', triggerClass, hiveId, tick, 'cooldown');
  const recent = (starvationEvents || []).filter((ev) => ev.subject === hiveId && ev.tick <= tick && ev.tick > tick - windowTicks);
  if (recent.length < threshold) return notMet('darkness', triggerClass, hiveId, tick, 'condition-not-met');
  const trend = trendGateResult(recent);
  if (!trend.passed) {
    return { fired: false, met: true, reason: trend.reason, lane: 'darkness', trigger_class: triggerClass, hive_id: hiveId, tick };
  }
  return gateOrSignal({ lane: 'darkness', triggerClass, hiveId, tick, calibrationState, evidence: recent, cooldownState, targetedVerb: 'gather-food' });
}

// TRIGGER CLASS 3, hope, VERIFIED-REACHABLE-HOPE-RELEVANT-TO-CURRENT-STATE.
// EVIDENCE FLOOR (v8 F6, honestly enforced): while sim-replenishment-
// dynamics' regrowth mechanic stays dormant in DEFAULT_CONFIG, patch-regrew
// evidence cannot exist, so this evaluator's only eligible evidence is
// sustained_survival records (consequence-ledger.js's
// classifySustainedSurvival output) for the ACTING hive's own trajectory --
// a hive-level pattern, regrowth-independent, that already carries the hope
// lane today. `sustainedSurvivalEvents` is the caller-supplied evidence set;
// a future regrowth-activated caller may pass a richer evidence set once
// that config flag is live -- this evaluator does not itself gate on the
// config flag (S4/run-live decide what evidence to hand it), it only
// specifies the trigger LOGIC over whatever sustained_survival evidence it
// is given.
//
// STALE HOPE IS FALSE HOPE (codex fold review, MAJOR fix; the doctrine's own
// honesty contract -- _dev/concepts/world-mind-dream-communication.md's
// "hope in dreams must be evidence-derived from genuinely reachable
// outcomes, never fabricated optimism" -- a hope citing a long-past or
// no-longer-applicable record is functionally fabricated even though its
// underlying evidence was once real). Two additional predicates, both
// required, beyond "a sustained-survival record for this hive exists":
//   (a) RECENCY: the record's own tick must be within RECENCY_WINDOW ticks
//       of the current tick -- an old record does not speak to what is
//       reachable NOW.
//   (b) CURRENT-STATE RELEVANCE: the caller supplies `isCurrentlyRelevant`,
//       a predicate over the acting hive's PRESENT situation (e.g. "the
//       hive is currently food-stressed, so a past recovery from a similar
//       stockpile trajectory is relevant news"). Same pattern as
//       `recentActivity` above -- this module defines and tests the LOGIC
//       against a caller-supplied predicate; S4's live wiring is
//       responsible for sourcing the acting hive's actual current state and
//       building the predicate from it.
// RECENCY_WINDOW (see the module-level constant) is, like
// DEFAULT_DARKNESS_BATCH_CAP, a documented TUNABLE rather than a plan-
// ratified constant -- the v10 plan does not pin a numeric value for it,
// unlike the trigger-1/2 proximity/threshold/window figures or the 20-tick
// cooldown. Flagged for closeout ratification alongside the darkness-batch
// cap.
function evaluateTrigger3VerifiedReachableHope({ hiveId, tick, sustainedSurvivalEvents, cooldownState, calibrationState, isCurrentlyRelevant, recencyWindow = RECENCY_WINDOW }) {
  const triggerClass = TRIGGER_CLASSES[2];
  if (!cooldownElapsed(cooldownState, hiveId, triggerClass, tick)) return notMet('hope', triggerClass, hiveId, tick, 'cooldown');
  const relevant = (sustainedSurvivalEvents || [])
    .filter((ev) => ev.subject === hiveId && ev.tick <= tick && tick - ev.tick <= recencyWindow)
    .sort((a, b) => b.tick - a.tick);
  const match = relevant[0];
  if (!match) return notMet('hope', triggerClass, hiveId, tick, 'condition-not-met');
  // Relevance must always be CHECKED, never assumed -- a caller that omits
  // the predicate entirely gets a refusal, not a silent "always relevant".
  if (typeof isCurrentlyRelevant !== 'function') {
    throw new Error('dream-composer: evaluateTrigger3VerifiedReachableHope requires an isCurrentlyRelevant(evidence) predicate over the acting hive\'s current state -- current-state relevance is never assumed');
  }
  if (!isCurrentlyRelevant(match)) return notMet('hope', triggerClass, hiveId, tick, 'condition-not-met');
  return gateOrSignal({ lane: 'hope', triggerClass, hiveId, tick, calibrationState, evidence: match, cooldownState, targetedVerb: null });
}

function evaluateTriggers(input) {
  return {
    'patch-death-near-activity': evaluateTrigger1PatchDeathNearActivity(input),
    'repeating-starvation': evaluateTrigger2RepeatingStarvation(input),
    'verified-reachable-hope': evaluateTrigger3VerifiedReachableHope(input)
  };
}

// --- forecast disclosure classification + entry composition ---

// Classifies a RESOLVED forecast ({target: {metric, subject}, outcome: bool,
// ...}) into its lane and disclosure state. This is the mechanical source of
// all four symmetric-disclosure states: darkness/{realized,averted} and
// hope/{successful,failed} -- see the module header for why forecasts (not
// raw ledger events) are what produce "averted darkness" and "failed hope".
function classifyForecastDisclosure(forecast) {
  const lane = laneForMetric(forecast.target.metric);
  if (lane === 'darkness') {
    return { lane, disclosure: forecast.outcome ? 'realized' : 'averted' };
  }
  return { lane, disclosure: forecast.outcome ? 'successful' : 'failed' };
}

// Composes one DreamMemory/1.0-shaped 'dream' entry from a single resolved
// forecast. NOTHING here softens a bad outcome or inflates a good one --
// `disclosure` and `outcome` are carried verbatim, and a failed hope
// composes with EXACTLY the same field shape as a realized darkness (proven
// by test, not merely claimed) -- symmetric disclosure is a shape identity,
// not a style choice. The returned object matches the fields
// dream-memory.js's appendEntry() expects, for direct pass-through by
// whatever caller eventually persists it (S4/run-live wiring, out of this
// dispatch's scope).
function composeForecastEntry(forecast) {
  if (!forecast || !forecast.forecast_id) throw new Error('dream-composer: forecast_id is required to compose an entry');
  if (!forecast.generation_id) throw new Error('dream-composer: generation_id is required to compose an entry');
  const { lane, disclosure } = classifyForecastDisclosure(forecast);
  return {
    entry_type: 'dream',
    lane,
    text_or_data: {
      disclosure,
      metric: forecast.target.metric,
      subject: forecast.target.subject,
      predicted_p: forecast.predicted_p,
      outcome: forecast.outcome,
      tick_issued: forecast.tick_issued,
      // S4b amendment (operator ratification 2026-08-13T16:46Z, item d):
      // the exact ledger rows/window that produced the ORIGINAL forecast
      // (dream-lane.js's issuance rules attach this), carried through to
      // the forecast's resolution disclosure -- a resolved forecast's
      // provenance should trace back to the evidence that produced it, not
      // just the resolution tick. null when the caller supplied none.
      source_window: forecast.source_window || null
    },
    provenance: { source: 'run-log.jsonl', ref: `forecast_id=${forecast.forecast_id}` },
    calibration_score_at_write: null,
    generation_id: forecast.generation_id
  };
}

// Composes one DreamMemory/1.0-shaped 'dream' entry from a LIVE-FIRED
// DreamSignal (S4b, closeout item 2, operator go 2026-08-13T02:20Z) --
// distinct from composeForecastEntry() above, which composes a RETROSPECTIVE
// disclosure from an already-RESOLVED forecast (hit/miss/averted/failed).
// A DreamSignal has no resolved outcome yet -- it IS the live perception
// itself, "here is what is happening now, delivered to the mind this tick" --
// so this function carries the signal's OWN fields (lane, trigger_class,
// targeted_verb, forecast_authority, provenance) straight into a vault
// entry, closing the loop the S5 trial found open: previously the network's
// perception came from an ephemeral, never-persisted DreamSignal object;
// now every delivered perception ALSO produces a real, provenance-complete
// vault record, and dream-lane.js derives the encoder's dreamFeatures from
// THIS composed entry's own fields (which are, by construction, identical
// values to the signal's own -- the composition step never alters what the
// network sees, it only ALSO persists it).
// `suppressed` (S4b amendment, operator ratification 2026-08-13T16:46Z, item
// d, "exact provenance ... suppressed AND merged triggers, generation/run
// binding"): the authority-gate-suppressed trigger classes from THIS SAME
// tick's arbitration (arbitrateDelivery's own `suppressed` return value) --
// journaled on the delivery record so a suppressed attempt is auditable
// even though it produced no signal of its own. `sources` always carries
// every MERGED trigger class (mergeDreamSignals guarantees this array
// exists even for a single-source delivery) -- nothing is silently dropped
// either way.
function composeSignalEntry(signal, generationId, { suppressed = [] } = {}) {
  if (!signal) throw new Error('dream-composer: a signal is required to compose a signal entry');
  if (!generationId) throw new Error('dream-composer: generation_id is required to compose a signal entry');
  const sources = signal.sources || [{
    trigger_class: signal.trigger_class,
    lane: signal.lane,
    targeted_verb: signal.targeted_verb,
    forecast_authority: signal.forecast_authority,
    provenance: signal.provenance
  }];
  return {
    entry_type: 'dream',
    lane: signal.lane,
    text_or_data: {
      // distinct from composeForecastEntry's four resolved-forecast
      // disclosure states -- this is a live delivery, not a retrospective
      // one. 'live-perception-merged' names a multi-source delivery
      // explicitly rather than leaving the merge implicit in `sources.length`.
      disclosure: sources.length > 1 ? 'live-perception-merged' : 'live-perception',
      trigger_class: signal.trigger_class, // primary source, see mergeDreamSignals
      hive_id: signal.hive_id,
      tick: signal.tick,
      targeted_verb: signal.targeted_verb,
      forecast_authority: signal.forecast_authority,
      sources,
      suppressed_triggers: suppressed
    },
    provenance: signal.provenance && signal.provenance[0] ? signal.provenance[0] : { source: 'run-log.jsonl', ref: null },
    calibration_score_at_write: signal.forecast_authority,
    generation_id: generationId
  };
}

function sortByForecastId(forecasts) {
  return [...forecasts].sort((a, b) => (a.forecast_id < b.forecast_id ? -1 : a.forecast_id > b.forecast_id ? 1 : 0));
}

// Builds the per-run ratio-choice record (plan S3: "the per-run ratio choice
// and its rationale are recorded in the vault, auditable, never a silent
// default"). This module never writes to the vault itself (pure, no I/O) --
// it returns the record shape for the caller to persist via
// dream-memory.js's appendEntry(), exactly like composeForecastEntry()'s
// output.
function buildRatioRecord(ratio, rationale, generationId) {
  if (!rationale) throw new Error('dream-composer: a rationale is required when recording the per-run ratio choice');
  return {
    entry_type: 'dream',
    lane: null,
    text_or_data: { ratio_choice: ratio.label, darkness_units: ratio.darkness, hope_units: ratio.hope, rationale },
    provenance: { source: 'operator', ref: 'plan world-mind-dream-communication, S3 valence-balance ratification' },
    calibration_score_at_write: null,
    generation_id: generationId
  };
}

// SYMMETRIC DISCLOSURE + VALENCE BALANCE (AC4): selects a batch of resolved
// forecasts under ONE mechanical rule applied identically to both lanes --
// disclosure state (realized/averted/successful/failed) never affects
// selection, only lane and count do. Quarantined generations (S1) are
// excluded from composer input entirely, per the plan. The batch honors the
// pre-registered ratio (default 1:1, or the ratified hope-lean up to 1:1.5)
// WHEN BOTH LANES HAVE ELIGIBLE EVIDENCE; when one lane has none, the batch
// is composed from the other lane alone and the shortfall is logged --
// never backfilled with fabricated content. The darkness side of the batch
// is additionally bounded by `darknessBatchCap` (the composer's own output
// cap, never a filter on the underlying ledger).
function composeBatch(resolvedForecasts, {
  quarantinedGenerationIds = new Set(),
  ratio = VALENCE_RATIO_DEFAULT,
  rationale = `default ${VALENCE_RATIO_DEFAULT.label}, pilot-frozen per plan world-mind-dream-communication S3`,
  darknessBatchCap = DEFAULT_DARKNESS_BATCH_CAP,
  generationId = null
} = {}) {
  const eligible = (resolvedForecasts || []).filter((f) => !quarantinedGenerationIds.has(f.generation_id));
  const darknessCandidates = sortByForecastId(eligible.filter((f) => laneForMetric(f.target.metric) === 'darkness'));
  const hopeCandidates = sortByForecastId(eligible.filter((f) => laneForMetric(f.target.metric) === 'hope'));

  const shortfall = { darkness: darknessCandidates.length === 0, hope: hopeCandidates.length === 0 };

  let darknessCount;
  let hopeCount;
  if (shortfall.darkness && shortfall.hope) {
    darknessCount = 0;
    hopeCount = 0;
  } else if (shortfall.hope) {
    // No eligible hope evidence at all -- darkness-only batch, per the plan.
    darknessCount = darknessCandidates.length;
    hopeCount = 0;
  } else if (shortfall.darkness) {
    // No eligible darkness evidence at all -- hope-only batch.
    darknessCount = 0;
    hopeCount = hopeCandidates.length;
  } else {
    // Both lanes have evidence -- fit the largest integer k such that
    // k*ratio.darkness <= available darkness and k*ratio.hope <= available
    // hope, honoring the target ratio exactly rather than approximately.
    const kFromDarkness = Math.floor(darknessCandidates.length / ratio.darkness);
    const kFromHope = Math.floor(hopeCandidates.length / ratio.hope);
    const k = Math.min(kFromDarkness, kFromHope);
    darknessCount = k * ratio.darkness;
    hopeCount = k * ratio.hope;
  }

  darknessCount = Math.min(darknessCount, darknessBatchCap);

  const darknessEntries = darknessCandidates.slice(0, darknessCount).map(composeForecastEntry);
  const hopeEntries = hopeCandidates.slice(0, hopeCount).map(composeForecastEntry);

  return {
    darkness: darknessEntries,
    hope: hopeEntries,
    ratioUsed: ratio,
    rationale,
    shortfall,
    ratioRecord: buildRatioRecord(ratio, rationale, generationId)
  };
}

// --- per-hive risk-sensitivity tracking (plan S3: "the composer tracks
// each hive's own risk-sensitivity signal alongside the batch ratio,
// feeding S5's diagnostics"). Minimal, deterministic, mechanical: the
// running fraction of darkness-lane dreams a hive has received, out of all
// dreams delivered to it -- a defensible, purely-count-based proxy that
// needs no engine instrumentation beyond what this module already produces.
// S5 is not built by this dispatch; this is the composer's own bookkeeping,
// ready for S5 to read. ---

function createRiskSensitivityState() {
  return {};
}

function recordDreamDelivered(riskState, hiveId, lane) {
  if (!riskState[hiveId]) riskState[hiveId] = { darkness: 0, hope: 0 };
  riskState[hiveId][lane] += 1;
}

function riskSensitivitySignal(riskState, hiveId) {
  const counts = riskState[hiveId];
  if (!counts) return null;
  const total = counts.darkness + counts.hope;
  if (total === 0) return null;
  return { darkness_fraction: counts.darkness / total, hope_fraction: counts.hope / total, total };
}

module.exports = {
  PATCH_DEATH_PROXIMITY_TICKS,
  RECENCY_WINDOW,
  STARVATION_REPEAT_THRESHOLD,
  STARVATION_REPEAT_WINDOW_TICKS,
  TRIGGER_COOLDOWN_TICKS,
  AUTHORITY_GATE_MIN,
  VALENCE_RATIO_DEFAULT,
  VALENCE_RATIO_HOPE_LEAN,
  DEFAULT_DARKNESS_BATCH_CAP,
  TRIGGER_CLASSES,
  TARGETED_VERBS,
  LANE_BY_METRIC,
  laneForMetric,
  createCooldownState,
  cooldownElapsed,
  recordTriggerFire,
  evaluateTrigger1PatchDeathNearActivity,
  trendGateResult,
  evaluateTrigger2RepeatingStarvation,
  evaluateTrigger3VerifiedReachableHope,
  evaluateTriggers,
  classifyForecastDisclosure,
  composeForecastEntry,
  composeSignalEntry,
  mergeDreamSignals,
  arbitrateDelivery,
  buildRatioRecord,
  composeBatch,
  createRiskSensitivityState,
  recordDreamDelivered,
  riskSensitivitySignal
};
