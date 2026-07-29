'use strict';

/**
 * doctrine-reflex.cjs — Control Loop reflex scanner.
 *
 * Deterministic, LLM-free, zero-network. Seven checks, single entrypoint.
 * Returns { verdict: 'pass'|'warn'|'stall', findings: [...] }.
 *
 * Firing points (wired by s05):
 *   (a) PostToolUse — on every Write/Edit (hook in .claude/settings.json)
 *   (b) Stop — before session end (hook)
 *   (c) signal-close — from close-signal.js, actor-auto.js, codex-auto.js
 *   (d) bridge-return — when codex-bridge response lands
 *   (e) worker-return — when a Task-tool subagent returns
 *
 * Input: typed event envelope per
 *   tools/kernel/lib/reflex-event-envelope.schema.json
 *
 * Checks (all deterministic — regex/grep/file-exists/schema-validate/set-compare):
 *   1. Kernel-written artifact carries all six Retrieval frontmatter fields
 *   2. Acceptance-grade write has distinct-intelligence review artifact
 *   3. Confidence claims cite verification artifact from current session
 *   4. Outbound bridge prompt carries tier-appropriate card hash AND
 *      contains named <critical>/<context> tagged blocks
 *   5. External content wrapped in <observed>
 *   6. write_set ⊆ parent.write_set (against scope_identity.owned_artifacts)
 *   7. Stall-on-contradiction — top-down intent + bottom-up evidence
 *      must both be satisfiable by current NOW state
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  validateFrontmatter,
  parseFrontmatterFromMarkdown
} = require('./lib/retrieval-adapter.cjs');

const PROJECT_ROOT = process.cwd();
const SESSION_PRESENT_PATH = path.resolve(
  PROJECT_ROOT,
  '_dev/state/session-present.json'
);
const CARD_PATH = path.resolve(
  PROJECT_ROOT,
  'instructions/canonical/kernel/session-grounding-card.md'
);
const ENVELOPE_SCHEMA_PATH = path.resolve(
  __dirname,
  'lib/reflex-event-envelope.schema.json'
);

const HARNESS_ID_PREFIX = 'claude-code:';

// Artifact classes considered "kernel-written" for check #1.
const KERNEL_ARTIFACT_GLOBS = [
  /^_dev\/concepts\/.*\.md$/,
  /^_dev\/reports\/analysis\/.*\.md$/,
  /^_dev\/reports\/signals\/.*\.signal\.json$/,
  /^instructions\/canonical\/kernel\/.*\.md$/,
  /^\.claude\/skills\/.*\/SKILL\.md$/
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function finding(check, level, code, detail) {
  return { check, level, code, detail };
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (_) {
    return null;
  }
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function isKernelArtifact(relPath) {
  return KERNEL_ARTIFACT_GLOBS.some((re) => re.test(relPath));
}

function cardPayloadHash() {
  const txt = readText(CARD_PATH);
  if (!txt) return null;
  const start = txt.indexOf('<!-- PAYLOAD-START -->');
  const end = txt.indexOf('<!-- PAYLOAD-END -->');
  const payload = start >= 0 && end > start ? txt.slice(start, end) : txt;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function pathWithinAny(candidate, allowedGlobs) {
  const rel = path.isAbsolute(candidate)
    ? path.relative(PROJECT_ROOT, candidate)
    : candidate;
  for (const glob of allowedGlobs) {
    if (glob.endsWith('/**')) {
      const prefix = glob.slice(0, -2); // drop "**"
      if (rel.startsWith(prefix)) return true;
      if (rel === prefix.slice(0, -1)) return true;
    } else if (glob.endsWith('/*')) {
      const prefix = glob.slice(0, -1);
      if (rel.startsWith(prefix) && !rel.slice(prefix.length).includes('/')) {
        return true;
      }
    } else {
      if (rel === glob) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Check 1 — kernel-written artifact carries all six Retrieval frontmatter fields
// ---------------------------------------------------------------------------

function check1KernelFrontmatter(envelope) {
  const findings = [];
  const writeSet = envelope.observed_write_set || [];
  for (const raw of writeSet) {
    const rel = path.isAbsolute(raw) ? path.relative(PROJECT_ROOT, raw) : raw;
    if (!isKernelArtifact(rel)) continue;
    const abs = path.resolve(PROJECT_ROOT, rel);
    const txt = readText(abs);
    if (!txt) {
      findings.push(finding(1, 'warn', 'kernel_artifact_unreadable', { path: rel }));
      continue;
    }
    // Signal JSON files: frontmatter shape does not apply; skip for now.
    if (rel.endsWith('.json')) continue;
    const fm = parseFrontmatterFromMarkdown(txt);
    const res = validateFrontmatter(fm);
    if (!res.ok) {
      findings.push(
        finding(1, 'warn', 'frontmatter_invalid', {
          path: rel,
          missing: res.missing,
          issues: res.findings
        })
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 2 — acceptance-grade write has distinct-intelligence review artifact
// ---------------------------------------------------------------------------

function check2AcceptanceReview(envelope) {
  const findings = [];
  if (!envelope.acceptance_grade) return findings;
  const evidence = (envelope.declared_intent && envelope.declared_intent.review_artifact) ||
    envelope.review_artifact ||
    null;
  if (!evidence) {
    findings.push(finding(2, 'warn', 'missing_review_artifact', {
      hint: 'acceptance_grade=true requires distinct-intelligence review artifact reference'
    }));
    return findings;
  }
  const abs = path.resolve(PROJECT_ROOT, evidence);
  if (!fs.existsSync(abs)) {
    findings.push(finding(2, 'warn', 'review_artifact_absent', { evidence }));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 3 — confidence claims cite verification artifact from current session
// ---------------------------------------------------------------------------

function check3ConfidenceEvidence(envelope) {
  const findings = [];
  const claims = envelope.confidence_claims || [];
  for (const c of claims) {
    if (!c || !c.evidence_artifact) {
      findings.push(finding(3, 'warn', 'claim_missing_evidence', { claim: c && c.claim }));
      continue;
    }
    const abs = path.resolve(PROJECT_ROOT, c.evidence_artifact);
    if (!fs.existsSync(abs)) {
      findings.push(finding(3, 'warn', 'evidence_artifact_absent', c));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 4 — outbound bridge prompt carries card hash AND named tagged blocks
// ---------------------------------------------------------------------------

function check4BridgePromptContract(envelope) {
  const findings = [];
  const body = envelope.bridge_prompt_body;
  if (!body || typeof body !== 'string') return findings;
  const tier = envelope.scope_tier;
  // Tier-appropriate card hash must be present at project/system tier.
  if (tier === 'project' || tier === 'system') {
    const expected = envelope.card_hash_expected || cardPayloadHash();
    if (!expected || !body.includes(expected)) {
      findings.push(
        finding(4, 'warn', 'bridge_prompt_missing_card_hash', {
          tier,
          expected_hash: expected
        })
      );
    }
  }
  // Named tagged blocks REQUIRED on every bridge dispatch.
  const hasCritical = /<critical[\s>][\s\S]*?<\/critical>/i.test(body);
  const hasContext = /<context[\s>][\s\S]*?<\/context>/i.test(body);
  if (!hasCritical) {
    findings.push(finding(4, 'warn', 'bridge_prompt_missing_critical_block', {}));
  }
  if (!hasContext) {
    findings.push(finding(4, 'warn', 'bridge_prompt_missing_context_block', {}));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 5 — external content wrapped in <observed>
// ---------------------------------------------------------------------------

function check5ObservedWrap(envelope) {
  const findings = [];
  const refs = envelope.external_content_refs || [];
  if (!Array.isArray(refs) || refs.length === 0) return findings;
  // Body carrying external quoted content must include <observed> wrap.
  const bodies = [];
  if (typeof envelope.bridge_prompt_body === 'string') {
    bodies.push(envelope.bridge_prompt_body);
  }
  for (const ref of refs) {
    const wrapped = bodies.some((b) =>
      new RegExp(`<observed[^>]*>[\\s\\S]*?${escapeRegex(String(ref))}[\\s\\S]*?<\/observed>`, 'i').test(b)
    );
    if (!wrapped) {
      findings.push(finding(5, 'warn', 'external_content_unwrapped', { ref }));
    }
  }
  return findings;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Check 6 — write_set ⊆ parent.write_set (scope_identity.owned_artifacts)
// ---------------------------------------------------------------------------

function check6WriteSetSubset(envelope) {
  const findings = [];
  const owned = (envelope.declared_intent && envelope.declared_intent.owned_artifacts) || [];
  const forbidden = (envelope.declared_intent && envelope.declared_intent.forbidden_artifacts) || [];
  const observed = envelope.observed_write_set || [];
  if (owned.length === 0) return findings; // no intent declared → nothing to check
  const allowedGlobs = owned.slice();
  for (const w of observed) {
    const rel = path.isAbsolute(w) ? path.relative(PROJECT_ROOT, w) : w;
    if (pathWithinAny(rel, forbidden)) {
      findings.push(finding(6, 'stall', 'write_to_forbidden_path', { path: rel }));
      continue;
    }
    if (!pathWithinAny(rel, allowedGlobs)) {
      findings.push(finding(6, 'warn', 'write_outside_owned_artifacts', { path: rel }));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 7 — stall-on-contradiction
// ---------------------------------------------------------------------------

function check7StallOnContradiction(envelope) {
  const findings = [];
  const snapshot = envelope.session_present_snapshot || {};
  // Writer-attestation visibility on the NOW snapshot: missing attestation
  // → stall (non-harness-path write detection per s04 gate 9).
  if (snapshot && Object.keys(snapshot).length > 0) {
    const attest = snapshot.writer_attestation;
    if (!attest || !attest.writer_harness_id || !String(attest.writer_harness_id).startsWith(HARNESS_ID_PREFIX)) {
      findings.push(
        finding(7, 'stall', 'session_present_missing_attestation', {
          detail: 'NOW snapshot lacks valid harness writer-attestation; non-harness-path write detected'
        })
      );
    }
  }
  // Classic contradiction: declared_intent says no-write to X,
  // observed_write_set writes to X. This overlaps with #6 but stall
  // here covers the logical-impossibility framing (Gemini falsifier).
  const intent = envelope.declared_intent || {};
  const observed = envelope.observed_write_set || [];
  const forbidden = intent.forbidden_artifacts || [];
  for (const w of observed) {
    const rel = path.isAbsolute(w) ? path.relative(PROJECT_ROOT, w) : w;
    if (pathWithinAny(rel, forbidden)) {
      findings.push(finding(7, 'stall', 'intent_evidence_contradiction', {
        declared: 'forbidden',
        observed: rel
      }));
    }
  }
  // Explicit contradiction flag surfaced by caller.
  if (intent.contradiction_declared === true) {
    findings.push(finding(7, 'stall', 'caller_declared_contradiction', {
      reason: intent.contradiction_reason || 'unspecified'
    }));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

function runReflex(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return {
      verdict: 'warn',
      findings: [finding(0, 'warn', 'envelope_missing_or_invalid', {})]
    };
  }
  const findings = [
    ...check1KernelFrontmatter(envelope),
    ...check2AcceptanceReview(envelope),
    ...check3ConfidenceEvidence(envelope),
    ...check4BridgePromptContract(envelope),
    ...check5ObservedWrap(envelope),
    ...check6WriteSetSubset(envelope),
    ...check7StallOnContradiction(envelope)
  ];
  let verdict = 'pass';
  for (const f of findings) {
    if (f.level === 'stall') {
      verdict = 'stall';
      break;
    }
    if (f.level === 'warn') verdict = 'warn';
  }
  return { verdict, findings };
}

/**
 * Load NOW snapshot from disk. Harness-callable convenience.
 */
