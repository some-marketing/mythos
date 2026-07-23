#!/usr/bin/env node
'use strict';

/**
 * once-per-session.cjs — session-scoped guardrail-emission dedupe.
 *
 * PURPOSE
 *   Reminder-class hooks (debrief-on-commit, subagent no-spawn, plan-mode notice,
 *   framework-manifest notice) re-emitted identical text on every trigger.
 *   Repeated identical injections teach the model to skim ALL injections
 *   (alarm fatigue — finding F3 of the fable-process-tier audit). Each reminder
 *   should carry its instruction once per session and stay silent after.
 *
 *   Does NOT apply to the dangerous-command detector: each of those firings is
 *   a distinct event that must stay visible.
 *
 * HARD INVARIANT — FAIL OPEN
 *   A broken dedupe must never suppress a guardrail. Any error path returns
 *   true ("emit"). Convene 20260610T161625Z authorized this fast-lane on the
 *   fail-open condition.
 *
 * I/O CONTRACT
 *   shouldEmit(sessionId, key) -> boolean
 *     true  — first time this (sessionId, key) pair is seen; caller emits.
 *     false — already emitted this session; caller stays silent.
 *   State: _dev/state/hook-emissions/<sessionId>.json (swept by /clean-house).
 *
 * Stdlib-only.
 */

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.resolve(__dirname, '../../../../_dev/state/hook-emissions');

function shouldEmit(sessionId, key) {
  try {
    if (!sessionId || !key) return true;
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const file = path.join(STATE_DIR, `${String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
    let seen = {};
    if (fs.existsSync(file)) {
      try { seen = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { seen = {}; }
    }
    if (seen[key]) return false;
    seen[key] = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(seen));
    return true;
  } catch {
    return true; // fail open — a broken dedupe must never suppress a guardrail
  }
}

module.exports = { shouldEmit, STATE_DIR };
