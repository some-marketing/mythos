#!/usr/bin/env node
'use strict';

// PostToolUse hook (Write|Edit): auto-bridge dispatch on kernel-class concept landing.
// Concept: _dev/concepts/auto-bridge-on-acceptance-claim.md
// OQ-1 resolution (Codex 2026-04-29): floor = dispatch-bridge to Codex; escalation
// to /convene only when the Codex response flags kernel impact / drift.
//
// Triggers ONLY on writes to _dev/concepts/*.md at top level (NOT subdirectories).
// Fires async via marker file; never blocks the operator turn.
// Suppressed by sentinel file at _dev/state/integrator-pass-active or env
// MYTHOS_NO_AUTO_BRIDGE=1, or per-file frontmatter `auto_bridge: false`.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// env-path-hardening s2: repo root was previously a runtime-cwd fallback that
// a stale/foreign launch silently resurrected old paths through (mkdir-p never
// ENOENTs). Now the ONE canonical source. circuit-breaker during staged
// rollout; promoted to 'hard' after s5 clean-pass on all retrofitted writers.
const { resolveCanonicalRoot } = require('../lib/canonical-root.cjs');
const PROJECT_ROOT = resolveCanonicalRoot({ mode: 'hard' });
const STATE_DIR = path.join(PROJECT_ROOT, '_dev', 'state');
const PENDING_DIR = path.join(STATE_DIR, 'auto-bridge-pending');
const FAILED_DIR = path.join(STATE_DIR, 'auto-bridge-failed');
const SUPPRESS_SENTINEL = path.join(STATE_DIR, 'integrator-pass-active');
const SIGNALS_DIR = path.join(PROJECT_ROOT, '_dev', 'reports', 'signals');

function readStdinSync() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function hasMatchingDispatch(conceptRel) {
  if (!fs.existsSync(SIGNALS_DIR)) return false;
  const signals = fs.readdirSync(SIGNALS_DIR);
  for (const f of signals) {
    if (!f.endsWith('.signal.json')) continue;
    try {
      const sig = JSON.parse(fs.readFileSync(path.join(SIGNALS_DIR, f), 'utf8'));
      if (sig.signal_type !== 'dispatch-bridge') continue;
      // Match by context artifacts (most reliable for concept writes)
      if (Array.isArray(sig.decision_context_artifacts) && sig.decision_context_artifacts.includes(conceptRel)) return true;
      // Match by task/scope naming
      const slug = path.basename(conceptRel, '.md');
      if (sig.scope && sig.scope.includes(slug)) return true;
    } catch { continue; }
  }
  return false;
}

function tryParse(s) { try { return JSON.parse(s); } catch { return null; } }
function extractFilePath(p) {
  if (!p || typeof p !== 'object') return '';
  if (p.tool_input && p.tool_input.file_path) return String(p.tool_input.file_path);
  if (p.file_path) return String(p.file_path);
  return '';
}

function resolveFilePath(payload) {
  const fromStdin = extractFilePath(payload || tryParse(readStdinSync()));
  const fromEnv = extractFilePath(tryParse(process.env.CLAUDE_TOOL_INPUT || ''));
  const f = fromStdin || fromEnv;
  if (!f) return '';
  return path.isAbsolute(f) ? f : path.resolve(PROJECT_ROOT, f);
}

function isTopLevelConcept(absPath) {
  const rel = path.relative(PROJECT_ROOT, absPath);
  // Match top-level _dev/concepts/*.md OR _dev/drafts/skill-proposals/*.md
  const m = rel.match(/^(_dev\/concepts\/[^/]+\.md|_dev\/drafts\/skill-proposals\/[^/]+\.md)$/);
  if (!m) return false;
  // Skip integrator artifacts (settings patches, README, etc.).
  const name = path.basename(rel, '.md');
  if (name.startsWith('__') || name === '_README') return false;
  return true;
}

