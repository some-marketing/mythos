#!/usr/bin/env node
'use strict';
// UserPromptSubmit hook — inject the OWL altitude-check framing on free-text prompts.
//
// ENFORCEMENT_FAMILY: quality-process
//   (tier-s2a-safety-family-lint — tier-consuming quality/process scaffolding,
//   never a safety gate.)
//
// tier-s2b-injection-consumers (tier-enforcement-implementation slice 2,
// convene 20260611T130035Z conditions 4 + 5): WIRED GLOBALLY via
// dispatch-userprompt.cjs but TIER-GATED through the ProcessTierRule/1.1
// add_registry — the framing fires ONLY for sessions carrying the
// `owl-altitude-injection` add (resolved LIVE by readSessionAdds; scaffold
// tier today), and is inert for every other session (frontier, associate,
// unstamped sessions, prompt-only harnesses). This supersedes the 2026-06-10
// UNWIRED decision: the per-prompt ceremony objection applied to frontier
// coordinators, and the add gate now scopes the injection to the scaffold
// exoskeleton the rule prescribes. Adds are productive scaffolding, not
// punishment: ceremony as exoskeleton.
//
// Kill switch (bypass_policy, operator authority):
//   _dev/state/kill-switches/owl-altitude-injection.off
//
// Purpose: realize "delegate by default" without over-orchestrating trivial asks.
// On every typed prompt, prepend a short standing instruction that makes the
// coordinator run Observe -> Weigh -> Loop before acting, and route by altitude
// (trivial -> answer directly; bounded -> single worker; novel -> read-only best-of-N).
//
// Skips: empty prompts and explicit slash commands (prompt starts with "/"),
// which already carry their own routing/authority.
//
// Reversible: remove the noticeForPayload call in dispatch-userprompt.cjs, or
// drop the kill-switch file. The script is inert for sessions without the add.
//
// Stdin (CLI mode): UserPromptSubmit JSON payload ({ prompt, session_id, ... }).
// Stdout: framing text, which the harness adds to the model's context.

const fs = require('fs');
const path = require('path');
const { readSessionAdds } = require('./lib/process-tier.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const ADD_ID = 'owl-altitude-injection';

const FRAMING = [
  'OWL ALTITUDE CHECK (auto-injected; orchestrate-loop discipline — advisory framing, not a new authority):',
  'Before acting, run Observe -> Weigh -> Loop.',
  '- Observe: what is the current state (durable artifacts, not assumed memory)?',
  '- Weigh: classify the work and pick altitude —',
  '    TRIVIAL (one safe step / conversational / a fact you can read) -> answer or route directly; do NOT orchestrate.',
  '    BOUNDED (a known, scoped job) -> delegate to a single worker subagent; the coordinator is not the default worker.',
  '    NOVEL (open, multiple viable approaches) -> consider a read-only best-of-N pool with a SEPARATE judge (no acceptance_criteria -> no fanout).',
  '- Loop: route through the matching native Mythos command/skill; preserve coordinator/worker/reviewer boundaries and existing gates.',
  'Keep the fast path fast: delegate by default ONLY when work is bounded or novel. A worker/branch must pay rent (expected_rework_avoided > cost).',
  'Reference: _dev/concepts/speculative-worker-pool.md , memory feedback_best-of-n-topology-mirror-law.',
  'DISPATCH ROUTING (advisory; instructions/canonical/dispatch-routing-rule.yaml):',
  '- Disclose the mind at EVERY dispatch ("haiku — mechanical", "codex GPT-5.5 — distinct review"); same-model subagents are parallel contexts, not distinct intelligence.',
  '- Tier by altitude: mechanical/recon -> haiku/local; bounded judgment -> sonnet; genuine reasoning/synthesis/IN-FLIGHT-judgment mutations -> frontier. Pre-staged operator-decided script-verifiable mutations tier DOWN (target: no LLM). Artifact-verifiable output lowers tier.',
  '- Route across harnesses (codex, gemini, openrouter, opencode, opencode-local per tools/signals/lib/target-command-policy.cjs); credential-adjacent prefers opencode-local. Ask: cheapest mind this lane\'s verification can hold accountable?'
].join('\n');

function killSwitchPath(add) {
  const rel = (add && add.bypass_policy && add.bypass_policy.kill_switch) ||
    `_dev/state/kill-switches/${ADD_ID}.off`;
  return path.isAbsolute(rel) ? rel : path.join(PROJECT_ROOT, rel);
}

// Returns the framing for sessions carrying the owl-altitude-injection add on
// a free-text prompt; '' otherwise. Never throws (fail-inert).
function noticeForPayload(payload, opts = {}) {
  try {
    const prompt = String((payload && payload.prompt) || '').trim();
    // Explicit slash commands and empty prompts pass through untouched.
    if (!prompt || prompt.startsWith('/')) return '';
    const adds = readSessionAdds(payload && payload.session_id, opts);
    const add = adds.find((a) => a && a.id === ADD_ID);
    if (!add) return ''; // inert: session does not carry the add
    if (fs.existsSync(killSwitchPath(add))) return ''; // operator kill-switch
    return FRAMING;
  } catch {
    return ''; // a broken injection must never degrade the prompt
  }
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

function main() {
  let payload = {};
  try { payload = JSON.parse(readStdin() || '{}'); } catch (_) { payload = {}; }
  const notice = noticeForPayload(payload);
  if (notice) process.stdout.write(notice);
}

module.exports = { ADD_ID, FRAMING, noticeForPayload };

if (require.main === module) {
  try {
    main();
  } catch (_) {
    // never break the turn
  }
  process.exit(0);
}
