#!/usr/bin/env node
'use strict';
/**
 * semantic-query.cjs — anchor-based semantic retrieval over the Smart Connections
 * embedding store (your configured memory-mirror directory's .smart-env/multi/*.ajson, if present).
 *
 * Plan: memory-dreaming-obsidian-improvements · slice mdoi-semantic-retrieval
 * Gate: AMD-2 resolved 2026-06-10 — the human operator stamped default-off
 *       implementation on the codex LIFT verdict
 *       (_dev/reports/analysis/review-progress__codex-judge-retrieval-lift-mdoi-semantic-retrieval.md).
 *       Gate-resolution record:
 *       _dev/state/plan-task-review-state/memory-dreaming-obsidian-improvements.json.
 *
 * EMBEDDING-STRATEGY DECISION (honest):
 *   Free-text query embedding is NOT implemented. The store's vectors come from
 *   TaylorAI/bge-micro-v2 run by smart-connections (v4.5.3) inside Obsidian's
 *   Electron runtime via transformers.js; the model weights live in Obsidian's
 *   app storage, not in any Node-reachable cache (verified 2026-06-10: no
 *   @xenova/transformers in node_modules, no bge-micro-v2 under
 *   ~/.cache/huggingface). Embedding a free-text query from this CLI would
 *   require a new network-fetched dependency + model download, which the AMD-2
 *   stamp forbids (no network calls, no new network dependencies). Therefore:
 *   ANCHOR MODE ONLY — `--anchor <vault-note>` resolves that note's EXISTING
 *   source vector and returns its nearest neighbors by cosine over the existing
 *   source vectors. This is the same proxy method the preflight baseline used
 *   (amendment fallback method); it answers "similar to anchor", a stand-in for
 *   true query-NN. If a local-weights path becomes available later, --query can
 *   be added behind the same filters.
 *
 * VERSION-PINNED READER ASSUMPTIONS (fail soft on drift — exit 2, no crash):
 *   - smart-connections plugin version 4.x (assayed at 4.5.3)
 *   - embed model key "TaylorAI/bge-micro-v2", 384-dim source vectors
 *   - .ajson format: append-only JSON fragments `"key": {...},` per line,
 *     last write wins per key (JSON.parse of `{...}` keeps the last duplicate)
 *   - source entries keyed `smart_sources:<path>`, vector at
 *     entry.embeddings[MODEL_KEY].vec
 *
 * MANDATORY MECHANICAL FILTERS (binding condition (b) of the AMD-2 stamp —
 * in code, not advisory):
 *   - existence filter: drop results whose vault file no longer exists
 *     (349 orphaned embeddings known at assay time)
 *   - hard path filter: drop any result whose vault-relative path contains
 *     `clients/`, a personal-notes directory, or `session-bundles/`; an anchor in
 *     that space is refused outright
 *
 * DEFAULT-OFF (binding condition (c)): this CLI is NOT wired into
 * contextual-inject.cjs, SessionStart, or any hook. Default-on is a separate
 * future gate after excluded keys age out and are re-verified.
 *
 * Usage:
 *   node tools/memory/semantic-query.cjs --anchor <vault-relative-note.md> [--k N] [--json]
 *
 * Output (default): one line per hit — `<cosine>\t<vault-relative-path>`;
 * stats go to stderr. `--json` emits a single structured JSON object on stdout.
 * Read-only: never writes to the vault or the store.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const VAULT = path.join(PROJECT_ROOT, process.env.MYTHOS_MEMORY_MIRROR_DIR || 'memory-mirror');
const MULTI = path.join(VAULT, '.smart-env', 'multi');
const PLUGIN_MANIFEST = path.join(VAULT, '.obsidian', 'plugins', 'smart-connections', 'manifest.json');
const SMART_ENV = path.join(VAULT, '.smart-env', 'smart_env.json');

// Pinned assumptions (see header).
const PINNED_PLUGIN_MAJOR = 4;
const ASSAYED_PLUGIN_VERSION = '4.5.3';
const MODEL_KEY = 'TaylorAI/bge-micro-v2';
const VEC_DIM = 384;
const PARSE_ERROR_ABORT_RATIO = 0.05; // >5% unreadable files = format drift

// Binding condition (b): hard path filter — mechanical, not advisory.
const FORBIDDEN_PATH_SUBSTRINGS = ['clients/', 'personal-notes/', 'session-bundles/'];

function softFail(msg) {
  process.stderr.write(`semantic-query: SOFT-FAIL (format/version drift or bad input): ${msg}\n`);
  process.stderr.write('semantic-query: no results returned; re-verify reader assumptions against the live store.\n');
  process.exit(2);
}

function usage(code) {
  process.stderr.write(
    'Usage: node tools/memory/semantic-query.cjs --anchor <vault-relative-note.md> [--k N] [--json]\n' +
    'Anchor mode only (no free-text query embedding — see file header for why).\n'
  );
  process.exit(code);
}

function parseArgs(argv) {
  const args = { anchor: null, k: 10, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--anchor') args.anchor = argv[++i];
    else if (a === '--k') args.k = parseInt(argv[++i], 10);
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') usage(0);
    else usage(1);
  }
  if (!args.anchor) usage(1);
  if (!Number.isInteger(args.k) || args.k < 1 || args.k > 100) softFail(`--k must be an integer 1..100, got: ${args.k}`);
  return args;
}

function checkPins() {
  // Plugin version pin (major-version gate; warn on minor drift past assay).
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
  } catch (e) {
    softFail(`cannot read smart-connections manifest (${PLUGIN_MANIFEST}): ${e.message}`);
  }
  const major = parseInt(String(manifest.version).split('.')[0], 10);
  if (major !== PINNED_PLUGIN_MAJOR) {
    softFail(`smart-connections major version ${manifest.version} != pinned ${PINNED_PLUGIN_MAJOR}.x — reader assumptions unverified`);
  }
  if (manifest.version !== ASSAYED_PLUGIN_VERSION) {
    process.stderr.write(`semantic-query: WARN plugin version ${manifest.version} differs from assayed ${ASSAYED_PLUGIN_VERSION} (same major; proceeding)\n`);
  }
  // Model-key pin from live config.
  let env;
  try {
    env = JSON.parse(fs.readFileSync(SMART_ENV, 'utf8'));
  } catch (e) {
    softFail(`cannot read smart_env.json: ${e.message}`);
  }
  const modelKey = env && env.smart_sources && env.smart_sources.embed_model &&
    env.smart_sources.embed_model.transformers && env.smart_sources.embed_model.transformers.model_key;
  if (modelKey !== MODEL_KEY) {
    softFail(`configured embed model "${modelKey}" != pinned "${MODEL_KEY}" — vectors may be a different space`);
  }
  return manifest.version;
}

function loadSources() {
  let files;
  try {
    files = fs.readdirSync(MULTI).filter((f) => f.endsWith('.ajson'));
  } catch (e) {
    softFail(`cannot read store dir ${MULTI}: ${e.message}`);
  }
  if (files.length === 0) softFail('store contains no .ajson files');
  const sources = []; // { path, vec }
  let parseErrors = 0;
  for (const f of files) {
    let obj;
    try {
      let text = fs.readFileSync(path.join(MULTI, f), 'utf8').trim();
      if (text.endsWith(',')) text = text.slice(0, -1);
      obj = JSON.parse('{' + text + '}'); // duplicate keys: last write wins
    } catch {
      parseErrors++;
      continue;
    }
    for (const [key, val] of Object.entries(obj)) {
      if (!key.startsWith('smart_sources:')) continue;
      if (!val || typeof val.path !== 'string') continue;
      const vec = val.embeddings && val.embeddings[MODEL_KEY] && val.embeddings[MODEL_KEY].vec;
      if (!Array.isArray(vec)) continue;
      if (vec.length !== VEC_DIM) {
        softFail(`vector dim ${vec.length} != pinned ${VEC_DIM} for ${val.path} — model/format drift`);
      }
      sources.push({ path: val.path, vec });
    }
  }
  if (parseErrors / files.length > PARSE_ERROR_ABORT_RATIO) {
    softFail(`${parseErrors}/${files.length} .ajson files unreadable — format drift`);
  }
  if (sources.length === 0) softFail('no source vectors found in store');
  return { sources, parseErrors, ajsonFiles: files.length };
}

function isForbidden(p) {
  return FORBIDDEN_PATH_SUBSTRINGS.some((sub) => p.includes(sub));
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function main() {
  const args = parseArgs(process.argv);
  const pluginVersion = checkPins();

  const anchorRel = args.anchor.replace(/^\/+/, '');
  if (isForbidden(anchorRel)) {
    softFail(`anchor path is in forbidden space (${FORBIDDEN_PATH_SUBSTRINGS.join(', ')}): ${anchorRel}`);
  }

  const { sources, parseErrors, ajsonFiles } = loadSources();
  const anchor = sources.find((s) => s.path === anchorRel);
  if (!anchor) {
    softFail(`anchor has no source vector in the store: ${anchorRel} (must be an embedded vault note, vault-relative path)`);
  }

  let filteredForbidden = 0;
  let filteredOrphaned = 0;
  const scored = [];
  for (const s of sources) {
    if (s.path === anchorRel) continue;
    if (isForbidden(s.path)) { filteredForbidden++; continue; }          // condition (b): hard path filter
    if (!fs.existsSync(path.join(VAULT, s.path))) { filteredOrphaned++; continue; } // condition (b): existence filter
    scored.push({ path: s.path, score: Math.round(cosine(anchor.vec, s.vec) * 10000) / 10000 });
  }
  scored.sort((x, y) => y.score - x.score || x.path.localeCompare(y.path));
  const top = scored.slice(0, args.k);

  const stats = {
    mode: 'anchor',
    anchor: anchorRel,
    k: args.k,
    plugin_version: pluginVersion,
    model_key: MODEL_KEY,
    vec_dim: VEC_DIM,
    ajson_files: ajsonFiles,
    parse_errors: parseErrors,
    source_vectors: sources.length,
    candidates_scored: scored.length,
    filtered_forbidden_paths: filteredForbidden,
    filtered_orphaned: filteredOrphaned,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify({ results: top, stats }, null, 2) + '\n');
  } else {
    for (const r of top) process.stdout.write(`${r.score.toFixed(4)}\t${r.path}\n`);
    process.stderr.write(`semantic-query: ${JSON.stringify(stats)}\n`);
  }
}

main();
