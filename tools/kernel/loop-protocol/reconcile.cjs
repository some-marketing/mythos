#!/usr/bin/env node
'use strict';

/**
 * reconcile.cjs — W3 — drift check: the per-instance classification ledger vs
 * the manifest/git truth it is supposed to track.
 *
 * Flags any path whose EFFECTIVE ledgered layer no longer matches the layer the
 * protected-path manifest (W1) would assign it — UNLESS the deviation is backed
 * by an operator-signed `reclassify` entry (a legitimate down-layer ratchet,
 * loop-protocol law §2). An unbacked mismatch is DRIFT and exits non-zero.
 *
 * Manifest is read BY PATH per INTERFACE.md (no cross-editing W1's file):
 *   tools/kernel/loop-protocol/protected-path-manifest.json
 * If the manifest does not exist yet (parallel build), there is no truth to
 * reconcile against: emit a NOTICE and exit 0.
 *
 * Usage:
 *   node reconcile.cjs [--instance <id>]   # omit --instance to scan all ledgers
 * Exit codes: 0 = no drift; 2 = drift detected; 1 = usage/IO error.
 */

const fs = require('fs');
const path = require('path');
const ledger = require('./ledger.js');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const MANIFEST_PATH = path.join(__dirname, 'protected-path-manifest.json');

const LAYER_RANK = { L0: 0, 'L0.5': 1, L1: 2, L2: 3 };

/**
 * Convert a glob (supporting ** and *) to an anchored RegExp.
 * `**` matches across path separators; `*` matches within a segment.
 */
function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** — match anything including separators
        re += '.*';
        i++;
        // swallow a trailing slash after ** so **/x also matches x
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$+?.()|[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  re += '$';
  return new RegExp(re);
}

function matchesAny(globs, p) {
  if (!Array.isArray(globs)) return false;
  return globs.some((g) => globToRegExp(g).test(p));
}

/**
 * Compute the manifest-implied layer for a path in an instance.
 * Physics order (default-deny): auto_L1 wins, then instance floor/L0.5/L0 maps,
 * else the manifest default (L1).
 */
function manifestLayer(manifest, instance, p) {
  if (matchesAny(manifest.auto_L1_globs, p)) return 'L1';
  const inst = (manifest.instances && manifest.instances[instance]) || {};
  if (matchesAny(inst.floor_tripwire_globs, p)) return 'L1';
  if (matchesAny(inst.L05_grant_globs, p)) return 'L0.5';
  if (matchesAny(inst.L0_globs, p)) return 'L0';
  return manifest.default || 'L1';
}

function isOperatorReclassify(entry) {
  return (
    entry &&
    entry.kind === 'reclassify' &&
    entry.reclassify &&
    entry.reclassify.confirmed === true &&
    typeof entry.signature === 'string'
  );
}

/** Latest entry per path, preserving append order for stability. */
function effectiveByPath(entries) {
  const map = new Map();
  for (const e of entries) map.set(e.path, e); // later overwrites earlier
  return map;
}

function listInstances() {
  if (!fs.existsSync(ledger.LEDGER_DIR)) return [];
  return fs
    .readdirSync(ledger.LEDGER_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.itercap.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

function main() {
  const argv = process.argv.slice(2);
  let onlyInstance = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--instance') onlyInstance = argv[++i];
  }

  if (!fs.existsSync(MANIFEST_PATH)) {
    process.stdout.write(
      `reconcile: NOTICE — no manifest at ${path.relative(PROJECT_ROOT, MANIFEST_PATH)} yet; ` +
        'nothing to reconcile (W1 not built). Exit 0.\n'
    );
    process.exit(0);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (err) {
    process.stderr.write(`reconcile: ERROR — cannot parse manifest: ${err.message}\n`);
    process.exit(1);
  }

  const instances = onlyInstance ? [onlyInstance] : listInstances();
  if (instances.length === 0) {
    process.stdout.write('reconcile: NOTICE — no instance ledgers found. Exit 0.\n');
    process.exit(0);
  }

  const drift = [];
  const overrides = [];
  const missingOnDisk = [];

  for (const instance of instances) {
    const entries = ledger.read(instance);
    const effective = effectiveByPath(entries);
    for (const [p, entry] of effective) {
      const truth = manifestLayer(manifest, instance, p);
      if (entry.layer !== truth) {
        if (isOperatorReclassify(entry)) {
          overrides.push({ instance, path: p, ledger: entry.layer, manifest: truth });
        } else {
          drift.push({
            instance,
            path: p,
            ledger_layer: entry.layer,
            manifest_layer: truth,
            down_layer: LAYER_RANK[entry.layer] < LAYER_RANK[truth],
          });
        }
      }
      const abs = path.join(PROJECT_ROOT, p);
      if (!fs.existsSync(abs)) missingOnDisk.push({ instance, path: p });
    }
  }

  for (const o of overrides) {
    process.stdout.write(
      `reconcile: override (operator-signed) instance=${o.instance} path=${o.path} ` +
        `ledger=${o.ledger} manifest=${o.manifest} — legitimate ratchet, not drift\n`
    );
  }
  for (const m of missingOnDisk) {
    process.stdout.write(
      `reconcile: WARNING — instance=${m.instance} ledgered path missing on disk: ${m.path}\n`
    );
  }

  if (drift.length > 0) {
    process.stderr.write('reconcile: DRIFT DETECTED\n');
    for (const d of drift) {
      process.stderr.write(
        `  instance=${d.instance} path=${d.path} ledger=${d.ledger_layer} ` +
          `manifest=${d.manifest_layer}` +
          (d.down_layer ? ' [DOWN-LAYER without operator reclassify — RATCHET VIOLATION]' : '') +
          '\n'
      );
    }
    process.exit(2);
  }

  process.stdout.write(
    `reconcile: OK — ${instances.length} instance ledger(s) consistent with manifest truth.\n`
  );
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { globToRegExp, manifestLayer, matchesAny, isOperatorReclassify };
