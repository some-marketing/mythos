'use strict';

/**
 * local-first-dispatch.js — Pre-dispatch local verification filter.
 *
 * Sits between signal selection and Codex dispatch. For signals classified
 * as low-risk, runs verify-local on each artifact first. If all pass
 * locally, the signal can be closed without frontier tokens.
 *
 * Risk classification:
 *   - Explicit: signal.risk_class field ('low', 'medium', 'high')
 *   - Inferred: from artifact paths and signal scope
 *   - Default: 'medium' (always escalates to Codex)
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Risk classification
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Lane registry — loaded from JSON, not hardcoded
// ---------------------------------------------------------------------------

const REGISTRY_PATH = path.join(__dirname, 'local-first-registry.json');

let _registryCache = null;

function loadRegistry() {
  if (_registryCache) return _registryCache;
  try {
    _registryCache = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch {
    _registryCache = { low_risk_scopes: [], always_escalate_patterns: [] };
  }
  return _registryCache;
}

/** Reset cache — for testing */
function resetRegistryCache() { _registryCache = null; }

/**
 * Artifact patterns that are NEVER eligible for local-only review.
 * Loaded from registry, compiled to RegExp at runtime.
 */
function getAlwaysEscalatePatterns() {
  const reg = loadRegistry();
  return (reg.always_escalate_patterns || []).map(p => new RegExp(p, 'i'));
}

/**
 * Signal scopes eligible for local-first review.
 */
function getLowRiskScopes() {
  return loadRegistry().low_risk_scopes || [];
}

// Legacy exports for test compatibility
const ALWAYS_ESCALATE_PATTERNS = [
  /\.env/i, /credentials/i, /secrets?\./i, /guardrails\.md/i,
  /client\.json/i, /WORKSPACE_MANIFEST/i, /instructions\/canonical/
];
const LOW_RISK_SCOPES = [
  'local-model-structural-lane', 'local-model-verify-local', 'simpleminions-routing-integration'
];

/**
 * Classify the risk level of a signal for local-first dispatch.
 *
 * @param {object} signal - HandoffSignal
 * @returns {{ risk: 'low'|'medium'|'high', reason: string }}
 */
function classifySignalRisk(signal) {
  if (!signal) return { risk: 'medium', reason: 'No signal provided' };

  // Explicit risk_class on signal takes precedence
  if (signal.risk_class === 'low') return { risk: 'low', reason: 'Explicit risk_class: low' };
  if (signal.risk_class === 'high') return { risk: 'high', reason: 'Explicit risk_class: high' };
  if (signal.risk_class === 'medium') return { risk: 'medium', reason: 'Explicit risk_class: medium' };

  const artifacts = signal.artifacts || [];
  const patterns = getAlwaysEscalatePatterns();

  // Check for always-escalate patterns (registry-driven)
  for (const artifact of artifacts) {
    for (const pattern of patterns) {
      if (pattern.test(artifact)) {
        return { risk: 'high', reason: `Artifact matches escalation pattern: ${artifact}` };
      }
    }
  }

  // Check if scope is in the low-risk list (registry-driven)
  const scope = signal.signal_scope || signal.scope || '';
  const lowScopes = getLowRiskScopes();
  if (lowScopes.includes(scope)) {
    return { risk: 'low', reason: `Scope "${scope}" is in low-risk list` };
  }

  return { risk: 'medium', reason: 'Default: no low-risk indicators matched' };
}

// ---------------------------------------------------------------------------
// Routing telemetry — append-only JSONL
// ---------------------------------------------------------------------------

const TELEMETRY_PATH = path.join(__dirname, '../../../_dev/logs/local-first-routing.jsonl');

function logRoutingDecision(entry) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry
  }) + '\n';
  try {
    fs.mkdirSync(path.dirname(TELEMETRY_PATH), { recursive: true });
    fs.appendFileSync(TELEMETRY_PATH, line);
  } catch { /* telemetry is best-effort */ }
}

// ---------------------------------------------------------------------------
// Local first-pass verification
// ---------------------------------------------------------------------------

/**
 * Run local first-pass verification on a signal's artifacts.
 *
 * @param {object} signal - HandoffSignal
 * @param {string} projectRoot - Absolute project root
 * @param {object} [opts]
 * @param {string} [opts.model] - Ollama model override
 * @returns {Promise<{
 *   eligible: boolean,
 *   risk: object,
 *   skipped: boolean,
 *   results: object[],
 *   locally_accepted: boolean,
 *   needs_escalation: boolean,
 *   reason: string
 * }>}
 */
