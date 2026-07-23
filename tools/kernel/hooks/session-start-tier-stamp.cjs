#!/usr/bin/env node
'use strict';

const fs = require('fs');
const {
  readRule,
  resolveProcessTierDetailed,
  writeSessionTier
} = require('./lib/process-tier.cjs');

function readPayload() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// Claude Code hook payloads do NOT carry a model field (verified 2026-06-10:
// every real boot stamped model:unknown → tier:scaffold, making frontier-tier
// ceremony-shedding silently inert — the exact failure the calibration convene
// told us to assert against). The transcript JSONL does carry it on every
// assistant message (message.model), so derive from transcript_path when the
// payload and env are silent. At SessionStart on a brand-new session the
// transcript may not exist yet — ensureSessionTier() re-stamps lazily at first
// UserPromptSubmit, by which point it does.
function modelFromTranscript(payload) {
  const transcriptPath = payload && payload.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').trimEnd().split('\n');
    const start = Math.max(0, lines.length - 400);
    for (let i = lines.length - 1; i >= start; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        const model = (obj.message && obj.message.model) || obj.model;
        if (model && typeof model === 'string' && !model.startsWith('<')) return model;
      } catch {
        // skip unparsable line
      }
    }
  } catch {
    // unreadable transcript — fall through to unknown
  }
  return '';
}

function resolveModel(payload) {
  return String(
    payload.model ||
    payload.model_id ||
    payload.claude_model ||
    process.env.CLAUDE_MODEL ||
    process.env.CLAUDE_MODEL_ID ||
    process.env.MYTHOS_MODEL ||
    modelFromTranscript(payload) ||
    'unknown'
  );
}

function resolveDeclaredTier(payload) {
  return String(
    payload.process_tier ||
    payload.sm_os_process_tier ||
    process.env.MYTHOS_PROCESS_TIER ||
    ''
  ).trim();
}

// tier-s1b-resolver-down-only: an UPWARD tier declaration is honored only
// with an operator-provenance artifact reference (declaration_policy in
// process-tier-rule.yaml, convene 20260611T130035Z condition 3).
function resolveOperatorProvenance(payload) {
  return String(
    payload.process_tier_operator_provenance ||
    process.env.MYTHOS_PROCESS_TIER_OPERATOR_PROVENANCE ||
    ''
  ).trim();
}

// Coordination scope + judgment ceiling per the operator's haiku-subtree fork
// resolution (Ratification Record 2026-06-11; carried through the stamp so
// slice-2 consumers can check the recursive invariant in hook code).
function resolveCoordinationScope(payload) {
  const value = String(
    payload.coordination_scope ||
    process.env.MYTHOS_COORDINATION_SCOPE ||
    ''
  ).trim().toLowerCase();
  return value === 'subtree' || value === 'session-root' ? value : '';
}

function resolveJudgmentCeiling(payload) {
  return String(
    payload.judgment_ceiling ||
    process.env.MYTHOS_JUDGMENT_CEILING ||
    ''
  ).trim().toLowerCase();
}

function main(payloadArg, opts = {}) {
  const payload = payloadArg && typeof payloadArg === 'object' ? payloadArg : readPayload();
  const model = resolveModel(payload);
  const declared = resolveDeclaredTier(payload);
  const operatorProvenance = resolveOperatorProvenance(payload);
  const rule = readRule();
  // tier-s0a (convene 20260611T130035Z, condition 2): the stamp must always
  // say HOW it was classified — resolved-model | declared | fallback-scaffold.
  // An unresolvable model stamps fallback-scaffold with that provenance
  // recorded, never a silent default.
  // tier-s1b (condition 3): declarations are down-only; a rejected upward
  // declaration falls back to the name-inferred tier and is RECORDED in the
  // stamp (rejected_declaration), never silently honored or dropped.
  const resolved = resolveProcessTierDetailed({ model, declared, operatorProvenance, rule });
  const stamp = writeSessionTier({
    sessionId: payload.session_id || process.env.CLAUDE_SESSION_ID || process.env.MYTHOS_SESSION_ID || 'unknown',
    model,
    declared,
    tier: resolved.tier,
    tierProvenance: resolved.tier_provenance,
    coordinationScope: resolveCoordinationScope(payload),
    judgmentCeiling: resolveJudgmentCeiling(payload),
    rejectedDeclaration: resolved.rejected_declaration || null,
    declarationOperatorProvenance: resolved.declaration_operator_provenance || null,
    source: opts.source || 'SessionStart'
  });
  // quiet: the UserPromptSubmit lazy-repair path must never inject tier-status
  // text into the prompt stream (Codex review 2026-06-10, MAJOR).
  if (!opts.quiet) {
    process.stdout.write(`[process-tier] coordinator=${stamp.model} tier=${stamp.tier} provenance=${stamp.tier_provenance} (process-tier-rule)\n`);
  }
  return stamp;
}

// Lazy repair for boots where SessionStart ran before the transcript existed
// (fresh sessions): if the stamp is missing or resolved model:unknown, re-stamp
// now that the transcript can answer. Cheap no-op when the stamp is healthy.
function ensureSessionTier(payload) {
  try {
    const { readSessionStamp } = require('./lib/process-tier.cjs');
    const sessionId = (payload && payload.session_id) || 'unknown';
    const existing = readSessionStamp ? readSessionStamp(sessionId) : null;
    if (existing && existing.model && existing.model !== 'unknown') return existing;
    // No-op when the model still cannot be resolved (transcript absent or
    // model-less): re-stamping unknown→scaffold every prompt is churn, and the
    // prompt path must stay silent either way (Codex review 2026-06-10, MAJOR).
    if (resolveModel(payload || {}) === 'unknown') return existing;
    return main(payload, { quiet: true, source: 'UserPromptSubmit-lazy-repair' });
  } catch {
    // never break the prompt
  }
  return null;
}

module.exports = {
  ensureSessionTier,
  main,
  modelFromTranscript,
  readPayload,
  resolveCoordinationScope,
  resolveDeclaredTier,
  resolveJudgmentCeiling,
  resolveModel,
  resolveOperatorProvenance
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`[process-tier] ${err.message}\n`);
    process.exit(0);
  }
}
