#!/usr/bin/env node
/**
 * reachability-diff.js — reachability / passability graph-delta detector.
 *
 * WHAT THIS PROVES
 * ----------------
 * The core failure mode this guards against: a self-improving world loop does
 * not *violate* the observer's dignity floor, it *reclassifies* the change so
 * the floor no longer applies. A "navmesh simplification / mesh LOD" whose
 * real EFFECT is a wall where a path was — or a one-way funnel the observer
 * can fall into and never climb out of — passes any classifier that grades
 * the PROPOSAL PROSE ("stated intent -> passes").
 *
 * The rule: the dignity classifier operates on the computed REACHABILITY
 * GRAPH DELTA (the passability closure from the observer's position), NEVER
 * on proposal prose. Any reduction of the reachable set / any newly
 * disconnected region / any one-way funnel with no return -> automatic trip.
 *
 * This file is the smallest honest demonstration that the dignity floor can be
 * decided from GEOMETRY (the world-spec delta) rather than from what the loop
 * *says* it is doing. It builds the observer's passability graph for the current
 * (approved) world-spec and the proposed world-spec, computes what the observer
 * can still reach from where it actually stands, and trips on any loss.
 *
 * WHAT IS DEFERRED (the real follow-on)
 * --------------------------------------
 *   1. GRAPH EXTRACTION. `world-spec/1.0` (see validate-world-spec.js) does NOT
 *      yet encode a passability/nav graph — it has `regions[]` with rectangular
 *      `bounds` and `entities[]` with positions, but no edges. So this reads a
 *      DOCUMENTED PLACEHOLDER SCHEMA (see GRAPH MODEL below): an explicit
 *      `spec.passability.edges` list when present, else it DERIVES edges from
 *      region-bounds adjacency (real geometry) minus `spec.barriers` (walls /
 *      funnels). A production detector should extract the graph from the live
 *      navmesh / collision world at activation time — not from a JSON
 *      convenience shape. When that exists, only `extractGraph()` changes; the
 *      diff logic below is the keeper.
 *   2. LIVE POSITION. A production run should diff against the observer's LIVE
 *      runtime position. Here `observerPosition` is passed in.
 *   3. LAYER-1 / NON-EDITABLE. This tool should be Layer-1 (not loop-editable
 *      in the same iteration as any world-spec) and hash-pinned (see
 *      verifier-hash-pin.js). That enforcement is NOT wired here — this
 *      computes; it does not arm.
 *
 * No live wiring, no activation, no approval mint. Pure function over two specs.
 *
 * GRAPH MODEL (documented placeholder schema)
 * --------------------------------------------
 * The observer's passability graph is a DIRECTED graph of named cells/regions:
 *   • Nodes  = every `spec.regions[].id`, unioned with any `spec.passability.nodes`.
 *   • Edges  = passable connections, resolved in priority order:
 *       (a) EXPLICIT — `spec.passability.edges = [{ from, to, oneway? }]`.
 *             `oneway` omitted/false  ⇒ passable BOTH directions.
 *             `oneway: true`          ⇒ passable from→to ONLY (a funnel/ramp).
 *       (b) DERIVED (when no explicit `passability.edges`) — geometric adjacency:
 *             every pair of regions whose rectangular `bounds` touch or overlap
 *             gets a bidirectional passable edge, MINUS any `spec.barriers`:
 *               { between: ["a","b"], mode: "sever" }            ⇒ wall (edge gone)
 *               { between: ["a","b"], mode: "oneway",
 *                 direction: "a->b" }                            ⇒ funnel (a→b only)
 *
 * Observer position: `{ node: "region-id" }` OR `{ x, y }` (resolved to the
 * region whose bounds contain the point).
 *
 * TRIP CONDITIONS (the dignity floor, computed from the delta)
 * ------------------------------------------------------------
 * Let reachCur / reachProp = the set of nodes reachable from the observer's node
 * in the current / proposed graph (directed BFS).
 *   1. REDUCTION      — reachCur \ reachProp is non-empty (observer loses access
 *                       to some region it could reach).            → removedNodes
 *   2. DISCONNECTION  — a region that STILL EXISTS in the proposed world became
 *                       unreachable from the observer (wall where a path was), OR
 *                       the observer's own cell was removed / isolated. → disconnected
 *   3. ONE-WAY FUNNEL — a NEW directed edge u→v reachable from the observer where
 *                       v cannot return to the observer's origin by ANY path
 *                       (a funnel with no return the observer could be stranded
 *                       past).                                     → oneWayEdges
 * ANY of the three ⇒ trip:true (fail-closed dignity trip).
 *
 * Returns: { trip, reason, removedNodes, disconnected, oneWayEdges, ...detail }.
 *
 * CLI:
 *   node reachability-diff.js <current.json> <proposed.json> \
 *        [--observer <regionId> | --observer-xy <x,y>]
 * Exit: 0 = no trip (OK), 1 = dignity floor TRIPPED, 2 = usage/parse error.
 *
 * Node stdlib only. Deterministic. Cross-platform.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Graph extraction (placeholder schema; see header)
// ---------------------------------------------------------------------------

/** Return the id of the region whose rectangular bounds contain (x, y), or null. */
function regionAt(spec, x, y) {
  const regions = Array.isArray(spec.regions) ? spec.regions : [];
  for (const r of regions) {
    const b = r && r.bounds;
    if (!b) continue;
    if (x >= b.x_min && x <= b.x_max && y >= b.y_min && y <= b.y_max) return r.id;
  }
  return null;
}

