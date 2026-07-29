'use strict';
// Node-side wrapper around the JXA scripts. Shells to `osascript -l JavaScript`,
// passing structured input via temp files and parsing JSON from stdout.
//
// Reminders is slow / can time out on cold start (AppleEvent -1712), so reads
// and applies are retried with a generous timeout.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const JXA_DIR = path.join(__dirname, '..', 'jxa');
const OSA_TIMEOUT_MS = 180000;

function runJxa(scriptName, args = [], { retries = 2 } = {}) {
  const script = path.join(JXA_DIR, scriptName);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const out = execFileSync('osascript', ['-l', 'JavaScript', script, ...args], {
        timeout: OSA_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        encoding: 'utf8',
      });
      return out.trim();
    } catch (e) {
      lastErr = e;
      // -1712 = AppleEvent timed out; retry after a brief warm-up pause.
      const msg = (e.stderr || e.message || '').toString();
      if (attempt < retries && /-1712|timed out|Application isn't running/i.test(msg)) {
        try { execFileSync('osascript', ['-e', 'tell application "Reminders" to launch'], { timeout: 30000 }); } catch (_) {}
        continue;
      }
      throw new Error(`osascript ${scriptName} failed: ${msg}`);
    }
  }
  throw lastErr;
}

function writeTemp(prefix, content) {
  const p = path.join(os.tmpdir(), `${prefix}-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  fs.writeFileSync(p, content);
  return p;
}

/** Read all reminders in lists matching the configured prefix. */
function readReminders(listPrefix) {
  const out = runJxa('reminders-read.js', [listPrefix]);
  return out ? JSON.parse(out) : [];
}

const APPLY_CHUNK = 20;

function applyChunk(ops) {
  const file = writeTemp('apple-sync-ops', JSON.stringify({ ops }));
  try {
    // retries:0 — write ops must never double-fire (a retry after a partial
    // timeout would re-create reminders). Chunks are small enough that a single
    // attempt comfortably fits the timeout.
    const out = runJxa('reminders-apply.js', [file], { retries: 0 });
    return out ? JSON.parse(out) : { created: {}, applied: 0, errors: [] };
  } catch (e) {
    // A slow/timed-out chunk must not abort the whole run. Whatever it created
    // before dying is recovered on the next run via dartId-body adoption.
    return { created: {}, applied: 0, errors: [{ op: 'chunk', detail: String(e.message || e) }] };
  } finally {
    try { fs.unlinkSync(file); } catch (_) {}
  }
}

/**
 * Apply reminder ops. ensureList ops run first (one call), then the remaining
 * create/update/complete ops run in small chunks so no single osascript call
 * runs long enough to risk a timeout mid-batch.
 * Returns {created:{tempId:id}, applied, errors}.
 */
function applyReminderOps(ops) {
  if (!ops.length) return { created: {}, applied: 0, errors: [] };
  const merged = { created: {}, applied: 0, errors: [] };

  const ensures = ops.filter((o) => o.op === 'ensureList');
  const rest = ops.filter((o) => o.op !== 'ensureList');

  if (ensures.length) {
    const r = applyChunk(ensures);
    merged.applied += r.applied || 0;
    if (r.errors) merged.errors.push(...r.errors);
  }
  for (let i = 0; i < rest.length; i += APPLY_CHUNK) {
    const r = applyChunk(rest.slice(i, i + APPLY_CHUNK));
    Object.assign(merged.created, r.created || {});
    merged.applied += r.applied || 0;
    if (r.errors) merged.errors.push(...r.errors);
  }
  return merged;
}

/** Upsert the digest note. */
function upsertNote(title, bodyHtml, folder) {
  const file = writeTemp('apple-sync-note', bodyHtml);
  try {
    const args = [title, file];
    if (folder) args.push(folder);
    const out = runJxa('note-upsert.js', args);
    return out ? JSON.parse(out) : { action: 'unknown', title };
  } finally {
    try { fs.unlinkSync(file); } catch (_) {}
  }
}

module.exports = { readReminders, applyReminderOps, upsertNote, runJxa };
