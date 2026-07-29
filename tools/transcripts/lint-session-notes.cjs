#!/usr/bin/env node
'use strict';

/**
 * lint-session-notes.cjs — session-note frontmatter conformance lint.
 *
 * Plan: memory-dreaming-obsidian-improvements (step mdoi-session-note-schema)
 * Amendment: AMD-3 (continuity fields carried by schema + template + THIS lint)
 *
 * Scans the repo-side transcript sources that sync-obsidian-vault.sh mirrors
 * into the vault (top-level _dev/state/*.md and *.txt) and reports files that
 * do not conform to tools/memory/schemas/session-note.schema.json.
 *
 * Classification:
 *   - CONFORMING            — frontmatter type: llm_session and all schema checks pass
 *   - NONCONFORMING         — type: llm_session but schema violations (listed)
 *   - NOT-A-SESSION-NOTE    — no llm_session frontmatter (bare .txt, frontmatter-less
 *                             .md, other note kinds). These are the heterogeneous
 *                             surfaces the schema exists to converge.
 *
 * Stdlib-only. Read-only — never modifies scanned files.
 *
 * Usage:
 *   node tools/transcripts/lint-session-notes.cjs            # default surface
 *   node tools/transcripts/lint-session-notes.cjs <path...>  # explicit files/dirs
 *   node tools/transcripts/lint-session-notes.cjs --json     # machine output
 *
 * Exit codes: 0 = all scanned files conforming (or only NOT-A-SESSION-NOTE with
 * --allow-foreign), 1 = nonconforming session notes or unconverged surfaces found.
 * Advisory tool — not wired into SessionStart or any launchd lane.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'tools', 'memory', 'schemas', 'session-note.schema.json');
const DEFAULT_SURFACE = path.join(REPO_ROOT, '_dev', 'state');

function parseArgs(argv) {
  const out = { json: false, allowForeign: false, paths: [] };
  for (const a of argv.slice(2)) {
    if (a === '--json') out.json = true;
    else if (a === '--allow-foreign') out.allowForeign = true;
    else out.paths.push(a);
  }
  return out;
}

/** Collect the default lint surface: top-level _dev/state *.md / *.txt
 * (exactly the set rsync'd into vault transcripts/ by sync-obsidian-vault.sh). */
