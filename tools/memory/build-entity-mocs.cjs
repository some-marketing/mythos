#!/usr/bin/env node
'use strict';

/**
 * build-entity-mocs.cjs — mechanically generated entity Map-of-Content hub notes.
 *
 * Plan: memory-dreaming-obsidian-improvements (step mdoi-entity-mocs).
 *
 * Reads the memory DB (_dev/state/memory-db/memory.sqlite via the sqlite3 CLI,
 * or the JSONL fallback) plus known registries (clients/<CODE>/ dirs, tools/
 * top-level dirs, memory wikilink targets) and generates one MOC note per
 * entity listing the memories/concepts that reference it, with scores.
 *
 * Gates (binding, from the plan):
 *   - One-way mirror: MOCs are written REPO-SIDE ONLY (_dev/state/memory-db/mocs/);
 *     sync-obsidian-vault.sh mirrors them into Mythos-memories/mocs/. This tool
 *     never writes into Mythos-memories/.
 *   - Client MOCs carry TITLES/PATHS ONLY — never client data. (The memory DB
 *     already excludes clients/** at ingest via its privacy floor, so every
 *     listed node is a non-client surface that merely references the code.)
 *   - Generated notes carry "generated — do not hand-edit" frontmatter.
 *
 * Determinism: content derives only from the DB + registries (no wall-clock);
 * re-running over an unchanged DB yields identical files. Advisory surface —
 * exits 0 with a message rather than failing hard when the DB is absent.
 *
 * Usage: node tools/memory/build-entity-mocs.cjs [--min-backlinks N] [--max-link-entities N]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveSqlite3 } = require('./lib/resolve-sqlite3.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DB_DIR = path.join(REPO_ROOT, '_dev', 'state', 'memory-db');
const SQLITE_PATH = path.join(DB_DIR, 'memory.sqlite');
const MOCS_DIR = path.join(DB_DIR, 'mocs');
const CLIENTS_DIR = path.join(REPO_ROOT, 'clients');
const TOOLS_DIR = path.join(REPO_ROOT, 'tools');

const MIN_BACKLINKS = num(flag('--min-backlinks'), 2);
const MAX_LINK_ENTITIES = num(flag('--max-link-entities'), 40);

function flag(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}
function num(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
}

function loadDb() {
  // Use the sqlite store only if both the DB file AND a sqlite3 binary exist;
  // otherwise fall through to the cross-platform JSONL fallback.
  const sqlite3Bin = fs.existsSync(SQLITE_PATH) ? resolveSqlite3() : null;
  if (sqlite3Bin) {
    const q = (sql) =>
      JSON.parse(
        execFileSync(sqlite3Bin, ['-json', SQLITE_PATH, sql], { encoding: 'utf8' }) || '[]'
      );
    return {
      memories: q('SELECT id, type, title, body, tags, source_path FROM memories;'),
      concepts: q('SELECT id, path, title, summary, tags, links_json FROM concepts;'),
    };
  }
  const readJsonl = (f) => {
    const p = path.join(DB_DIR, f);
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  return { memories: readJsonl('memories.jsonl'), concepts: readJsonl('concepts.jsonl') };
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function safeDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();
  } catch (_) {
    return [];
  }
}

function extractWikilinks(s) {
  const out = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(s || '')) !== null) {
    const t = m[1].split('|')[0].trim().toLowerCase();
    if (t) out.push(t);
  }
  return out;
}

function buildNodes(db) {
  const nodes = [];
  for (const m of db.memories) {
    const base = m.id.replace(/^pocket:|^kernel:/, '');
    nodes.push({
      id: m.id,
      kind: 'memory',
      title: m.title,
      ref: m.source_path ? m.source_path.replace(REPO_ROOT + path.sep, '') : m.id,
      // Vault-side path (memory dir is mirrored to vault memory/).
      vaultLink: m.id.startsWith('pocket:') ? `memory/${base}` : base,
      text: `${m.title || ''} ${m.body || ''} ${m.tags || ''}`,
      links: extractWikilinks(m.body || ''),
      slug: slugify(base),
    });
  }
  for (const c of db.concepts) {
    let links = [];
    try { links = JSON.parse(c.links_json || '[]'); } catch (_) {}
    const rel = c.path || c.id;
    nodes.push({
      id: c.id,
      kind: 'concept',
      title: c.title,
      ref: rel,
      // _dev/concepts/** mirrors to vault concepts/**.
      vaultLink: rel.replace(/^_dev\/concepts\//, 'concepts/').replace(/\.md$/, ''),
      text: `${c.title || ''} ${c.summary || ''} ${c.tags || ''}`,
      links: links.map((l) => String(l).toLowerCase()),
      slug: slugify(path.basename(rel, '.md')),
    });
  }
  return nodes;
}

/** Score a node against an entity: 2 per wikilink hit, 1 per text mention.
 * Wikilink matching is EXACT (slug equality) — substring matching produced
 * false positives (e.g. client {CLIENT_CODE} inside [[…-tech-…]]). */
function matchNode(node, entity) {
  let score = 0;
  const reasons = [];
  for (const l of node.links) {
    if (l === entity.matchToken || slugify(l) === entity.slug) {
      score += 2;
      reasons.push('wikilink');
      break;
    }
  }
  if (entity.textRe && entity.textRe.test(node.text)) {
    score += 1;
    reasons.push('mention');
  }
  return { score, reasons };
}

