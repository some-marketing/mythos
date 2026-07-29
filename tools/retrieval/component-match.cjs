#!/usr/bin/env node
'use strict';

/**
 * component-match.cjs — S4 of composable-framework-substrate.
 *
 * Fuzzy component retrieval across ALL frameworks: given a task description,
 * rank transferable components so planning adopts cross-compatible skills
 * instead of re-deriving them via inference (operator resolution 2026-06-11
 * backing OMEGA: idf-weighted matching is the PRIMARY ranking layer from v1;
 * exact tag-overlap is only a fast pre-boost, never a gate).
 *
 * Scoring (dreaming-system shape, query→node):
 *   score = Σ idf(term) × field_weight   over terms shared with the node
 *   weights: curated similarity_tags 3.0, name 2.5, description 2.0,
 *            surfaces/domain 1.5, lineage evidence/preconditions 1.25,
 *            transfer_notes 1.0
 * idf = ln(N / df) over the node corpus, so rare shared terms dominate —
 * 'redirect-matrix' connects, 'the' does not.
 *
 * Output carries basis (which terms/tags matched, per field) and a transfer
 * distance label WITH its evidence [CONVENE-A2/GROUNDING-ADJ #3]:
 *   use-as-is       — curated transfer_notes say the component transfers as-is
 *                     AND curated tags matched
 *   moderate-tweak  — curated tag match plus corroborating term overlap
 *   pattern-only    — description/lineage overlap only
 * thin_evidence=true whenever the basis is a single field or single term —
 * "weak basis, treat as pattern-only" is stated, not hidden.
 *
 * Tags rank but never gate existence: zero-score components simply rank
 * nowhere; they remain findable by path/description in the corpus itself.
 *
 * Usage:
 *   node tools/retrieval/component-match.cjs --task "<description>" [--top N] [--json]
 */

const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const { buildComponentIndex } = require('../planning/component-index.cjs');

const STOPWORDS = new Set((
  'a an and are as at be by for from has have if in into is it its of on or '
  + 'that the their then this to was were will with we you your not no do '
  + 'does done after before when where which who all any each per via'
).split(' '));

/** Light stem: plural -s ('links'~'link') and -ing ('rendering'~'render'). */
function stem(t) {
  if (t.length > 6 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

function tokenize(text) {
  const out = new Set();
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9_-]+/)) {
    if (raw.length <= 2 || STOPWORDS.has(raw)) continue;
    out.add(stem(raw));
    // Compound tags ('broken-links', 'redirect-matrix') also index their
    // constituents, so a query saying 'links' or 'redirect' still connects —
    // the convene's named rigidity case.
    for (const part of raw.split(/[-_]/)) {
      if (part.length > 2 && !STOPWORDS.has(part)) out.add(stem(part));
    }
  }
  return [...out];
}

function nodeFields(n) {
  return {
    tags: tokenize(n.tags.similarity_tags.join(' ')),
    name: tokenize(n.name.replace(/_/g, ' ')),
    description: tokenize(n.description),
    context: tokenize([n.tags.domain, ...n.tags.surfaces, n.framework_id].join(' ')),
    lineage: tokenize([...n.lineage.preconditions, ...n.lineage.evidence_obligations].join(' ')),
    notes: tokenize(n.tags.transfer_notes)
  };
}

const FIELD_WEIGHTS = {
  tags: 3.0,
  name: 2.5,
  description: 2.0,
  context: 1.5,
  // Lineage terms are framework-level — every sibling component shares them,
  // so they corroborate rather than rank (Codex S5 review, MINOR).
  lineage: 0.75,
  notes: 1.0
};

function buildMatcher(index = buildComponentIndex()) {
  const docs = index.nodes.map((n) => ({ node: n, fields: nodeFields(n) }));
  const df = new Map();
  for (const d of docs) {
    const seen = new Set(Object.values(d.fields).flat());
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = docs.length || 1;
  const idf = (t) => Math.log(N / (df.get(t) || 1));

  function match(taskText, top = 8) {
    const qTerms = new Set(tokenize(taskText));
    const results = [];
    for (const { node, fields } of docs) {
      let score = 0;
      const basis = {};
      for (const [field, terms] of Object.entries(fields)) {
        const hits = [...new Set(terms)].filter((t) => qTerms.has(t));
        if (!hits.length) continue;
        basis[field] = hits;
        score += hits.reduce((s, t) => s + idf(t), 0) * FIELD_WEIGHTS[field];
      }
      if (score <= 0) continue;

      const matchedFields = Object.keys(basis);
      const distinctTerms = new Set(matchedFields.flatMap((f) => basis[f]));
      const thinEvidence = matchedFields.length < 2 || distinctTerms.size < 2;
      const curatedHit = Boolean(basis.tags && basis.tags.length);
      const notesSayAsIs = /as-is|as is/i.test(node.tags.transfer_notes || '');
      let transferDistance = 'pattern-only';
      if (curatedHit && notesSayAsIs && !thinEvidence) transferDistance = 'use-as-is';
      else if (curatedHit && !thinEvidence) transferDistance = 'moderate-tweak';

      results.push({
        id: node.id,
        framework_id: node.framework_id,
        kind: node.kind,
        path: node.path,
        score: Math.round(score * 100) / 100,
        basis,
        transfer_distance: transferDistance,
        thin_evidence: thinEvidence,
        transfer_notes: node.tags.transfer_notes || '',
        lineage: node.lineage
      });
    }
    results.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    return results.slice(0, top);
  }

  return { match, corpusSize: N };
}

function main() {
  const args = process.argv.slice(2);
  const taskFlag = args.indexOf('--task');
  if (taskFlag === -1 || !args[taskFlag + 1]) {
    process.stderr.write('Usage: component-match.cjs --task "<description>" [--top N] [--json]\n');
    process.exit(2);
  }
  const topFlag = args.indexOf('--top');
  const top = topFlag !== -1 ? parseInt(args[topFlag + 1], 10) || 8 : 8;
  const { match, corpusSize } = buildMatcher();
  const results = match(args[taskFlag + 1], top);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({
      schema: 'ComponentMatch/1.0',
      corpus_size: corpusSize,
      task: args[taskFlag + 1],
      results
    }, null, 2) + '\n');
  } else {
    for (const r of results) {
      const thin = r.thin_evidence ? ' [weak basis — treat as pattern-only]' : '';
      process.stdout.write(`${r.score.toFixed(2).padStart(7)}  ${r.id}  (${r.transfer_distance})${thin}\n`);
      process.stdout.write(`         basis: ${Object.entries(r.basis).map(([f, ts]) => `${f}:${ts.join(',')}`).join(' ')}\n`);
    }
    if (!results.length) process.stdout.write('no components above zero score\n');
  }
}

if (require.main === module) main();

module.exports = { buildMatcher, tokenize };
