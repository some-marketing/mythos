#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/lore-engine/generate-entry.js — turns a ROUTINE-tier
// trigger (from detect-triggers.js) into a wiki-log entry by dispatching a
// short generation prompt to a local model. Milestone-tier triggers are NOT
// handled here -- unattended frontier-model dispatch is deliberately out of
// scope; the watcher queues those separately for manual/attended narration.
//
// `dispatchFn` is injectable so this module is unit-testable without a real
// model call -- the default dispatch (a local Ollama instance, same pattern
// as llm-decide.js) is used only when this runs for real via watch.js.

const { spawnSync } = require('child_process');

const DEFAULT_ROLLING_CONTEXT_SIZE = 5; // last N of the SAME hive's own entries
const DEFAULT_OLLAMA_URL = process.env.LORE_ENGINE_OLLAMA_URL || 'http://localhost:11434/api/chat';
const DEFAULT_MODEL = process.env.LORE_ENGINE_MODEL || 'deepseek-r1:14b';

function buildPrompt(trigger, recentEntries) {
  const contextBlock = (recentEntries || [])
    .slice(-DEFAULT_ROLLING_CONTEXT_SIZE)
    .map((e) => `- (${e.entry_type}/${e.subject}) ${e.narrative_text}`)
    .join('\n') || '(no prior entries yet for this hive)';

  return [
    'You are writing a short in-world lore entry (2-4 sentences, no meta-commentary, no markdown headers) for an ant colony simulation\'s browsable wiki.',
    'Stay grounded in the stated fact below -- do not invent contradicting facts, and do not repeat the prior entries verbatim.',
    '',
    `Colony: ${trigger.hive}`,
    `Event type: ${trigger.entry_type}`,
    `Subject: ${trigger.subject}`,
    '',
    'This colony\'s recent recorded history (for consistency, do not contradict):',
    contextBlock,
    '',
    'Write the new entry now, in-world voice, present tense, as if a colony chronicler recorded it:'
  ].join('\n');
}

// Real dispatch: a plain local Ollama chat call (curl over localhost, no
// network dependency beyond that), mirroring the pattern used by
// llm-decide.js elsewhere in this project. Returns { verdict, response,
// model } / { verdict: 'error'|'timeout', error }.
function dispatchViaLocalOllama(promptText, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const url = opts.ollamaUrl || DEFAULT_OLLAMA_URL;
  const payload = JSON.stringify({
    model,
    messages: [{ role: 'user', content: promptText }],
    stream: false,
    options: { temperature: 0.7, num_predict: 300 }
  });
  const result = spawnSync('curl', ['-s', url, '-d', payload], {
    encoding: 'utf-8',
    timeout: opts.timeoutMs ?? 60000,
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.error) {
    return { verdict: result.error.code === 'ETIMEDOUT' ? 'timeout' : 'error', error: result.error.message };
  }
  if (result.status !== 0) {
    return { verdict: 'error', error: `curl exited ${result.status}: ${result.stderr}` };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    const content = (parsed.message && parsed.message.content) || '';
    return { verdict: 'ok', response: content, model };
  } catch (e) {
    return { verdict: 'error', error: `parse_failed: ${e.message}` };
  }
}

// Basic output sanitization -- never trust the model's raw text blindly:
// strip markdown headers/code fences it might add despite the prompt, cap
// length so one bad response cannot bloat the wiki log unboundedly, and
// reject empty/whitespace-only responses as failures rather than writing
// an empty entry.
const MAX_ENTRY_LENGTH = 1200;

function sanitizeNarrativeText(raw) {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  text = text.replace(/^#+\s.*$/gm, '').replace(/```[\s\S]*?```/g, '').trim();
  if (!text) return null;
  if (text.length > MAX_ENTRY_LENGTH) text = text.slice(0, MAX_ENTRY_LENGTH).trim() + '…';
  return text;
}

// trigger: a ROUTINE-tier trigger from detect-triggers.js.
// recentEntries: this hive's own last-N wiki-log entries (already loaded
// by the caller -- this module has no file I/O for the wiki log itself).
function generateEntry(trigger, { recentEntries = [], dispatchFn = dispatchViaLocalOllama, model, timeoutMs } = {}) {
  if (trigger.tier !== 'routine') {
    return { ok: false, error: `generate-entry.js only handles routine-tier triggers, got tier=${trigger.tier}` };
  }
  const prompt = buildPrompt(trigger, recentEntries);
  let dispatchResult;
  try {
    dispatchResult = dispatchFn(prompt, { model, timeoutMs });
  } catch (e) {
    return { ok: false, error: `dispatch threw: ${e.message}`, trigger };
  }
  if (!dispatchResult || dispatchResult.verdict !== 'ok') {
    return { ok: false, error: dispatchResult?.error || `dispatch verdict: ${dispatchResult?.verdict}`, trigger };
  }
  const narrativeText = sanitizeNarrativeText(dispatchResult.response);
  if (!narrativeText) {
    return { ok: false, error: 'model returned empty/unusable text after sanitization', trigger };
  }
  return {
    ok: true,
    entry: {
      ts: new Date().toISOString(),
      hive: trigger.hive,
      entry_type: trigger.entry_type,
      subject: trigger.subject,
      narrative_text: narrativeText,
      tier: trigger.tier,
      source_event: trigger.source_event,
      model: dispatchResult.model || model || null
    }
  };
}

module.exports = {
  buildPrompt,
  sanitizeNarrativeText,
  dispatchViaLocalOllama,
  generateEntry,
  DEFAULT_ROLLING_CONTEXT_SIZE,
  MAX_ENTRY_LENGTH
};
