'use strict';

/**
 * detectors.cjs — P4 cascade observability detector layer.
 *
 * CONSTITUTIONAL INVARIANT: Every detector is a PURE READ-ONLY function over the
 * assembled span tree. Detectors NEVER block, NEVER mutate dispatches.jsonl or any
 * execution state, and NEVER rank an actor as a verdict. This surface is a passive
 * SENSOR, not a regulator. Enforcement, if ever added, is a SEPARATE operator-gated
 * engine (held disagreement D-2 in cascade-observability-dashboard.md).
 *
 * OUTPUT REGISTER: Every finding uses the guardrails Required-Labels structure:
 *   Observation:       raw span facts (tokens, tool_uses, model_tier, routing_decision…)
 *   HYPOTHESIS:        the rule-mismatch inference (never a diagnosis)
 *   Evidence Locations: the cited policy file:line — NEVER placed in the finding header
 *
 * The STRUCTURED field is `evidence_locations` (array), RENDERED as the
 * `Evidence Locations:` label in CLI output. Do not conflate the internal field
 * name with the display label.
 *
 * STABILITY LABELS:
 *   'experimental' — default; assigned until the operator-set N spans / M sessions
 *                    threshold has been observed (mirrors the Learning-and-Automation
 *                    promotion rule: trustworthy repeated success before routine).
 *   'routine'      — only after threshold evidence is met.
 *   Config path: _dev/state/detectors/corpus-thresholds.json
 *   { "N_spans": <number>, "M_sessions": <number>,
 *     "evidence": [{ "detector": <id>, "span_count": <n>, "session_count": <m> }] }
 *   A detector promotes to 'routine' only when its operator-recorded evidence
 *   record meets BOTH span_count >= N_spans AND session_count >= M_sessions.
 *   The evidence[] array is the durable promotion record — resolveStabilityLabel
 *   consumes it per-detector. An UNSET threshold => ALWAYS 'experimental'.
 *
 * WORK_CLASS_INFERRED APPROXIMATION (from emit-span.cjs):
 *   `mechanical` iff total_tokens === 0 AND tool_uses > 0; else `inference`.
 *   FALSIFIER: a frontier model doing genuine tool-orchestrated reasoning at zero
 *   tokens (e.g. a tool-only planning pass where the LLM produced no text tokens)
 *   would be mis-classified as `mechanical`. The approximation is defensively biased
 *   toward NOT firing the never-branched detector — if the class is null (insufficient
 *   data) the detector refuses to fire. Behavioral adaptation to dodge this metric is
 *   itself an integrity signal to investigate, not disconfirmation of the detector.
 *
 * POLICY CITATIONS: see evidence_locations in each finding. Citations name the
 * canonical policy artifact, never an actor — the policy is a human REFERENCE,
 * not an enforcement hook.
 *
 * INCENTIVE-GRADIENT NOTE: Behavioral adaptation to dodge a detector (e.g.
 * artificially adding tokens to avoid the mechanical-at-frontier signal) is itself
 * an integrity signal to investigate, not disconfirmation of the detector.
 */

const fs = require('fs');
const path = require('path');
const { deriveModelTier, workClassInferred } = require('./emit-span.cjs');
const { assembleTrace, loadAllSpans, latestTraceId } = require('./assemble-tree.cjs');

// ---------------------------------------------------------------------------
// Corpus threshold loading (stability gate)
// ---------------------------------------------------------------------------

/**
 * loadCorpusThresholds — reads the operator-set N/M corpus thresholds.
 * Config path: _dev/state/detectors/corpus-thresholds.json
 * Returns null if the file is absent or unparseable (=> always 'experimental').
 */
