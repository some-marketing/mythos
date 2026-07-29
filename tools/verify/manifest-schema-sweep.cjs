#!/usr/bin/env node
'use strict';

/**
 * manifest-schema-sweep.cjs — mechanical drift watchdog for the config surfaces
 * that currently have no watcher (review finding SH5c): framework manifests,
 * canonical command YAML, and the workspace templates .mcp.json / package.json.
 *
 * REPORT-ONLY, ALWAYS. There is no --apply mode and this tool never writes to
 * any swept file. Its whole job is to notice, cheaply and deterministically, when
 * one of these files stops parsing or loses a required field — the silent failure
 * surfaces the heartbeat-consumer folds into the scheduled sweep.
 *
 * WHAT IT CHECKS
 *   1. frameworks/<service>/<framework>/manifest.json
 *        - parses as JSON
 *        - carries the required keys the framework auditor expects
 *          (derived from tools/verify/verify-framework.cjs).
 *   2. instructions/canonical/commands/*.yaml
 *        - is well-formed YAML. NOTE: js-yaml is not a repo dependency, so this
 *          is a self-contained structural check limited to signals that are
 *          RELIABLE without a real parser: a hard tab in indentation (genuinely
 *          illegal in YAML) and an empty/contentless file. It deliberately does
 *          NOT try to balance quotes — apostrophes in unquoted scalars make that
 *          heuristic false-positive on legitimate files. Reported honestly as
 *          method 'yaml-structural'; it is a corruption tripwire, not a validator.
 *   3. .mcp.json and package.json (repo root)
 *        - parse as JSON.
 *
 * USAGE
 *   node tools/verify/manifest-schema-sweep.cjs            # human summary
 *   node tools/verify/manifest-schema-sweep.cjs --json     # machine-readable
 *   node tools/verify/manifest-schema-sweep.cjs --root <d> # sweep an alt tree (tests)
 *
 * Exit 0 = no drift; 1 = at least one hard failure (parse error or missing
 * required manifest key). Report-only refers to mutation, not exit code — a
 * non-zero exit lets the supervisor flag drift without anyone editing a file.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '../..');

// Required manifest keys — derived from verify-framework.cjs manifestKeys.
const REQUIRED_MANIFEST_KEYS = ['service_category', 'framework_name', 'version', 'prompt_count', 'execution_modes'];

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) { out._.push(tok); continue; }
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (key === 'root' && next && !next.startsWith('--')) { out.root = next; i++; }
    else out[key] = true;
  }
  return out;
}

function globFiles(pattern, root) {
  try {
    return fs.globSync(pattern, { cwd: root, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => path.resolve(d.parentPath || d.path || root, d.name));
  } catch {
    return [];
  }
}

/**
 * Minimal YAML corruption tripwire. Deliberately narrow: it only flags signals
 * that are reliable WITHOUT a real parser, so it never false-positives on valid
 * files. Detects a hard tab in indentation (genuinely illegal YAML) and an
 * empty/contentless file. It intentionally does not attempt quote balancing —
 * apostrophes in unquoted scalars (e.g. "the client's brief") make that
 * heuristic wrong on legitimate files. Returns { ok, error }.
 */
function checkYamlWellFormed(text) {
  const lines = text.split('\n');
  let sawContent = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/#.*$/, ''); // strip trailing comments (naive but fine for the check)
    if (line.trim() === '') continue;
    sawContent = true;

    // Hard tab used in leading indentation is invalid YAML.
    const indent = raw.match(/^[ \t]*/)[0];
    if (indent.includes('\t')) {
      return { ok: false, error: `line ${i + 1}: tab character in indentation (invalid YAML)` };
    }
  }
  if (!sawContent) return { ok: false, error: 'file is empty / has no YAML content' };
  return { ok: true, error: null };
}

function sweep(root) {
  const findings = [];
  const push = (surface, file, status, detail) =>
    findings.push({ surface, file: path.relative(root, file), status, detail });

  // 1. Framework manifests.
  const manifests = globFiles('frameworks/*/*/manifest.json', root);
  for (const abs of manifests) {
    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (err) {
      push('framework-manifest', abs, 'fail', `invalid JSON: ${err.message}`);
      continue;
    }
    const missing = REQUIRED_MANIFEST_KEYS.filter((k) => !(k in obj));
    if (missing.length) push('framework-manifest', abs, 'fail', `missing required keys: ${missing.join(', ')}`);
    else push('framework-manifest', abs, 'ok', null);
  }

  // 2. Canonical command YAML.
  const yamls = globFiles('instructions/canonical/commands/*.yaml', root);
  for (const abs of yamls) {
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      push('command-yaml', abs, 'fail', `unreadable: ${err.message}`);
      continue;
    }
    const res = checkYamlWellFormed(text);
    if (res.ok) push('command-yaml', abs, 'ok', 'method=yaml-structural');
    else push('command-yaml', abs, 'fail', res.error);
  }

  // 3. Workspace templates.
  for (const rel of ['.mcp.json', 'package.json']) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) { push('workspace-template', abs, 'missing', 'file not present'); continue; }
    try {
      JSON.parse(fs.readFileSync(abs, 'utf8'));
      push('workspace-template', abs, 'ok', null);
    } catch (err) {
      push('workspace-template', abs, 'fail', `invalid JSON: ${err.message}`);
    }
  }

  return findings;
}

function main() {
  const args = parseArgs(process.argv);
  const root = args.root ? path.resolve(args.root) : DEFAULT_ROOT;
  const findings = sweep(root);

  const failures = findings.filter((f) => f.status === 'fail');
  const missing = findings.filter((f) => f.status === 'missing');
  const summary = {
    schema: 'ManifestSchemaSweep/1.0',
    ts: new Date().toISOString(),
    root: root === DEFAULT_ROOT ? '.' : root,
    total: findings.length,
    ok: findings.filter((f) => f.status === 'ok').length,
    failures: failures.length,
    missing: missing.length,
    findings
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('manifest-schema-sweep — REPORT ONLY');
    console.log('='.repeat(48));
    console.log(`Swept ${findings.length} files: ${summary.ok} ok, ${failures.length} failed, ${missing.length} missing.\n`);
    for (const f of [...failures, ...missing]) {
      console.log(`  [${f.status.toUpperCase()}] ${f.surface}: ${f.file}`);
      if (f.detail) console.log(`      ${f.detail}`);
    }
    if (failures.length === 0 && missing.length === 0) console.log('  No drift detected.');
  }

  // Missing workspace templates are a warning, not a hard fail; parse failures
  // and missing required manifest keys are hard failures.
  process.exit(failures.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  sweep,
  checkYamlWellFormed,
  REQUIRED_MANIFEST_KEYS,
  DEFAULT_ROOT
};
