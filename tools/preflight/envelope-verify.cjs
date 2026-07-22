#!/usr/bin/env node
'use strict';

// tools/preflight/envelope-verify.cjs
//
// Envelope preflight — deterministic check that a task's permission envelope
// is satisfied on this host before execution starts.
//
// Authority: _dev/policies/permission-envelope.md
// Schema:    _dev/policies/permission-envelope.schema.json
//
// Usage:
//   node tools/preflight/envelope-verify.cjs --envelope <path>
//   node tools/preflight/envelope-verify.cjs --envelope <path> --json
//   node tools/preflight/envelope-verify.cjs --envelope <path> --strict
//
// The verifier:
//   1. Loads the envelope JSON and validates its shape.
//   2. Loads .claude/settings.json and .claude/settings.local.json and merges
//      their permissions.allow lists.
//   3. Checks bash_prefixes: every required pattern must be present exactly.
//   4. Checks write_surfaces: writes a disposable probe file to each surface.
//   5. Checks mcp_connections: reads .mcp.json only for declared MCP server
//      names. Settings MCP declarations are not read. Live connectivity is
//      NOT attempted — it is a runtime concern.
//   6. Emits a report. With --strict, exits 1 on any blocker.
//
// This tool does NOT mutate settings.local.json. Persistence of the
// persistent_safe_subset is a separate, operator-approved step.

const fs = require('fs');
const path = require('path');

const {
  ENVELOPE_VERSION,
  loadAllowSet,
  validateEnvelopeShape,
  matchBashPrefixes
} = require('./lib/envelope-match.cjs');

const { filterPersistCandidates } = require('./lib/safe-persistence.cjs');

const REPO_ROOT = process.cwd();

function parseArgs(argv) {
  const args = { envelope: null, json: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--envelope' && argv[i + 1]) {
      args.envelope = argv[++i];
    } else if (a === '--json') {
      args.json = true;
    } else if (a === '--strict') {
      args.strict = true;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    }
  }
  return args;
}

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function loadSettings() {
  const docs = [];
  const loaded = [];
  const errors = [];
  for (const rel of ['.claude/settings.json', '.claude/settings.local.json']) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const result = readJson(abs);
    if (result.ok) {
      docs.push(result.value);
      loaded.push(rel);
    } else {
      errors.push({ file: rel, error: result.error });
    }
  }
  return { docs, loaded, errors };
}

function probeWriteSurfaces(surfaces) {
  const report = [];
  const pid = process.pid;
  const repoPrefix = REPO_ROOT + path.sep;
  for (const surface of surfaces || []) {
    const entry = { surface, abs: null, writable: false, reason: null };
    if (typeof surface !== 'string' || surface.length === 0) {
      entry.reason = 'write_surface must be a non-empty string';
      report.push(entry);
      continue;
    }
    if (path.isAbsolute(surface)) {
      entry.reason = 'write_surface must be repo-relative (absolute paths are rejected)';
      report.push(entry);
      continue;
    }
    const abs = path.resolve(REPO_ROOT, surface);
    if (!abs.startsWith(repoPrefix) && abs !== REPO_ROOT) {
      entry.reason = 'write_surface resolves outside repo root (path escape rejected)';
      report.push(entry);
      continue;
    }
    entry.abs = abs;
    try {
      if (!fs.existsSync(abs)) {
        entry.reason = 'path does not exist';
        report.push(entry);
        continue;
      }
      const stat = fs.statSync(abs);
      if (!stat.isDirectory()) {
        entry.reason = 'path is not a directory';
        report.push(entry);
        continue;
      }
      const probe = path.join(abs, `.envelope_probe_${pid}_${Date.now()}`);
      fs.writeFileSync(probe, '');
      fs.unlinkSync(probe);
      entry.writable = true;
    } catch (err) {
      entry.reason = err.message;
    }
    report.push(entry);
  }
  return report;
}

function loadDeclaredMcp() {
  const declared = new Set();
  const mcpPath = path.join(REPO_ROOT, '.mcp.json');
  if (fs.existsSync(mcpPath)) {
    const result = readJson(mcpPath);
    if (result.ok && result.value && result.value.mcpServers && typeof result.value.mcpServers === 'object') {
      for (const name of Object.keys(result.value.mcpServers)) declared.add(name);
    }
  }
  return declared;
}

function checkMcpConnections(required, declared) {
  const report = [];
  for (const name of required || []) {
    report.push({
      name,
      declared: declared.has(name),
      live_check: false,
      live_note: 'live MCP connectivity is a runtime concern and is not probed by this preflight'
    });
  }
  return report;
}

