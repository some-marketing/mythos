#!/usr/bin/env node
'use strict';

/**
 * write-edges.js — standalone, read-only MemoryDependencyEdge/1.0 writer.
 *
 * Reads existing repo artifacts (plans, concepts, debriefs, convene manifests,
 * git history) and writes inferred dependency edges to
 * _dev/state/memory-edges/edges.jsonl. Re-run REPLACES the full file (no append).
 *
 * STRICTLY read-only over all sources. Writes ONLY edges.jsonl. Makes no archival
 * or deletion decision. Records objective dependency state only (membrane PRIME LAW).
 *
 * Inference mechanism (criteria_version "v1") is specified in lib/edge-schema.js.
 *
 * Usage:  node tools/memory/dependency-edge/write-edges.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  buildEdge,
  validateEdge,
  CRITERIA_VERSION,
} = require('./lib/edge-schema');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const PATHS = {
  memoryDir: 'Mythos-memories/memory',
  memoryIndex: 'Mythos-memories/memory/MEMORY.md',
  plans: '_dev/reports/analysis/task-plans',
  concepts: '_dev/concepts',
  analysis: '_dev/reports/analysis',
  conveneRuns: '_dev/reports/analysis/convene-runs',
  outDir: '_dev/state/memory-edges',
  outFile: '_dev/state/memory-edges/edges.jsonl',
};

function abs(rel) { return path.join(REPO_ROOT, rel); }
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } }
function listDir(p) { try { return fs.readdirSync(p); } catch (_) { return []; } }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---------------------------------------------------------------------------
// Live memory universe = files under memory/ (excl MEMORY.md) ∪ MEMORY.md slugs.
// ---------------------------------------------------------------------------
function buildUniverse() {
  const universe = new Set();
  for (const f of listDir(abs(PATHS.memoryDir))) {
    if (f.endsWith('.md') && f !== 'MEMORY.md') universe.add(f.slice(0, -3));
  }
  const index = readText(abs(PATHS.memoryIndex));
  // Capture both bare "(slug.md)" and path-prefixed "(memory/slug.md)",
  // "(./slug.md)", "(any/path/slug.md)" links — keep the BASENAME slug (last
  // path segment before .md). Exclude MEMORY.md itself.
  const linkRe = /\]\((?:[^)]*\/)?([a-z0-9][a-z0-9_-]*)\.md\)/gi;
  let m;
  while ((m = linkRe.exec(index)) !== null) {
    const slug = m[1];
    if (slug.toLowerCase() !== 'memory') universe.add(slug);
  }
  return universe;
}

// ---------------------------------------------------------------------------
// Classify how each live-memory slug is referenced inside a text scope.
// Returns Map<slug, 'strong'|'weak'>.
//
// context = 'declared' (an explicit declared-dependency scope, e.g. RULE A's
//   joined grounded_in/composes_with list) | 'body' (free prose scanned whole,
//   e.g. RULE B over a concept .md).
//
//   strong:
//     'declared' -> memory-path citation, [[wikilink]], OR a bare-slug token
//                   (the declaration is explicit, so a bare token is a real claim).
//     'body'     -> ONLY a memory-path citation or a [[wikilink]]. A bare-slug
//                   token in free prose is NOT strong (false-positive vector:
//                   incidental prose mentions must not read as a detected dep).
//   weak: a bare-slug prose mention (in 'body') OR the slug only appears as a
//         "<slug>.md" filename (e.g. a same-named _dev/concepts/<slug>.md path)
//         -> ambiguous about the memory surface -> classification_uncertain.
// ---------------------------------------------------------------------------
function classifyReferences(text, universe, context) {
  context = context || 'declared';
  const found = new Map();
  if (!text) return found;
  for (const slug of universe) {
    const s = escapeRe(slug);
    const pathCite = new RegExp(`(?:Mythos-memories/memory/|(?<![\\w])memory/)${s}\\.md`).test(text);
    const wikilink = new RegExp(`\\[\\[${s}\\]\\]`).test(text);
    const bareSlug = new RegExp(`(?<![\\w/-])${s}(?!\\.md)(?![\\w-])`).test(text);
    const strong = (context === 'body')
      ? (pathCite || wikilink)
      : (pathCite || wikilink || bareSlug);
    if (strong) { found.set(slug, 'strong'); continue; }
    // In 'body', a bare-slug prose mention downgrades to weak (classification_uncertain).
    // A same-named "<slug>.md" filename is weak in either context.
    const weak = (context === 'body' && bareSlug) || new RegExp(`${s}\\.md`).test(text);
    if (weak) found.set(slug, 'weak');
  }
  return found;
}

// Extract memory slugs named via an explicit memory/ path (live OR absent).
function extractMemoryPathSlugs(text) {
  const slugs = new Set();
  const re = /(?:Mythos-memories\/memory\/|(?<![\w])memory\/)([a-z0-9][a-z0-9_-]*)\.md/g;
  let m;
  while ((m = re.exec(text)) !== null) slugs.add(m[1]);
  return slugs;
}

// ---------------------------------------------------------------------------
// RULE A — referenced_by_plan from task-plan grounded_in[] + composes_with[].
// ---------------------------------------------------------------------------
function ruleA_plans(universe, now) {
  const edges = [];
  const dir = abs(PATHS.plans);
  for (const f of listDir(dir)) {
    if (!f.endsWith('__plan.json')) continue;
    let plan;
    try { plan = JSON.parse(readText(path.join(dir, f))); } catch (_) { continue; }
    const planId = plan.task_id || f.replace(/__plan\.json$/, '');
    const declared = []
      .concat(plan.grounded_in || [])
      .concat(plan.composes_with || [])
      .filter((x) => typeof x === 'string');
    if (declared.length === 0) continue;
    const scope = declared.join('\n');
    // 'declared': an explicit grounded_in/composes_with list — a bare-slug token here is a real declaration.
    for (const [slug, strength] of classifyReferences(scope, universe, 'declared')) {
      const detected = strength === 'strong';
      edges.push(buildEdge({
        source: { kind: 'memory_key', id: slug },
        target: { kind: 'plan_id', id: planId },
        relationship: 'referenced_by_plan',
        keystone_status: detected ? 'detected' : 'classification_uncertain',
        keystone_rationale: detected
          ? `Declared in plan ${planId} grounded_in/composes_with (explicit dependency).`
          : `Plan ${planId} names "${slug}" only via a same-named non-memory path; cannot confirm the memory surface is the keystone.`,
        witness_state: detected ? 'witnessed' : 'inferred',
        generated_at: now,
      }));
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// RULE B — referenced_by_plan from concept-doc grounded_in + inline citations.
// ---------------------------------------------------------------------------
function conceptTargetId(text, slug) {
  // Parse plan_id ONLY from the YAML frontmatter block (between the leading
  // "---" line and the next "---"). A loose /m match could pick up a "plan_id:"
  // appearing anywhere in the body (code blocks, quotes), which is not authority.
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const m = fm[1].match(/^plan_id:\s*([^\s#]+)/m);
    if (m) return m[1].trim();
  }
  return slug; // no frontmatter plan_id -> concept slug = filename
}

function ruleB_concepts(universe, now) {
  const edges = [];
  const dir = abs(PATHS.concepts);
  for (const f of listDir(dir)) {
    if (!f.endsWith('.md')) continue;
    const conceptSlug = f.slice(0, -3);
    const text = readText(path.join(dir, f));
    if (!text) continue;
    const targetId = conceptTargetId(text, conceptSlug);
    // 'body': scan whole concept prose — a bare-slug mention must NOT count as detected.
    for (const [slug, strength] of classifyReferences(text, universe, 'body')) {
      if (slug === conceptSlug) continue; // a doc citing itself is not a memory dep
      const detected = strength === 'strong';
      edges.push(buildEdge({
        source: { kind: 'memory_key', id: slug },
        target: { kind: 'plan_id', id: targetId },
        relationship: 'referenced_by_plan',
        keystone_status: detected ? 'detected' : 'classification_uncertain',
        keystone_rationale: detected
          ? `Cited by concept/design ${targetId} (grounded_in or inline load-bearing reference).`
          : `Concept ${targetId} names "${slug}" only via a same-named non-memory path; ambiguous between the concept doc and the memory of that name.`,
        witness_state: detected ? 'witnessed' : 'inferred',
        generated_at: now,
      }));
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// RULE C — anchors_lesson from run-debrief memory-path mentions.
// ---------------------------------------------------------------------------
function ruleC_debriefs(universe, now) {
  const edges = [];
  const dir = abs(PATHS.analysis);
  for (const f of listDir(dir)) {
    if (!/^run-debrief__.*\.md$/.test(f)) continue;
    const lessonId = f.slice(0, -3);
    const text = readText(path.join(dir, f));
    for (const slug of extractMemoryPathSlugs(text)) {
      const live = universe.has(slug);
      edges.push(buildEdge({
        source: { kind: 'memory_key', id: slug },
        target: { kind: 'lesson_id', id: lessonId },
        relationship: 'anchors_lesson',
        keystone_status: live ? 'detected' : 'classification_uncertain',
        keystone_rationale: live
          ? `Debrief ${lessonId} names this memory as a load-bearing/produced artifact.`
          : `Debrief ${lessonId} references memory "${slug}" but it is absent from the live memory surface; cannot confirm it is currently load-bearing.`,
        witness_state: live ? 'witnessed' : 'inferred',
        generated_at: now,
      }));
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// RULE D — grounds_span from convene-run manifest context_files[].
// ---------------------------------------------------------------------------
function ruleD_spans(universe, now) {
  const edges = [];
  const dir = abs(PATHS.conveneRuns);
  for (const run of listDir(dir)) {
    const manifestPath = path.join(dir, run, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try { manifest = JSON.parse(readText(manifestPath)); } catch (_) { continue; }
    const ctx = Array.isArray(manifest.context_files) ? manifest.context_files : [];
    const text = ctx.filter((x) => typeof x === 'string').join('\n');
    for (const slug of extractMemoryPathSlugs(text)) {
      const live = universe.has(slug);
      edges.push(buildEdge({
        source: { kind: 'memory_key', id: slug },
        target: { kind: 'span_id', id: run },
        relationship: 'grounds_span',
        keystone_status: live ? 'detected' : 'classification_uncertain',
        keystone_rationale: live
          ? `Injected as grounding context_files for convene span ${run}.`
          : `Listed in context_files for span ${run} but absent from the live memory surface.`,
        witness_state: live ? 'witnessed' : 'inferred',
        generated_at: now,
      }));
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// RULE E — gates_archival_of from archival commit anchors (non-obvious).
// Commit subject need NOT contain the slug; resolved via git changed files.
// ---------------------------------------------------------------------------
function ruleE_archivalCommits(universe, now) {
  const edges = [];
  let log;
  try {
    log = execFileSync('git', ['-C', REPO_ROOT, 'log', '--all', '--format=%h%x09%s'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (_) { return edges; }
  const archivalCommits = log.split('\n')
    .map((line) => { const i = line.indexOf('\t'); return i < 0 ? null : { sha: line.slice(0, i), subject: line.slice(i + 1) }; })
    .filter((c) => c && /^memory[:(].*archiv/i.test(c.subject));
  for (const c of archivalCommits) {
    let files;
    try {
      files = execFileSync('git', ['-C', REPO_ROOT, 'show', '--pretty=format:', '--name-only', c.sha],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n');
    } catch (_) { continue; }
    for (const file of files) {
      const m = file.match(/^Mythos-memories\/memory\/([a-z0-9][a-z0-9_-]*)\.md$/);
      if (!m || m[1] === 'MEMORY') continue;
      edges.push(buildEdge({
        source: { kind: 'memory_key', id: m[1] },
        target: { kind: 'commit_anchor', id: c.sha },
        relationship: 'gates_archival_of',
        keystone_status: 'detected',
        keystone_rationale: `Archival commit ${c.sha} ("${c.subject}") is the durable anchor for this memory; moving/forgetting it relative to this commit is the archival gate.`,
        witness_state: 'witnessed',
        generated_at: now,
      }));
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Merge edges by edge_id (idempotent replace), keeping the strongest claim.
// ---------------------------------------------------------------------------
const KEYSTONE_RANK = { detected: 3, classification_uncertain: 2, not_detected: 1 };
const WITNESS_RANK = { witnessed: 4, inferred: 3, legacy_absent: 2, structurally_unwitnessable: 1, sentinel: 0 };

function mergeEdges(edges) {
  const byId = new Map();
  for (const e of edges) {
    const prev = byId.get(e.edge_id);
    if (!prev) { byId.set(e.edge_id, e); continue; }
    // Keep the WINNING EDGE AS A COHERENT WHOLE. Winner = highest keystone_status
    // rank; tie-break = highest witness rank. Its keystone_status, witness_state,
    // AND keystone_rationale travel together as one unit — never mix fields across
    // edges (that could synthesize a (status,witness) pair no single rule emitted).
    const dk = KEYSTONE_RANK[e.keystone_status] - KEYSTONE_RANK[prev.keystone_status];
    let winner;
    if (dk > 0) winner = e;
    else if (dk < 0) winner = prev;
    else winner = (WITNESS_RANK[e.witness_state] > WITNESS_RANK[prev.witness_state]) ? e : prev;
    byId.set(e.edge_id, winner);
  }
  return Array.from(byId.values());
}

// ---------------------------------------------------------------------------
// ORPHAN pass — universe memories with no reference-type edge -> not_detected.
// ---------------------------------------------------------------------------
const REFERENCE_RELATIONSHIPS = new Set(['referenced_by_plan', 'anchors_lesson', 'grounds_span']);

function orphanPass(universe, edges, now) {
  const referenced = new Set();
  for (const e of edges) {
    if (REFERENCE_RELATIONSHIPS.has(e.relationship)) referenced.add(e.source.id);
  }
  const out = [];
  for (const slug of universe) {
    if (referenced.has(slug)) continue;
    out.push(buildEdge({
      source: { kind: 'memory_key', id: slug },
      target: { kind: 'plan_id', id: null },
      relationship: 'referenced_by_plan',
      keystone_status: 'not_detected',
      keystone_rationale: 'Absence inferred over the criteria_version v1 scanned surfaces (which have known blind spots). NOT archival clearance — only "no dependency detected by v1".',
      witness_state: 'inferred',
      generated_at: now,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
function collectEdges(now) {
  now = now || new Date().toISOString();
  const universe = buildUniverse();
  let edges = [].concat(
    ruleA_plans(universe, now),
    ruleB_concepts(universe, now),
    ruleC_debriefs(universe, now),
    ruleD_spans(universe, now),
    ruleE_archivalCommits(universe, now),
  );
  edges = mergeEdges(edges);
  edges = edges.concat(orphanPass(universe, edges, now));
  // Deterministic ordering.
  edges.sort((a, b) => (a.source.id + a.edge_id).localeCompare(b.source.id + b.edge_id));
  return { universe, edges };
}

function writeEdges() {
  const now = new Date().toISOString();
  const { universe, edges } = collectEdges(now);
  const invalid = [];
  for (const e of edges) {
    const v = validateEdge(e);
    if (!v.valid) invalid.push({ edge_id: e.edge_id, errors: v.errors });
  }
  if (invalid.length) {
    console.error(`Refusing to write: ${invalid.length} invalid edge(s).`);
    console.error(JSON.stringify(invalid.slice(0, 5), null, 2));
    process.exit(1);
  }
  fs.mkdirSync(abs(PATHS.outDir), { recursive: true });
  const body = edges.map((e) => JSON.stringify(e)).join('\n') + (edges.length ? '\n' : '');
  fs.writeFileSync(abs(PATHS.outFile), body); // REPLACE (not append)

  const detected = edges.filter((e) => e.keystone_status === 'detected').length;
  const uncertain = edges.filter((e) => e.keystone_status === 'classification_uncertain').length;
  const notDetected = edges.filter((e) => e.keystone_status === 'not_detected').length;
  console.log(`criteria_version=${CRITERIA_VERSION}`);
  console.log(`memory universe: ${universe.size} keys`);
  console.log(`edges written: ${edges.length} -> ${PATHS.outFile}`);
  console.log(`  keystone detected=${detected} classification_uncertain=${uncertain} not_detected=${notDetected}`);
}

module.exports = {
  REPO_ROOT,
  PATHS,
  buildUniverse,
  classifyReferences,
  mergeEdges,
  collectEdges,
  writeEdges,
};

if (require.main === module) writeEdges();