function defaultSurfaceFiles() {
  let names;
  try {
    names = fs.readdirSync(DEFAULT_SURFACE, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  return names
    .filter((d) => d.isFile() && (d.name.endsWith('.md') || d.name.endsWith('.txt')))
    .map((d) => path.join(DEFAULT_SURFACE, d.name))
    .sort();
}

function collectFiles(args) {
  if (!args.paths.length) return defaultSurfaceFiles();
  const files = [];
  for (const p of args.paths) {
    const full = path.resolve(p);
    let st;
    try { st = fs.statSync(full); } catch (_) { continue; }
    if (st.isDirectory()) {
      for (const n of fs.readdirSync(full).sort()) {
        if (n.endsWith('.md') || n.endsWith('.txt')) files.push(path.join(full, n));
      }
    } else if (st.isFile()) {
      files.push(full);
    }
  }
  return files;
}

// --- minimal frontmatter parser (matches build-memory-db.js conventions,
// plus block lists `- item` under a key) ---------------------------------
function splitFrontmatter(raw) {
  if (!raw.startsWith('---')) return { fm: null, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { fm: null, body: raw };
  return { fm: raw.slice(3, end).replace(/^\n/, ''), body: raw.slice(end + 4) };
}

function stripQuotes(s) {
  return String(s).replace(/^["']|["']$/g, '').trim();
}

function parseScalar(val) {
  val = val.trim();
  if (val === 'null' || val === '~' || val === '') return null;
  if (val.startsWith('[') && val.endsWith(']')) {
    const inner = val.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(stripQuotes).filter((x) => x !== '');
  }
  return stripQuotes(val);
}

function parseFrontmatter(fmText) {
  const out = {};
  if (!fmText) return out;
  const lines = fmText.split('\n');
  let listKey = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const listItem = line.match(/^\s+-\s*(.*)$/);
    if (listItem && listKey) {
      out[listKey].push(stripQuotes(listItem[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim();
    if (val === '') {
      listKey = key;
      out[key] = [];
    } else {
      listKey = null;
      out[key] = parseScalar(val);
    }
  }
  return out;
}

// --- schema-driven validation (subset validator for this schema's shapes) ---
function validateAgainstSchema(meta, schema) {
  const errors = [];
  for (const req of schema.required || []) {
    if (!(req in meta)) errors.push(`missing required field: ${req}`);
  }
  for (const [key, spec] of Object.entries(schema.properties || {})) {
    if (!(key in meta)) continue;
    const val = meta[key];
    const types = spec.type
      ? Array.isArray(spec.type) ? spec.type : [spec.type]
      : null;
    if (spec.const !== undefined && val !== spec.const) {
      errors.push(`${key}: expected ${JSON.stringify(spec.const)}, got ${JSON.stringify(val)}`);
      continue;
    }
    if (val === null) {
      if (types && !types.includes('null')) errors.push(`${key}: null not permitted`);
      continue;
    }
    if (types) {
      const t = Array.isArray(val) ? 'array' : typeof val;
      if (!types.includes(t)) {
        errors.push(`${key}: expected ${types.join('|')}, got ${t}`);
        continue;
      }
    }
    if (spec.enum && !spec.enum.includes(val)) {
      errors.push(`${key}: '${val}' not in [${spec.enum.join(', ')}]`);
    }
    if (spec.pattern && typeof val === 'string' && !new RegExp(spec.pattern).test(val)) {
      errors.push(`${key}: '${val}' does not match ${spec.pattern}`);
    }
    if (typeof val === 'string' && spec.minLength && val.length < spec.minLength) {
      errors.push(`${key}: shorter than minLength ${spec.minLength}`);
    }
    if (Array.isArray(val)) {
      if (spec.minItems && val.length < spec.minItems) {
        errors.push(`${key}: fewer than ${spec.minItems} items`);
      }
      if (spec.contains && spec.contains.const !== undefined && !val.includes(spec.contains.const)) {
        errors.push(`${key}: must contain '${spec.contains.const}'`);
      }
    }
  }
  return errors;
}

function lintFile(full, schema) {
  const rel = path.relative(REPO_ROOT, full);
  if (full.endsWith('.txt')) {
    return { file: rel, status: 'NOT-A-SESSION-NOTE', reasons: ['bare .txt transcript — no frontmatter surface (convert via session-note template/distiller)'] };
  }
  let raw;
  try { raw = fs.readFileSync(full, 'utf8'); } catch (e) {
    return { file: rel, status: 'NOT-A-SESSION-NOTE', reasons: ['unreadable: ' + e.message] };
  }
  const { fm } = splitFrontmatter(raw);
  if (fm === null) {
    return { file: rel, status: 'NOT-A-SESSION-NOTE', reasons: ['no YAML frontmatter'] };
  }
  const meta = parseFrontmatter(fm);
  if (meta.type !== 'llm_session') {
    return {
      file: rel,
      status: 'NOT-A-SESSION-NOTE',
      reasons: [`frontmatter type is ${meta.type === undefined ? 'absent' : `'${meta.type}'`} (expected 'llm_session')`],
    };
  }
  const errors = validateAgainstSchema(meta, schema);
  if (errors.length) return { file: rel, status: 'NONCONFORMING', reasons: errors };
  return { file: rel, status: 'CONFORMING', reasons: [] };
}

function main() {
  const args = parseArgs(process.argv);
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  } catch (e) {
    process.stderr.write(`lint-session-notes: cannot load schema at ${SCHEMA_PATH}: ${e.message}\n`);
    process.exit(2);
  }
  const files = collectFiles(args);
  const results = files.map((f) => lintFile(f, schema));

  const counts = { CONFORMING: 0, NONCONFORMING: 0, 'NOT-A-SESSION-NOTE': 0 };
  for (const r of results) counts[r.status]++;

  if (args.json) {
    process.stdout.write(JSON.stringify({ schema: 'SessionNoteLint/1.0', surface: args.paths.length ? args.paths : ['_dev/state (top-level *.md, *.txt)'], counts, results }, null, 2) + '\n');
  } else {
    process.stdout.write(`lint-session-notes — schema ${path.relative(REPO_ROOT, SCHEMA_PATH)}\n`);
    process.stdout.write(`surface: ${args.paths.length ? args.paths.join(', ') : '_dev/state (top-level *.md, *.txt — the vault-mirrored transcript set)'}\n\n`);
    for (const r of results) {
      process.stdout.write(`[${r.status}] ${r.file}\n`);
      for (const reason of r.reasons) process.stdout.write(`    - ${reason}\n`);
    }
    process.stdout.write(`\n${results.length} files: ${counts.CONFORMING} conforming, ${counts.NONCONFORMING} nonconforming, ${counts['NOT-A-SESSION-NOTE']} not-a-session-note\n`);
  }

  const bad = counts.NONCONFORMING + (args.allowForeign ? 0 : counts['NOT-A-SESSION-NOTE']);
  process.exit(bad > 0 ? 1 : 0);
}

main();