function loadSessionPresent() {
  return readJson(SESSION_PRESENT_PATH) || {};
}

// ---------------------------------------------------------------------------
// CLI — accept JSON envelope on stdin, emit JSON verdict on stdout.
// ---------------------------------------------------------------------------

function runCli() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    let envelope;
    try {
      envelope = JSON.parse(raw || '{}');
    } catch (err) {
      process.stdout.write(
        JSON.stringify({ verdict: 'warn', findings: [finding(0, 'warn', 'stdin_parse_error', { error: err.message })] }) + '\n'
      );
      return;
    }
    // Hydrate missing snapshot from disk if absent.
    if (!envelope.session_present_snapshot) {
      envelope.session_present_snapshot = loadSessionPresent();
    }
    const result = runReflex(envelope);
    process.stdout.write(JSON.stringify(result) + '\n');
  });
}

if (require.main === module) {
  try {
    runCli();
  } catch (err) {
    process.stderr.write(`[doctrine-reflex] ${err.message}\n`);
    process.exit(0);
  }
}

module.exports = {
  runReflex,
  loadSessionPresent,
  cardPayloadHash,
  isKernelArtifact,
  pathWithinAny,
  ENVELOPE_SCHEMA_PATH,
  SESSION_PRESENT_PATH,
  CARD_PATH,
  check1KernelFrontmatter,
  check2AcceptanceReview,
  check3ConfidenceEvidence,
  check4BridgePromptContract,
  check5ObservedWrap,
  check6WriteSetSubset,
  check7StallOnContradiction
};
