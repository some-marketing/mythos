#!/usr/bin/env node
/**
 * build-memory-db.js — LOCAL-ONLY memory + "dreaming" database for Mythos.
 *
 * No network calls, no external services, no heavy deps. Uses the macOS
 * preinstalled `sqlite3` CLI if present; otherwise falls back to a
 * dependency-free JSONL store under the same directory.
 *
 * INGEST (durable work only — privacy floor per doctrine.md §3b):
 *   1. Claude pocket memories  (~/.claude/projects/.../memory/*.md)
 *   2. Canonical kernel-memory  (_dev/state/kernel-memory/entries/*.json)
 *   3. Concept docs            (_dev/concepts/ ** /*.md)
 *
 * Then a deterministic, explainable DREAMING pass surfaces non-obvious
 * associations (shared tags / shared [[wikilinks]] / shared rare terms)
 * and writes a readable dream-report.md.
 *
 * Re-runnable / idempotent: rebuilds the store from scratch each run.
 *
 * Usage:  node tools/memory/build-memory-db.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { resolveSqlite3 } = require('./lib/resolve-sqlite3.cjs');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const POCKET_MEMORY_DIR = path.join(
  os.homedir(),
  '.claude',
  'projects',
  '{PROJECT_SLUG}',
  'memory'
);
const KERNEL_ENTRIES_DIR = path.join(REPO_ROOT, '_dev', 'state', 'kernel-memory', 'entries');
const CONCEPTS_DIR = path.join(REPO_ROOT, '_dev', 'concepts');
const OUT_DIR = path.join(REPO_ROOT, '_dev', 'state', 'memory-db');
const SQLITE_PATH = path.join(OUT_DIR, 'memory.sqlite');
const DREAM_REPORT_PATH = path.join(OUT_DIR, 'dream-report.md');

// Privacy floor: directory substrings that must never be ingested.
const FORBIDDEN_PATH_SUBSTRINGS = [
  path.sep + 'clients' + path.sep,
  path.sep + 'research' + path.sep + '{OPERATOR_NAME}-philosophy' + path.sep,
  '.env',
];

// ---------------------------------------------------------------------------
// sqlite3 detection
// ---------------------------------------------------------------------------
function detectSqlite3() {
  // Cross-platform binary resolution (win32 `where`, macOS/Linux `which`,
  // common install paths, SMOS_SQLITE3 override). Null → JSONL fallback.
  return resolveSqlite3();
}

// ---------------------------------------------------------------------------
// Small text utilities
// ---------------------------------------------------------------------------
const STOPWORDS = new Set(
  ('a an the and or but if then else of to in on at by for with from into over under as is are was '
    + 'were be been being it its this that these those there here not no nor so than too very can will '
    + 'just only also more most some any all each every both either neither he she they them we you i '
    + 'me my your our their his her do does did done has have had having which who whom whose what when '
    + 'where why how which while about above after again against because before below between during '
    + 'further once out off up down via per such own same other another up vs etc ie eg one two three '
    + 'must never always need needs would should could may might shall let lets get got make made use '
    + 'used using new now per via like upon within without across among toward towards onto thru '
    + 'sm os dev md json file files path paths run runs task tasks claim claims actor actors operator '
    + 'state work works concept concepts memory memories note notes per the').split(/\s+/)
);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/\[\[[^\]]*\]\]/g, ' ') // drop wikilink syntax from token stream
    .replace(/https?:\/\/\S+/g, ' ') // drop urls
    .replace(/[^a-z0-9'+-]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[-'+]+|[-'+]+$/g, ''))
    .filter((t) => t.length >= 4 && t.length <= 30 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function extractWikilinks(text) {
  const links = new Set();
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(text || '')) !== null) {
    // strip any |alias and surrounding whitespace
    const target = m[1].split('|')[0].trim().toLowerCase();
    if (target) links.add(target);
  }
  return [...links];
}

function normalizeTag(t) {
  return String(t).trim().toLowerCase().replace(/^#/, '');
}

// ---------------------------------------------------------------------------
// Parse YAML-ish frontmatter (no yaml dep — handles the simple shapes here)
// ---------------------------------------------------------------------------
function splitFrontmatter(raw) {
  if (!raw.startsWith('---')) return { fm: null, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { fm: null, body: raw };
  const fmText = raw.slice(3, end).replace(/^\n/, '');
  const body = raw.slice(end + 4).replace(/^\s*\n/, '');
  return { fm: fmText, body };
}

function parseFrontmatter(fmText) {
  // Very small parser: top-level `key: value`, one level of nesting under a
  // key that has no inline value, and inline `[a, b]` lists.
  const out = {};
  if (!fmText) return out;
  const lines = fmText.split('\n');
  let parentKey = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.match(/^(\s*)/)[1].length;
    const mm = line.match(/^\s*([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!mm) continue;
    const key = mm[1];
    let val = mm[2].trim();
    if (indent >= 2 && parentKey) {
      out[parentKey] = out[parentKey] || {};
      out[parentKey][key] = stripQuotes(val);
      continue;
    }
    parentKey = null;
    if (val === '') {
      parentKey = key;
      out[key] = {};
    } else {
      out[key] = parseScalarOrList(val);
    }
  }
  return out;
}

function stripQuotes(s) {
  return String(s).replace(/^["']|["']$/g, '').trim();
}

function parseScalarOrList(val) {
  val = val.trim();
  if (val.startsWith('[') && val.endsWith(']')) {
    return val
      .slice(1, -1)
      .split(',')
      .map((x) => stripQuotes(x))
      .filter(Boolean);
  }
  return stripQuotes(val);
}

// ---------------------------------------------------------------------------
// First markdown heading + first prose paragraph / Status-Decision line
// ---------------------------------------------------------------------------
function firstHeading(body, fallback) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function shortSummary(body) {
  const lines = body.split('\n');
  // Prefer an explicit Status / Decision / Identified line.
  for (const line of lines) {
    const m = line.match(/^\s*\*\*(Status|Decision|Verdict|Identified|Context)\:?\*\*\s*(.+)$/i);
    if (m && m[2].trim().length > 8) return collapse(`${m[1]}: ${m[2]}`);
  }
  // Else first non-heading, non-frontmatter-delimiter, non-blank paragraph.
  let buf = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (buf.length) break;
      continue;
    }
    if (t.startsWith('#') || t === '---' || t.startsWith('**Identified')) continue;
    buf.push(t);
    if (buf.join(' ').length > 240) break;
  }
  return collapse(buf.join(' '));
}

function collapse(s) {
  return s.replace(/\s+/g, ' ').trim().slice(0, 400);
}

function isForbidden(p) {
  const norm = p;
  return FORBIDDEN_PATH_SUBSTRINGS.some((sub) => norm.includes(sub));
}

// ---------------------------------------------------------------------------
// Ingest: pocket memories
// ---------------------------------------------------------------------------
function ingestPocketMemories() {
  const rows = [];
  const skipped = [];
  if (!fs.existsSync(POCKET_MEMORY_DIR)) return { rows, skipped };
  for (const name of fs.readdirSync(POCKET_MEMORY_DIR).sort()) {
    if (!name.endsWith('.md')) continue;
    if (name === 'MEMORY.md') {
      skipped.push({ path: name, reason: 'memory index, not a memory entry' });
      continue;
    }
    const full = path.join(POCKET_MEMORY_DIR, name);
    const raw = fs.readFileSync(full, 'utf8');
    const { fm, body } = splitFrontmatter(raw);
    const meta = parseFrontmatter(fm);
    const id = 'pocket:' + name.replace(/\.md$/, '');
    const type =
      (meta.metadata && meta.metadata.type) || meta.type || inferTypeFromName(name) || 'memory';
    const title = meta.name || name.replace(/\.md$/, '');
    rows.push({
      id,
      type,
      title,
      body: collapse(meta.description ? meta.description + ' — ' + body : body).slice(0, 4000),
      tags: dedupe(collectTags(meta)),
      links: extractWikilinks(body),
      source_path: full,
      created: fileCreated(full),
      mtimeMs: fileMtimeMs(full),
    });
  }
  return { rows, skipped };
}

function inferTypeFromName(name) {
  const m = name.match(/^([a-z]+)_/);
  if (m) return m[1];
  if (name.startsWith('feedback')) return 'feedback';
  return null;
}

function collectTags(meta) {
  const tags = [];
  if (Array.isArray(meta.tags)) tags.push(...meta.tags);
  else if (typeof meta.tags === 'string' && meta.tags) tags.push(meta.tags);
  return tags.map(normalizeTag).filter(Boolean);
}

function dedupe(arr) {
  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
}

function fileCreated(full) {
  try {
    return fs.statSync(full).birthtime.toISOString();
  } catch (_) {
    return new Date().toISOString();
  }
}

function fileMtimeMs(full) {
  try {
    return Math.round(fs.statSync(full).mtimeMs);
  } catch (_) {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Ingest: canonical kernel-memory entries
// PRIVACY FLOOR: skip entries that capture operator personal data (location,
// physical identity) — those are not durable WORK. We flag and report them.
// ---------------------------------------------------------------------------
const PII_MARKERS =
  /\b(gps|coordinates|latitude|longitude|location|home address|residential|drone|physical identity|where (i|the operator) live)\b/i;

function ingestKernelMemory() {
  const rows = [];
  const skipped = [];
  if (!fs.existsSync(KERNEL_ENTRIES_DIR)) return { rows, skipped };
  for (const name of fs.readdirSync(KERNEL_ENTRIES_DIR).sort()) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(KERNEL_ENTRIES_DIR, name);
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      skipped.push({ path: full, reason: 'unparseable JSON: ' + e.message });
      continue;
    }
    const blob = `${entry.title || ''} ${entry.body || ''}`;
    if (PII_MARKERS.test(blob)) {
      skipped.push({
        path: full,
        reason: 'privacy floor: entry captures operator personal/location data, not durable work',
      });
      continue;
    }
    const body = entry.body || '';
    rows.push({
      id: 'kernel:' + (entry.id || name.replace(/\.json$/, '')),
      type: 'kernel-' + (entry.type || 'memory'),
      title: entry.title || entry.id || name,
      body: collapse(body).slice(0, 4000),
      tags: dedupe((entry.tags || []).map(normalizeTag)),
      links: extractWikilinks(body),
      source_path: full,
      created: entry.created_ts || fileCreated(full),
      mtimeMs: fileMtimeMs(full),
    });
  }
  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// Ingest: concept docs
// ---------------------------------------------------------------------------
function walkMd(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return acc;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) {
      // Resolve; skip dangling links and links that escape into transcripts/forbidden areas.
      try {
        const real = fs.realpathSync(full);
        if (!fs.existsSync(real)) continue;
        if (isForbidden(real)) continue;
        if (/chat-log|transcript|session-log/i.test(real)) continue;
        if (real.endsWith('.md')) acc.push({ full, real });
      } catch (_) {
        // dangling symlink — skip
      }
      continue;
    }
    if (ent.isDirectory()) {
      walkMd(full, acc);
    } else if (ent.isFile() && ent.name.endsWith('.md')) {
      acc.push({ full, real: full });
    }
  }
  return acc;
}

function ingestConcepts() {
  const rows = [];
  const skipped = [];
  const files = walkMd(CONCEPTS_DIR, []);
  for (const { full, real } of files) {
    if (isForbidden(real)) {
      skipped.push({ path: full, reason: 'privacy floor: forbidden path' });
      continue;
    }
    if (/chat-log|transcript|session-log/i.test(real)) {
      skipped.push({ path: full, reason: 'transcript/chat-log excluded by privacy floor' });
      continue;
    }
    let raw;
    try {
      raw = fs.readFileSync(real, 'utf8');
    } catch (e) {
      skipped.push({ path: full, reason: 'read error: ' + e.message });
      continue;
    }
    const { fm, body } = splitFrontmatter(raw);
    const meta = parseFrontmatter(fm);
    const relPath = path.relative(REPO_ROOT, full);
    const title = meta.title || firstHeading(body, path.basename(full, '.md'));
    const links = extractWikilinks(body);
    rows.push({
      id: 'concept:' + relPath,
      path: relPath,
      title,
      summary: shortSummary(body),
      tags: dedupe(collectTags(meta)),
      links,
      mtimeMs: fileMtimeMs(real),
      // keep a body sample for term mining only (not stored verbatim beyond summary)
      _termSource: title + ' ' + body,
    });
  }
  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// Build a unified node list for the dreaming pass.
// Each node: {key, kind, id, title, tags[], links[], terms:Map<term,count>}
// ---------------------------------------------------------------------------
function buildNodes(memories, concepts) {
  const nodes = [];
  for (const m of memories) {
    nodes.push({
      key: m.id,
      kind: 'memory',
      id: m.id,
      title: m.title,
      tags: m.tags,
      links: m.links,
      termSource: `${m.title} ${m.body} ${m.tags.join(' ')}`,
      mtimeMs: m.mtimeMs || 0,
      domain: 'memory/' + (m.type || 'memory'),
    });
  }
  for (const c of concepts) {
    nodes.push({
      key: c.id,
      kind: 'concept',
      id: c.id,
      title: c.title,
      tags: c.tags,
      links: c.links,
      termSource: c._termSource || `${c.title} ${c.summary}`,
      selfPath: c.path,
      mtimeMs: c.mtimeMs || 0,
      domain: conceptDomain(c.path),
    });
  }
  return nodes;
}

/** Coarse mechanical domain bucket for a concept: first path segment under
 * _dev/concepts/ (bundle dir name, subdir, or flat-file basename). */
