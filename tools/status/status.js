#!/usr/bin/env node
'use strict';

/**
 * status.js — Consolidated operator status surface (SCAFFOLD).
 *
 * Rebuilt from scratch over ONLY the surfaces actually shipped in this repo:
 * the signals lane (tools/signals/signal-lane.cjs) and the closeout stub
 * (tools/maintenance/end-session-closeout.js), plus a plain filesystem
 * inventory (frameworks, commands). The source this was ported from
 * aggregated across many more private systems (a decision-tree next-step
 * resolver, a task-plan resolver, a maintenance-topology scout, a harness-
 * capability dashboard, a Dart integration, and a hardcoded read of one real
 * client's live-ads tracker) — none of those exist here, so rather than ship
 * a status tool with broken imports and a client-code path baked in, this is
 * a genuine rewrite: small, honest, and it only claims what it can verify.
 *
 * Usage:
 *   node tools/status/status.js [--json]
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

const { listSignals } = require('../signals/signal-lane.cjs');
const { buildCloseout } = require('../maintenance/end-session-closeout.js');

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function countFiles(dirPath, predicate = () => true) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .filter((entry) => predicate(entry.name))
      .length;
  } catch {
    return 0;
  }
}

function countDirs(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .length;
  } catch {
    return 0;
  }
}

// ── Section: Live signals ──

function getLiveSignalSummary(projectRoot = PROJECT_ROOT) {
  const entries = listSignals({ root: projectRoot });
  return entries.map((e) => ({
    file: e.filename,
    schema: e.signal.schema || null,
    scope: e.signal.scope || e.signal.signal_scope || null,
    lifecycle_state: e.signal.lifecycle_state || null
  }));
}

// ── Section: Bridge activity ──

// Bridge targets this repo can dispatch to, with the binary that powers each.
// `binary` is a command name (resolved via PATH); `credentialEnv` is the env
// var the bridge needs when its binary requires one. Absence of either marks
// the lane unavailable — this is availability, not "active".
const BRIDGE_TARGETS = Object.freeze([
  { actor: 'codex', binary: 'codex', credentialEnv: null },
  { actor: 'gemini', binary: 'gemini', credentialEnv: 'GEMINI_API_KEY', opItem: 'sm_os-gemini-credential' },
  { actor: 'claude', binary: 'claude', credentialEnv: null },
  { actor: 'openrouter', binary: null, credentialEnv: 'OPENROUTER_API_KEY' }
]);

function resolveCredentialPresent(target) {
  if (!target.credentialEnv) return true;
  if (process.env[target.credentialEnv]) return true;
  if (target.opItem) {
    try {
      const { execSync } = require('child_process');
      execSync(`op item get ${JSON.stringify(target.opItem)} --fields label=credential`, {
        encoding: 'utf8', timeout: 3000, stdio: 'ignore'
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function resolveBinary(command) {
  if (!command) return null;
  try {
    const { execSync } = require('child_process');
    return execSync(`command -v ${command}`, { encoding: 'utf8', timeout: 3000 }).trim() || null;
  } catch {
    return null;
  }
}

function getBridgeSummary(projectRoot = PROJECT_ROOT) {
  const entries = listSignals({ root: projectRoot });
  // Live signals that are bridge-targeted: dispatch-bridge signals carry the
  // actor they were sent to; ready-for-review signals name their next actor.
  const perActor = new Map();
  for (const e of entries) {
    const actor = e.signal && (e.signal.recommended_next_actor || e.signal.actor);
    if (!actor) continue;
    const slot = perActor.get(actor) || { live: 0, scopes: [] };
    slot.live += 1;
    if (slot.scopes.length < 5) slot.scopes.push(e.signal.scope || e.signal.signal_scope || e.filename);
    perActor.set(actor, slot);
  }

  return BRIDGE_TARGETS.map((t) => ({
    actor: t.actor,
    binary: resolveBinary(t.binary),
    credential: resolveCredentialPresent(t),
    live: perActor.get(t.actor) ? perActor.get(t.actor).live : 0,
    scopes: perActor.get(t.actor) ? perActor.get(t.actor).scopes : []
  }));
}

// ── Section: Closeout readiness ──

function getCloseoutSummary(projectRoot = PROJECT_ROOT) {
  try {
    return buildCloseout(projectRoot, 'system');
  } catch (err) {
    return { available: false, error: err.message };
  }
}

// ── Section: System inventory ──

function getSystemInventory(projectRoot = PROJECT_ROOT) {
  const frameworksDir = path.join(projectRoot, 'frameworks');
  const commandsDir = path.join(projectRoot, '.claude', 'commands');
  const skillsDir = path.join(projectRoot, '.claude', 'skills');

  // "Framework count" here means service-category directories under
  // frameworks/ (e.g. homebrew/) -- a plain filesystem count, not a parse of
  // a canonical system inventory file, since that file's shape is specific
  // to whatever your own repo's instructions layer declares.
  return {
    framework_categories: countDirs(frameworksDir),
    commands: countFiles(commandsDir, (name) => name.endsWith('.md')),
    skills: countDirs(skillsDir)
  };
}

// ── Aggregate ──

function buildStatus(projectRoot = PROJECT_ROOT) {
  return {
    schema: 'MythosStatusSnapshot/1.0',
    timestamp: new Date().toISOString(),
    live_signals: getLiveSignalSummary(projectRoot),
    bridges: getBridgeSummary(projectRoot),
    closeout: getCloseoutSummary(projectRoot),
    inventory: getSystemInventory(projectRoot)
  };
}

// ── Output ──

function formatText(status) {
  const lines = [];
  lines.push('Mythos System Status');
  lines.push('=====================\n');

  lines.push(`Timestamp: ${status.timestamp}`);
  lines.push('');

  if (status.live_signals.length > 0) {
    lines.push(`Live signals (${status.live_signals.length}):`);
    for (const s of status.live_signals) {
      lines.push(`  [${s.schema || 'unknown-schema'}] ${s.scope || '(no scope)'} — ${s.file}`);
    }
  } else {
    lines.push('Live signals: none');
  }
  lines.push('');

  // Bridges — what's live and what's available
  const bridges = status.bridges || [];
  lines.push(`Bridges (${bridges.filter((b) => b.live > 0).length} active / ${bridges.filter((b) => b.binary && b.credential).length} available):`);
  if (bridges.length === 0) {
    lines.push('  (none)');
  } else {
    for (const b of bridges) {
      const avail = b.binary && b.credential ? 'avail' : (b.binary ? 'no-cred' : 'no-bin');
      const active = b.live > 0 ? `LIVE(${b.live})` : 'idle';
      const scopes = b.scopes.length > 0 ? ` — ${b.scopes.join(', ')}` : '';
      lines.push(`  [${avail}] ${b.actor}: ${active}${scopes}`);
    }
  }
  lines.push('');

  const c = status.closeout;
  if (c && c.schema) {
    lines.push(`Closeout readiness: ${c.ready_for_clear ? 'READY' : 'BLOCKED'}`);
    if (c.blockers && c.blockers.length > 0) {
      for (const b of c.blockers) {
        lines.push(`  [blocked] ${b.id}: ${b.basis}`);
      }
    }
  } else {
    lines.push(`Closeout readiness: unavailable${c && c.error ? ` (${c.error})` : ''}`);
  }
  lines.push('');

  const inv = status.inventory;
  lines.push(`Inventory: ${inv.framework_categories} framework categor${inv.framework_categories === 1 ? 'y' : 'ies'}, ${inv.commands} commands, ${inv.skills} skills`);

  return lines.join('\n');
}

// ── Main ──

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node tools/status/status.js [--json] [--help]

Consolidated operator status over shipped surfaces only: live signals,
closeout readiness, and a plain system inventory.

Options:
  --json   Output structured JSON
  --help   Show this help`);
    process.exit(0);
  }

  const status = buildStatus();

  if (args.includes('--json')) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log(formatText(status));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildStatus,
  formatText,
  getLiveSignalSummary,
  getBridgeSummary,
  getCloseoutSummary,
  getSystemInventory
};