function loadCorpusThresholds(projectRoot) {
  const configPath = path.join(
    projectRoot || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    '_dev/state/detectors/corpus-thresholds.json'
  );
  try {
    if (!fs.existsSync(configPath)) return null;
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * resolveStabilityLabel — returns 'routine' only when the operator-set N/M
 * threshold is met for this detector; 'experimental' in all other cases.
 *
 * Threshold evidence sources (checked in order):
 *   1. Explicit firingCount/sessionCount args (when a caller has already
 *      computed this detector's corpus stats for the current run).
 *   2. thresholds.evidence[] — the operator-recorded corpus record per detector:
 *        { "detector": <id>, "span_count": <n>, "session_count": <m> }
 *      This is the durable, operator-set promotion record consumed here.
 *
 * Promotion to 'routine' requires BOTH span_count >= N_spans AND
 * session_count >= M_sessions for THIS detector. UNSET thresholds (or thresholds
 * lacking numeric N_spans/M_sessions) => always 'experimental' (the mind never
 * self-promotes — only operator-recorded corpus evidence promotes a detector).
 */
function resolveStabilityLabel(detectorId, thresholds, firingCount, sessionCount) {
  if (!thresholds || typeof thresholds.N_spans !== 'number' || typeof thresholds.M_sessions !== 'number') {
    return 'experimental'; // UNSET threshold => always experimental
  }
  const N = thresholds.N_spans;
  const M = thresholds.M_sessions;

  // Resolve corpus stats for this detector: prefer explicit args, then fall back
  // to the operator-recorded thresholds.evidence[] record for this detector.
  let spans = Number(firingCount) || 0;
  let sessions = Number(sessionCount) || 0;

  if ((!spans || !sessions) && Array.isArray(thresholds.evidence)) {
    const record = thresholds.evidence.find((e) => e && e.detector === detectorId);
    if (record) {
      if (!spans) spans = Number(record.span_count) || 0;
      if (!sessions) sessions = Number(record.session_count) || 0;
    }
  }

  if (spans >= N && sessions >= M) return 'routine';
  return 'experimental';
}

// ---------------------------------------------------------------------------
// Finding shape builder
// ---------------------------------------------------------------------------

/**
 * makeFinding — construct a fully-shaped finding object.
 *
 * @param {object} opts
 * @param {string} opts.detector           — detector ID (e.g. 'self-spawn-ratio')
 * @param {object} opts.span               — the raw span object this finding cites
 * @param {string} opts.observation        — raw span facts (Required-Labels: Observation:)
 * @param {string} opts.hypothesis         — rule-mismatch inference (Required-Labels: HYPOTHESIS:)
 * @param {string[]} opts.evidence_locations — policy file:line refs (Required-Labels: Evidence Locations:)
 * @param {string} opts.stability_label    — 'experimental' | 'routine'
 */
function makeFinding({ detector, span, observation, hypothesis, evidence_locations, stability_label }) {
  return {
    detector,
    register: 'observation',
    span_ref: {
      span_id: span.span_id || null,
      trace_id: span.trace_id || null,
      timestamp: span.timestamp || null,
      actor_role: span.actor_role || null,
      model: span.model || null
    },
    observation,
    hypothesis,
    evidence_locations: Array.isArray(evidence_locations) ? evidence_locations : [evidence_locations],
    stability_label: stability_label || 'experimental'
  };
}

// ---------------------------------------------------------------------------
// Flatten a tree into a span array (utility)
// ---------------------------------------------------------------------------

function flattenTree(tree) {
  const spans = [];
  const walk = (node) => {
    spans.push(node.span);
    for (const child of node.children) walk(child);
  };
  for (const root of tree.roots) walk(root);
  return spans;
}

// ---------------------------------------------------------------------------
// DETECTOR 1: same-tier-concentration
//
// (Renamed from 'self-spawn-ratio' to align the detector NAME and LOGIC with
// its policy citation — codex review fix. The logic measures same-TIER child
// concentration, so it cites the same-TIER altitude/tiering policy, not the
// same-MODEL disclose-model policy.)
//
// Policy citation: the tier-models-by-work-altitude rule and the altitude table
// (cited as exact file:line in evidence_locations). The signal is that a trace
// where nearly all child dispatches land on the SAME tier as the coordinator is
// consistent with under-use of altitude tiering (descend scope -> descend mind):
// children that could route to a cheaper or distinct tier all sit at one tier.
//
// Observation: a trace where > threshold of child dispatches share the root's
// model_tier. This is a surface metric, not a verdict.
//
// BENIGN PATTERN (fires with hedged hypothesis): a coordinator legitimately fans
// out N parallel same-tier workers for an embarrassingly parallel task at a uniform
// altitude (e.g. processing independent records that all warrant the same tier).
// This MEETS the surface metric, so the detector FIRES — it observes and hypothesizes,
// it does NOT pre-judge legitimacy (the human's call). The detector sets a HIGH
// threshold (>0.85) and a >= 3-child floor to reduce noise; the human inspects
// routing_decision/actor_reason to resolve. The finding ranks nothing.
// ---------------------------------------------------------------------------

const SELF_SPAWN_MIN_CHILDREN = 3;
const SELF_SPAWN_RATIO_THRESHOLD = 0.85;

/**
 * detectSameTierConcentration — fires when > threshold of child dispatches in a
 * trace share the root/coordinator's model_tier.
 */
function detectSameTierConcentration(tree, { thresholds, firingCount = 0, sessionCount = 0 } = {}) {
  const findings = [];
  const spans = flattenTree(tree);
  if (spans.length < 2) return findings; // need at least root + 1 child

  // Identify the root model/tier
  const root = spans[0];
  const rootTier = root.model_tier || deriveModelTier(root.model);

  // Count children (depth > 0) and same-tier children
  const children = spans.filter((s) => (s.layer_depth || 0) > 0 && s.model);
  if (children.length < SELF_SPAWN_MIN_CHILDREN) return findings;

  const sameTier = children.filter((s) => {
    const tier = s.model_tier || deriveModelTier(s.model);
    return tier && rootTier && tier === rootTier;
  });

  const ratio = sameTier.length / children.length;
  if (ratio <= SELF_SPAWN_RATIO_THRESHOLD) return findings;

  const stability_label = resolveStabilityLabel('same-tier-concentration', thresholds, firingCount, sessionCount);

  findings.push(makeFinding({
    detector: 'same-tier-concentration',
    span: root,
    observation: `Observation: trace_id=${root.trace_id} has ${children.length} child dispatch(es); ` +
      `${sameTier.length} (${(ratio * 100).toFixed(0)}%) share the root's model_tier (${rootTier}). ` +
      `root model=${root.model || 'null'} root tier=${rootTier || 'null'}.`,
    hypothesis: `HYPOTHESIS: High same-tier child concentration is consistent with under-use of altitude tiering — ` +
      `children that could descend to a cheaper or distinct tier all sit at one tier. ` +
      `Legitimate uniform-altitude parallel fanout is an alternative explanation — ` +
      `inspect routing_decision and actor_reason fields to distinguish.`,
    evidence_locations: [
      'instructions/canonical/dispatch-routing-rule.yaml:21 (rule tier-models-by-work-altitude)',
      'instructions/canonical/dispatch-routing-rule.yaml:42 (altitude_tier_table: genuine reasoning / creative / synthesis -> frontier)'
    ],
    stability_label
  }));

  return findings;
}

// ---------------------------------------------------------------------------
// DETECTOR 2: heavy-work-at-low-tier
//
// Policy: dispatch-routing-rule.yaml altitude_tier_table:
//   mechanical/extraction/recon -> haiku tier
//   bounded light judgment       -> sonnet tier
//   genuine reasoning/creative   -> frontier tier
//
// Observation: a span with high token counts dispatched at haiku-tier is
// consistent with misaligned altitude routing. "High" = > HEAVY_TOKEN_THRESHOLD.
//
// BENIGN PATTERN (fires with hedged hypothesis): a haiku-class span doing
// extraction of large documents legitimately consumes many tokens (extraction
// work IS the haiku altitude). This MEETS the surface metric, so the detector
// FIRES — it observes and hypothesizes, it does NOT pre-judge that extraction
// at haiku is wrong (it may be the correct routing per the table). The operator
// inspects actor_reason to resolve. The detector NEVER fires on null tiers
// (insufficient data) — that is a genuine zero-findings case, not a benign pattern.
// ---------------------------------------------------------------------------

const HEAVY_TOKEN_THRESHOLD = 50000;

/**
 * detectHeavyWorkAtLowTier — fires on spans with haiku-tier + high tokens.
 */
function detectHeavyWorkAtLowTier(tree, { thresholds, firingCount = 0, sessionCount = 0 } = {}) {
  const findings = [];
  const spans = flattenTree(tree);

  for (const span of spans) {
    const tier = span.model_tier || deriveModelTier(span.model);
    if (!tier || tier !== 'small') continue; // only haiku/small tier

    const totalTokens = Number(span.total_tokens) ||
      ((Number(span.tokens_in) || 0) + (Number(span.tokens_out) || 0));
    if (totalTokens <= HEAVY_TOKEN_THRESHOLD) continue;

    const stability_label = resolveStabilityLabel('heavy-work-at-low-tier', thresholds, firingCount, sessionCount);

    findings.push(makeFinding({
      detector: 'heavy-work-at-low-tier',
      span,
      observation: `Observation: span_id=${span.span_id || 'null'} trace_id=${span.trace_id || 'null'} ` +
        `model_tier=${tier} total_tokens=${totalTokens} tokens_in=${span.tokens_in || 0} ` +
        `tokens_out=${span.tokens_out || 0} model=${span.model || 'null'} ` +
        `actor_role=${span.actor_role || 'null'} routing_decision=${span.routing_decision || 'null'}.`,
      hypothesis: `HYPOTHESIS: High token consumption at haiku/small tier is consistent with altitude mismatch — ` +
        `"genuine reasoning / creative / synthesis" work should route to frontier tier per the altitude table. ` +
        `Alternative: large-document extraction is a legitimate haiku-altitude use case. ` +
        `Inspect actor_reason and work_class_inferred=${span.work_class_inferred || 'null'} to distinguish.`,
      evidence_locations: [
        'instructions/canonical/dispatch-routing-rule.yaml:42 (altitude_tier_table: genuine reasoning / creative / synthesis / live-mutation -> frontier)',
        'instructions/canonical/dispatch-routing-rule.yaml:21 (rule tier-models-by-work-altitude)'
      ],
      stability_label
    }));
  }

  return findings;
}

// ---------------------------------------------------------------------------
// DETECTOR 3: never-branched-to-cheaper-model
//
// Policy: dispatch-routing-rule.yaml rules[1] (tier-models-by-work-altitude):
//   "mechanical/extraction/recon work goes to Haiku-class or local models"
//
// Observation: a span where work_class_inferred==='mechanical' AND
// model_tier==='frontier' is consistent with failing to branch down to a
// cheaper model for mechanical work.
//
// APPROXIMATION: work_class_inferred = 'mechanical' iff total_tokens === 0
// AND tool_uses > 0. FALSIFIER: a frontier model doing genuine tool-orchestrated
// reasoning at zero tokens (e.g. a tool-only planning pass that produced no
// text output) would be mis-classified as mechanical. Detectors trust ONLY
// work_class_inferred (never work_class_declared) per emit-span.cjs contract.
//
// BENIGN PATTERN (fires with hedged hypothesis): a coordinator doing initial
// reconnaissance at frontier tier (before deciding to delegate) that happens to
// use only tools and produce no text tokens MEETS the surface metric, so the
// detector FIRES — it observes and hypothesizes, it does NOT pre-judge that the
// coordinator should have branched down. First-pass recon before knowing to
// delegate is a legitimate alternative; the human inspects actor_reason to resolve.
// ---------------------------------------------------------------------------

/**
 * detectNeverBranchedToCheaperModel — fires when work_class_inferred='mechanical'
 * and model_tier='frontier'.
 */
function detectNeverBranchedToCheaperModel(tree, { thresholds, firingCount = 0, sessionCount = 0 } = {}) {
  const findings = [];
  const spans = flattenTree(tree);

  for (const span of spans) {
    // Compute work_class_inferred from span fields (trust only the computed value)
    const wci = workClassInferred({
      tokens_in: span.tokens_in,
      tokens_out: span.tokens_out,
      total_tokens: span.total_tokens,
      tool_uses: span.tool_uses
    });

    if (wci !== 'mechanical') continue;

    const tier = span.model_tier || deriveModelTier(span.model);
    if (!tier || tier !== 'frontier') continue;

    const stability_label = resolveStabilityLabel('never-branched-to-cheaper-model', thresholds, firingCount, sessionCount);

    findings.push(makeFinding({
      detector: 'never-branched-to-cheaper-model',
      span,
      observation: `Observation: span_id=${span.span_id || 'null'} trace_id=${span.trace_id || 'null'} ` +
        `work_class_inferred=${wci} (tokens=0, tool_uses=${span.tool_uses || 0}) ` +
        `model_tier=${tier} model=${span.model || 'null'} ` +
        `actor_role=${span.actor_role || 'null'} routing_decision=${span.routing_decision || 'null'}.`,
      hypothesis: `HYPOTHESIS: work_class_inferred=mechanical at frontier tier is consistent with failing to ` +
        `branch down to a cheaper model for mechanical work. ` +
        `NOTE: approximation mechanical iff tokens==0 && tool_uses>0 — a frontier model doing tool-only ` +
        `reasoning (no text output) is a known false-positive case. Inspect actor_reason to distinguish.`,
      evidence_locations: [
        'instructions/canonical/dispatch-routing-rule.yaml:30 (altitude_tier_table: mechanical / extraction / recon -> haiku)',
        'instructions/canonical/dispatch-routing-rule.yaml:21 (rule tier-models-by-work-altitude)'
      ],
      stability_label
    }));
  }

  return findings;
}

// ---------------------------------------------------------------------------
// DETECTOR 4: reopen-hotspots
//
// Policy: no single canonical line — reopen/correction clusters are a
// quality signal indicating plan instability or scope churn.
//   dispatch-routing-rule.yaml: general routing discipline
//   process-tier-rule.yaml:add_registry.closeout-evidence-gate (quality-process)
//
// Observation: a node or scope/framework cluster with multiple reopen_events
// or correction_events is consistent with instability in scope or routing.
//
// BENIGN PATTERN (fires with hedged hypothesis): a legitimate iterative framework
// (e.g. a QA loop that intentionally reopens tasks until green) produces
// reopen_events by design. This MEETS the surface metric (>= REOPEN_THRESHOLD),
// so the detector FIRES — it observes and hypothesizes, it does NOT pre-judge
// that the iteration is instability (the framework may expect it). The human
// inspects frameworks_referenced/actor_reason to resolve.
// ---------------------------------------------------------------------------

const REOPEN_THRESHOLD = 2;

/**
 * detectReopenHotspots — fires on spans with >= threshold reopen_events
 * or correction_events.
 */
function detectReopenHotspots(tree, { thresholds, firingCount = 0, sessionCount = 0 } = {}) {
  const findings = [];
  const spans = flattenTree(tree);

  for (const span of spans) {
    const reopens = Array.isArray(span.reopen_events) ? span.reopen_events.length : 0;
    const corrections = Array.isArray(span.correction_events) ? span.correction_events.length : 0;
    const total = reopens + corrections;
    if (total < REOPEN_THRESHOLD) continue;

    const stability_label = resolveStabilityLabel('reopen-hotspots', thresholds, firingCount, sessionCount);

    findings.push(makeFinding({
      detector: 'reopen-hotspots',
      span,
      observation: `Observation: span_id=${span.span_id || 'null'} trace_id=${span.trace_id || 'null'} ` +
        `reopen_events=${reopens} correction_events=${corrections} (total=${total}) ` +
        `scope_identity=${span.scope_identity || 'null'} ` +
        `frameworks_referenced=${JSON.stringify(span.frameworks_referenced || [])} ` +
        `actor_role=${span.actor_role || 'null'}.`,
      hypothesis: `HYPOTHESIS: ${total} reopen/correction event(s) on this span is consistent with plan ` +
        `instability, scope churn, or repeated correction — a quality signal for the operator to review. ` +
        `Alternative: legitimate iterative frameworks (QA loops, acceptance-grade review cycles) ` +
        `produce reopen_events by design. Inspect frameworks_referenced and actor_reason.`,
      evidence_locations: [
        'instructions/canonical/process-tier-rule.yaml:159 (add_registry.closeout-evidence-gate, quality-process kind:hard-gate)',
        'instructions/canonical/process-tier-rule.yaml:172 (closeout-evidence-gate behavior: no close without evidence set)'
      ],
      stability_label
    }));
  }

  return findings;
}

// ---------------------------------------------------------------------------
// DETECTOR 5: scope-hoarding
//
// Policy: process-tier-rule.yaml:add_registry.delegation-altitude-cap:
//   "a coordinator may not dispatch-and-self-clear judgment work at or above
//   its own tier; route acceptance validation upward or to script-verifiable checks"
//
// Observation: a span with routing_decision==='do-self' where actor_role is
// 'coordinator' and work_class_inferred==='inference' (i.e. actual reasoning
// work, not mechanical) is one pattern consistent with a delegation-altitude
// mismatch (work retained at the coordinator rather than routed down). It is NOT
// a verdict — coordinator synthesis is an equally consistent benign explanation.
//
// BENIGN PATTERN (fires with hedged hypothesis): a coordinator legitimately doing
// its own synthesis work (e.g. writing the final plan or debrief) routes 'do-self'.
// This MEETS the surface metric (coordinator + do-self + inference), so the detector
// FIRES — it observes and hypothesizes, it does NOT pre-judge hoarding-vs-synthesis
// (the human's call). Synthesis is the coordinator's legitimate lane; the human
// inspects actor_reason/frameworks_referenced to resolve. The finding ranks nothing.
// ---------------------------------------------------------------------------

/**
 * detectScopeHoarding — fires on coordinator spans with do-self routing
 * where work_class_inferred=inference.
 */
function detectScopeHoarding(tree, { thresholds, firingCount = 0, sessionCount = 0 } = {}) {
  const findings = [];
  const spans = flattenTree(tree);

  for (const span of spans) {
    if (span.routing_decision !== 'do-self') continue;
    if (span.actor_role !== 'coordinator') continue;

    const wci = workClassInferred({
      tokens_in: span.tokens_in,
      tokens_out: span.tokens_out,
      total_tokens: span.total_tokens,
      tool_uses: span.tool_uses
    });

    // Only flag spans with actual inference token usage
    if (wci !== 'inference') continue;

    const totalTokens = Number(span.total_tokens) ||
      ((Number(span.tokens_in) || 0) + (Number(span.tokens_out) || 0));

    // Only flag when meaningful token usage (not a near-zero stub)
    if (totalTokens < 1000) continue;

    const tier = span.model_tier || deriveModelTier(span.model);

    const stability_label = resolveStabilityLabel('scope-hoarding', thresholds, firingCount, sessionCount);

    findings.push(makeFinding({
      detector: 'scope-hoarding',
      span,
      observation: `Observation: span_id=${span.span_id || 'null'} trace_id=${span.trace_id || 'null'} ` +
        `routing_decision=do-self actor_role=coordinator ` +
        `work_class_inferred=${wci} total_tokens=${totalTokens} ` +
        `model_tier=${tier || 'null'} model=${span.model || 'null'} ` +
        `scope_identity=${span.scope_identity || 'null'}.`,
      hypothesis: `HYPOTHESIS: a coordinator routing do-self for inference-class work is one pattern consistent ` +
        `with a delegation-altitude mismatch (work retained at the coordinator rather than routed down or to a ` +
        `specialist). Coordinator synthesis (final plan, debrief authorship) is an equally consistent benign ` +
        `explanation. Inspect actor_reason and frameworks_referenced to distinguish; this finding ranks nothing.`,
      evidence_locations: [
        'instructions/canonical/process-tier-rule.yaml:174 (add_registry.delegation-altitude-cap, quality-process kind:hard-gate)',
        'instructions/canonical/process-tier-rule.yaml:187 (delegation-altitude-cap behavior: rule invariant 3 — route acceptance validation upward or to script-verifiable checks)'
      ],
      stability_label
    }));
  }

  return findings;
}

// ---------------------------------------------------------------------------
// runDetectors — run the full taxonomy over a tree
// ---------------------------------------------------------------------------

/**
 * runDetectors — run all registered detectors over an assembled trace tree.
 *
 * @param {object} tree           — result of assembleTrace()
 * @param {object} [opts]
 * @param {object} [opts.thresholds]      — corpus thresholds from loadCorpusThresholds()
 * @param {object} [opts.firingCounts]    — { detectorId: spanCount } for stability
 * @param {object} [opts.sessionCounts]   — { detectorId: sessionCount } for stability
 * @returns {object[]} array of findings (may be empty)
 */
function runDetectors(tree, opts = {}) {
  if (!tree || !tree.found) return [];
  const { thresholds, firingCounts = {}, sessionCounts = {} } = opts;

  const detectorOpts = (id) => ({
    thresholds,
    firingCount: firingCounts[id] || 0,
    sessionCount: sessionCounts[id] || 0
  });

  const findings = [
    ...detectSameTierConcentration(tree, detectorOpts('same-tier-concentration')),
    ...detectHeavyWorkAtLowTier(tree, detectorOpts('heavy-work-at-low-tier')),
    ...detectNeverBranchedToCheaperModel(tree, detectorOpts('never-branched-to-cheaper-model')),
    ...detectReopenHotspots(tree, detectorOpts('reopen-hotspots')),
    ...detectScopeHoarding(tree, detectorOpts('scope-hoarding'))
  ];

  return findings;
}

module.exports = {
  // Detector functions (exported for test isolation)
  detectSameTierConcentration,
  // Back-compat alias (renamed from self-spawn-ratio -> same-tier-concentration)
  detectSelfSpawnRatio: detectSameTierConcentration,
  detectHeavyWorkAtLowTier,
  detectNeverBranchedToCheaperModel,
  detectReopenHotspots,
  detectScopeHoarding,
  // Main entry point
  runDetectors,
  // Utilities
  loadCorpusThresholds,
  resolveStabilityLabel,
  flattenTree,
  makeFinding,
  // Constants (exported for tests)
  SELF_SPAWN_MIN_CHILDREN,
  SELF_SPAWN_RATIO_THRESHOLD,
  HEAVY_TOKEN_THRESHOLD,
  REOPEN_THRESHOLD
};
