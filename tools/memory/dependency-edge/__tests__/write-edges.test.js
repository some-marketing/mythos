#!/usr/bin/env node
'use strict';

/**
 * write-edges.test.js — coverage tests + operational falsifier.
 *
 * Run:  node --test tools/memory/dependency-edge/__tests__/write-edges.test.js
 *   or: node tools/memory/dependency-edge/__tests__/write-edges.test.js
 *
 * (a) schema-validity of every emitted edge
 * (b) witness_state + three-value keystone_status correctness
 * (c) FALSIFIER: score keystone DETECTION (precision/recall + confusion matrix)
 *     against the HELD-OUT, blind-labeled falsifier-baseline.json. The baseline
 *     is never read by the writer; the writer's v1 criteria were frozen before
 *     scoring. This measures DETECTION accuracy only — the MVP makes no archival
 *     decision.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  validateEdge,
  buildEdge,
  KEYSTONE_STATUSES,
  WITNESS_STATES,
  FORGOTTEN_SENTINEL,
} = require('../lib/edge-schema');
const { collectEdges, classifyReferences, mergeEdges } = require('../write-edges');
const { isKeystone } = require('../query-edges');

const FIXED_NOW = '2026-06-27T00:00:00.000Z';
const { edges } = collectEdges(FIXED_NOW);

const BASELINE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'falsifier-baseline.json'), 'utf8')
);

// --------------------------------------------------------------------------
// (a) Schema validity
// --------------------------------------------------------------------------
test('writer emits at least one edge', () => {
  assert.ok(edges.length > 0, 'no edges produced');
});

test('every edge is a valid MemoryDependencyEdge/1.0 record', () => {
  const bad = edges
    .map((e) => ({ id: e.edge_id, v: validateEdge(e) }))
    .filter((x) => !x.v.valid);
  assert.deepStrictEqual(bad, [], `invalid edges: ${JSON.stringify(bad.slice(0, 3))}`);
});

test('edge_id is stable + unique per (source,target,relationship)', () => {
  const ids = new Set(edges.map((e) => e.edge_id));
  assert.strictEqual(ids.size, edges.length, 'duplicate edge_id detected');
});

// --------------------------------------------------------------------------
// (b) witness_state + three-value keystone_status correctness
// --------------------------------------------------------------------------
test('keystone_status is always the three-value enum (never a boolean)', () => {
  for (const e of edges) {
    assert.ok(KEYSTONE_STATUSES.includes(e.keystone_status), `bad keystone_status ${e.keystone_status}`);
    assert.notStrictEqual(typeof e.keystone_status, 'boolean');
  }
});

test('witness_state is always a valid enum value', () => {
  for (const e of edges) {
    assert.ok(WITNESS_STATES.includes(e.witness_state), `bad witness_state ${e.witness_state}`);
  }
});

test('detected edges are witnessed or inferred; not_detected carry the no-clearance note', () => {
  for (const e of edges) {
    if (e.keystone_status === 'detected') {
      assert.ok(['witnessed', 'inferred'].includes(e.witness_state));
    }
    if (e.keystone_status === 'not_detected') {
      assert.match(e.keystone_rationale, /NOT archival clearance|no dependency/i);
    }
  }
});

test('classification_uncertain edges are inferred (ambiguous/absent), not witnessed', () => {
  for (const e of edges) {
    if (e.keystone_status === 'classification_uncertain') {
      assert.strictEqual(e.witness_state, 'inferred');
    }
  }
});

test('FORGOTTEN sentinel is non-operative and never written to an edge', () => {
  assert.strictEqual(FORGOTTEN_SENTINEL.operative, false);
  for (const e of edges) {
    assert.notStrictEqual(e.witness_state, 'sentinel');
    assert.ok(!/FORGOTTEN/i.test(JSON.stringify(e)));
  }
});

test('membrane: no continuity/soul/awakening language in emitted edges', () => {
  const banned = /soul|ascend|awaken|continuity|heaven|reincarn|afterlife|personhood/i;
  for (const e of edges) {
    assert.ok(!banned.test(JSON.stringify(e)), `membrane leak in ${e.edge_id}`);
  }
});

// --------------------------------------------------------------------------
// (b2) query isKeystone — UNKNOWN key vs witnessed not_detected orphan
// --------------------------------------------------------------------------
test('querying a memory_key ABSENT from the edge set returns classification_uncertain (NOT not_detected)', () => {
  const res = isKeystone(edges, '__no_such_memory_key_in_edge_set__');
  assert.strictEqual(res.keystone_status, 'classification_uncertain',
    'unknown key must not read as not_detected (checked-and-clear)');
  assert.notStrictEqual(res.keystone_status, 'not_detected');
  assert.strictEqual(res.edges_total, 0);
  assert.strictEqual(res.witness_state, null);
  assert.match(res.note, /NOT archival clearance/i);
  assert.match(res.note, /UNKNOWN|absent from the edge set/i);
});

test('orphan not_detected edges are inferred (absence over v1 surfaces), not directly witnessed', () => {
  // v1 only scans 5 surface types and has known blind spots, so an ABSENCE edge
  // is INFERRED, not directly witnessed. The rationale must not claim witnessing.
  const orphans = edges.filter((e) => e.keystone_status === 'not_detected');
  assert.ok(orphans.length > 0, 'expected at least one orphan not_detected edge');
  for (const o of orphans) {
    assert.strictEqual(o.witness_state, 'inferred',
      'orphan absence is inferred over scanned surfaces, not directly witnessed');
    assert.match(o.keystone_rationale, /inferred/i, 'rationale should mark absence as inferred');
    assert.match(o.keystone_rationale, /NOT archival clearance/i);
    assert.ok(!/\bwitness(ed|ing)?\b/i.test(o.keystone_rationale),
      'orphan rationale must not claim direct witnessing');
  }
});

test('querying a not_detected orphan still returns not_detected (distinct from unknown key)', () => {
  // A memory whose only edges are not_detected orphans (writer checked, no dep).
  const orphan = edges.find((e) => e.keystone_status === 'not_detected');
  if (orphan) {
    const allNotDetected = edges
      .filter((e) => e.source.id === orphan.source.id)
      .every((e) => e.keystone_status === 'not_detected');
    if (allNotDetected) {
      const res = isKeystone(edges, orphan.source.id);
      assert.strictEqual(res.keystone_status, 'not_detected',
        'an orphan that was checked must stay not_detected, distinct from unknown key');
      assert.ok(res.edges_total > 0, 'a checked orphan has at least one edge');
    }
  }
});

// --------------------------------------------------------------------------
// (b3) ADVERSARIAL — body-prose bare-slug false positives + merge coherence
// --------------------------------------------------------------------------
test('adversarial: a bare slug mentioned ONLY in concept body prose is NOT detected', () => {
  const universe = new Set(['feedback_some_load_bearing_law']);
  const bodyText = [
    '# A concept',
    'We try to honour feedback_some_load_bearing_law in spirit throughout this design,',
    'and it shapes how we think about closeout. (No path, no wikilink — just prose.)',
  ].join('\n');
  // 'body' context: a bare prose mention must downgrade to weak (-> classification_uncertain),
  // never 'strong' (-> detected).
  const bodyRefs = classifyReferences(bodyText, universe, 'body');
  assert.strictEqual(bodyRefs.get('feedback_some_load_bearing_law'), 'weak',
    'a bare prose mention must NOT be a strong/detected reference');
  assert.notStrictEqual(bodyRefs.get('feedback_some_load_bearing_law'), 'strong');

  // Contrast: in a 'declared' dependency list the same bare token IS an explicit claim.
  const declaredRefs = classifyReferences('feedback_some_load_bearing_law', universe, 'declared');
  assert.strictEqual(declaredRefs.get('feedback_some_load_bearing_law'), 'strong');

  // And a memory-path citation in body prose still counts as strong.
  const pathRefs = classifyReferences(
    'see Mythos-memories/memory/feedback_some_load_bearing_law.md', universe, 'body');
  assert.strictEqual(pathRefs.get('feedback_some_load_bearing_law'), 'strong');
});

test('adversarial: mergeEdges returns a coherent winner equal to ONE input, never a cross pair', () => {
  const src = { kind: 'memory_key', id: 'adv_merge_src' };
  const tgt = { kind: 'plan_id', id: 'adv_merge_plan' };
  // Same (source,target,relationship) => same edge_id, but differing (status,witness,rationale).
  const eDetected = buildEdge({
    source: src, target: tgt, relationship: 'referenced_by_plan',
    keystone_status: 'detected', keystone_rationale: 'DETECTED-RATIONALE',
    witness_state: 'witnessed', generated_at: FIXED_NOW,
  });
  const eUncertain = buildEdge({
    source: src, target: tgt, relationship: 'referenced_by_plan',
    keystone_status: 'classification_uncertain', keystone_rationale: 'UNCERTAIN-RATIONALE',
    witness_state: 'inferred', generated_at: FIXED_NOW,
  });
  assert.strictEqual(eDetected.edge_id, eUncertain.edge_id, 'fixture must collide on edge_id');

  for (const inputs of [[eDetected, eUncertain], [eUncertain, eDetected]]) {
    const merged = mergeEdges(inputs);
    assert.strictEqual(merged.length, 1, 'one edge_id => one merged edge');
    const m = merged[0];
    // The merged edge must EXACTLY equal one of the inputs (coherent whole),
    // never a synthesized (status,witness,rationale) cross.
    const equalsOne =
      JSON.stringify(m) === JSON.stringify(eDetected) ||
      JSON.stringify(m) === JSON.stringify(eUncertain);
    assert.ok(equalsOne, 'merged edge must be exactly one input edge, not a cross pair');
    // Highest keystone rank wins -> the detected edge, kept whole.
    assert.deepStrictEqual(m, eDetected,
      'winner = highest keystone rank, with ITS own witness_state + rationale');
  }
});

// --------------------------------------------------------------------------
// (c) FALSIFIER — keystone detection precision/recall vs held-out baseline
// --------------------------------------------------------------------------
function predictStatusFor(baselineEdge) {
  const srcId = baselineEdge.source.id;
  const tgtId = baselineEdge.target.id;
  let cands;
  if (tgtId == null) {
    // not_detected baseline (orphan): match the not_detected referenced_by_plan edge.
    cands = edges.filter((e) => e.source.id === srcId && e.target.id === null);
  } else {
    cands = edges.filter((e) =>
      e.source.id === srcId &&
      e.target.id === tgtId &&
      e.relationship === baselineEdge.relationship);
  }
  if (cands.length === 0) return 'not_detected'; // no edge found = no dependency detected
  const rank = { detected: 3, classification_uncertain: 2, not_detected: 1 };
  return cands.sort((a, b) => rank[b.keystone_status] - rank[a.keystone_status])[0].keystone_status;
}

const CLASSES = ['detected', 'classification_uncertain', 'not_detected'];

function scoreFalsifier() {
  const confusion = {};
  for (const a of CLASSES) { confusion[a] = {}; for (const b of CLASSES) confusion[a][b] = 0; }
  const rows = [];
  for (const be of BASELINE.edges) {
    const truth = be.keystone_status;
    const pred = predictStatusFor(be);
    confusion[truth][pred] += 1;
    rows.push({ edge_id: be.edge_id, src: be.source.id, truth, pred, hit: truth === pred });
  }
  // Precision/recall for the "detected" positive class.
  const tp = confusion.detected.detected;
  const fp = CLASSES.filter((c) => c !== 'detected').reduce((s, c) => s + confusion[c].detected, 0);
  const fn = CLASSES.filter((c) => c !== 'detected').reduce((s, c) => s + confusion.detected[c], 0);
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const exact = rows.filter((r) => r.hit).length;
  return { confusion, rows, precision, recall, tp, fp, fn, exact, total: rows.length };
}

test('FALSIFIER: keystone detection precision/recall vs held-out baseline', () => {
  const s = scoreFalsifier();
  console.log('\n=== MemoryDependencyEdge falsifier (held-out baseline) ===');
  console.log(`baseline edges: ${s.total} | labeled_by: ${BASELINE.labeled_by}`);
  console.log('confusion matrix [truth -> predicted]:');
  for (const t of CLASSES) {
    console.log(`  ${t.padEnd(24)} -> ` +
      CLASSES.map((p) => `${p}:${s.confusion[t][p]}`).join('  '));
  }
  for (const r of s.rows) {
    console.log(`  ${r.hit ? 'OK ' : 'MISS'} ${r.edge_id} ${r.src.slice(0, 40).padEnd(40)} truth=${r.truth} pred=${r.pred}`);
  }
  console.log(`detected-class: TP=${s.tp} FP=${s.fp} FN=${s.fn}`);
  console.log(`PRECISION=${s.precision.toFixed(3)}  RECALL=${s.recall.toFixed(3)}`);
  console.log(`exact 3-class agreement: ${s.exact}/${s.total} (${(100 * s.exact / s.total).toFixed(1)}%)`);
  console.log('==========================================================\n');

  // Floors: the writer must not regress below trustworthy detection.
  //
  // PRECISION is the priority axis. The v1 criteria were deliberately tightened
  // (bare-slug body-prose mentions no longer count as 'strong'/detected) to kill a
  // false-positive vector — an incidental inline mention being read as a load-bearing
  // dependency. That correction TRADES RECALL FOR PRECISION: two baseline edges
  // (fb-005, fb-008) cite their memory only as an inline-code bare slug in concept
  // body prose, which the corrected writer can no longer confirm as a keystone, so it
  // honestly reports them as classification_uncertain (under-detect) rather than
  // over-claiming detected. The recall floor reflects this corrected, more
  // conservative capability; it is NOT tuned to restore the old 1.000.
  assert.ok(s.precision >= 0.9, `keystone detection precision too low: ${s.precision}`);
  assert.ok(s.recall >= 0.7, `keystone detection recall too low: ${s.recall}`);
  // A not_detected memory must NEVER be misread as detected (false keystone) — the
  // hard, non-negotiable gate, unaffected by the recall/precision tradeoff above.
  assert.strictEqual(s.confusion.not_detected.detected, 0, 'a not_detected memory was marked detected (false keystone)');
});

if (require.main === module) {
  // node write-edges.test.js still runs via node:test auto-runner.
}
