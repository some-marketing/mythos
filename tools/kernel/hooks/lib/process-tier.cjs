'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');
const RULE_PATH = path.join(ROOT, 'instructions/canonical/process-tier-rule.yaml');
const STATE_DIR = path.join(ROOT, '_dev/state/session-tier');
// associate joined both sets in ProcessTierRule/1.1 (tier-s1b-resolver-down-only,
// convene 20260611T130035Z conditions 3 + 12).
const DECLARED_TIERS = new Set(['mechanical', 'sentinel', 'associate', 'frontier', 'scaffold']);
const NAME_INFERRED_TIERS = new Set(['frontier', 'associate', 'scaffold']);

// Rank by operational freedom (mirror of process-tier-rule.yaml
// declaration_policy.tier_rank). Declarations are DOWN-ONLY: a declared tier
// is honored only when its rank is <= the name-inferred tier's rank.
const TIER_RANK = Object.freeze({
  mechanical: 0,
  sentinel: 1,
  scaffold: 2,
  associate: 3,
  frontier: 4
});

const COORDINATION_SCOPES = new Set(['subtree', 'session-root']);

// How a session's tier was classified (tier-s0a, convene 20260611T130035Z
// condition 2). A stamp must always say HOW it was classified:
//   declared          — an explicitly declared process tier was honored
//                       (down-only, or upward with operator provenance)
//   resolved-model    — the model name matched a tier's match_models pattern
//   fallback-scaffold — nothing resolved; defaulted to scaffold (never silent)
const TIER_PROVENANCE = Object.freeze({
  DECLARED: 'declared',
  RESOLVED_MODEL: 'resolved-model',
  FALLBACK_SCAFFOLD: 'fallback-scaffold'
});

function readRule(rulePath = RULE_PATH) {
  return JSON.parse(fs.readFileSync(rulePath, 'utf8'));
}

function readRuleSafe(rulePath = RULE_PATH) {
  try {
    return readRule(rulePath);
  } catch {
    return null;
  }
}

function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function modelMatches(pattern, model) {
  return globToRegExp(pattern).test(String(model || ''));
}

function tierRank(tier) {
  const rank = TIER_RANK[String(tier || '').trim().toLowerCase()];
  return Number.isInteger(rank) ? rank : null;
}

// Name-inference only: which tier does the model string itself resolve to?
function resolveNameInferredTier({ model, rule } = {}) {
  const activeRule = rule || readRule();
  const modelName = String(model || '').trim();
  for (const tier of activeRule.tiers || []) {
    if (!NAME_INFERRED_TIERS.has(tier.tier)) continue;
    if (!Array.isArray(tier.match_models)) continue;
    if (tier.match_models.some((pattern) => modelMatches(pattern, modelName))) {
      return { tier: tier.tier, tier_provenance: TIER_PROVENANCE.RESOLVED_MODEL };
    }
  }
  return { tier: 'scaffold', tier_provenance: TIER_PROVENANCE.FALLBACK_SCAFFOLD };
}

// Upward declarations require an operator-provenance artifact reference that
// exists on disk (process-tier-rule.yaml declaration_policy; convene
// 20260611T130035Z condition 3). Returns the normalized reference when valid.
function resolveOperatorProvenanceRef(ref, root = ROOT) {
  const value = String(ref || '').trim();
  if (!value) return null;
  const abs = path.isAbsolute(value) ? value : path.resolve(root, value);
  return fs.existsSync(abs) ? value : null;
}

// tier-s1b-resolver-down-only (convene 20260611T130035Z conditions 3 + 12):
// declarations are DOWN-ONLY. A declared tier is honored when its rank is
// equal to or lower than the name-inferred tier's rank. An UPWARD declaration
// is honored only with an operator-provenance artifact reference that exists
// on disk; otherwise resolution falls back to the name-inferred tier and the
// rejected declaration is surfaced so the stamp records it (never silent).
function resolveProcessTierDetailed({ model, declared, operatorProvenance, rule, root } = {}) {
  const activeRule = rule || readRule();
  const inferred = resolveNameInferredTier({ model, rule: activeRule });
  const normalizedDeclared = String(declared || '').trim().toLowerCase();

  if (DECLARED_TIERS.has(normalizedDeclared)) {
    const declaredRank = tierRank(normalizedDeclared);
    const inferredRank = tierRank(inferred.tier);
    if (declaredRank !== null && inferredRank !== null && declaredRank <= inferredRank) {
      // Down (or equal): honored unconditionally.
      return { tier: normalizedDeclared, tier_provenance: TIER_PROVENANCE.DECLARED };
    }
    const provenanceRef = resolveOperatorProvenanceRef(operatorProvenance, root || ROOT);
    if (provenanceRef) {
      // Upward with operator provenance: honored, reference carried for the stamp.
      return {
        tier: normalizedDeclared,
        tier_provenance: TIER_PROVENANCE.DECLARED,
        declaration_operator_provenance: provenanceRef
      };
    }
    // Upward without operator provenance: REJECTED — fall back to inference
    // and record the rejection (the self-promotion hole, closed).
    return {
      ...inferred,
      rejected_declaration: {
        declared: normalizedDeclared,
        inferred_tier: inferred.tier,
        reason: 'upward-declaration-without-operator-provenance'
      }
    };
  }

  return inferred;
}

