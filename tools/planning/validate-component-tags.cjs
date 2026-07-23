#!/usr/bin/env node
'use strict';

/**
 * validate-component-tags.cjs — S2 of composable-framework-substrate.
 *
 * Validates every manifest's component_tags block:
 * - field shapes follow the kernel tag vocabulary
 *   (tools/kernel/lib/kernel-artifact-tag-schema.json: similarity_tags[],
 *   domain as STRING, surfaces[], related_artifacts[]) plus transfer_notes
 *   (string) — one vocabulary, no parallel invention [GROUNDING-ADJ #5];
 * - paired-surface integrity: every tagged key "<kind>::<name>" must
 *   reference a component the index actually emits — tags may not drift from
 *   the corpus (debrief lesson: paired surfaces update atomically);
 * - client-data lint on tag values and transfer_notes: client codes, client
 *   domains, and client names must never enter frameworks/
 *   [GROUNDING-ADJ #1, guardrails non-negotiable #2].
 *
 * Usage:
 *   node tools/planning/validate-component-tags.cjs [--json]
 * Exit 0 = valid, 1 = violations found.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const { buildComponentIndex } = require('./component-index.cjs');

// Client identifiers that must never appear in framework files. Sourced from
// clients/ directory names plus known client domains; lowercase substrings.
function clientLintTerms() {
  const terms = new Set();
  try {
    for (const code of fs.readdirSync(path.join(PROJECT_ROOT, 'clients'))) {
      if (!code.startsWith('.') && code.length >= 3) terms.add(code.toLowerCase());
    }
  } catch {
    // no clients dir — lint still runs on the static list
  }
  for (const t of ['highland', 'mazda', 'super dave', 'yarmouth']) terms.add(t);
  return [...terms];
}

function lintValue(value, terms) {
  const v = String(value).toLowerCase();
  return terms.filter((t) => v.includes(t));
}

function validateComponentTags(projectRoot = PROJECT_ROOT) {
  const index = buildComponentIndex();
  const knownIds = new Set(index.nodes.map((n) => `${n.framework_id}::${n.kind}::${n.name}`));
  const terms = clientLintTerms();
  const violations = [];
  let taggedCount = 0;

  // Tag surfaces: every framework manifest, plus the _shared sidecar
  // (frameworks/_shared/component-tags.json — _shared has no manifest).
  const tagSurfaces = [];
  const frameworksRoot = path.join(projectRoot, 'frameworks');
  const sidecar = path.join(frameworksRoot, '_shared', 'component-tags.json');
  if (fs.existsSync(sidecar)) {
    const doc = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    tagSurfaces.push({
      where: path.relative(projectRoot, sidecar),
      frameworkId: '_shared',
      block: doc.component_tags || doc
    });
  }
  for (const service of fs.readdirSync(frameworksRoot)) {
    if (service.startsWith('_') || service.startsWith('.')) continue;
    const serviceDir = path.join(frameworksRoot, service);
    if (!fs.statSync(serviceDir).isDirectory()) continue;
    for (const name of fs.readdirSync(serviceDir)) {
      const manifestPath = path.join(serviceDir, name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch {
        continue; // manifest:check owns JSON validity
      }
      if (manifest.component_tags == null) continue;
      tagSurfaces.push({
        where: path.relative(projectRoot, manifestPath),
        frameworkId: `${service}/${name}`,
        block: manifest.component_tags
      });
    }
  }

  for (const { where, frameworkId, block } of tagSurfaces) {
    if (typeof block !== 'object' || Array.isArray(block) || block == null) {
      violations.push({ manifest: where, key: '', rule: 'component_tags must be an object keyed "<kind>::<name>"' });
      continue;
    }
    for (const [key, entry] of Object.entries(block)) {
        taggedCount += 1;
        if (!knownIds.has(`${frameworkId}::${key}`)) {
          violations.push({ manifest: where, key, rule: 'tagged key does not reference an indexed component (paired-surface drift)' });
        }
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          violations.push({ manifest: where, key, rule: 'tag entry must be an object' });
          continue;
        }
        for (const f of ['similarity_tags', 'surfaces', 'related_artifacts']) {
          if (f in entry && (!Array.isArray(entry[f]) || entry[f].some((x) => typeof x !== 'string'))) {
            violations.push({ manifest: where, key, rule: `${f} must be an array of strings` });
          }
        }
        for (const f of ['domain', 'transfer_notes']) {
          if (f in entry && typeof entry[f] !== 'string') {
            violations.push({ manifest: where, key, rule: `${f} must be a string (kernel schema: domain is a string)` });
          }
        }
        const unknown = Object.keys(entry).filter(
          (k) => !['similarity_tags', 'domain', 'surfaces', 'related_artifacts', 'transfer_notes'].includes(k)
        );
        if (unknown.length) {
          violations.push({ manifest: where, key, rule: `unknown fields: ${unknown.join(', ')} (kernel vocabulary only)` });
        }
        const flat = [
          ...(Array.isArray(entry.similarity_tags) ? entry.similarity_tags : []),
          ...(Array.isArray(entry.surfaces) ? entry.surfaces : []),
          entry.domain || '',
          entry.transfer_notes || ''
        ];
        for (const v of flat) {
          const hits = lintValue(v, terms);
          if (hits.length) {
            violations.push({ manifest: where, key, rule: `client-data lint: "${String(v).slice(0, 60)}" contains [${hits.join(', ')}]` });
          }
        }
    }
  }
  return { schema: 'ComponentTagValidation/1.0', tagged_components: taggedCount, violations };
}

function main() {
  const result = validateComponentTags();
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (result.violations.length === 0) {
    process.stdout.write(`component-tags: VALID (${result.tagged_components} tagged component(s))\n`);
  } else {
    process.stdout.write(`component-tags: ${result.violations.length} violation(s)\n`);
    for (const v of result.violations) {
      process.stdout.write(`  ${v.manifest} [${v.key}]: ${v.rule}\n`);
    }
  }
  process.exit(result.violations.length === 0 ? 0 : 1);
}

if (require.main === module) main();

module.exports = { validateComponentTags, clientLintTerms, lintValue };