function conceptDomain(relPath) {
  const parts = String(relPath).split(path.sep);
  const idx = parts.indexOf('concepts');
  const seg = idx !== -1 && parts.length > idx + 1 ? parts[idx + 1] : parts[parts.length - 1];
  return 'concepts/' + seg.replace(/\.md$/, '');
}

// ---------------------------------------------------------------------------
// DREAMING PASS — deterministic associative recombination, no LLM.
//   score = 3.0 * sharedRareTermScore
//         + 2.5 * sharedWikilink
//         + 2.0 * (one node links to the other)
//         + 1.5 * sharedTag
// A "rare" term is distinctive: low document frequency across the corpus.
// We weight shared terms by inverse document frequency so common words add
// little and an uncommon shared term ("investiture", "demiurge") dominates.
// ---------------------------------------------------------------------------
const THRESHOLD = 3.0;
const MAX_DREAMS = 25;

// --- Diversity / preservation / novelty configuration (plan
// memory-dreaming-obsidian-improvements, step mdoi-dream-diversity;
// amendment 20260610T111449Z AMD-4 + AMD-5). Documented in
// _dev/concepts/dreaming-system/concept.md → Configuration. -----------------
// Per-node cap: a single node may appear in at most this many surfaced
// associations per report section (structural de-monopolization).
const PER_NODE_CAP = 3;
// Inverse-degree penalty exponent: surfacing score divides by
// sqrt(log2(2+degA)·log2(2+degB)) — hub nodes of densely self-linked
// clusters are dampened without being removed (preferred over raw recency
// decay per AMD-5: old high-value cross-domain links must not be buried).
// Novelty: repeatedly surfaced pairs decay by 1/(1 + SEEN_DOWNWEIGHT·seen).
// seen counts persist across from-scratch rebuilds in SEEN_SIDECAR_PATH and
// are part of "sidecar state" for the determinism gate (AMD-4): same corpus
// + same sidecar ⇒ byte-identical report (verify with --freeze-seen twice).
const SEEN_DOWNWEIGHT = 0.5;
// Preservation (AMD-5): associations whose OLDER endpoint is at least
// OLD_DAYS older than the corpus time anchor AND whose endpoints live in
// different domains get a guaranteed dedicated report section (top
// OLD_SLOTS by surfacing score). The time anchor is corpus-internal
// (newest node mtime), never wall-clock (AMD-4 determinism).
const OLD_DAYS = 14;
const OLD_SLOTS = 10;
const SEEN_SIDECAR_PATH = path.join(OUT_DIR, 'dream-seen.json');