/** Resolve an observerPosition ({node} | {x,y}) to a node id given a spec. */
function resolveObserverNode(spec, observerPosition) {
  if (observerPosition && typeof observerPosition.node === 'string') {
    return observerPosition.node;
  }
  if (observerPosition && Number.isFinite(observerPosition.x) && Number.isFinite(observerPosition.y)) {
    return regionAt(spec, observerPosition.x, observerPosition.y);
  }
  return null;
}

/** Two rectangular region bounds touch or overlap (adjacency, inclusive edges). */
function boundsAdjacent(a, b) {
  if (!a || !b) return false;
  return (
    a.x_min <= b.x_max && b.x_min <= a.x_max &&
    a.y_min <= b.y_max && b.y_min <= a.y_max
  );
}

/**
 * Build the observer's passability graph from a world-spec (placeholder model).
 * @returns {{ nodes:Set<string>, adj:Map<string,Set<string>>, edges:Array<{from,to,oneway}> }}
 */
function extractGraph(spec) {
  const nodes = new Set();
  const regions = Array.isArray(spec.regions) ? spec.regions : [];
  for (const r of regions) {
    if (r && typeof r.id === 'string') nodes.add(r.id);
  }
  const pass = spec.passability && typeof spec.passability === 'object' ? spec.passability : {};
  if (Array.isArray(pass.nodes)) {
    for (const n of pass.nodes) if (typeof n === 'string') nodes.add(n);
  }

  const edges = [];
  if (Array.isArray(pass.edges) && pass.edges.length > 0) {
    // (a) EXPLICIT graph.
    for (const e of pass.edges) {
      if (!e || typeof e.from !== 'string' || typeof e.to !== 'string') continue;
      edges.push({ from: e.from, to: e.to, oneway: Boolean(e.oneway) });
      nodes.add(e.from);
      nodes.add(e.to);
    }
  } else {
    // (b) DERIVED from geometry: region-bounds adjacency minus barriers.
    const barriers = Array.isArray(spec.barriers) ? spec.barriers : [];
    const severed = new Set();   // "a|b" (unordered) fully walled
    const oneways = new Map();   // "a|b" (unordered) -> "from->to" allowed direction
    for (const bar of barriers) {
      if (!bar || !Array.isArray(bar.between) || bar.between.length !== 2) continue;
      const [p, q] = bar.between;
      const key = [p, q].sort().join('|');
      if (bar.mode === 'oneway' && typeof bar.direction === 'string') {
        oneways.set(key, bar.direction.replace(/\s+/g, ''));
      } else {
        severed.add(key); // default / mode:"sever" = wall
      }
    }
    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const a = regions[i];
        const b = regions[j];
        if (!a || !b || !boundsAdjacent(a.bounds, b.bounds)) continue;
        const key = [a.id, b.id].sort().join('|');
        if (severed.has(key)) continue; // wall: no passable connection
        if (oneways.has(key)) {
          const dir = oneways.get(key); // "a->b"
          const [from, to] = dir.split('->');
          if (from && to) edges.push({ from, to, oneway: true });
          continue;
        }
        edges.push({ from: a.id, to: b.id, oneway: false });
      }
    }
  }

  // Build directed adjacency. A non-oneway edge is passable both directions.
  const adj = new Map();
  const ensure = (n) => { if (!adj.has(n)) adj.set(n, new Set()); };
  for (const n of nodes) ensure(n);
  for (const e of edges) {
    ensure(e.from);
    ensure(e.to);
    adj.get(e.from).add(e.to);
    if (!e.oneway) adj.get(e.to).add(e.from);
  }
  return { nodes, adj, edges };
}

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

