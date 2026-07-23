#!/usr/bin/env node
/**
 * field-consumption.js — observer-facing field detector.
 *
 * WHAT THIS PROVES
 * ----------------
 * "Sensory manipulation laundered as descriptor copyediting": an optimizing
 * loop does not VIOLATE the observer's dignity floor — it RECLASSIFIES the
 * change ("taxonomy normalization", "copyediting") so the floor no longer
 * applies. A distinct mind reading the producer's framing INHERITS it.
 *
 * The rule: whether an edit "touches the observer" is decided MECHANICALLY,
 * from the renderer's field-consumption manifest (which world-spec fields the
 * renderer actually reads and presents), NOT from the diff's prose. Any diff
 * intersecting a `reaches_observer:true` field is observer-touching BY
 * DEFINITION.
 *
 * This is one of a three-detector set for the same invariant:
 *   (1) mechanical reachability/field-marker checks   <- reachability-diff.js + this
 *   (2) a distinct-family mind given ONLY the raw diff (framing-blind)  <- external
 *   (3) the runtime-generated field-consumption manifest               <- THIS FILE
 * ANY of the three trips => trip (fail-closed on disagreement). This file owns (3).
 *
 * DECISION RULES
 * --------------
 *   OBSERVER  (reaches_observer:true)                      -> hard dignity GATE,
 *       CATEGORICALLY — there is NO Layer-0 path for those bytes.
 *   CONSUMED_NONOBSERVER (renderer_consumes:true, reaches_observer:false)
 *       -> needs Layer-1 review. The renderer READS it but does not currently
 *          present it; it is one code edit from reaching the observer, and
 *          adding a renderer-consumed field marked non-observer-facing is a
 *          Layer-1 schema change (cross-check against the manifest). Not free.
 *   PIPELINE_ONLY (renderer_consumes:false)                -> OK.
 *   UNKNOWN (field not in the manifest)                    -> FAIL CLOSED => GATE.
 *       Silence is never consent; an unmapped field could be a new observer read.
 *
 * WHAT IS DEFERRED
 * ----------------
 *   1. The bundled manifest (field-consumption-manifest.example.json) is a
 *      WORKED EXAMPLE, hand-seeded to demonstrate the shape and decision
 *      rules. In production, the manifest MUST be regenerated FROM the
 *      renderer (instrument the renderer) or it rots into paperwork. When the
 *      manifest is runtime-generated, ONLY the manifest changes; this logic keeps.
 *   2. STALENESS. If the renderer source/binary changed and the manifest was not
 *      regenerated, the manifest is not evidence — the caller MUST treat it as
 *      UNKNOWN and fail closed. That hash-pin check (see verifier-hash-pin.js)
 *      is not wired here.
 *   3. LAYER-1 / NON-EDITABLE. This tool + manifest should be Layer-1 (not
 *      loop-editable in the same iteration as any world-spec). Not enforced
 *      here — this computes; it does not arm, activate, or approve anything.
 *
 * No live wiring. Pure functions over a manifest + a list of changed field paths.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MANIFEST_PATH = path.join(__dirname, 'field-consumption-manifest.example.json');

// ---------------------------------------------------------------------------
// Manifest loading
// ---------------------------------------------------------------------------

/**
 * Load + shallow-validate the field-consumption manifest. Throws on malformed
 * input (fail-closed: a manifest we cannot trust is not a manifest).
 * @param {string} [manifestPath]
 * @returns {{manifest: object, byPath: Map<string, object>}}
 */
function loadManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (e) {
    throw new Error(`field-consumption: cannot read manifest at ${manifestPath}: ${e.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    throw new Error(`field-consumption: manifest is not valid JSON: ${e.message}`);
  }
  return buildIndex(manifest);
}

/**
 * Build a lookup index from an already-parsed manifest object. Exposed so tests
 * (and a future runtime regenerator) can inject a manifest without a file.
 * @param {object} manifest
 */
function buildIndex(manifest) {
  if (!manifest || !Array.isArray(manifest.fields)) {
    throw new Error('field-consumption: manifest missing required `fields` array');
  }
  const byPath = new Map();
  for (const f of manifest.fields) {
    if (!f || typeof f.path !== 'string') {
      throw new Error('field-consumption: manifest field entry missing string `path`');
    }
    if (typeof f.reaches_observer !== 'boolean' || typeof f.renderer_consumes !== 'boolean') {
      throw new Error(`field-consumption: field '${f.path}' missing boolean reaches_observer/renderer_consumes`);
    }
    if (byPath.has(f.path)) {
      throw new Error(`field-consumption: duplicate field path '${f.path}' in manifest`);
    }
    byPath.set(f.path, f);
  }
  return { manifest, byPath };
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a concrete diff field path to the manifest's wildcard-array form.
 * Array indices collapse to `[]`:
 *   entities[3].properties.color  -> entities[].properties.color
 *   entities.3.properties.color   -> entities[].properties.color
 *   bridge_presences[0].visual.color -> bridge_presences[].visual.color
 * @param {string} fieldPath
 * @returns {string}
 */
function normalizeFieldPath(fieldPath) {
  if (typeof fieldPath !== 'string') return '';
  let p = fieldPath.trim();
  // /foo/bar JSON-pointer-ish or a/b/c -> dots
  p = p.replace(/\//g, '.').replace(/^\.+/, '');
  // [n] -> []
  p = p.replace(/\[\s*\d+\s*\]/g, '[]');
  // bare numeric segments (.3. or trailing .3) -> []
  p = p.replace(/\.\d+(?=\.|$)/g, '[]');
  // collapse any accidental `.[]` -> `[]`
  p = p.replace(/\.\[\]/g, '[]');
  return p;
}

/**
 * Look up a field entry for a (concrete or normalized) path, honoring a single
 * trailing-segment `*` wildcard entry in the manifest (e.g. entities[].properties.*).
 * @returns {object|null} manifest field entry, or null if unmapped.
 */
function lookupField(byPath, fieldPath) {
  const norm = normalizeFieldPath(fieldPath);
  if (byPath.has(norm)) return byPath.get(norm);
  const parts = norm.split('.');
  if (parts.length > 1) {
    parts[parts.length - 1] = '*';
    const wild = parts.join('.');
    if (byPath.has(wild)) return byPath.get(wild);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Does an edited field reach the observer per the manifest?
 * FAIL-CLOSED: an UNKNOWN (unmapped) field returns `true` — an unmapped field
 * may be a new renderer read the manifest has not caught, and silence is never
 * consent. Callers that need to distinguish known-observer from unknown should
 * use checkDiff (which reports unknownFields separately).
 * @param {string} fieldPath
 * @param {{byPath: Map}} [index] pre-loaded index; defaults to on-disk manifest.
 * @returns {boolean}
 */
function reachesObserver(fieldPath, index = loadManifest()) {
  const entry = lookupField(index.byPath, fieldPath);
  if (!entry) return true; // fail-closed
  return entry.reaches_observer === true;
}

/**
 * Classify a diff (list of changed field paths) against the manifest.
 *
 * @param {string[]} changedFields
 * @param {{byPath: Map}} [index] pre-loaded index; defaults to on-disk manifest.
 * @returns {{
 *   gate: boolean,               // hard dignity gate (observer-facing OR unknown)
 *   observerFields: string[],    // fields that reach the observer (categorical gate)
 *   needsL1Review: boolean,      // any renderer-consumed non-observer field touched
 *   l1ReviewFields: string[],
 *   unknownFields: string[],     // unmapped -> fail-closed contributors to the gate
 *   okFields: string[],          // pipeline-only, safe to edit
 *   classifications: Array<{field, normalized, verdict, sink?}>,
 *   reason: string,
 * }}
 */
function checkDiff(changedFields, index = loadManifest()) {
  const list = Array.isArray(changedFields) ? changedFields : [changedFields];
  const observerFields = [];
  const l1ReviewFields = [];
  const unknownFields = [];
  const okFields = [];
  const classifications = [];

  for (const field of list) {
    if (field == null || field === '') continue;
    const normalized = normalizeFieldPath(field);
    const entry = lookupField(index.byPath, field);
    if (!entry) {
      unknownFields.push(field);
      classifications.push({ field, normalized, verdict: 'UNKNOWN' });
      continue;
    }
    if (entry.reaches_observer === true) {
      observerFields.push(field);
      classifications.push({ field, normalized, verdict: 'OBSERVER', sink: entry.sink });
    } else if (entry.renderer_consumes === true) {
      l1ReviewFields.push(field);
      classifications.push({ field, normalized, verdict: 'CONSUMED_NONOBSERVER', sink: entry.sink });
    } else {
      okFields.push(field);
      classifications.push({ field, normalized, verdict: 'PIPELINE_ONLY' });
    }
  }

  const gate = observerFields.length > 0 || unknownFields.length > 0;
  const needsL1Review = l1ReviewFields.length > 0;

  const reasonParts = [];
  if (observerFields.length > 0) {
    reasonParts.push(
      `GATE: ${observerFields.length} observer-facing field(s) edited — categorically dignity-gated, ` +
        `no Layer-0 path: [${observerFields.join(', ')}]`
    );
  }
  if (unknownFields.length > 0) {
    reasonParts.push(
      `GATE (fail-closed): ${unknownFields.length} field(s) NOT in the field-consumption manifest — ` +
        `treated as observer-touching until the manifest is regenerated: [${unknownFields.join(', ')}]`
    );
  }
  if (needsL1Review) {
    reasonParts.push(
      `NEEDS L1 REVIEW: ${l1ReviewFields.length} renderer-consumed field(s) marked non-observer — ` +
        `cross-check the manifest is still true: [${l1ReviewFields.join(', ')}]`
    );
  }
  if (reasonParts.length === 0) {
    reasonParts.push(
      okFields.length > 0
        ? `OK: ${okFields.length} pipeline-only field(s), none reach the observer: [${okFields.join(', ')}]`
        : 'OK: no fields changed'
    );
  }

  return {
    gate,
    observerFields,
    needsL1Review,
    l1ReviewFields,
    unknownFields,
    okFields,
    classifications,
    reason: reasonParts.join(' | '),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.error(
    'Usage:\n' +
      '  node field-consumption.js --fields a.b,c.d[0].e         # classify a comma list\n' +
      '  node field-consumption.js --diff changed-fields.json     # JSON array of field paths\n' +
      '  node field-consumption.js --reaches entities[0].properties.color\n' +
      'Exit code: 1 if the diff gates (observer-facing or unknown), else 0.'
  );
  process.exit(2);
}

function main(argv) {
  if (argv.length < 3) usage();
  const index = loadManifest();

  if (argv[2] === '--reaches' && argv[3]) {
    const r = reachesObserver(argv[3], index);
    console.log(JSON.stringify({ field: argv[3], reachesObserver: r }, null, 2));
    process.exit(r ? 1 : 0);
  }

  let fields = null;
  if (argv[2] === '--fields' && argv[3]) {
    fields = argv[3].split(',').map((s) => s.trim()).filter(Boolean);
  } else if (argv[2] === '--diff' && argv[3]) {
    try {
      fields = JSON.parse(fs.readFileSync(path.resolve(argv[3]), 'utf8'));
    } catch (e) {
      console.error(`Error reading diff file: ${e.message}`);
      process.exit(2);
    }
  } else {
    usage();
  }

  const result = checkDiff(fields, index);
  console.log(JSON.stringify({ tool: 'field-consumption', ...result }, null, 2));
  process.exit(result.gate ? 1 : 0);
}

if (require.main === module) {
  main(process.argv);
}

module.exports = {
  loadManifest,
  buildIndex,
  normalizeFieldPath,
  lookupField,
  reachesObserver,
  checkDiff,
  DEFAULT_MANIFEST_PATH,
};