// Tier-only view kept for existing consumers.
function resolveProcessTier(args = {}) {
  return resolveProcessTierDetailed(args).tier;
}

// Resolve a tier's adds LIVE from the rule (never baked into stamps):
// ProcessTierRule/1.1 add_registry entries referenced by per-tier add-ID
// arrays. Safe degradation (convene condition 12 / G12): a 1.0 rule without
// an add_registry, an unknown tier, or an unreadable rule all yield [].
function resolveAddsForTier(tier, rule) {
  const activeRule = rule === undefined ? readRuleSafe() : rule;
  if (!activeRule || typeof activeRule !== 'object') return [];
  const registry = activeRule.add_registry && activeRule.add_registry.adds;
  if (!registry || typeof registry !== 'object') return []; // ProcessTierRule/1.0 fallback
  const tierEntry = (activeRule.tiers || []).find((t) => t && t.tier === String(tier || '').trim().toLowerCase());
  if (!tierEntry || !Array.isArray(tierEntry.adds)) return [];
  const adds = [];
  for (const id of tierEntry.adds) {
    const def = registry[id];
    if (def && typeof def === 'object') adds.push({ id, ...def });
    // Unregistered add IDs are skipped here and rejected by
    // tools/maintenance/process-tier-rule-lint.cjs.
  }
  return adds;
}

// readSessionAdds — the hook-facing accessor (G12): resolves the stamped
// tier's adds live from the rule file at read time, never from the stamp
// body. ProcessTierStamp/1.0 stamps lacking new fields degrade safely (only
// stamp.tier is consulted); a missing stamp yields [].
function readSessionAdds(sessionId, opts = {}) {
  const stamp = readSessionStamp(sessionId, opts);
  if (!stamp || typeof stamp.tier !== 'string') return [];
  const rule = opts.rule !== undefined ? opts.rule : readRuleSafe(opts.rulePath);
  return resolveAddsForTier(stamp.tier, rule);
}

// checkCoordinationInvariant — machine-checkable form of the operator's
// haiku-subtree fork resolution (Ratification Record 2026-06-11; G9):
// coordination_scope is subtree | session-root; a subtree coordinator's tier
// must be >= the highest judgment tier in its subtree, applied recursively;
// session-root coordination is forbidden for haiku-class models.
//
// node shape: {
//   tier, model?, coordination_scope?, judgment_ceiling?,
//   lanes?: [{ kind: 'judgment' | 'mechanical', tier }],
//   children?: [node]
// }
function highestJudgmentRank(node) {
  let max = -1;
  for (const lane of (node && Array.isArray(node.lanes) ? node.lanes : [])) {
    if (!lane || lane.kind !== 'judgment') continue;
    const rank = tierRank(lane.tier);
    if (rank !== null && rank > max) max = rank;
  }
  for (const child of (node && Array.isArray(node.children) ? node.children : [])) {
    // A child coordinator is itself a judgment actor inside this subtree.
    const childRank = tierRank(child && child.tier);
    if (childRank !== null && childRank > max) max = childRank;
    const nested = highestJudgmentRank(child);
    if (nested > max) max = nested;
  }
  return max;
}