function buildDreams(nodes) {
  const N = nodes.length;
  // term -> document frequency
  const df = new Map();
  for (const node of nodes) {
    node.termSet = new Set(tokenize(node.termSource));
    for (const t of node.termSet) df.set(t, (df.get(t) || 0) + 1);
  }
  // idf weight; ignore terms appearing in >40% of docs (not distinctive)
  const idf = new Map();
  const maxDf = Math.max(2, Math.floor(N * 0.4));
  for (const [t, d] of df) {
    if (d < 2) continue; // must be shared by at least 2 docs to ever co-occur
    if (d > maxDf) continue; // too common to be salient
    idf.set(t, Math.log((N + 1) / d));
  }

  // Build a slug index so wikilinks/self-paths can match nodes.
  const slugIndex = new Map(); // slug -> node
  for (const node of nodes) {
    for (const s of nodeSlugs(node)) {
      if (!slugIndex.has(s)) slugIndex.set(s, node);
    }
  }

  const pairs = [];
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const reasons = [];
      let score = 0;

      // shared tags
      const sharedTags = intersect(a.tags, b.tags);
      for (const t of sharedTags) {
        score += 1.5;
        reasons.push(`shared tag '${t}'`);
      }

      // shared wikilinks
      const sharedLinks = intersect(a.links, b.links);
      for (const l of sharedLinks) {
        score += 2.5;
        reasons.push(`shared link [[${l}]]`);
      }

      // one links to the other (directional)
      if (linksTo(a, b, slugIndex)) {
        score += 2.0;
        reasons.push(`${shortKey(a)} links to ${shortKey(b)}`);
      }
      if (linksTo(b, a, slugIndex)) {
        score += 2.0;
        reasons.push(`${shortKey(b)} links to ${shortKey(a)}`);
      }

      // shared rare/salient terms
      const sharedTerms = [];
      for (const t of a.termSet) {
        if (b.termSet.has(t) && idf.has(t)) sharedTerms.push(t);
      }
      sharedTerms.sort((x, y) => idf.get(y) - idf.get(x));
      let termScore = 0;
      const topTerms = sharedTerms.slice(0, 3);
      for (const t of topTerms) termScore += idf.get(t);
      if (termScore > 0) {
        score += 3.0 * (termScore / 4); // normalize: ~4 idf ≈ one strong term
        reasons.push(`shared rare term${topTerms.length > 1 ? 's' : ''} ${topTerms.map((t) => `'${t}'`).join('+')}`);
      }

      if (score >= THRESHOLD) {
        pairs.push({
          a_id: a.id,
          a_kind: a.kind,
          a_title: a.title,
          b_id: b.id,
          b_kind: b.kind,
          b_title: b.title,
          a_mtimeMs: a.mtimeMs,
          b_mtimeMs: b.mtimeMs,
          a_domain: a.domain,
          b_domain: b.domain,
          basis: reasons.join('; '),
          score: round(score),
          // mark "non-obvious": NO authored connection at all — no shared tag,
          // no shared [[wikilink]], no directional link between them — the pair
          // is bridged purely by shared rare/salient terms. This is the real
          // "dreaming" surface: concepts never authored together yet sharing
          // distinctive vocabulary.
          nonObvious:
            sharedTags.length === 0 &&
            sharedLinks.length === 0 &&
            !linksTo(a, b, slugIndex) &&
            !linksTo(b, a, slugIndex) &&
            termScore > 0 &&
            topTerms.length > 0,
        });
      }
    }
  }
  // Deterministic order: score desc, then stable id tie-break (AMD-4).
  pairs.sort((x, y) => y.score - x.score || cmp(x.a_id, y.a_id) || cmp(x.b_id, y.b_id));
  return pairs;
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// SURFACING PASS — diversity + novelty + preservation (AMD-4 / AMD-5).
// Pure function of (pairs, seen sidecar, corpus anchor): deterministic.
// ---------------------------------------------------------------------------
function pairKey(d) {
  return [d.a_id, d.b_id].sort().join(' || ');
}

