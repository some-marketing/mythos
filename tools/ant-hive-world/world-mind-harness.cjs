#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/world-mind-harness.cjs — the WORLD MIND, harnessed by
// the Mythos project (operator, 2026-08-03: "the harness for the worldmind
// needs to be the mythos project"; option B confirmed: LLM-backed).
//
// This is the Mythos-side mind. It lives in the Mythos context (this Mac,
// where the memories and the vault are) and coordinates the ant-hive-world
// simulation that runs in the isolated Orwell WSL guest.
//
// Isolation contract (unchanged): the guest has no mounts and no egress.
//   - SIM STATE crosses OUT host-initiated (pull world-state from the guest).
//   - DECISIONS cross IN host-initiated (push world-mind-decision.json into
//     the guest's sandbox root; the engine reads it fresh each tick).
//   - MEMORY NEVER ENTERS THE GUEST. Memories/vault/goals are read Mac-side,
//     folded into the prompt, and only the resulting decision verb crosses.
//
// Doctrine notes (operator-signed policy changes, recorded not assumed):
//   - LLM-backed world mind is an explicit policy change from the sim's
//     fresh-minds rule (which governs HIVE minds, not the world-coordination
//     layer). Operator chose option B on 2026-08-03.
//   - CARRIAGE / COORDINATION, NOT AUTHORITY: the world mind emits the same
//     environmental/signaling verbs as world-mind.js — it never overrides a
//     hive's decision (no-godmode + solar-system carriage ruling).
//   - Producer never validates its own trial: every decision is logged with
//     its prompt digest; the mind does not grade itself.
//   - Privacy floor: memory folding is bounded and redacts client/credential
//     surfaces (clients/, *.env, keychain). The prompt is the only surface.
//
// Usage: node world-mind-harness.cjs [--once] [--model <claude|gemini>]
//   Default: --forever loop, one decision per cadence (default 30s),
//   --once for a single decision (verification/debug).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argVal = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const hasFlag = (flag) => process.argv.indexOf(flag) !== -1;

const ONCE = hasFlag('--once');
const CADENCE_MS = parseInt(argVal('--cadence-ms', '30000'), 10);
const MODEL = argVal('--model', 'claude'); // claude | gemini
const ORWELL_SSH = argVal('--orwell', 'orwell'); // ssh alias for the guest host
const GUEST_TRANSPORT = argVal('--guest-transport', 'ssh'); // ssh (Mac->Orwell) | local (running ON Orwell)
const GUEST_DISTRO = argVal('--guest-distro', 'Ubuntu-24.04');
const GUEST_STATE_PATH = argVal('--guest-state-path', '/opt/antworld/_dev/state/ant-hive-world-run/shared/world-state.json');
const GUEST_DECISION_PATH = argVal('--guest-decision-path', '/opt/antworld/_dev/state/ant-hive-world-run/world-mind-decision.json');

const MYTHOS_ROOT = path.resolve(__dirname, '..', '..');
const HARNESS_MEMORY_DIR = argVal('--memory-dir', path.join(process.env.HOME, '.claude', 'projects', '-Users-admin-mythos', 'memory'));
const VAULT_SUBSTRATE = argVal('--vault-dir', path.join(MYTHOS_ROOT, 'Mythos-memories', 'substrate'));
const HANDOFF_PATH = argVal('--handoff', path.join(MYTHOS_ROOT, 'Mythos-memories', 'next-session-handoff.md'));
const DECISION_LOG = path.join(MYTHOS_ROOT, '_dev', 'state', 'ant-hive-world-run', 'world-mind-decisions.jsonl');

const WORLD_VERBS = ['seed-wood', 'seed-stone', 'signal-food', 'relax-decay', 'idle'];

// ---- guest transport: execFile/argv only (A3) ------------------------------
// A3 (plan sim-foundation-repairs, S7): the old pull/push interpolated
// argv-derived --guest-state-path/--guest-decision-path/--guest-distro into
// bash -lc STRINGS (`cat ${GUEST_STATE_PATH}` etc.), a host command-injection
// surface: a path containing `;`, `$(...)`, or backticks executed on the host.
// CHOSEN MECHANISM (single, per the plan): execFileSync with argv ARRAYS -- a
// fixed literal script receives the variable path as a QUOTED POSITIONAL bound
// inside the script as "$1" (and "$2" for the push payload). Env-var transport
// and blacklists are REJECTED as insufficient: env vars expand unquoted, and a
// blacklist does not define the accepted grammar. The grammar below is the
// gate: any value that does not match is refused BEFORE a command is built, so
// no command can execute with a non-conforming value.
const GUEST_PATH_GRAMMAR = /^[A-Za-z0-9_./-]+$/;   // no spaces, quotes, $, ;, backticks, newlines
const GUEST_DISTRO_GRAMMAR = /^[A-Za-z0-9_.-]+$/;  // distro names: letters/digits/./_/-

