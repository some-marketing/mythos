#!/usr/bin/env node
'use strict';
/**
 * copy-compliance-gate.js — reusable, fully parameterized ad-copy compliance gate.
 *
 * Extracted from clients/patron-gamma/projects/may-2026-offers/apply-multivariant-copy.js
 * (compliance gate canonical, 2026-06-10). FULLY parameterized — no client-specific
 * copy-block defaults. Callers supply copy-block config explicitly.
 *
 * Governing artifacts:
 *   _dev/reports/analysis/operator-decision__meta-ads-tools-promotion__20260610.md
 *   _dev/reports/analysis/convene-runs/20260610T145537Z-meta-ads-tools-promotion-review/synthesis.md
 *
 * Usage (module):
 *   const { complianceCheck } = require('./copy-compliance-gate');
 *   const result = complianceCheck(adSets, config);
 *   // adSets: Array<{ label: string, c: { titles: string[], bodies: string[], descriptions: string[] } }>
 *   // config (optional): { titleMaxChars, descMaxChars, maxOptionsPerField, superlativeTokens, bannedPatterns }
 *
 * Usage (CLI):
 *   node copy-compliance-gate.js --copy-json '{"adSets":[...],"config":{...}}'
 *   node copy-compliance-gate.js --copy-file path/to/copy.json
 *   node copy-compliance-gate.js --help
 *
 * Exit codes: 0=pass, 1=violations found, 2=input error
 */

/**
 * DEFAULT_CONFIG: safe automotive defaults — no patron-gamma-specific copy.
 * Callers for non-automotive use MUST override bannedPatterns as needed.
 */
const DEFAULT_CONFIG = {
  // Meta platform limits for text fields in asset_feed_spec
  titleMaxChars: 40,
  descMaxChars: 30,
  maxOptionsPerField: 5,

  // Superlative tokens: each token increments a budget counter.
  // Array of { token: RegExp|string, budget: number, label: string }
  // token can be a RegExp or a string (treated as case-insensitive word boundary)
  superlativeTokens: [
    { token: /\boriginal\b/i, budget: 1, label: '"original" superlative' }
  ],

  // bannedPatterns: Array of [RegExp, reasonLabel]
  // Callers may extend or replace. These are standard automotive SAC defaults.
  bannedPatterns: [
    [/[—–]|--/, 'em/en dash'],
    [/\$\s?\d|\d\s?%|\bAPR\b|\brate\b/i, 'price or rate'],
    [/bi-?weekly|per (week|month)|\/mo\b|payment/i, 'payment language'],
    [/financ|credit|approv|\bOAC\b|\bapply\b|lease/i, 'financing/credit language (SAC)'],
    [/ends? (june|july|\d)|expir|limited time|while .* last/i, 'expiry/urgency claim'],
    [/some ?marketing/i, 'agency named']
  ]
};

/**
 * complianceCheck — core gate function.
 *
 * @param {Array<{ label: string, c: { titles: string[], bodies: string[], descriptions: string[] } }>} adSets
 *   Array of ad sets to check. Must be non-empty; caller is responsible for providing the copy.
 *   There is NO built-in default adSets — this function refuses to run on an empty/undefined input.
 * @param {object} [config] — overrides for DEFAULT_CONFIG (deep-merged per key, not nested-merged)
 * @returns {{ errs: string[], superlativeCounts: object, pass: boolean }}
 */
