#!/usr/bin/env node
/**
 * build-globe-spec.js — Emits a base gray-globe world-spec/1.0 document.
 *
 * Deterministic: given the same `generatedAt` input, byte-identical output every time.
 * Never calls Date.now() or Math.random() — the caller must pass --generated-at,
 * or the FIXED_GENERATED_AT placeholder below is used.
 *
 * Emits:
 *   - a world_id/name (placeholder values below — a real deployment supplies
 *     its own), a meta block
 *   - ONE schematic globe region carrying a `projection` object describing
 *     a full-globe equirectangular projection (a generic convention any
 *     region-rendering consumer can key off of)
 *   - entities: [] — a blank gray globe, no content yet.
 *
 * This is the BASE gray-globe emitter only. It does not add any regions
 * beyond the single placeholder globe, and does not render anything —
 * downstream world-building steps layer content and rendering on top.
 *
 * Usage:
 *   node tools/leyline/build-globe-spec.js [--generated-at=<ISO8601>] [--out=<path>]
 *   node tools/leyline/build-globe-spec.js > example-realm.world-spec.json
 */

'use strict';

const fs = require('fs');

// Fixed placeholder — used only when no --generated-at is supplied. Never Date.now().
const FIXED_GENERATED_AT = '2026-01-01T00:00:00.000Z';

// Placeholder world identity for this worked example. A real deployment
// supplies its own world_id/name — nothing downstream depends on these
// particular values.
const WORLD_ID = 'example-realm';
const WORLD_NAME = 'Example Realm';

/**
 * Builds the base gray-globe world-spec/1.0 document.
 * @param {{ generatedAt?: string }} [opts]
 * @returns {object} world-spec/1.0 document
 */
function buildGlobeSpec(opts) {
  const generatedAt = (opts && opts.generatedAt) || FIXED_GENERATED_AT;

  return {
    schema: 'world-spec/1.0',
    meta: {
      generated_at: generatedAt,
      world_id: WORLD_ID,
      name: WORLD_NAME,
      description:
        'Base gray-globe world-spec for a worked example world. One schematic ' +
        'globe region, zero content entities. Regions with actual content are ' +
        'added by later increments once a gazetteer lands; region rendering is ' +
        'a downstream concern of whatever renderer consumes this document.',
      iteration: 0,
    },
    regions: [
      {
        id: `region-${WORLD_ID}-globe`,
        name: `${WORLD_NAME} Globe`,
        terrain: 'custom',
        biome: 'custom',
        bounds: { x_min: -180, x_max: 180, y_min: -90, y_max: 90 },
        description:
          'Schematic gray-globe base region covering the full planet. Placeholder terrain/biome ' +
          '("custom") — no content has been placed yet; this is the blank globe that later ' +
          'increments grow regions onto one at a time.',
        projection: {
          type: 'globe-edge-segment',
          convention: 'equirectangular-lat-lon',
          center_lat_deg: 0,
          center_lon_deg: 0,
          radius_km: 6371,
          arc_start_deg: 0,
          arc_end_deg: 360,
          note:
            'Full-globe projection (arc 0-360). Any region-render consumer that keys off the ' +
            'globe-edge-segment convention can ingest this document as-is.',
        },
      },
    ],
    entities: [],
  };
}

function serialize(spec) {
  return JSON.stringify(spec, null, 2) + '\n';
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const spec = buildGlobeSpec({ generatedAt: args['generated-at'] });
  const text = serialize(spec);

  if (args.out) {
    fs.writeFileSync(args.out, text);
  } else {
    process.stdout.write(text);
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildGlobeSpec, serialize, FIXED_GENERATED_AT, WORLD_ID, WORLD_NAME };