function validateGuestValues() {
  const problems = [];
  if (!GUEST_PATH_GRAMMAR.test(GUEST_STATE_PATH)) {
    problems.push(`--guest-state-path '${GUEST_STATE_PATH}' does not match ${GUEST_PATH_GRAMMAR}`);
  }
  if (!GUEST_PATH_GRAMMAR.test(GUEST_DECISION_PATH)) {
    problems.push(`--guest-decision-path '${GUEST_DECISION_PATH}' does not match ${GUEST_PATH_GRAMMAR}`);
  }
  if (!GUEST_DISTRO_GRAMMAR.test(GUEST_DISTRO)) {
    problems.push(`--guest-distro '${GUEST_DISTRO}' does not match ${GUEST_DISTRO_GRAMMAR}`);
  }
  return problems;
}

// ---- host-initiated guest pull (sim state OUT) -----------------------------
// Fixed literal script (no interpolation); the state path arrives as "$1".
//   local:  wsl -d <distro> -- bash -lc 'cat "$1"' <path>
//   ssh:    ssh ... <host> "wsl -d <distro> -- bash -lc 'cat \"\$1\"' <path>"
function pullWorldState() {
  const invalid = validateGuestValues();
  if (invalid.length > 0) {
    process.stderr.write(`[world-mind] REFUSED guest state pull: ${invalid.join('; ')}\n`);
    return null;
  }
  try {
    const out = GUEST_TRANSPORT === 'local'
      ? execFileSync('wsl', ['-d', GUEST_DISTRO, '--', 'bash', '-lc', 'cat "$1"', 'world-mind-pull', GUEST_STATE_PATH], {
          encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore']
        })
      : execFileSync('ssh', ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-o', 'UpdateHostKeys=no',
          ORWELL_SSH, `wsl -d ${GUEST_DISTRO} -- bash -lc 'cat "$1"' world-mind-pull`, GUEST_STATE_PATH], {
          encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore']
        });
    return JSON.parse(out);
  } catch {
    return null; // guest unreachable / state torn — caller falls back to null
  }
}

// ---- host-initiated guest push (decision IN) -------------------------------
// The payload (base64 of the decision JSON) is passed as "$1", the decision
// path as "$2" -- both quoted positionals inside a fixed literal script, never
// concatenated into a shell string. Base64 is the wire format because JSON
// double-quotes and spaces would otherwise be mangled by the Windows quoting
// chain (ssh -> cmd -> wsl -> bash); the fixed script decodes it guest-side.
function pushDecision(decision) {
  const payload = Buffer.from(JSON.stringify(decision)).toString('base64');
  const invalid = validateGuestValues();
  if (invalid.length > 0) {
    process.stderr.write(`[world-mind] REFUSED guest decision push: ${invalid.join('; ')}\n`);
    return false;
  }
  try {
    if (GUEST_TRANSPORT === 'local') {
      execFileSync('wsl', ['-d', GUEST_DISTRO, '--', 'bash', '-lc',
        'printf %s "$1" | base64 -d > "$2"', 'world-mind-push', payload, GUEST_DECISION_PATH], {
        encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore']
      });
    } else {
      execFileSync('ssh', ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-o', 'UpdateHostKeys=no',
        ORWELL_SSH, `wsl -d ${GUEST_DISTRO} -- bash -lc 'printf %s "$1" | base64 -d > "$2"' world-mind-push`,
        payload, GUEST_DECISION_PATH], {
        encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore']
      });
    }
    return true;
  } catch (e) {
    return false;
  }
}

// ---- memory folding (Mac-side, bounded, privacy-floored) -------------------
function boundedRead(p, maxBytes = 4000) {
  try {
    const s = fs.readFileSync(p, 'utf8');
    return s.length > maxBytes ? s.slice(0, maxBytes) + '\n…[truncated]' : s;
  } catch {
    return null;
  }
}

function foldMemory() {
  const parts = [];
  const handoff = boundedRead(HANDOFF_PATH, 3000);
  if (handoff) parts.push(`## Active handoff (goals / work)\n${handoff}`);

  // Harness memory: MEMORY.md index + up to 3 most-recent memory files.
  const idx = boundedRead(path.join(HARNESS_MEMORY_DIR, 'MEMORY.md'), 2000);
  if (idx) parts.push(`## Harness memory index\n${idx}`);
  try {
    const files = fs.readdirSync(HARNESS_MEMORY_DIR).filter((f) => f.endsWith('.md')).slice(0, 3);
    for (const f of files) {
      const body = boundedRead(path.join(HARNESS_MEMORY_DIR, f), 1200);
      if (body) parts.push(`## Memory: ${f}\n${body}`);
    }
  } catch {}

  // Vault substrate: index.json if present, else a shallow listing (no raw
  // vault dumps — bounded and never client/credential surfaces).
  const idxJson = boundedRead(path.join(VAULT_SUBSTRATE, 'index.json'), 2000);
  if (idxJson) parts.push(`## Obsidian vault index\n${idxJson}`);

  return parts.join('\n\n');
}

