'use strict';

/**
 * inject-grounding-card.cjs — SessionStart hook.
 *
 * Responsibilities:
 *   1. Read the tiered grounding card at
 *      instructions/canonical/kernel/session-grounding-card.md.
 *   2. Emit the task-tier section to stdout as system-context (hook
 *      output is surfaced to Claude as system context).
 *   3. Read prior session's _dev/state/session-drift-log.json; if any
 *      uncleared drift entries exist, set a drift flag.
 *   4. Write initial record to _dev/state/session-present.json with a
 *      harness-signed writer-attestation envelope (harness write — NOT
 *      Claude's tool-path write). Appends without mutating owner semantics.
 *
 * Additive: never replaces existing SessionStart hook output. Other
 * SessionStart hooks (session-start-emit.cjs, verify-credentials.cjs)
 * run independently per .claude/settings.json.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = process.cwd();
const CARD_PATH = path.join(
  PROJECT_ROOT,
  'instructions',
  'canonical',
  'kernel',
  'session-grounding-card.md'
);
const DRIFT_LOG_PATH = path.join(
  PROJECT_ROOT,
  '_dev',
  'state',
  'session-drift-log.json'
);
const SESSION_PRESENT_PATH = path.join(
  PROJECT_ROOT,
  '_dev',
  'state',
  'session-present.json'
);

const HARNESS_ID = 'claude-code:inject-grounding-card.cjs';

function readCardPayload() {
  if (!fs.existsSync(CARD_PATH)) return null;
  return fs.readFileSync(CARD_PATH, 'utf8');
}

function extractTier(cardText, tierLabel) {
  if (!cardText) return '';
  const re = new RegExp(
    `## Tier: ${tierLabel}\\s*\\n([\\s\\S]*?)(?=\\n## Tier: |<!-- PAYLOAD-END -->|$)`
  );
  const m = cardText.match(re);
  return m ? m[1].trim() : '';
}

function readDriftLog() {
  if (!fs.existsSync(DRIFT_LOG_PATH)) return { uncleared: [], entries: [] };
  try {
    const raw = fs.readFileSync(DRIFT_LOG_PATH, 'utf8');
    const obj = JSON.parse(raw);
    const entries = Array.isArray(obj.entries) ? obj.entries : [];
    const uncleared = entries.filter(
      (e) => e && e.status && e.status !== 'cleared' && e.status !== 'acknowledged'
    );
    return { uncleared, entries };
  } catch (_) {
    return { uncleared: [], entries: [] };
  }
}

function computePayloadHash(text) {
  const start = text.indexOf('<!-- PAYLOAD-START -->');
  const end = text.indexOf('<!-- PAYLOAD-END -->');
  const payload = start >= 0 && end > start ? text.slice(start, end) : text || '';
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function signAttestation(recordWithoutSig) {
  const serialized = JSON.stringify(recordWithoutSig);
  const digest = crypto
    .createHash('sha256')
    .update(`${HARNESS_ID}:${serialized}`)
    .digest('hex');
  return {
    writer_harness_id: HARNESS_ID,
    signature_alg: 'sha256-harness-concat-v1',
    signature: digest,
    signed_at: new Date().toISOString()
  };
}

function writeSessionPresentInitial(driftFlag, cardHash) {
  const record = {
    schema: 'SessionPresent/1.0',
    scope_tier: 'task',
    owned_artifacts: [],
    write_set: [],
    evidence_paths: [],
    contradiction_status: driftFlag ? 'inherited_uncleared_drift' : 'clean',
    alpha_loaded_flag: true,
    alpha_card_hash: cardHash,
    last_reflex_verdict: null,
    last_updated_by: HARNESS_ID,
    last_updated_at: new Date().toISOString(),
    drift_inherited: driftFlag
  };
  const attestation = signAttestation(record);
  const envelope = { ...record, writer_attestation: attestation };
  try {
    fs.mkdirSync(path.dirname(SESSION_PRESENT_PATH), { recursive: true });
    fs.writeFileSync(
      SESSION_PRESENT_PATH,
      JSON.stringify(envelope, null, 2) + '\n'
    );
  } catch (err) {
    process.stderr.write(
      `[inject-grounding-card] session-present write failed: ${err.message}\n`
    );
  }
  return envelope;
}

function main() {
  const cardText = readCardPayload();
  const taskTier = extractTier(cardText, 'task');
  const drift = readDriftLog();
  const driftFlag = drift.uncleared.length > 0;
  const cardHash = computePayloadHash(cardText || '');

  writeSessionPresentInitial(driftFlag, cardHash);

  const lines = [];
  lines.push('SESSION GROUNDING CARD — task tier');
  lines.push('');
  if (driftFlag) {
    lines.push(
      `DRIFT INHERITED from prior session(s): ${drift.uncleared.length} uncleared entry/entries in _dev/state/session-drift-log.json. The first PostToolUse reflex firing will surface this state.`
    );
    lines.push('');
  }
  if (taskTier) {
    lines.push(taskTier);
  } else {
    lines.push('(card absent — run /plan-task control-loop-lobe to ship it)');
  }
  lines.push('');
  lines.push(`alpha_card_hash: ${cardHash}`);

  process.stdout.write(lines.join('\n') + '\n');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`[inject-grounding-card] ${err.message}\n`);
    process.exit(0); // fail-open: never block SessionStart
  }
}

module.exports = {
  extractTier,
  computePayloadHash,
  signAttestation,
  readDriftLog,
  CARD_PATH,
  SESSION_PRESENT_PATH,
  DRIFT_LOG_PATH,
  HARNESS_ID
};