function loadSeen() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SEEN_SIDECAR_PATH, 'utf8'));
    return parsed && typeof parsed.pairs === 'object' ? parsed : { schema: 'DreamSeen/1.0', pairs: {} };
  } catch (_) {
    return { schema: 'DreamSeen/1.0', pairs: {} };
  }
}

function saveSeen(seen) {
  // Stable key order so the sidecar itself is deterministic.
  const sorted = {};
  for (const k of Object.keys(seen.pairs).sort()) sorted[k] = seen.pairs[k];
  fs.writeFileSync(
    SEEN_SIDECAR_PATH,
    JSON.stringify({ schema: 'DreamSeen/1.0', pairs: sorted }, null, 2) + '\n'
  );
}

/** Greedy per-node-capped selection over a deterministically sorted list. */
function capSelect(sortedPairs, limit, capPerNode) {
  const out = [];
  const nodeCount = new Map();
  for (const d of sortedPairs) {
    if (out.length >= limit) break;
    const ca = nodeCount.get(d.a_id) || 0;
    const cb = nodeCount.get(d.b_id) || 0;
    if (ca >= capPerNode || cb >= capPerNode) continue;
    out.push(d);
    nodeCount.set(d.a_id, ca + 1);
    nodeCount.set(d.b_id, cb + 1);
  }
  return out;
}