function buildReport(envelope, settings) {
  const shapeErrors = validateEnvelopeShape(envelope);
  if (shapeErrors.length > 0) {
    return {
      ok: false,
      envelope_version: envelope && envelope.envelope_version ? envelope.envelope_version : null,
      task_id: envelope && envelope.task_id ? envelope.task_id : null,
      shape_errors: shapeErrors,
      settings_loaded: settings.loaded,
      settings_errors: settings.errors,
      bash: null,
      write_surfaces: null,
      mcp: null,
      persistent_safe_subset: null,
      blockers: shapeErrors.map((msg) => `shape: ${msg}`)
    };
  }

  const allowSet = loadAllowSet(settings.docs);
  const bash = matchBashPrefixes(envelope, allowSet);
  const writeReport = probeWriteSurfaces(envelope.write_surfaces);
  const mcpReport = checkMcpConnections(envelope.mcp_connections, loadDeclaredMcp());

  const persistSubset = Array.isArray(envelope.persistent_safe_subset) ? envelope.persistent_safe_subset : [];
  const persistFilter = filterPersistCandidates(persistSubset, envelope);

  const blockers = [];
  for (const missing of bash.missing) blockers.push(`bash_prefix missing: ${missing}`);
  for (const entry of writeReport) if (!entry.writable) blockers.push(`write_surface not writable: ${entry.surface} (${entry.reason})`);
  for (const entry of mcpReport) if (!entry.declared) blockers.push(`mcp_connection not declared: ${entry.name}`);
  for (const r of persistFilter.rejected) blockers.push(`persistent_safe_subset rejected: ${r.pattern} — ${r.reason}`);

  return {
    ok: blockers.length === 0,
    envelope_version: envelope.envelope_version,
    task_id: envelope.task_id,
    shape_errors: [],
    settings_loaded: settings.loaded,
    settings_errors: settings.errors,
    bash,
    write_surfaces: writeReport,
    mcp: mcpReport,
    persistent_safe_subset: persistFilter,
    blockers
  };
}

function printHuman(report) {
  const lines = [];
  lines.push(`permission-envelope preflight — task_id=${report.task_id || '?'} envelope_version=${report.envelope_version || '?'}`);
  lines.push(`settings loaded: ${report.settings_loaded.join(', ') || '(none)'}`);
  if (report.settings_errors && report.settings_errors.length) {
    for (const e of report.settings_errors) lines.push(`  settings error: ${e.file}: ${e.error}`);
  }
  if (report.shape_errors && report.shape_errors.length) {
    lines.push('shape errors:');
    for (const m of report.shape_errors) lines.push(`  - ${m}`);
  }
  if (report.bash) {
    lines.push(`bash_prefixes: ${report.bash.present.length}/${report.bash.required} present`);
    for (const m of report.bash.missing) lines.push(`  missing: ${m}`);
  }
  if (Array.isArray(report.write_surfaces)) {
    lines.push('write_surfaces:');
    for (const e of report.write_surfaces) {
      lines.push(`  ${e.writable ? 'OK  ' : 'FAIL'} ${e.surface}${e.reason ? ' — ' + e.reason : ''}`);
    }
  }
  if (Array.isArray(report.mcp)) {
    lines.push('mcp_connections:');
    for (const e of report.mcp) lines.push(`  ${e.declared ? 'declared' : 'missing '} ${e.name}`);
  }
  lines.push(report.ok ? 'RESULT: ok' : `RESULT: blocked (${report.blockers.length} blocker${report.blockers.length === 1 ? '' : 's'})`);
  return lines.join('\n');
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help || !args.envelope) {
    process.stdout.write(
      [
        'Usage: node tools/preflight/envelope-verify.cjs --envelope <path> [--json] [--strict]',
        '',
        'Required:',
        '  --envelope <path>   Path to a permission-envelope JSON (v' + ENVELOPE_VERSION + ')',
        'Options:',
        '  --json              Print machine-readable JSON',
        '  --strict            Exit 1 on any blocker',
        '  --help, -h          Show this help',
        ''
      ].join('\n')
    );
    return args.envelope ? 0 : 2;
  }
  const envelopeRead = readJson(path.resolve(args.envelope));
  if (!envelopeRead.ok) {
    const err = { ok: false, error: `envelope load failed: ${envelopeRead.error}` };
    if (args.json) {
      process.stdout.write(JSON.stringify(err, null, 2) + '\n');
    } else {
      process.stdout.write(err.error + '\n');
    }
    return 2;
  }
  const settings = loadSettings();
  const report = buildReport(envelopeRead.value, settings);
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(printHuman(report) + '\n');
  }
  if (!report.ok && args.strict) return 1;
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { main, buildReport };