function collectEntities(nodes) {
  const entities = [];
  // 1. Client codes (registry: clients/<CODE>/). Titles/paths only in output.
  for (const code of safeDirs(CLIENTS_DIR)) {
    entities.push({
      kind: 'client',
      name: code,
      slug: slugify(code),
      matchToken: code.toLowerCase(),
      // No adjacent word chars OR hyphens: prevents date-shaped false
      // positives like the {CLIENT_CODE} inside YYYY-MM-DD.
      textRe: new RegExp(`(?<![\\w-])${code}(?![\\w-])`, 'i'),
      note: 'Client MOC — references by title/path only; no client data (privacy floor).',
    });
  }
  // 2. Major tools (registry: tools/<dir>/). Matched as the literal path
  //    "tools/<name>" to avoid generic-word false positives.
  for (const t of safeDirs(TOOLS_DIR)) {
    entities.push({
      kind: 'tool',
      name: `tools/${t}`,
      slug: 'tools-' + slugify(t),
      matchToken: `tools/${t}`.toLowerCase(),
      textRe: new RegExp(`tools/${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
      note: null,
    });
  }
  // 3. Recurring wikilink targets (>= MIN_BACKLINKS distinct referrers).
  const linkCounts = new Map();
  for (const n of nodes) {
    for (const l of new Set(n.links)) linkCounts.set(l, (linkCounts.get(l) || 0) + 1);
  }
  const nodeSlugs = new Set(nodes.map((n) => n.slug));
  const linkEntities = [...linkCounts.entries()]
    .filter(([l, c]) => c >= MIN_BACKLINKS)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_LINK_ENTITIES);
  for (const [target] of linkEntities) {
    const slug = slugify(target);
    entities.push({
      kind: nodeSlugs.has(slug) ? 'system' : 'system-unresolved',
      name: target,
      slug,
      matchToken: target,
      textRe: null, // wikilink-defined entities match by link only
      note: nodeSlugs.has(slug)
        ? null
        : 'Unresolved wikilink target — referenced by multiple notes but no note of this name exists yet.',
    });
  }
  return entities;
}

function renderMoc(entity, hits) {
  const lines = [];
  lines.push('---');
  lines.push('type: moc');
  lines.push('generated: true');
  lines.push('generated_note: "generated — do not hand-edit (rebuilt by tools/memory/build-entity-mocs.cjs)"');
  lines.push(`entity: "${entity.name}"`);
  lines.push(`entity_kind: ${entity.kind}`);
  lines.push('tags:');
  lines.push('  - moc');
  lines.push(`  - moc-${entity.kind.replace('-unresolved', '')}`);
  lines.push('---');
  lines.push('');
  lines.push(`# MOC — ${entity.name}`);
  lines.push('');
  if (entity.note) lines.push(`> ${entity.note}`);
  lines.push(`> Hub of ${hits.length} backlinking notes from the Mythos memory DB (memories + concepts).`);
  lines.push('');
  for (const h of hits) {
    lines.push(`- **[${h.score}]** ${h.kind} [[${h.vaultLink}|${h.title}]] — \`${h.ref}\` (${h.reasons.join('+')})`);
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  if (!fs.existsSync(SQLITE_PATH) && !fs.existsSync(path.join(DB_DIR, 'memories.jsonl'))) {
    process.stdout.write('build-entity-mocs: no memory DB found (run build-memory-db.js first). Exiting 0 (advisory surface).\n');
    return;
  }
  const db = loadDb();
  const nodes = buildNodes(db);
  const entities = collectEntities(nodes);

  fs.mkdirSync(MOCS_DIR, { recursive: true });
  // Clean previous generated set so renames don't leave stale hubs (this dir
  // is wholly owned by this generator).
  for (const f of fs.readdirSync(MOCS_DIR)) {
    if (f.endsWith('.md')) fs.unlinkSync(path.join(MOCS_DIR, f));
  }

  const summary = [];
  for (const entity of entities) {
    const hits = [];
    for (const n of nodes) {
      const { score, reasons } = matchNode(n, entity);
      if (score > 0) hits.push({ score, reasons, kind: n.kind, title: n.title, ref: n.ref, slug: n.slug, vaultLink: n.vaultLink });
    }
    hits.sort((x, y) => y.score - x.score || (x.ref < y.ref ? -1 : 1));
    if (hits.length < MIN_BACKLINKS) continue;
    const file = path.join(MOCS_DIR, `${entity.kind === 'client' ? 'client__' : entity.kind === 'tool' ? 'tool__' : 'hub__'}${entity.slug}.md`);
    fs.writeFileSync(file, renderMoc(entity, hits));
    summary.push({ entity: entity.name, kind: entity.kind, backlinks: hits.length, file: path.relative(REPO_ROOT, file) });
  }

  summary.sort((a, b) => b.backlinks - a.backlinks);
  process.stdout.write(JSON.stringify({
    schema: 'EntityMocBuild/1.0',
    mocs_written: summary.length,
    out_dir: path.relative(REPO_ROOT, MOCS_DIR),
    min_backlinks: MIN_BACKLINKS,
    entities_considered: entities.length,
    top: summary.slice(0, 15),
  }, null, 2) + '\n');
}

main();