function isKernelClass(content) {
  // Trigger conditions per concept doc:
  // - Triadic form: yes
  // - ## Falsifiable test (or "Falsifiable" header)
  // - 2+ Composes with: lines
  // - Epistemic mode: declared
  if (/^\s*\*\*Triadic form:\*\*\s*yes/im.test(content)) return true;
  if (/^##+\s*Falsifiable/im.test(content)) return true;
  if (/^\s*\*\*Epistemic mode:\*\*/im.test(content)) return true;
  const composesCount = (content.match(/^\s*\*\*Composes with:\*\*/gim) || []).length;
  if (composesCount >= 2) return true;
  return false;
}

function resolveDispatchTarget(content) {
  // OQ-1 decision (2026-04-29) was floor=codex.
  // Bridge-First Observer Synthesis (2026-05-21) adds gemini for topological breadth.
  if (/^\s*\*\*Triadic form:\*\*\s*yes/im.test(content)) return 'gemini';
  if (/^\s*\*\*Epistemic mode:\*\*/im.test(content)) return 'gemini';
  return 'codex';
}

function isSuppressed(content) {
  if (process.env.MYTHOS_NO_AUTO_BRIDGE === '1') return 'env';
  if (fs.existsSync(SUPPRESS_SENTINEL)) return 'sentinel';
  if (/^\s*auto_bridge:\s*false/im.test(content)) return 'frontmatter';
  return null;
}

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

function writePendingMarker(conceptRel, slug, target) {
  ensureDir(PENDING_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const markerPath = path.join(PENDING_DIR, `${ts}__${slug}.json`);
  const tmp = markerPath + '.tmp';
  const payload = {
    schema: 'AutoBridgePending/1.0',
    timestamp: new Date().toISOString(),
    concept_path: conceptRel,
    target,
    command: '/dispatch-bridge',
    floor_or_escalation: 'floor',
    notes: 'OQ-1 resolved 2026-04-29: floor=dispatch-bridge, escalate to /convene on flagged drift'
  };
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, markerPath);
  return markerPath;
}

function dispatchAsync(conceptAbs, conceptRel, target) {
  // Detached async dispatch — never blocks the operator turn.
  const runner = path.join(PROJECT_ROOT, 'tools', 'signals', 'dispatch-bridge.js');
  if (!fs.existsSync(runner)) return { ok: false, reason: 'dispatch-bridge runner missing' };
  const args = [
    runner,
    '--target', target,
    '--task', `Auto-bridge review of kernel-class concept ${conceptRel}`,
    '--command', '/review-source-material',
    '--source', 'auto-bridge-hook',
    '--context', conceptRel,
    '--scope', `auto-bridge-${path.basename(conceptRel, '.md')}`
  ];
  try {
    const child = spawn('node', args, {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return { ok: true, pid: child.pid };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

function writeFailureMarker(conceptRel, reason) {
  ensureDir(FAILED_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = path.basename(conceptRel, '.md');
  const p = path.join(FAILED_DIR, `${ts}__${slug}.json`);
  fs.writeFileSync(p, JSON.stringify({
    schema: 'AutoBridgeFailed/1.0',
    timestamp: new Date().toISOString(),
    concept_path: conceptRel,
    reason
  }, null, 2));
  return p;
}

function main(payload) {
  const filePath = resolveFilePath(payload);
  if (!filePath || !isTopLevelConcept(filePath)) return;
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); }
  catch { return; }
  if (!isKernelClass(content)) return;
  const suppress = isSuppressed(content);
  if (suppress) {
    process.stdout.write(`auto-bridge: suppressed (${suppress}) for ${path.relative(PROJECT_ROOT, filePath)}\n`);
    return;
  }
  const conceptRel = path.relative(PROJECT_ROOT, filePath);
  if (hasMatchingDispatch(conceptRel)) {
    process.stdout.write(`auto-bridge: suppressed (existing-dispatch) for ${conceptRel}\n`);
    return;
  }
  const slug = path.basename(conceptRel, '.md');
  const target = resolveDispatchTarget(content);
  try {
    const marker = writePendingMarker(conceptRel, slug, target);
    const dispatch = dispatchAsync(filePath, conceptRel, target);
    if (dispatch.ok) {
      process.stdout.write(`auto-bridge: dispatched ${target} review of ${conceptRel} (pid ${dispatch.pid}, marker ${path.relative(PROJECT_ROOT, marker)})\n`);
    } else {
      writeFailureMarker(conceptRel, dispatch.reason);
      process.stdout.write(`auto-bridge: dispatch failed for ${conceptRel} — ${dispatch.reason} (failure marker written)\n`);
    }
  } catch (err) {
    writeFailureMarker(conceptRel, String(err));
    process.stdout.write(`auto-bridge: hook error for ${conceptRel} — ${err}\n`);
  }
}

module.exports = {
  dispatchAsync,
  extractFilePath,
  hasMatchingDispatch,
  isKernelClass,
  isSuppressed,
  isTopLevelConcept,
  main,
  resolveDispatchTarget,
  resolveFilePath,
  tryParse,
  writeFailureMarker,
  writePendingMarker
};

if (require.main === module) {
  main();
}
