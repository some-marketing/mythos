#!/usr/bin/env node
'use strict';

/**
 * end-session-closeout.js — MINIMAL WORKING STUB of the end-session-closeout
 * pattern.
 *
 * This is a scaffold, not the operator's full private implementation. The
 * real version this was distilled from cross-references a specific plan/
 * review/signal contract (a private multi-actor coordination schema, a
 * "planned vs. operational" session classifier, per-actor pending-action
 * routing) that hasn't shipped here. What DID ship is the reusable shape:
 * a read-only summary builder that looks at your own repo's live state and
 * tells you whether it's safe to end the session.
 *
 * THE PATTERN
 *   1. Inventory durable artifacts for the scope (debriefs, handoffs, plan
 *      files — whatever your own naming convention uses under
 *      _dev/reports/analysis/).
 *   2. Read whatever pending signal files exist under _dev/reports/signals/
 *      (any JSON file whose lifecycle_state isn't "closed" counts as live).
 *   3. Derive ready_for_clear: true only when there are no live pending
 *      signals and the artifact inventory isn't empty.
 *   4. Write a JSON + Markdown summary so the decision is durable and
 *      inspectable, not just a console message that scrolls away.
 *
 * Wire this to your own guild's real signal/plan/launchd machinery by
 * replacing inventoryArtifacts() and readLiveSignals() below with whatever
 * your own conventions are — the buildCloseout() / writeCloseout() shape
 * around them doesn't need to change.
 *
 * Usage:
 *   node tools/maintenance/end-session-closeout.js --scope <name>
 *   node tools/maintenance/end-session-closeout.js --scope <name> --json
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ANALYSIS_REL = path.join('_dev', 'reports', 'analysis');
const SIGNALS_REL = path.join('_dev', 'reports', 'signals');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--scope') out.scope = argv[++i];
    else if (tok === '--json') out.json = true;
    else if (tok === '--help' || tok === '-h') out.help = true;
  }
  return out;
}

function safeReaddir(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Replace this with your own artifact-naming convention. This stub treats
// any file under _dev/reports/analysis/ whose name contains the scope as a
// relevant artifact.
function inventoryArtifacts(projectRoot, scope) {
  const dir = path.join(projectRoot, ANALYSIS_REL);
  const names = safeReaddir(dir);
  return names
    .filter((name) => !scope || name.includes(scope))
    .map((name) => path.join(ANALYSIS_REL, name).split(path.sep).join('/'))
    .sort();
}

// Replace this with your own signal schema. This stub's convention: any
// JSON file under _dev/reports/signals/ with a lifecycle_state field that
// isn't "closed" is a live pending signal for the given scope.
function readLiveSignals(projectRoot, scope) {
  const dir = path.join(projectRoot, SIGNALS_REL);
  const names = safeReaddir(dir).filter((name) => name.endsWith('.json'));
  const live = [];
  for (const name of names) {
    const parsed = safeReadJson(path.join(dir, name));
    if (!parsed) continue;
    if (parsed.lifecycle_state === 'closed') continue;
    if (scope && parsed.scope && parsed.scope !== scope) continue;
    live.push({ path: path.join(SIGNALS_REL, name).split(path.sep).join('/'), schema: parsed.schema || null, scope: parsed.scope || null });
  }
  return live;
}

function buildCloseout(projectRoot, scope, opts = {}) {
  const timestamp = opts.timestamp || new Date().toISOString();
  const artifacts = inventoryArtifacts(projectRoot, scope);
  const liveSignals = readLiveSignals(projectRoot, scope);

  const blockers = [];
  if (liveSignals.length > 0) {
    blockers.push({ id: 'live_pending_signals', basis: 'One or more live signal files remain for this scope', evidence: liveSignals });
  }
  if (artifacts.length === 0) {
    blockers.push({ id: 'no_artifacts_found', basis: 'No durable artifacts were found for this scope under _dev/reports/analysis/' });
  }

  return {
    schema: 'EndSessionCloseoutStub/1.0',
    timestamp,
    scope: scope || 'system',
    artifact_inventory: artifacts,
    live_signals: liveSignals,
    ready_for_clear: blockers.length === 0,
    blockers
  };
}

function buildMarkdown(closeout) {
  const lines = [
    '# End Session Closeout (stub)',
    '',
    `- Schema: ${closeout.schema}`,
    `- Timestamp: ${closeout.timestamp}`,
    `- Scope: ${closeout.scope}`,
    `- Ready for clear: ${closeout.ready_for_clear ? 'true' : 'false'}`,
    '',
    '## Blockers',
    ''
  ];
  if (closeout.blockers.length === 0) {
    lines.push('- None');
  } else {
    for (const blocker of closeout.blockers) lines.push(`- ${blocker.id}: ${blocker.basis}`);
  }
  lines.push('', '## Artifact Inventory', '');
  if (closeout.artifact_inventory.length === 0) {
    lines.push('- none');
  } else {
    for (const artifact of closeout.artifact_inventory) lines.push(`- ${artifact}`);
  }
  lines.push('', '## Live Signals', '');
  if (closeout.live_signals.length === 0) {
    lines.push('- none');
  } else {
    for (const signal of closeout.live_signals) lines.push(`- ${signal.path} (${signal.schema || 'no schema field'})`);
  }
  return `${lines.join('\n')}\n`;
}

function writeCloseout(projectRoot, closeout) {
  const dir = path.join(projectRoot, ANALYSIS_REL);
  fs.mkdirSync(dir, { recursive: true });
  const safeTimestamp = closeout.timestamp.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const base = `end-session-closeout__${closeout.scope}__${safeTimestamp}`;
  const jsonPath = path.join(dir, `${base}.json`);
  const mdPath = path.join(dir, `${base}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(closeout, null, 2)}\n`);
  fs.writeFileSync(mdPath, buildMarkdown(closeout));
  return {
    json: path.relative(projectRoot, jsonPath),
    markdown: path.relative(projectRoot, mdPath)
  };
}

function help() {
  console.log(`
End-session closeout stub — a read-only summary builder demonstrating the pattern.

Usage:
  node tools/maintenance/end-session-closeout.js --scope <name> [--json]
  node tools/maintenance/end-session-closeout.js --help
`.trim());
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    help();
    return;
  }
  const closeout = buildCloseout(PROJECT_ROOT, args.scope || 'system');
  const outputPaths = writeCloseout(PROJECT_ROOT, closeout);

  if (args.json) {
    console.log(JSON.stringify({ ...closeout, output_paths: outputPaths }, null, 2));
    return;
  }

  console.log(`ready_for_clear: ${closeout.ready_for_clear}`);
  console.log(`blockers: ${closeout.blockers.map((b) => b.id).join(', ') || 'none'}`);
  console.log(`json: ${outputPaths.json}`);
  console.log(`markdown: ${outputPaths.markdown}`);
}

if (require.main === module) {
  main();
}

module.exports = { buildCloseout, buildMarkdown, writeCloseout, inventoryArtifacts, readLiveSignals };