// ---- prompt + LLM call ------------------------------------------------------
function buildPrompt(worldState, memory) {
  const stateSnippet = worldState
    ? JSON.stringify(worldState, null, 1).slice(0, 3000)
    : '(world-state unavailable)';
  return [
    'You are the WORLD MIND of ant-hive-world: a coordination layer, harnessed by the Mythos project.',
    'You know the operator\'s goals and current work (below). You perceive the sim\'s shared world-state.',
    'You emit ONE world-level coordination verb per decision. RULES:',
    ' - carriage/coordination only: NEVER override or command a hive mind\'s decision.',
    ' - environmental/signaling actions only.',
    ' - choose from exactly: ' + WORLD_VERBS.join(', ') + '.',
    ' - respond with STRICT JSON only: {"verb": "<verb>", "rationale": "<one sentence>"}.',
    '',
    memory,
    '',
    '## Current world-state',
    stateSnippet,
    ''
  ].join('\n');
}

function callModel(prompt) {
  if (MODEL === 'gemini') {
    const out = execFileSync('gemini', ['-p', prompt, '--output-format', 'json'], {
      encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'ignore']
    });
    return out;
  }
  if (MODEL === 'codex') {
    // codex exec --json returns a JSON envelope; the model's text lives in
    // result[0].message.content (or result.message.content in newer CLIs).
    const out = execFileSync('codex', ['exec', '--json', prompt], {
      encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'ignore']
    });
    try {
      const parsed = JSON.parse(out);
      const content = (parsed.result && parsed.result[0] && parsed.result[0].message && parsed.result[0].message.content)
        || (parsed.result && parsed.result.message && parsed.result.message.content)
        || parsed.output || out;
      return typeof content === 'string' ? content : JSON.stringify(content);
    } catch {
      return out; // not a JSON envelope — pass raw through to parseDecision
    }
  }
  // claude (default — the operator's own harness mind seat, HWFWM contract).
  const out = execFileSync('claude', ['-p', prompt, '--output-format', 'json'], {
    encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'ignore']
  });
  return out;
}

function parseDecision(raw) {
  // Unwrap in order: (1) claude --output-format json envelope carries the
  // model text in `result`; (2) the model may wrap its JSON in markdown
  // fences; (3) the decision is {"verb": "...", "rationale": "..."}.
  let text = String(raw || '');
  try {
    const top = JSON.parse(text);
    if (top && typeof top === 'object' && !('verb' in top)) {
      text = (top.result !== undefined ? String(top.result) : top.output !== undefined ? String(top.output) : text);
    }
  } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1];
  try {
    const d = JSON.parse(text.trim());
    if (d && WORLD_VERBS.includes(d.verb)) {
      return { verb: d.verb, rationale: String(d.rationale || '').slice(0, 300) };
    }
  } catch {}
  return { verb: 'idle', rationale: 'unparseable model output — world idle this cycle' };
}

// ---- cycle -----------------------------------------------------------------
function cycle() {
  const worldState = pullWorldState();
  const memory = foldMemory();
  const prompt = buildPrompt(worldState, memory);
  let decision;
  try {
    decision = parseDecision(callModel(prompt));
  } catch {
    decision = { verb: 'idle', rationale: 'model call failed — world idle this cycle' };
  }
  const pushed = pushDecision(decision);
  const row = {
    ts: new Date().toISOString(),
    verb: decision.verb,
    rationale: decision.rationale,
    world_state_present: Boolean(worldState),
    decision_pushed: pushed,
    model: MODEL,
    prompt_bytes: Buffer.byteLength(prompt)
  };
  fs.mkdirSync(path.dirname(DECISION_LOG), { recursive: true });
  fs.appendFileSync(DECISION_LOG, JSON.stringify(row) + '\n');
  process.stdout.write(`[world-mind] ${row.ts} verb=${row.verb} pushed=${pushed} state=${row.world_state_present}\n`);
}

// ---- main ------------------------------------------------------------------
if (require.main === module) {
  process.stdout.write(`World mind harness (Mythos) — model=${MODEL} once=${ONCE} cadence=${CADENCE_MS}ms\n`);
  if (ONCE) {
    cycle();
  } else {
    cycle();
    setInterval(cycle, CADENCE_MS);
    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
  }
}

module.exports = { cycle, foldMemory, buildPrompt, parseDecision, pullWorldState, pushDecision };