function complianceCheck(adSets, config = {}) {
  if (!Array.isArray(adSets) || adSets.length === 0) {
    return {
      errs: ['complianceCheck: adSets must be a non-empty array — no built-in copy defaults; caller must supply copy explicitly'],
      superlativeCounts: {},
      pass: false
    };
  }

  const cfg = Object.assign({}, DEFAULT_CONFIG, config);
  // Allow caller to pass custom bannedPatterns and superlativeTokens directly.
  const banned = Array.isArray(cfg.bannedPatterns) ? cfg.bannedPatterns : DEFAULT_CONFIG.bannedPatterns;
  const superlatives = Array.isArray(cfg.superlativeTokens) ? cfg.superlativeTokens : DEFAULT_CONFIG.superlativeTokens;

  const errs = [];
  // Track counts per superlative label across all ad sets.
  const superlativeCounts = {};
  for (const s of superlatives) superlativeCounts[s.label] = 0;

  for (const ad of adSets) {
    const label = ad.label || '(unlabeled)';
    const c = ad.c || {};
    const titles = c.titles || [];
    const bodies = c.bodies || [];
    const descriptions = c.descriptions || [];
    const all = [...titles, ...bodies, ...descriptions];

    // Field-count limits (Meta platform limit: max 5 options per text field)
    if (titles.length > cfg.maxOptionsPerField) errs.push(`${label}: ${titles.length} titles (max ${cfg.maxOptionsPerField})`);
    if (bodies.length > cfg.maxOptionsPerField) errs.push(`${label}: ${bodies.length} bodies (max ${cfg.maxOptionsPerField})`);
    if (descriptions.length > cfg.maxOptionsPerField) errs.push(`${label}: ${descriptions.length} descriptions (max ${cfg.maxOptionsPerField})`);

    // Char limits
    titles.forEach((t, i) => {
      if (t.length > cfg.titleMaxChars) errs.push(`${label} title ${i + 1} > ${cfg.titleMaxChars} chars (${t.length}): ${t}`);
    });
    descriptions.forEach((d, i) => {
      if (d.length > cfg.descMaxChars) errs.push(`${label} description ${i + 1} > ${cfg.descMaxChars} chars (${d.length}): ${d}`);
    });

    // Banned content patterns
    for (const text of all) {
      for (const [re, why] of banned) {
        const pattern = re instanceof RegExp ? re : new RegExp(`\\b${re}\\b`, 'i');
        if (pattern.test(text)) {
          errs.push(`${label} banned content (${why}): ${JSON.stringify(text.slice(0, 60))}`);
        }
      }
    }

    // Superlative budget tracking
    for (const text of all) {
      for (const s of superlatives) {
        const re = s.token instanceof RegExp ? s.token : new RegExp(`\\b${s.token}\\b`, 'i');
        const matches = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || [];
        superlativeCounts[s.label] = (superlativeCounts[s.label] || 0) + matches.length;
      }
    }
  }

  // Superlative budget enforcement
  for (const s of superlatives) {
    const count = superlativeCounts[s.label] || 0;
    if (count > s.budget) {
      errs.push(`${s.label} used ${count}x (budget: ${s.budget})`);
    }
  }

  return { errs, superlativeCounts, pass: errs.length === 0 };
}

// ---- CLI wrapper ----
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write([
      'copy-compliance-gate.js — ad-copy compliance gate',
      '',
      'Usage:',
      '  node copy-compliance-gate.js --copy-json \'{"adSets":[...],"config":{...}}\'',
      '  node copy-compliance-gate.js --copy-file path/to/copy.json',
      '',
      'Input JSON schema:',
      '  {',
      '    "adSets": [ { "label": "...", "c": { "titles": [], "bodies": [], "descriptions": [] } } ],',
      '    "config": {',
      '      "titleMaxChars": 40,',
      '      "descMaxChars": 30,',
      '      "maxOptionsPerField": 5,',
      '      "bannedPatterns": [ ["regex_string", "reason_label"], ... ],',
      '      "superlativeTokens": [ { "token": "original", "budget": 1, "label": "..." } ]',
      '    }',
      '  }',
      '',
      'Exit codes: 0=pass, 1=violations, 2=input error'
    ].join('\n') + '\n');
    process.exit(0);
  }

  let raw;
  const jsonIdx = args.indexOf('--copy-json');
  const fileIdx = args.indexOf('--copy-file');

  if (jsonIdx !== -1 && args[jsonIdx + 1]) {
    raw = args[jsonIdx + 1];
  } else if (fileIdx !== -1 && args[fileIdx + 1]) {
    const fs = require('fs');
    const fp = args[fileIdx + 1];
    if (!fs.existsSync(fp)) {
      process.stderr.write(`Error: file not found: ${fp}\n`);
      process.exit(2);
    }
    raw = fs.readFileSync(fp, 'utf8');
  } else {
    process.stderr.write('Error: pass --copy-json or --copy-file. Use --help for usage.\n');
    process.exit(2);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`Error: invalid JSON: ${e.message}\n`);
    process.exit(2);
  }

  const result = complianceCheck(parsed.adSets, parsed.config || {});
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');

  if (!result.pass) {
    result.errs.forEach((e) => process.stderr.write(`VIOLATION: ${e}\n`));
    process.exit(1);
  }
  process.stdout.write('Compliance gate: PASS\n');
  process.exit(0);
}

module.exports = { complianceCheck, DEFAULT_CONFIG };