async function runLocalFirstPass(signal, projectRoot, opts = {}) {
  const risk = classifySignalRisk(signal);

  // Only low-risk signals are eligible
  if (risk.risk !== 'low') {
    logRoutingDecision({
      action: 'escalated',
      risk_class: risk.risk,
      reason: risk.reason,
      dispatch_reason: `Not eligible for local-first: ${risk.reason}`,
      scope: signal.signal_scope || signal.scope || '',
      artifact_count: (signal.artifacts || []).length
    });
    return {
      eligible: false,
      risk,
      skipped: true,
      results: [],
      locally_accepted: false,
      needs_escalation: true,
      reason: `Not eligible: ${risk.reason}`
    };
  }

  const { verifyArtifact } = require('../../ai-bridge/lib/model-runtime');
  const artifacts = signal.artifacts || [];

  if (artifacts.length === 0) {
    return {
      eligible: true,
      risk,
      skipped: true,
      results: [],
      locally_accepted: false,
      needs_escalation: true,
      reason: 'No artifacts to verify'
    };
  }

  const results = [];
  let allPassed = true;

  for (const artifactPath of artifacts) {
    const absPath = path.resolve(projectRoot, artifactPath);

    // Skip non-existent files and non-code files
    if (!fs.existsSync(absPath)) {
      results.push({ artifact: artifactPath, skipped: true, reason: 'File not found' });
      continue;
    }

    const ext = path.extname(absPath);
    const verifiableExts = ['.js', '.cjs', '.mjs', '.json', '.md', '.yaml', '.yml'];
    if (!verifiableExts.includes(ext)) {
      results.push({ artifact: artifactPath, skipped: true, reason: `Extension ${ext} not verifiable` });
      continue;
    }

    const content = fs.readFileSync(absPath, 'utf-8');

    // Skip very large files (>50KB) — local model context is limited
    if (content.length > 50000) {
      results.push({ artifact: artifactPath, skipped: true, reason: 'File too large for local review' });
      allPassed = false;
      continue;
    }

    const modelOverride = opts.model
      ? (String(opts.model).includes(':') && (String(opts.model).startsWith('ollama:') || String(opts.model).startsWith('openai-compatible:'))
          ? String(opts.model)
          : `ollama:${String(opts.model)}`)
      : '';

    const { result, error, latency_ms, selection } = await verifyArtifact(content, {
      model: modelOverride,
      taskPrompt: `Review this file for correctness, consistency, and obvious defects. File: ${artifactPath}`,
      anchorPath: absPath,
      lane_context: {
        workflow_type: 'verification',
        acceptance_grade: false,
        risk_tier: 'low',
        local_eligible: true
      }
    });

    if (error || !result) {
      results.push({ artifact: artifactPath, error, latency_ms, verdict: null });
      allPassed = false;
      continue;
    }

    results.push({
      artifact: artifactPath,
      verdict: result.verdict,
      confidence: result.confidence,
      needs_escalation: result.needs_escalation,
      findings_count: (result.findings || []).length,
      latency_ms,
      resolved_model: selection ? selection.resolved_model_id : result.model_id || null,
      resolved_provider: selection ? selection.resolved_provider : result.provider || null
    });

    if (result.verdict !== 'pass' || result.needs_escalation) {
      allPassed = false;
    }
  }

  const outcome = {
    eligible: true,
    risk,
    skipped: false,
    results,
    locally_accepted: allPassed,
    needs_escalation: !allPassed,
    reason: allPassed
      ? `All ${results.length} artifacts passed local review`
      : `${results.filter(r => r.verdict !== 'pass' || r.needs_escalation || r.error).length} artifact(s) need escalation`
  };

  logRoutingDecision({
    action: allPassed ? 'local_accepted' : 'escalated_after_local',
    risk_class: risk.risk,
    dispatch_reason: allPassed
      ? `All ${results.length} artifacts passed local review — no escalation needed`
      : `${results.filter(r => r.verdict !== 'pass' || r.needs_escalation || r.error).length} artifact(s) failed local review — escalating to frontier`,
    scope: signal.signal_scope || signal.scope || '',
    artifact_count: (signal.artifacts || []).length,
    artifacts_reviewed: results.filter(r => !r.skipped).length,
    locally_accepted: allPassed,
    total_latency_ms: results.reduce((sum, r) => sum + (r.latency_ms || 0), 0)
  });

  return outcome;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  classifySignalRisk,
  runLocalFirstPass,
  logRoutingDecision,
  loadRegistry,
  resetRegistryCache,
  getLowRiskScopes,
  getAlwaysEscalatePatterns,
  ALWAYS_ESCALATE_PATTERNS,
  LOW_RISK_SCOPES,
  REGISTRY_PATH,
  TELEMETRY_PATH
};