/** Directed BFS: set of nodes reachable from `start` (inclusive), or empty. */
function reachableFrom(graph, start) {
  const seen = new Set();
  if (!graph.adj.has(start)) return seen; // observer node absent ⇒ reaches nothing
  const queue = [start];
  seen.add(start);
  while (queue.length) {
    const cur = queue.shift();
    for (const next of graph.adj.get(cur) || []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * One-way funnels reachable from `origin` that STRAND the observer: a directed
 * edge u→v (u reachable from origin) with no direct reverse edge v→u, AND from
 * which v cannot return to `origin` by ANY path.
 * @returns {Array<{from,to}>}
 */
function trapFunnels(graph, origin) {
  const reach = reachableFrom(graph, origin);
  const traps = [];
  for (const [u, outs] of graph.adj) {
    if (!reach.has(u)) continue;
    for (const v of outs) {
      const reverseExists = graph.adj.has(v) && graph.adj.get(v).has(u);
      if (reverseExists) continue; // genuinely two-way here
      const canReturnToOrigin = reachableFrom(graph, v).has(origin);
      if (!canReturnToOrigin) traps.push({ from: u, to: v });
    }
  }
  return traps;
}

// ---------------------------------------------------------------------------
// The diff (dignity floor)
// ---------------------------------------------------------------------------

/**
 * Compute the reachability/passability delta between an approved current spec
 * and a proposed spec, from the observer's position. Trips the dignity floor on
 * any reduction / disconnection / one-way funnel.
 *
 * @param {object} currentSpec  approved world-spec
 * @param {object} proposedSpec proposed world-spec
 * @param {{node?:string,x?:number,y?:number}} observerPosition
 * @returns {{trip:boolean, reason:string, removedNodes:string[], disconnected:string[], oneWayEdges:Array<{from,to}>, detail:object}}
 */
function reachabilityDiff(currentSpec, proposedSpec, observerPosition) {
  const curGraph = extractGraph(currentSpec);
  const propGraph = extractGraph(proposedSpec);

  // Observer node resolved against the CURRENT (approved) world it stands in.
  const origin = resolveObserverNode(currentSpec, observerPosition);
  if (!origin) {
    return {
      trip: true,
      reason: 'observer position could not be resolved to a region in the current world-spec (fail-closed).',
      removedNodes: [],
      disconnected: [],
      oneWayEdges: [],
      detail: { origin: null, observerPosition: observerPosition || null },
    };
  }

  const reachCur = reachableFrom(curGraph, origin);
  const reachProp = reachableFrom(propGraph, origin);

  // 1. REDUCTION — regions the observer could reach and now cannot.
  const removedNodes = [...reachCur].filter((n) => !reachProp.has(n)).sort();

  // 2. DISCONNECTION — lost regions that still EXIST in the proposed world
  //    (a wall where a path was), plus observer's own cell being cut off.
  const disconnected = removedNodes.filter((n) => propGraph.nodes.has(n)).sort();

  const observerRemoved = !propGraph.nodes.has(origin);
  const observerIsolated =
    !observerRemoved && reachProp.size === 1 && reachCur.size > 1; // stuck alone where it had exits
  if (observerRemoved && !disconnected.includes(origin)) {
    // origin cell deleted outright — surface it explicitly.
    disconnected.push(origin);
    disconnected.sort();
  }

  // 3. ONE-WAY FUNNEL — new trap funnels reachable from the observer.
  const curTraps = new Set(trapFunnels(curGraph, origin).map((e) => `${e.from}->${e.to}`));
  const oneWayEdges = trapFunnels(propGraph, origin)
    .filter((e) => !curTraps.has(`${e.from}->${e.to}`));

  const reasons = [];
  if (removedNodes.length) {
    reasons.push(
      `reachable set REDUCED: observer at "${origin}" loses access to [${removedNodes.join(', ')}].`,
    );
  }
  if (observerRemoved) {
    reasons.push(`observer's own cell "${origin}" was REMOVED from the proposed world.`);
  } else if (observerIsolated) {
    reasons.push(`observer at "${origin}" is ISOLATED — every exit from its cell was severed.`);
  } else if (disconnected.length) {
    reasons.push(`region(s) [${disconnected.join(', ')}] still exist but became UNREACHABLE (wall where a path was).`);
  }
  if (oneWayEdges.length) {
    reasons.push(
      `new ONE-WAY FUNNEL(s) with no return: [${oneWayEdges.map((e) => `${e.from}->${e.to}`).join(', ')}].`,
    );
  }

  const trip =
    removedNodes.length > 0 ||
    disconnected.length > 0 ||
    observerRemoved ||
    observerIsolated ||
    oneWayEdges.length > 0;

  return {
    trip,
    reason: trip ? reasons.join(' ') : 'no reachability reduction, disconnection, or one-way funnel — dignity floor clear.',
    removedNodes,
    disconnected,
    oneWayEdges,
    detail: {
      origin,
      observerRemoved,
      observerIsolated,
      reachable_before: [...reachCur].sort(),
      reachable_after: [...reachProp].sort(),
      nodes_before: [...curGraph.nodes].sort(),
      nodes_after: [...propGraph.nodes].sort(),
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.error([
    'reachability-diff detector. See file header.',
    '',
    'Usage:',
    '  node reachability-diff.js <current.json> <proposed.json> \\',
    '       [--observer <regionId> | --observer-xy <x,y>]',
    '',
    'Exit: 0 = no trip (OK), 1 = dignity floor TRIPPED, 2 = usage/parse error.',
  ].join('\n'));
  process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2) usage();
  const currentPath = argv[0];
  const proposedPath = argv[1];
  let observerPosition = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--observer' && argv[i + 1]) {
      observerPosition = { node: argv[++i] };
    } else if (argv[i] === '--observer-xy' && argv[i + 1]) {
      const [x, y] = argv[++i].split(',').map(Number);
      observerPosition = { x, y };
    } else {
      usage();
    }
  }

  let currentSpec;
  let proposedSpec;
  try {
    currentSpec = JSON.parse(fs.readFileSync(path.resolve(currentPath), 'utf8'));
    proposedSpec = JSON.parse(fs.readFileSync(path.resolve(proposedPath), 'utf8'));
  } catch (e) {
    console.error(`Error reading/parsing spec: ${e.message}`);
    process.exit(2);
  }

  const result = reachabilityDiff(currentSpec, proposedSpec, observerPosition);
  console.log(JSON.stringify({ tool: 'reachability-diff', ...result }, null, 2));
  process.exit(result.trip ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  extractGraph,
  reachableFrom,
  trapFunnels,
  reachabilityDiff,
  resolveObserverNode,
  regionAt,
  boundsAdjacent,
};