function surfaceDreams(pairs, seen) {
  // Corpus-internal time anchor (AMD-4): newest node mtime among pair
  // endpoints — never wall-clock.
  let anchorMs = 0;
  const degree = new Map();
  for (const d of pairs) {
    if (d.a_mtimeMs > anchorMs) anchorMs = d.a_mtimeMs;
    if (d.b_mtimeMs > anchorMs) anchorMs = d.b_mtimeMs;
    degree.set(d.a_id, (degree.get(d.a_id) || 0) + 1);
    degree.set(d.b_id, (degree.get(d.b_id) || 0) + 1);
  }

  const scored = pairs.map((d) => {
    const degA = degree.get(d.a_id) || 0;
    const degB = degree.get(d.b_id) || 0;
    const degreeFactor = Math.sqrt(Math.log2(2 + degA) * Math.log2(2 + degB));
    const seenCount = (seen.pairs[pairKey(d)] && seen.pairs[pairKey(d)].seen) || 0;
    const novelty = 1 / (1 + SEEN_DOWNWEIGHT * seenCount);
    return Object.assign({}, d, {
      degree_a: degA,
      degree_b: degB,
      seen_count: seenCount,
      surface_score: round((d.score * novelty) / degreeFactor),
    });
  });
  scored.sort(
    (x, y) => y.surface_score - x.surface_score || cmp(x.a_id, y.a_id) || cmp(x.b_id, y.b_id)
  );

  const top = capSelect(scored, MAX_DREAMS, PER_NODE_CAP);
  const nonObvious = capSelect(scored.filter((d) => d.nonObvious), MAX_DREAMS, PER_NODE_CAP);

  // Preservation (AMD-5): old cross-domain associations keep a dedicated
  // section so de-monopolization can never bury them.
  const oldCutoffMs = anchorMs - OLD_DAYS * 86400000;
  const preserved = capSelect(
    scored.filter(
      (d) => d.a_domain !== d.b_domain && Math.min(d.a_mtimeMs, d.b_mtimeMs) <= oldCutoffMs
    ),
    OLD_SLOTS,
    PER_NODE_CAP
  );

  return { top, nonObvious, preserved, anchorMs, oldCutoffMs };
}

