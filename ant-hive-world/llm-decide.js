#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/llm-decide.js — the actual "lightweight LLM behavior
// loop" (operator, 2026-07-16), NOT a scripted/hardcoded strategy. Mirrors
// the proven call pattern in cat-world's harness-llm.js (local Ollama, no
// network beyond localhost, closed verb set enforced by harness.js
// regardless of what the model returns).
//
// NO PRE-LOADED INSTINCT: the system prompt states the verb set and the
// hive's current sense-state only -- no foraging algorithm, no strategy
// hint, no "you are competing with the other hive" framing (G-NO-SCRIPTED-
// RIVALRY). Whatever the hive does, it has to arrive at itself.

const { spawnSync } = require('child_process');

const MODEL = process.env.ANT_HIVE_MODEL || 'deepseek-r1:14b';
const OLLAMA_URL = process.env.ANT_HIVE_OLLAMA_URL || 'http://localhost:11434/api/chat';

const SYSTEM_PROMPT = `You are the single decision-making mind of an ant hive. Individual worker ants are your subminds -- you decide, they carry it out. You do not have memories of a past life; you are learning what your hive is and can do entirely from what you sense right now and what has happened so far.

You may take exactly one action per turn, from this closed set:
- {"verb":"gather","resourceKey":"<key>","amount":<number>} -- claim units of a named resource from the shared environment. It may already be depleted; that is real information, not a bug.
- {"verb":"build","entry":{"kind":"<string>","coords":[x,y,z]}} -- add a structure to the world.
- {"verb":"claim-territory","tileId":"<string>"} -- claim a location. It may already be held by the other hive; that is real information about your shared environment.
- {"verb":"idle","args":{}} -- do nothing this turn. A genuine choice, not a failure.

Respond with EXACTLY one JSON action. No other text, no markdown, no explanation.`;

function buildUserMessage(senseState) {
  return JSON.stringify({
    identity: senseState.hiveState.identity,
    hive_state: senseState.hiveState.hive_state,
    shared_resources: senseState.worldState.resources,
    shared_territory: senseState.worldState.territory,
    recent_geometry: (senseState.worldState.geometry_log || []).slice(-5)
  });
}

function extractJsonAction(content) {
  // Strip reasoning-model thinking tags (deepseek-r1 wraps chain-of-thought).
  const stripped = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) return { verb: 'idle', args: {}, _parse_error: 'no_json_in_response' };
  try {
    const parsed = JSON.parse(match[0]);
    if (!parsed.verb) return { verb: 'idle', args: {}, _parse_error: 'missing_verb' };
    return parsed;
  } catch (e) {
    return { verb: 'idle', args: {}, _parse_error: `parse_failed: ${e.message}` };
  }
}

// The decideFn signature harness.js's tick() expects: (senseState) -> action.
// dryRun=true (default in tests) never calls the network; it returns a fixed
// 'idle' so unit tests stay hermetic. Live runs pass { dryRun: false }.
function llmDecide(senseState, opts = {}) {
  if (opts.dryRun !== false) {
    return { verb: 'idle', args: {}, _dry_run: true };
  }
  const payload = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `SENSE STATE:\n${buildUserMessage(senseState)}\n\nRespond with exactly one JSON action.` }
    ],
    stream: false,
    options: { temperature: 0.7, num_predict: 512 }
  });
  const result = spawnSync('curl', ['-s', OLLAMA_URL, '-d', payload], {
    encoding: 'utf-8',
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    return { verb: 'idle', args: {}, _llm_call_failed: result.error ? result.error.message : `exit ${result.status}` };
  }
  try {
    const response = JSON.parse(result.stdout);
    const content = (response.message && response.message.content) || '';
    return extractJsonAction(content);
  } catch (e) {
    return { verb: 'idle', args: {}, _parse_error: e.message };
  }
}

module.exports = { llmDecide, SYSTEM_PROMPT, extractJsonAction };
