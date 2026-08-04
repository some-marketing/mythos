#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/lore-engine/generate-entry.js — plan
// ant-hive-world-lore-wiki-layer, S1. Turns a ROUTINE-tier trigger (from
// detect-triggers.js) into a wiki-log entry by dispatching to Orwell's
// Ollama via tools/fleet/orwell-submind.js (S0 axis 2 decision). Milestone-
// tier triggers are NOT handled here -- see the S0 memo's explicit note
// that unattended frontier-model dispatch is out of this plan's scope;
// the watcher queues those separately for manual/attended resolution.
//
// `dispatchFn` is injectable so this module is unit-testable without a
// real SSH round-trip to Orwell; the real dispatch (spawning
// orwell-submind.js as a CLI child process, since it has no importable JS
// API) is the default, used only when this runs for real via watch.js.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_ROLLING_CONTEXT_SIZE = 5; // S0 axis 3: last N of the SAME hive's own entries

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

// Real dispatch: writes the prompt to a scratch file and shells out to the
// existing, proven orwell-submind.js CLI (no importable API -- confirmed in
// the S0 memo). Returns the same { verdict, response, ... } shape that tool
// emits.
function dispatchViaOrwellSubmind(promptText, opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-engine-'));
  const taskFile = path.join(tmpDir, 'prompt.txt');
  const outFile = path.join(tmpDir, 'result.json');
  fs.writeFileSync(taskFile, promptText, 'utf8');
  try {
    const args = [
      path.join(REPO_ROOT, 'tools', 'fleet', 'orwell-submind.js'),
      'dispatch',
      '--task-file', taskFile,
      '--out', outFile,
      '--timeout-ms', String(opts.timeoutMs ?? 60000)
    ];
    if (opts.model) args.push('--model', opts.model);
    const result = spawnSync('node', args, { encoding: 'utf8' });
    if (result.status !== 0 && !fs.existsSync(outFile)) {
      return { verdict: 'error', error: result.stderr || 'orwell-submind.js dispatch failed with no output' };
    }
    return JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
function generateEntry(trigger, { recentEntries = [], dispatchFn = dispatchViaOrwellSubmind, model, timeoutMs } = {}) {
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
  dispatchViaOrwellSubmind,
  generateEntry,
  DEFAULT_ROLLING_CONTEXT_SIZE,
  MAX_ENTRY_LENGTH
};