function checkCoordinationInvariant(node, opts = {}) {
  const rule = opts.rule !== undefined ? opts.rule : readRuleSafe();
  const violations = [];
  const walk = (current, trail) => {
    if (!current || typeof current !== 'object') return;
    const label = trail || 'root';
    const scope = current.coordination_scope ? String(current.coordination_scope).trim().toLowerCase() : null;
    const coordinatorRank = tierRank(current.tier);

    if (scope && !COORDINATION_SCOPES.has(scope)) {
      violations.push({ node: label, reason: `invalid-coordination-scope:${scope}` });
    }

    const forbidden = (rule && rule.coordination_scope && Array.isArray(rule.coordination_scope.session_root_forbidden_for_models))
      ? rule.coordination_scope.session_root_forbidden_for_models
      : [];
    if (scope === 'session-root' && current.model &&
        forbidden.some((pattern) => modelMatches(pattern, current.model))) {
      violations.push({ node: label, reason: 'session-root-coordination-forbidden-for-model' });
    }

    if (scope === 'subtree') {
      const ceilingRank = tierRank(current.judgment_ceiling);
      if (ceilingRank === null) {
        violations.push({ node: label, reason: 'missing-judgment-ceiling' });
      } else if (coordinatorRank !== null && coordinatorRank < ceilingRank) {
        violations.push({ node: label, reason: 'coordinator-below-declared-judgment-ceiling' });
      }
      const actual = highestJudgmentRank(current);
      if (ceilingRank !== null && actual > ceilingRank) {
        violations.push({ node: label, reason: 'judgment-lane-exceeds-declared-ceiling' });
      }
    }

    // Recursive invariant: coordinator tier >= highest judgment tier in subtree.
    const actualJudgment = highestJudgmentRank(current);
    if (coordinatorRank !== null && actualJudgment > coordinatorRank) {
      violations.push({ node: label, reason: 'coordinator-below-subtree-judgment-tier' });
    }

    for (let i = 0; i < (Array.isArray(current.children) ? current.children.length : 0); i++) {
      walk(current.children[i], `${label}.children[${i}]`);
    }
  };
  walk(node, 'root');
  return { ok: violations.length === 0, violations };
}

function safeSessionId(sessionId) {
  return String(sessionId || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');
}

function stampPath(sessionId, stateDir = STATE_DIR) {
  return path.join(stateDir, `${safeSessionId(sessionId)}.json`);
}

function writeSessionTier({
  sessionId,
  model,
  declared,
  tier,
  tierProvenance,
  source,
  coordinationScope,
  judgmentCeiling,
  rejectedDeclaration,
  declarationOperatorProvenance
}, opts = {}) {
  const stateDir = opts.stateDir || STATE_DIR;
  const payload = {
    schema: 'ProcessTierStamp/1.0',
    session_id: sessionId || 'unknown',
    model: model || 'unknown',
    declared_process_tier: declared || null,
    tier,
    // Additive field (tier-s0a): readers must tolerate stamps without it.
    tier_provenance: tierProvenance || null,
    // Additive fields (tier-s1b): coordination scope + judgment ceiling per
    // the operator's subtree fork resolution; rejected upward declarations
    // are recorded, never silently dropped (convene condition 3).
    coordination_scope: coordinationScope || null,
    judgment_ceiling: judgmentCeiling || null,
    rejected_declaration: rejectedDeclaration || null,
    declaration_operator_provenance: declarationOperatorProvenance || null,
    source: source || 'session-start',
    stamped_at: new Date().toISOString()
  };
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stampPath(sessionId, stateDir), JSON.stringify(payload, null, 2) + '\n');
  return payload;
}

function readSessionTier(sessionId, opts = {}) {
  const stamp = readSessionStamp(sessionId, opts);
  return stamp && typeof stamp.tier === 'string' ? stamp.tier : null;
}

// Full stamp object (model, declared tier, provenance) — readSessionTier's
// tier-only view is kept for existing consumers.
function readSessionStamp(sessionId, opts = {}) {
  try {
    const stateDir = opts.stateDir || STATE_DIR;
    const parsed = JSON.parse(fs.readFileSync(stampPath(sessionId, stateDir), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = {
  COORDINATION_SCOPES,
  DECLARED_TIERS,
  NAME_INFERRED_TIERS,
  ROOT,
  RULE_PATH,
  STATE_DIR,
  TIER_PROVENANCE,
  TIER_RANK,
  checkCoordinationInvariant,
  globToRegExp,
  highestJudgmentRank,
  modelMatches,
  readRule,
  readRuleSafe,
  readSessionAdds,
  readSessionStamp,
  readSessionTier,
  resolveAddsForTier,
  resolveNameInferredTier,
  resolveOperatorProvenanceRef,
  resolveProcessTier,
  resolveProcessTierDetailed,
  safeSessionId,
  stampPath,
  tierRank,
  writeSessionTier
};
