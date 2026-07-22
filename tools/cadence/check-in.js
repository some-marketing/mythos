#!/usr/bin/env node
'use strict';

/**
 * check-in.js — Cadence slice renderer (READ-ONLY).
 *
 * This is guildmaster-loop (gm) — the generic orchestrate-loop — on a clock.
 * The operator runs three check-ins/day (morning/afternoon/night); at each
 * slice the coordinator advances ONE leaf per active domain via one familiar
 * (subagent) each — or records its honest state. This renderer prints the
 * per-slice grid so the coordinator does not re-brief each slice. It NEVER
 * dispatches agents and NEVER mutates state — dispatch stays native, this
 * only renders.
 *
 * State sources (read-only):
 *   _dev/state/cadence/domain-registry.json — the domains
 *   _dev/state/cadence/current-leaf.json     — one active leaf per domain
 *
 * Usage:
 *   node tools/cadence/check-in.js [--json] [--help]
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

const REGISTRY_PATH = path.join(PROJECT_ROOT, '_dev', 'state', 'cadence', 'domain-registry.json');
const LEAF_PATH = path.join(PROJECT_ROOT, '_dev', 'state', 'cadence', 'current-leaf.json');

// ── Helpers ──

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function truncate(value, max) {
  const str = value == null ? '—' : String(value);
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

function padEnd(value, width) {
  const str = value == null ? '—' : String(value);
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

// ── Assemble ──

function buildCadence(projectRoot = PROJECT_ROOT) {
  const registryPath = path.join(projectRoot, '_dev', 'state', 'cadence', 'domain-registry.json');
  const leafPath = path.join(projectRoot, '_dev', 'state', 'cadence', 'current-leaf.json');

  const registry = safeReadJson(registryPath);
  const leaves = safeReadJson(leafPath);

  const domains = (registry && Array.isArray(registry.domains)) ? registry.domains : [];
  const leafList = (leaves && Array.isArray(leaves.leaves)) ? leaves.leaves : [];
  const leafById = new Map(leafList.map(l => [l.domain_id, l]));

  const rows = domains.map(domain => {
    const leaf = leafById.get(domain.id) || {};
    return {
      domain_id: domain.id,
      scope: domain.scope || 'unset',
      label: domain.label || domain.id,
      domain_status: domain.status || 'unset',
      leaf: leaf.leaf || null,
      state: leaf.state || 'unset',
      blocked_on: leaf.blocked_on || null,
      last_artifact: leaf.last_artifact || null,
      updated_at: leaf.updated_at || null
    };
  });

  return {
    registry_available: registry != null,
    leaf_available: leaves != null,
    rows
  };
}

// ── Output ──

function formatText(cadence) {
  const lines = [];
  lines.push('Mythos Cadence Check-In');
  lines.push('=======================');
  lines.push('guildmaster-loop (gm) on a clock — advance ONE leaf per active domain per slice.');
  lines.push('');

  if (!cadence.registry_available) {
    lines.push('WARN: domain-registry.json not found or unreadable.');
  }
  if (!cadence.leaf_available) {
    lines.push('WARN: current-leaf.json not found or unreadable.');
  }
  if (cadence.rows.length === 0) {
    lines.push('No domains registered.');
    return lines.join('\n');
  }

  const W = { domain: 8, scope: 8, state: 8, leaf: 52, blocked: 38, artifact: 48 };

  const header =
    padEnd('DOMAIN', W.domain) + '  ' +
    padEnd('SCOPE', W.scope) + '  ' +
    padEnd('STATE', W.state) + '  ' +
    padEnd('LEAF', W.leaf) + '  ' +
    padEnd('BLOCKED_ON', W.blocked) + '  ' +
    'LAST_ARTIFACT';
  lines.push(header);
  lines.push('-'.repeat(header.length));

  for (const row of cadence.rows) {
    lines.push(
      padEnd(row.domain_id, W.domain) + '  ' +
      padEnd(row.scope, W.scope) + '  ' +
      padEnd(row.state, W.state) + '  ' +
      padEnd(truncate(row.leaf, W.leaf), W.leaf) + '  ' +
      padEnd(truncate(row.blocked_on, W.blocked), W.blocked) + '  ' +
      truncate(row.last_artifact, W.artifact)
    );
  }
  lines.push('');

  // Slice summary by state
  const byState = {};
  for (const row of cadence.rows) {
    byState[row.state] = (byState[row.state] || 0) + 1;
  }
  const summary = Object.entries(byState)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([state, count]) => `${count} ${state}`)
    .join(', ');
  lines.push(`Slice summary: ${cadence.rows.length} domains — ${summary}`);
  lines.push('Render-only. Dispatch stays native. Hand-update leaves in _dev/state/cadence/current-leaf.json.');

  return lines.join('\n');
}

// ── Main ──

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node tools/cadence/check-in.js [--json] [--help]

Render the per-slice cadence grid (READ-ONLY). Does not dispatch or mutate.

Options:
  --json   Output structured JSON
  --help   Show this help`);
    process.exit(0);
  }

  const cadence = buildCadence();

  if (args.includes('--json')) {
    console.log(JSON.stringify(cadence, null, 2));
  } else {
    console.log(formatText(cadence));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildCadence,
  formatText
};