function nodeSlugs(node) {
  const out = new Set();
  // title slug
  out.add(slugify(node.title));
  // id-based slugs
  if (node.kind === 'memory') {
    out.add(node.id.replace(/^pocket:/, '').replace(/^kernel:/, '').toLowerCase());
  }
  if (node.selfPath) {
    out.add(node.selfPath.toLowerCase());
    out.add(path.basename(node.selfPath, '.md').toLowerCase());
  }
  return [...out].filter(Boolean);
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function linksTo(from, to, slugIndex) {
  const targets = new Set();
  for (const s of nodeSlugs(to)) targets.add(s);
  for (const l of from.links) {
    const ls = l.toLowerCase();
    if (targets.has(ls)) return true;
    if (targets.has(slugify(l))) return true;
    // path-style link basename match
    const base = path.basename(ls, '.md');
    if (targets.has(base)) return true;
  }
  return false;
}

function shortKey(n) {
  return n.kind === 'concept' ? path.basename(n.id, '.md') : n.id.replace(/^pocket:|^kernel:/, '');
}

function intersect(a, b) {
  const setB = new Set(b);
  return [...new Set(a)].filter((x) => setB.has(x));
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Persistence — sqlite3 CLI path
// ---------------------------------------------------------------------------
function sqlEscape(v) {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function persistSqlite(sqlite3Bin, memories, concepts, dreams) {
  if (fs.existsSync(SQLITE_PATH)) fs.unlinkSync(SQLITE_PATH); // idempotent rebuild

  const stmts = [];
  stmts.push('BEGIN;');
  stmts.push(`CREATE TABLE memories (
    id TEXT PRIMARY KEY, type TEXT, title TEXT, body TEXT,
    tags TEXT, source_path TEXT, created TEXT
  );`);
  stmts.push(`CREATE TABLE concepts (
    id TEXT PRIMARY KEY, path TEXT, title TEXT, summary TEXT,
    tags TEXT, links_json TEXT
  );`);
  stmts.push(`CREATE TABLE associations (
    a_id TEXT, a_kind TEXT, b_id TEXT, b_kind TEXT, basis TEXT, score REAL
  );`);

  for (const m of memories) {
    stmts.push(
      `INSERT INTO memories (id,type,title,body,tags,source_path,created) VALUES (${[
        sqlEscape(m.id),
        sqlEscape(m.type),
        sqlEscape(m.title),
        sqlEscape(m.body),
        sqlEscape(m.tags.join(', ')),
        sqlEscape(m.source_path),
        sqlEscape(m.created),
      ].join(',')});`
    );
  }
  for (const c of concepts) {
    stmts.push(
      `INSERT INTO concepts (id,path,title,summary,tags,links_json) VALUES (${[
        sqlEscape(c.id),
        sqlEscape(c.path),
        sqlEscape(c.title),
        sqlEscape(c.summary),
        sqlEscape(c.tags.join(', ')),
        sqlEscape(JSON.stringify(c.links)),
      ].join(',')});`
    );
  }
  for (const d of dreams) {
    stmts.push(
      `INSERT INTO associations (a_id,a_kind,b_id,b_kind,basis,score) VALUES (${[
        sqlEscape(d.a_id),
        sqlEscape(d.a_kind),
        sqlEscape(d.b_id),
        sqlEscape(d.b_kind),
        sqlEscape(d.basis),
        d.score,
      ].join(',')});`
    );
  }
  stmts.push('CREATE INDEX idx_assoc_score ON associations(score DESC);');
  stmts.push('COMMIT;');
  stmts.push('VACUUM;'); // single self-contained file, no WAL sidecars

  execFileSync(sqlite3Bin, [SQLITE_PATH], { input: stmts.join('\n'), encoding: 'utf8' });
}

// ---------------------------------------------------------------------------
// Persistence — JSONL fallback
// ---------------------------------------------------------------------------
function persistJsonl(memories, concepts, dreams) {
  const w = (file, rows) =>
    fs.writeFileSync(path.join(OUT_DIR, file), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  w('memories.jsonl', memories.map((m) => ({
    id: m.id, type: m.type, title: m.title, body: m.body,
    tags: m.tags.join(', '), source_path: m.source_path, created: m.created,
  })));
  w('concepts.jsonl', concepts.map((c) => ({
    id: c.id, path: c.path, title: c.title, summary: c.summary,
    tags: c.tags.join(', '), links_json: JSON.stringify(c.links),
  })));
  w('associations.jsonl', dreams.map((d) => ({
    a_id: d.a_id, a_kind: d.a_kind, b_id: d.b_id, b_kind: d.b_kind,
    basis: d.basis, score: d.score,
  })));
}

// ---------------------------------------------------------------------------
// Dream report (readable)
// ---------------------------------------------------------------------------
function writeDreamReport(surfaced, counts, store) {
  const { top, nonObvious, preserved, anchorMs } = surfaced;
  const anchorIso = anchorMs ? new Date(anchorMs).toISOString() : 'n/a';
  const entry = (d, i) =>
    `${i + 1}. **[${d.surface_score}]** ${d.a_kind} *${d.a_title}* ⟷ ${d.b_kind} *${d.b_title}*`;
  const basisLine = (d) =>
    `   - basis: ${d.basis} (raw ${d.score}; deg ${d.degree_a}/${d.degree_b}; seen ${d.seen_count}x)`;
  const lines = [];
  lines.push('# Mythos Dream Report — associative recombination');
  lines.push('');
  // Corpus-internal time anchor, NOT wall-clock — same corpus + same sidecar
  // must yield a byte-identical report (AMD-4 determinism gate).
  lines.push(`Corpus anchor: ${anchorIso} (newest node mtime — deterministic, no wall-clock)`);
  lines.push(`Store: ${store}`);
  lines.push('');
  lines.push(
    `Corpus: ${counts.memories} memories + ${counts.concepts} concepts = ${counts.memories + counts.concepts} nodes; ` +
      `${counts.associations} associations above threshold ${THRESHOLD}.`
  );
  lines.push('');
  lines.push(
    'Each association is deterministic and explainable: raw score = 3.0·(shared rare terms, idf-weighted) ' +
      '+ 2.5·(shared [[wikilink]]) + 2.0·(directional link) + 1.5·(shared tag).'
  );
  lines.push(
    `Surfacing score = raw ÷ sqrt(log2(2+degA)·log2(2+degB)) × 1/(1+${SEEN_DOWNWEIGHT}·seen) — ` +
      `inverse-degree de-monopolization + seen-count novelty decay; per-node cap ${PER_NODE_CAP} per section ` +
      '(plan mdoi-dream-diversity, AMD-5).'
  );
  lines.push('');
  lines.push('## Top associations');
  lines.push('');
  top.forEach((d, i) => {
    lines.push(entry(d, i));
    lines.push(basisLine(d));
  });
  lines.push('');
  lines.push(
    '## Most non-obvious (no shared tag, no shared link, no directional link — bridged purely by shared rare terms)'
  );
  lines.push('');
  if (!nonObvious.length) {
    lines.push('_(none above threshold)_');
  }
  nonObvious.forEach((d, i) => {
    lines.push(entry(d, i));
    lines.push(basisLine(d));
  });
  lines.push('');
  lines.push(
    `## Old cross-domain dreams (preserved — older endpoint ≥${OLD_DAYS}d before corpus anchor, endpoints in different domains; guaranteed section per AMD-5)`
  );
  lines.push('');
  if (!preserved.length) {
    lines.push('_(none above threshold)_');
  }
  preserved.forEach((d, i) => {
    lines.push(entry(d, i));
    lines.push(`   - domains: ${d.a_domain} ⟷ ${d.b_domain}`);
    lines.push(basisLine(d));
  });
  lines.push('');
  fs.writeFileSync(DREAM_REPORT_PATH, lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  // --freeze-seen: do not mutate the seen sidecar (used for the AMD-4
  // determinism check: two consecutive --freeze-seen runs must byte-match).
  const freezeSeen = process.argv.includes('--freeze-seen');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sqlite3Bin = detectSqlite3();

  const pocket = ingestPocketMemories();
  const kernel = ingestKernelMemory();
  const memories = pocket.rows.concat(kernel.rows);
  const conceptsRes = ingestConcepts();
  const concepts = conceptsRes.rows;

  const nodes = buildNodes(memories, concepts);
  const dreams = buildDreams(nodes);

  const counts = {
    memories: memories.length,
    concepts: concepts.length,
    associations: dreams.length,
  };

  let store;
  if (sqlite3Bin) {
    persistSqlite(sqlite3Bin, memories, concepts, dreams);
    store = path.relative(REPO_ROOT, SQLITE_PATH) + ' (sqlite3 ' + sqlite3Bin + ')';
  } else {
    persistJsonl(memories, concepts, dreams);
    store = 'JSONL fallback under ' + path.relative(REPO_ROOT, OUT_DIR);
  }

  const seen = loadSeen();
  const surfaced = surfaceDreams(dreams, seen);
  writeDreamReport(surfaced, counts, store);

  // Anti-staleness reinforcement: surfaced pairs accrue seen-count so they
  // decay in future reports. Skipped under --freeze-seen.
  if (!freezeSeen) {
    for (const d of [...surfaced.top, ...surfaced.nonObvious, ...surfaced.preserved]) {
      const k = pairKey(d);
      const cur = seen.pairs[k] || { seen: 0 };
      seen.pairs[k] = { seen: cur.seen + 1, last_anchor_ms: surfaced.anchorMs };
    }
    saveSeen(seen);
  }

  const skipped = [...pocket.skipped, ...kernel.skipped, ...conceptsRes.skipped];
  const report = {
    store,
    sqlite3: sqlite3Bin || null,
    counts,
    corpus_anchor_iso: surfaced.anchorMs ? new Date(surfaced.anchorMs).toISOString() : null,
    surfacing: {
      per_node_cap: PER_NODE_CAP,
      seen_downweight: SEEN_DOWNWEIGHT,
      old_days: OLD_DAYS,
      preserved_count: surfaced.preserved.length,
      seen_sidecar: path.relative(REPO_ROOT, SEEN_SIDECAR_PATH),
      seen_frozen: freezeSeen,
    },
    skipped,
    dream_report: path.relative(REPO_ROOT, DREAM_REPORT_PATH),
    top_examples: surfaced.top.slice(0, 5).map((d) => ({
      a: `${d.a_kind}:${d.a_title}`,
      b: `${d.b_kind}:${d.b_title}`,
      score: d.surface_score,
      raw_score: d.score,
      basis: d.basis,
    })),
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main();
