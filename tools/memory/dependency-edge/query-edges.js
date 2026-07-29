#!/usr/bin/env node
'use strict';

/**
 * query-edges.js — read-only exporter over _dev/state/memory-edges/edges.jsonl.
 *
 * Answers the two MVP questions a future dashboard or archival decision COULD
 * consume — but this tool consumes nothing live and decides nothing.
 *
 *   node query-edges.js --what-stands-on <memory_key>
 *   node query-edges.js --is-keystone <memory_key>      (three-value status)
 *
 * Records objective state only (membrane PRIME LAW). FORGOTTEN remains a
 * non-operative sentinel and is never emitted here.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const EDGES_FILE = path.join(REPO_ROOT, '_dev/state/memory-edges/edges.jsonl');

const KEYSTONE_RANK = { detected: 3, classification_uncertain: 2, not_detected: 1 };

function loadEdges(file) {
  file = file || EDGES_FILE;
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (_) {
    console.error(`No edges file at ${file}. Run write-edges.js first.`);
    process.exit(2);
  }
  // BOUNDED REFUSAL: a malformed JSONL row means the edge surface is corrupt.
  // Do NOT silently skip the line (silent skip = data loss); refuse loudly so a
  // downstream consumer never reads a partial/garbled dependency surface.
  const lines = raw.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue; // blank line (e.g. trailing newline) is not corruption
    try {
      out.push(JSON.parse(line));
    } catch (_) {
      console.error(`edge surface corrupt at line ${i + 1} — do not consume`);
      process.exit(2);
    }
  }
  return out;
}

// Edges where something actually stands on this memory (a real, non-absent dep).
function whatStandsOn(edges, key) {
  return edges
    .filter((e) => e.source.id === key && e.keystone_status !== 'not_detected')
    .map((e) => ({
      target: e.target,
      relationship: e.relationship,
      keystone_status: e.keystone_status,
      witness_state: e.witness_state,
    }));
}

// Three-value aggregate keystone status across all of the memory's edges.
function isKeystone(edges, key) {
  const mine = edges.filter((e) => e.source.id === key);
  if (mine.length === 0) {
    // UNKNOWN key: never represented in the edge set at all. This is NOT a
    // witnessed orphan (writer checked, found no dependency -> not_detected).
    // It is an absence of any classification, so it must NOT read as
    // checked-and-clear to a downstream archival consumer.
    return {
      memory_key: key,
      keystone_status: 'classification_uncertain',
      edges_total: 0,
      witness_state: null,
      note: 'UNKNOWN to v1 edge surface — NOT archival clearance; key absent from the edge set, not witnessed-clear',
    };
  }
  let best = 'not_detected';
  for (const e of mine) {
    if (KEYSTONE_RANK[e.keystone_status] > KEYSTONE_RANK[best]) best = e.keystone_status;
  }
  const supporting = mine
    .filter((e) => e.keystone_status === best && best !== 'not_detected')
    .map((e) => `${e.relationship}->${e.target.kind}:${e.target.id} (${e.witness_state})`);
  return {
    memory_key: key,
    keystone_status: best, // detected | classification_uncertain | not_detected
    edges_total: mine.length,
    supporting,
    note: best === 'not_detected'
      ? 'no dependency detected by criteria v1 — NOT archival clearance'
      : undefined,
  };
}

function main(argv) {
  const args = argv.slice(2);
  const i = args.findIndex((a) => a === '--what-stands-on' || a === '--is-keystone');
  if (i < 0 || !args[i + 1]) {
    console.error('Usage: query-edges.js --what-stands-on <memory_key> | --is-keystone <memory_key>');
    process.exit(1);
  }
  const mode = args[i];
  const key = args[i + 1];
  const edges = loadEdges();
  if (mode === '--what-stands-on') {
    const res = whatStandsOn(edges, key);
    console.log(JSON.stringify({ memory_key: key, stands_on_count: res.length, edges: res }, null, 2));
  } else {
    console.log(JSON.stringify(isKeystone(edges, key), null, 2));
  }
}

module.exports = { loadEdges, whatStandsOn, isKeystone, EDGES_FILE };

if (require.main === module) main(process.argv);
