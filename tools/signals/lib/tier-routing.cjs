'use strict';

/**
 * tier-routing.cjs — S1 of adaptive-mind-router
 * (_dev/reports/analysis/task-plans/adaptive-mind-router__plan.json).
 *
 * Deterministic work-class classification + tier recommendation. Two-level
 * taxonomy (convene R4): altitude × verification shape, kernel-tag-bound,
 * never per-framework. Tier names are the formal ProcessTierRule/1.1 enums
 * (mechanical / sentinel / scaffold / associate / frontier), superseding the
 * staged fractal-tiering prompt's TIER 0-3 labels.
 *
 * Bindings honored here:
 * - G5: unknown work classes route to frontier as EXPLORATION and are
 *   excluded from matrix cell statistics; when classification has no basis,
 *   the output is an explicit abstention, never a low-confidence label.
 * - R6/always_escalate: sensitive paths force frontier regardless of class.
 * - transfer_distance (component substrate) is a thinking-budget modifier:
 *   use-as-is permits one tier down; pattern-only forces one tier up.
 *
 * ADVISORY ONLY (R1 shadow mode): this helper recommends; dispatch decisions
 * remain with the static registry until the operator grants authority.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const ALTITUDES = Object.freeze([
  'mechanical', 'bounded_patch', 'structured_review', 'planning',
  'synthesis', 'client_judgment', 'sensitive_surface', 'unknown'
]);
const SHAPES = Object.freeze([
  'json_schema', 'node_tool', 'manifest', 'markdown_prompt',
  'test_failure', 'browser_surface', 'unknown'
]);
const TIERS = Object.freeze(['mechanical', 'sentinel', 'scaffold', 'associate', 'frontier']);

function loadAlwaysEscalatePatterns() {
  try {
    const reg = JSON.parse(fs.readFileSync(
      path.join(PROJECT_ROOT, 'tools/signals/lib/local-first-registry.json'), 'utf8'
    ));
    return (reg.always_escalate_patterns || []).map((p) => new RegExp(p, 'i'));
  } catch {
    // fail CLOSED: if the registry is unreadable, everything is sensitive
    return [/.*/];
  }
}

// R6 ascent write bounds double as sensitivity classes here.
const SENSITIVE_EXTRA = [
  /(^|\/)tests?\//i, /tools\/signals\//i, /(^|\/)schemas?\//i,
  /migration/i, /(^|\/)hooks?\//i, /cost-gate/i, /tier-routing/i,
  /(^|\b)auth(\b|\/)/i, /instructions\/canonical/i, /process-tier-rule/i
];

const RULES = {
  client_judgment: /\bclient\b.*\b(approv|sign-?off|judg|tone|relationship|escalat)|\b(approv|sign-?off)\b.*\bclient\b/i,
  planning: /\b(plan|roadmap|architect|scope|design the|strategy|concept)\b/i,
  synthesis: /\b(synthesi[sz]e|summari[sz]e across|consolidate|debrief|reconcile findings)\b/i,
  structured_review: /\b(review|audit|validate|verify|lint|check)\b/i,
  bounded_patch: /\b(fix|patch|repair|bug|failing|error|broken|regress)\b/i,
  mechanical: /\b(run|scan|sync|rotate|append|copy|rename|generate report|poll|crawl)\b/i
};

const SHAPE_RULES = [
  ['test_failure', /\btests?\b.*\b(fail|red|broke)|\b(fail|red|broke).*\btests?\b|test_failure/i],
  ['json_schema', /\.schema\.json|\bjson\s*schema\b|schema validation/i],
  ['manifest', /manifest\.json|\bmanifest\b/i],
  ['browser_surface', /\b(browser|wp-admin|playwright|dom|click|page load|screenshot)\b/i],
  ['node_tool', /\.c?js\b|\bnode\b|\bcli\b|\bscript\b/i],
  ['markdown_prompt', /\.md\b|\bprompt\b|\bdocs?\b|\bguide\b/i]
];

/**
 * classifyWork({ task, paths, transfer_distance }) →
 *   { altitude, verification_shape, sensitive, basis[] }
 */
function classifyWork(input = {}) {
  const task = String(input.task || '');
  const paths = Array.isArray(input.paths) ? input.paths : [];
  const basis = [];

  const escalate = loadAlwaysEscalatePatterns();
  const sensitive = paths.some((p) =>
    escalate.some((re) => re.test(p)) || SENSITIVE_EXTRA.some((re) => re.test(p))
  );
  if (sensitive) basis.push('sensitive-path');

  let altitude = 'unknown';
  if (sensitive) {
    altitude = 'sensitive_surface';
  } else {
    for (const [alt, re] of Object.entries(RULES)) {
      if (re.test(task)) { altitude = alt; basis.push(`altitude:${alt}`); break; }
    }
  }

  let shape = 'unknown';
  const haystack = `${task} ${paths.join(' ')}`;
  for (const [s, re] of SHAPE_RULES) {
    if (re.test(haystack)) { shape = s; basis.push(`shape:${s}`); break; }
  }

  return { altitude, verification_shape: shape, sensitive, basis };
}

const ALTITUDE_TIER = Object.freeze({
  mechanical: 'mechanical',
  bounded_patch: 'scaffold',
  structured_review: 'associate',
  planning: 'frontier',
  synthesis: 'frontier',
  client_judgment: 'frontier',
  sensitive_surface: 'frontier',
  unknown: 'frontier'
});

function shiftTier(tier, delta) {
  const order = ['mechanical', 'sentinel', 'scaffold', 'associate', 'frontier'];
  const i = Math.min(order.length - 1, Math.max(0, order.indexOf(tier) + delta));
  return order[i];
}

/**
 * routeTier({ task, paths, transfer_distance }) →
 *   { tier, altitude, verification_shape, exploration, abstain, justification }
 */
function routeTier(input = {}) {
  const cls = classifyWork(input);
  let tier = ALTITUDE_TIER[cls.altitude];
  let exploration = false;
  let abstain = '';

  if (cls.altitude === 'unknown' && cls.verification_shape === 'unknown') {
    // G5: explicit abstention — no basis means no recommendation, not a
    // low-confidence label. Exploration runs at frontier and is excluded
    // from matrix cell statistics.
    exploration = true;
    abstain = 'no recommendation — exploring (unclassified work)';
  } else if (cls.altitude === 'unknown') {
    exploration = true;
  }

  // transfer_distance modifier (component substrate): never below the floor,
  // never modifies sensitive/client/unknown classes.
  const td = input.transfer_distance;
  const modifiable = !cls.sensitive
    && !['client_judgment', 'sensitive_surface', 'unknown'].includes(cls.altitude);
  if (modifiable && td === 'use-as-is') tier = shiftTier(tier, -1);
  if (modifiable && td === 'pattern-only') tier = shiftTier(tier, +1);

  return {
    tier,
    altitude: cls.altitude,
    verification_shape: cls.verification_shape,
    sensitive: cls.sensitive,
    exploration,
    abstain,
    justification: cls.basis.join(', ') || 'no classification basis',
    advisory: true
  };
}

module.exports = { classifyWork, routeTier, ALTITUDES, SHAPES, TIERS };
