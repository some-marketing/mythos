#!/usr/bin/env node
/**
 * validate-world-spec.js — Deterministic validator for world-spec/1.0.
 *
 * Reads a world-spec JSON file, validates against the schema contract,
 * checks safety constraints, and returns pass/fail with structured errors.
 *
 * Node stdlib only. Cross-platform (macOS + Windows).
 *
 * Usage:
 *   node validate-world-spec.js <path-to-world-spec.json>
 *
 * Exit codes:
 *   0 — valid (pass)
 *   1 — invalid (fail, errors on stdout)
 *   2 — usage error (missing file, unreadable, not JSON)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const REQUIRED_TOP = ['schema', 'meta', 'regions', 'entities'];
const META_REQUIRED = ['generated_at', 'world_id', 'name'];
const REGION_REQUIRED = ['id', 'name', 'bounds'];
const ENTITY_REQUIRED = ['id', 'type', 'position'];
const VALID_TERRAINS = ['flat', 'hilly', 'mountainous', 'coastal', 'underwater', 'floating', 'void', 'custom'];
const VALID_BIOMES = ['temperate', 'desert', 'tundra', 'jungle', 'ocean', 'volcanic', 'urban', 'ruins', 'ethereal', 'custom'];
const VALID_ENTITY_TYPES = ['creature', 'structure', 'flora', 'mineral', 'artifact', 'npc', 'light', 'sound_source', 'trigger_volume', 'decoration'];
const VALID_EVENT_TYPES = ['scheduled', 'conditional', 'manual', 'ambient'];
const VALID_ASSET_TYPES = ['static_mesh', 'skeletal_mesh', 'material', 'texture', 'particle', 'sound', 'blueprint', 'animation'];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const MAX_REGIONS = 100;
const MAX_ENTITIES = 1000;
const MAX_EVENTS = 100;

// Optional entity `appearance` bounds: a cosmetic styling channel for a rendered
// entity. Bounded #rrggbb hex color channels + one scale number ONLY, with
// additionalProperties CLOSED — an unknown subkey fails closed, so "no mesh/
// material/asset paths, no free prose" is a real rejection path, not
// documentation.
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const APPEARANCE_HEX_FIELDS = ['body_color', 'accent_color', 'nose_color', 'collar_color'];
const APPEARANCE_ALLOWED_KEYS = new Set([...APPEARANCE_HEX_FIELDS, 'hat_colors', 'scale']);
const APPEARANCE_MAX_HAT_COLORS = 6;
const APPEARANCE_SCALE_MIN = 0.01;
const APPEARANCE_SCALE_MAX = 100;

// Safety: patterns that must not appear in any prose/string field
const UNSAFE_PATTERNS = [
  { name: 'javascript_uri', pattern: /javascript\s*:/i },
  { name: 'eval_call', pattern: /\beval\s*\(/i },
  { name: 'function_constructor', pattern: /\bFunction\s*\(/i },
  { name: 'require_call', pattern: /\brequire\s*\(/i },
  { name: 'import_statement', pattern: /\bimport\s+.*\bfrom\b/i },
  { name: 'shell_exec', pattern: /\bexec\s*\(/i },
  { name: 'child_process', pattern: /child_process/i },
  { name: 'filesystem_path', pattern: /(?:\/etc\/|\/bin\/|\/dev\/|C:\\Windows\\|C:\\Program Files\\)/i },
  { name: 'network_url_in_code', pattern: /\b(fetch|XMLHttpRequest|axios)\s*\(/i },
];

// ---------------------------------------------------------------------------
// Entity `appearance` validator. Fail-closed and bounded: hex color channels,
// a bounded hat_colors array, a bounded scale, and CLOSED additionalProperties
// (unknown subkeys reject).
// ---------------------------------------------------------------------------
function validateEntityAppearance(app, base, errors) {
  const at = `${base}.appearance`;
  if (typeof app !== 'object' || app === null || Array.isArray(app)) {
    errors.push({ path: at, message: 'appearance must be an object' });
    return;
  }
  // Fail closed on unknown subkeys (additionalProperties:false parity).
  for (const key of Object.keys(app)) {
    if (!APPEARANCE_ALLOWED_KEYS.has(key)) {
      errors.push({ path: `${at}.${key}`, message: `additional property '${key}' not allowed` });
    }
  }
  for (const f of APPEARANCE_HEX_FIELDS) {
    if (app[f] !== undefined) {
      if (typeof app[f] !== 'string' || !HEX_COLOR_PATTERN.test(app[f])) {
        errors.push({ path: `${at}.${f}`, message: `must be a #rrggbb hex color, got ${JSON.stringify(app[f])}` });
      }
    }
  }
  if (app.hat_colors !== undefined) {
    if (!Array.isArray(app.hat_colors)) {
      errors.push({ path: `${at}.hat_colors`, message: 'must be an array' });
    } else {
      if (app.hat_colors.length > APPEARANCE_MAX_HAT_COLORS) {
        errors.push({ path: `${at}.hat_colors`, message: `max ${APPEARANCE_MAX_HAT_COLORS} colors, got ${app.hat_colors.length}` });
      }
      app.hat_colors.forEach((c, k) => {
        if (typeof c !== 'string' || !HEX_COLOR_PATTERN.test(c)) {
          errors.push({ path: `${at}.hat_colors[${k}]`, message: `must be a #rrggbb hex color, got ${JSON.stringify(c)}` });
        }
      });
    }
  }
  if (app.scale !== undefined) {
    if (typeof app.scale !== 'number' || !Number.isFinite(app.scale) || app.scale < APPEARANCE_SCALE_MIN || app.scale > APPEARANCE_SCALE_MAX) {
      errors.push({ path: `${at}.scale`, message: `must be a number in [${APPEARANCE_SCALE_MIN}, ${APPEARANCE_SCALE_MAX}], got ${JSON.stringify(app.scale)}` });
    }
  }
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------
function validate(spec) {
  const errors = [];

  // --- Top-level ---
  if (typeof spec !== 'object' || spec === null) {
    errors.push({ path: '$', message: 'spec must be a JSON object' });
    return errors;
  }

  // schema version
  if (spec.schema !== 'world-spec/1.0') {
    errors.push({
      path: '$.schema',
      message: `expected "world-spec/1.0", got "${spec.schema}"`,
    });
  }

  // required top fields
  for (const f of REQUIRED_TOP) {
    if (!(f in spec)) {
      errors.push({ path: `$`, message: `missing required field: ${f}` });
    }
  }
  if (errors.length > 0) return errors;

  // --- Meta ---
  if (typeof spec.meta !== 'object' || spec.meta === null) {
    errors.push({ path: '$.meta', message: 'meta must be an object' });
    return errors;
  }
  for (const f of META_REQUIRED) {
    if (!(f in spec.meta)) {
      errors.push({ path: `$.meta`, message: `missing required field: ${f}` });
    }
  }
  if (spec.meta.world_id && !ID_PATTERN.test(spec.meta.world_id)) {
    errors.push({
      path: '$.meta.world_id',
      message: `must match ${ID_PATTERN}, got "${spec.meta.world_id}"`,
    });
  }
  if (spec.meta.name && typeof spec.meta.name !== 'string') {
    errors.push({ path: '$.meta.name', message: 'must be a string' });
  }
  if (spec.meta.description && typeof spec.meta.description === 'string' && spec.meta.description.length > 2000) {
    errors.push({ path: '$.meta.description', message: `max 2000 chars, got ${spec.meta.description.length}` });
  }
  if (spec.meta.iteration !== undefined && (!Number.isInteger(spec.meta.iteration) || spec.meta.iteration < 0)) {
    errors.push({ path: '$.meta.iteration', message: 'must be a non-negative integer' });
  }

  // --- Regions ---
  if (!Array.isArray(spec.regions)) {
    errors.push({ path: '$.regions', message: 'must be an array' });
  } else if (spec.regions.length === 0) {
    errors.push({ path: '$.regions', message: 'must have at least 1 region' });
  } else if (spec.regions.length > MAX_REGIONS) {
    errors.push({ path: '$.regions', message: `max ${MAX_REGIONS} regions, got ${spec.regions.length}` });
  } else {
    const regionIds = new Set();
    for (let i = 0; i < spec.regions.length; i++) {
      const r = spec.regions[i];
      const base = `$.regions[${i}]`;
      if (typeof r !== 'object' || r === null) {
        errors.push({ path: base, message: 'must be an object' });
        continue;
      }
      for (const f of REGION_REQUIRED) {
        if (!(f in r)) errors.push({ path: base, message: `missing required field: ${f}` });
      }
      if (r.id) {
        if (!ID_PATTERN.test(r.id)) {
          errors.push({ path: `${base}.id`, message: `must match ${ID_PATTERN}, got "${r.id}"` });
        } else if (regionIds.has(r.id)) {
          errors.push({ path: `${base}.id`, message: `duplicate region id: "${r.id}"` });
        } else {
          regionIds.add(r.id);
        }
      }
      if (r.terrain && !VALID_TERRAINS.includes(r.terrain)) {
        errors.push({ path: `${base}.terrain`, message: `invalid terrain "${r.terrain}". Valid: ${VALID_TERRAINS.join(', ')}` });
      }
      if (r.biome && !VALID_BIOMES.includes(r.biome)) {
        errors.push({ path: `${base}.biome`, message: `invalid biome "${r.biome}". Valid: ${VALID_BIOMES.join(', ')}` });
      }
      if (r.bounds) {
        const b = r.bounds;
        for (const f of ['x_min', 'x_max', 'y_min', 'y_max']) {
          if (!(f in b)) errors.push({ path: `${base}.bounds`, message: `missing required field: ${f}` });
        }
        if (b.x_min !== undefined && b.x_max !== undefined && b.x_min >= b.x_max) {
          errors.push({ path: `${base}.bounds`, message: `x_min (${b.x_min}) must be < x_max (${b.x_max})` });
        }
        if (b.y_min !== undefined && b.y_max !== undefined && b.y_min >= b.y_max) {
          errors.push({ path: `${base}.bounds`, message: `y_min (${b.y_min}) must be < y_max (${b.y_max})` });
        }
      }
      if (r.description && typeof r.description === 'string' && r.description.length > 1000) {
        errors.push({ path: `${base}.description`, message: `max 1000 chars, got ${r.description.length}` });
      }
    }
  }

  // --- Entities ---
  if (!Array.isArray(spec.entities)) {
    errors.push({ path: '$.entities', message: 'must be an array' });
  } else if (spec.entities.length > MAX_ENTITIES) {
    errors.push({ path: '$.entities', message: `max ${MAX_ENTITIES} entities, got ${spec.entities.length}` });
  } else {
    const entityIds = new Set();
    for (let i = 0; i < spec.entities.length; i++) {
      const e = spec.entities[i];
      const base = `$.entities[${i}]`;
      if (typeof e !== 'object' || e === null) {
        errors.push({ path: base, message: 'must be an object' });
        continue;
      }
      for (const f of ENTITY_REQUIRED) {
        if (!(f in e)) errors.push({ path: base, message: `missing required field: ${f}` });
      }
      if (e.id) {
        if (!ID_PATTERN.test(e.id)) {
          errors.push({ path: `${base}.id`, message: `must match ${ID_PATTERN}, got "${e.id}"` });
        } else if (entityIds.has(e.id)) {
          errors.push({ path: `${base}.id`, message: `duplicate entity id: "${e.id}"` });
        } else {
          entityIds.add(e.id);
        }
      }
      if (e.type && !VALID_ENTITY_TYPES.includes(e.type)) {
        errors.push({ path: `${base}.type`, message: `invalid entity type "${e.type}". Valid: ${VALID_ENTITY_TYPES.join(', ')}` });
      }
      if (e.position) {
        for (const f of ['x', 'y']) {
          if (!(f in e.position)) errors.push({ path: `${base}.position`, message: `missing required field: ${f}` });
        }
      }
      if (e.energy !== undefined && (typeof e.energy !== 'number' || e.energy < 0 || e.energy > 100)) {
        errors.push({ path: `${base}.energy`, message: 'must be 0–100' });
      }
      if (e.behavior_tags && e.behavior_tags.length > 20) {
        errors.push({ path: `${base}.behavior_tags`, message: `max 20 tags, got ${e.behavior_tags.length}` });
      }
      if (e.lore_hooks && e.lore_hooks.length > 10) {
        errors.push({ path: `${base}.lore_hooks`, message: `max 10 lore hooks, got ${e.lore_hooks.length}` });
      }
      if (e.appearance !== undefined) {
        validateEntityAppearance(e.appearance, base, errors);
      }
      if (e.asset_requests) {
        for (let j = 0; j < e.asset_requests.length; j++) {
          const ar = e.asset_requests[j];
          if (!ar.type || !VALID_ASSET_TYPES.includes(ar.type)) {
            errors.push({ path: `${base}.asset_requests[${j}].type`, message: `invalid asset type "${ar.type}"` });
          }
          if (!ar.description) {
            errors.push({ path: `${base}.asset_requests[${j}].description`, message: 'missing description' });
          }
        }
      }
    }
  }

  // --- Events ---
  if (spec.events !== undefined) {
    if (!Array.isArray(spec.events)) {
      errors.push({ path: '$.events', message: 'must be an array' });
    } else if (spec.events.length > MAX_EVENTS) {
      errors.push({ path: '$.events', message: `max ${MAX_EVENTS} events, got ${spec.events.length}` });
    } else {
      const eventIds = new Set();
      for (let i = 0; i < spec.events.length; i++) {
        const ev = spec.events[i];
        const base = `$.events[${i}]`;
        if (!ev.id) errors.push({ path: base, message: 'missing id' });
        else if (eventIds.has(ev.id)) errors.push({ path: `${base}.id`, message: `duplicate event id: "${ev.id}"` });
        else eventIds.add(ev.id);
        if (ev.type && !VALID_EVENT_TYPES.includes(ev.type)) {
          errors.push({ path: `${base}.type`, message: `invalid event type "${ev.type}"` });
        }
        if (!ev.description) errors.push({ path: base, message: 'missing description' });
      }
    }
  }

  // --- Documentation ---
  if (spec.documentation) {
    const doc = spec.documentation;
    if (doc.world_concept && typeof doc.world_concept === 'string' && doc.world_concept.length > 3000) {
      errors.push({ path: '$.documentation.world_concept', message: `max 3000 chars, got ${doc.world_concept.length}` });
    }
    if (doc.iteration_notes && typeof doc.iteration_notes === 'string' && doc.iteration_notes.length > 2000) {
      errors.push({ path: '$.documentation.iteration_notes', message: `max 2000 chars, got ${doc.iteration_notes.length}` });
    }
  }

  // --- Safety scan (all string fields recursively) ---
  scanForUnsafe(spec, '$', errors);

  return errors;
}

// ---------------------------------------------------------------------------
// Recursive safety scan
// ---------------------------------------------------------------------------
function scanForUnsafe(obj, path_, errors) {
  if (typeof obj === 'string') {
    for (const { name, pattern } of UNSAFE_PATTERNS) {
      if (pattern.test(obj)) {
        errors.push({
          path: path_,
          message: `safety: unsafe pattern detected (${name})`,
        });
      }
    }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      scanForUnsafe(obj[i], `${path_}[${i}]`, errors);
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const key of Object.keys(obj)) {
      scanForUnsafe(obj[key], `${path_}.${key}`, errors);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node validate-world-spec.js <path-to-world-spec.json>');
    process.exit(2);
  }

  const filePath = args[0];
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`Error reading file: ${e.message}`);
    process.exit(2);
  }

  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (e) {
    console.error(`Error parsing JSON: ${e.message}`);
    process.exit(2);
  }

  const errors = validate(spec);

  if (errors.length === 0) {
    console.log(JSON.stringify({
      valid: true,
      world_id: spec.meta?.world_id || 'unknown',
      name: spec.meta?.name || 'unknown',
      regions: spec.regions?.length || 0,
      entities: spec.entities?.length || 0,
      events: spec.events?.length || 0,
      errors: [],
    }, null, 2));
    process.exit(0);
  } else {
    console.log(JSON.stringify({
      valid: false,
      world_id: spec.meta?.world_id || 'unknown',
      name: spec.meta?.name || 'unknown',
      errors: errors.map(e => ({ path: e.path, message: e.message })),
      error_count: errors.length,
    }, null, 2));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { validate, validateEntityAppearance };
