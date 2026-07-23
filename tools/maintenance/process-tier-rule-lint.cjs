#!/usr/bin/env node
'use strict';

/**
 * process-tier-rule-lint.cjs — ProcessTierRule/1.2 schema + consumer lint.
 *
 * tier-enforcement-implementation slice 1, step tier-s1c-rule-lint-and-tests
 * (convene 20260611T130035Z condition 4 / plan gate G4):
 *
 *   A. Rule validation — strict add-ID enum (unregistered add IDs in any
 *      tier's `adds` are REJECTED), required typed fields per registry add
 *      (family, kind, surfaces, paths, mode, artifact_query, bypass_policy),
 *      family present on every add and restricted to quality-process (the
 *      SAFETY family is tier-blind by construction and never expressed as a
 *      tier add), tier table well-formed, declaration_policy +
 *      coordination_scope + harness_capability sections present.
 *
 *   B. Consumer discipline — hooks must consume add IDs via
 *      readSessionAdds(), never hardcoded tier names. The lint greps
 *      tier-consuming hooks (those importing readSessionTier /
 *      readSessionStamp / readSessionAdds) for hardcoded tier-name
 *      conditionals outside the resolver. A finding is suppressed only by an
 *      explicit `tier-name-ok:` line marker with a reason, or by the
 *      known-consumer allowlist below.
 *
 * Exit codes: 0 clean, 1 findings. Wired into the maintenance lane
 * (`npm run lint:process-tier-rule`; part of verify:all).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_RULE_PATH = path.join(ROOT, 'instructions/canonical/process-tier-rule.yaml');
const DEFAULT_HOOKS_DIR = path.join(ROOT, 'tools/kernel/hooks');

const EXPECTED_SCHEMA = 'ProcessTierRule/1.2';
const FAMILIES = ['safety', 'quality-process'];
const ADD_FAMILIES_ALLOWED_IN_REGISTRY = ['quality-process'];
const KINDS = ['injection', 'hard-gate', 'review-routing'];
const MODES = ['report-only', 'blocking'];
const TIER_NAMES = ['mechanical', 'sentinel', 'scaffold', 'associate', 'frontier'];
const ARTIFACT_QUERY_REQUIRED_KINDS = ['hard-gate', 'review-routing'];

// Known hardcoded tier-name consumers awaiting add-ID rewiring. Each entry
// names the surface and the plan step that retires it. Anything NOT listed
// here (and not carrying a `tier-name-ok:` marker) is a finding.
// EMPTY since tier-s2b-injection-consumers retired the ambient-router line-173
// frontier suppression (now derived from the rule's sheds list via
// readSessionStamp + add IDs via readSessionAdds — no tier-name conditionals).
const KNOWN_TIER_NAME_CONSUMERS = [];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { __parse_error: err.message };
  }
}

// ─── Part A: rule schema validation ─────────────────────────────────────────

function lintRule(rule, rulePathLabel) {
  const findings = [];
  const flag = (reason) => findings.push({ type: 'rule', file: rulePathLabel, reason });

  if (!rule || typeof rule !== 'object') {
    flag('rule file unreadable or not an object');
    return findings;
  }
  if (rule.__parse_error) {
    flag(`rule file is not valid JSON: ${rule.__parse_error}`);
    return findings;
  }
  if (rule.schema !== EXPECTED_SCHEMA) {
    flag(`schema must be ${EXPECTED_SCHEMA}, found ${JSON.stringify(rule.schema)}`);
  }

  // add_registry
  const registry = rule.add_registry && rule.add_registry.adds;
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    flag('add_registry.adds object is required');
  } else {
    for (const [id, add] of Object.entries(registry)) {
      const where = `add_registry.adds.${id}`;
      if (!add || typeof add !== 'object') {
        flag(`${where} must be an object`);
        continue;
      }
      if (!FAMILIES.includes(add.family)) {
        flag(`${where}.family must be one of ${FAMILIES.join('|')}, found ${JSON.stringify(add.family)}`);
      } else if (!ADD_FAMILIES_ALLOWED_IN_REGISTRY.includes(add.family)) {
        flag(`${where}.family ${JSON.stringify(add.family)} forbidden: the safety family is tier-blind by construction and never expressed as a tier add`);
      }
      if (!KINDS.includes(add.kind)) {
        flag(`${where}.kind must be one of ${KINDS.join('|')}, found ${JSON.stringify(add.kind)}`);
      }
      if (!Array.isArray(add.surfaces) || add.surfaces.length === 0 || !add.surfaces.every((s) => typeof s === 'string' && s.trim())) {
        flag(`${where}.surfaces must be a non-empty array of strings`);
      }
      if (!Array.isArray(add.paths) || !add.paths.every((p) => typeof p === 'string' && p.trim())) {
        flag(`${where}.paths must be an array of strings (may be empty)`);
      }
      if (!MODES.includes(add.mode)) {
        flag(`${where}.mode must be one of ${MODES.join('|')}, found ${JSON.stringify(add.mode)}`);
      }
      if (!Object.prototype.hasOwnProperty.call(add, 'artifact_query')) {
        flag(`${where}.artifact_query field is required (string or null)`);
      } else if (ARTIFACT_QUERY_REQUIRED_KINDS.includes(add.kind) && (typeof add.artifact_query !== 'string' || !add.artifact_query.trim())) {
        flag(`${where}.artifact_query must be a non-empty string for kind ${add.kind}`);
      }
      if (!add.bypass_policy || typeof add.bypass_policy !== 'object' ||
          typeof add.bypass_policy.kill_switch !== 'string' || !add.bypass_policy.kill_switch.trim() ||
          typeof add.bypass_policy.authority !== 'string' || !add.bypass_policy.authority.trim()) {
        flag(`${where}.bypass_policy must be an object with non-empty kill_switch and authority`);
      }
    }
  }

  // tier table
  const tiers = rule.tiers;
  if (!Array.isArray(tiers) || tiers.length === 0) {
    flag('tiers must be a non-empty array');
  } else {
    const seen = new Set();
    for (const tier of tiers) {
      if (!tier || typeof tier !== 'object' || typeof tier.tier !== 'string') {
        flag('every tier entry must be an object with a string tier name');
        continue;
      }
      seen.add(tier.tier);
      const where = `tiers[${tier.tier}]`;
      if (!TIER_NAMES.includes(tier.tier)) {
        flag(`${where}: unknown tier name (expected one of ${TIER_NAMES.join('|')})`);
      }
      if (!Array.isArray(tier.keeps)) flag(`${where}.keeps must be an array`);
      if (!Array.isArray(tier.sheds)) flag(`${where}.sheds must be an array`);
      if (!Array.isArray(tier.adds)) {
        flag(`${where}.adds array is required (may be empty)`);
      } else if (registry && typeof registry === 'object' && !Array.isArray(registry)) {
        for (const id of tier.adds) {
          if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(registry, id)) {
            flag(`${where}.adds contains unregistered add ID ${JSON.stringify(id)} — add IDs are a strict enum over add_registry.adds`);
          }
        }
      }
    }
    for (const required of TIER_NAMES) {
      if (!seen.has(required)) flag(`tier table is missing the ${required} tier`);
    }
  }

  // declaration_policy
  const policy = rule.declaration_policy;
  if (!policy || typeof policy !== 'object' || !policy.tier_rank || typeof policy.tier_rank !== 'object') {
    flag('declaration_policy.tier_rank is required (down-only declarations, convene condition 3)');
  } else {
    for (const tierName of TIER_NAMES) {
      if (!Number.isInteger(policy.tier_rank[tierName])) {
        flag(`declaration_policy.tier_rank.${tierName} must be an integer rank`);
      }
    }
  }

  // coordination_scope
  const scope = rule.coordination_scope;
  if (!scope || typeof scope !== 'object' || !Array.isArray(scope.values) ||
      !scope.values.includes('subtree') || !scope.values.includes('session-root')) {
    flag('coordination_scope.values must include subtree and session-root (operator fork resolution, G9)');
  } else {
    if (!Array.isArray(scope.subtree_contract_conditions) || scope.subtree_contract_conditions.length !== 4) {
      flag('coordination_scope.subtree_contract_conditions must list the four ratified conditions');
    }
    if (!Array.isArray(scope.session_root_forbidden_for_models) || scope.session_root_forbidden_for_models.length === 0) {
      flag('coordination_scope.session_root_forbidden_for_models must be a non-empty array');
    }
  }

  // harness_capability
  const cap = rule.harness_capability;
  if (!cap || typeof cap !== 'object' || !Array.isArray(cap.media) || !cap.harnesses || typeof cap.harnesses !== 'object') {
    flag('harness_capability column with media + harnesses is required (convene condition 1)');
  }

  // vocabulary disambiguation (G8)
  if (!rule.vocabulary_disambiguation || typeof rule.vocabulary_disambiguation !== 'object') {
    flag('vocabulary_disambiguation section is required (process-tier frontier vs dispatch-routing altitude frontier, G8)');
  }

  return findings;
}

// ─── Part B: tier-consuming hook discipline ─────────────────────────────────

const TIER_READ_IMPORT = /readSessionTier|readSessionStamp|readSessionAdds/;
const TIER_NAME_CONDITIONAL = /[!=]==?\s*['"](mechanical|sentinel|scaffold|associate|frontier)['"]|['"](mechanical|sentinel|scaffold|associate|frontier)['"]\s*[!=]==?/;

function lintHooks(hooksDir) {
  const findings = [];
  if (!fs.existsSync(hooksDir)) return findings;
  const files = fs.readdirSync(hooksDir).filter((f) => {
    if (!f.endsWith('.cjs')) return false;
    return fs.statSync(path.join(hooksDir, f)).isFile();
  });
  for (const file of files) {
    const full = path.join(hooksDir, file);
    const text = fs.readFileSync(full, 'utf8');
    if (!TIER_READ_IMPORT.test(text)) continue; // not a tier consumer
    if (file === 'session-start-tier-stamp.cjs') continue; // stamp WRITER, not a consumer
    const allowlisted = KNOWN_TIER_NAME_CONSUMERS.find((entry) => entry.file === file);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!TIER_NAME_CONDITIONAL.test(line)) continue;
      if (line.includes('tier-name-ok:')) continue;
      if (allowlisted) continue;
      findings.push({
        type: 'hook',
        file: path.relative(ROOT, full),
        line: i + 1,
        reason: 'tier-consuming hook hardcodes a tier-name conditional; consume add IDs via readSessionAdds() instead (convene condition 4), or mark the line tier-name-ok: <reason>'
      });
    }
  }
  return findings;
}

// ─── main ────────────────────────────────────────────────────────────────────

function run({ rulePath = DEFAULT_RULE_PATH, hooksDir = DEFAULT_HOOKS_DIR } = {}) {
  const rule = readJson(rulePath);
  const ruleFindings = lintRule(rule, path.relative(ROOT, rulePath));
  const hookFindings = lintHooks(hooksDir);
  return { findings: [...ruleFindings, ...hookFindings] };
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const ruleIdx = args.indexOf('--rule');
  const hooksIdx = args.indexOf('--hooks-dir');
  const rulePath = ruleIdx !== -1 ? path.resolve(args[ruleIdx + 1]) : DEFAULT_RULE_PATH;
  const hooksDir = hooksIdx !== -1 ? path.resolve(args[hooksIdx + 1]) : DEFAULT_HOOKS_DIR;

  const { findings } = run({ rulePath, hooksDir });

  if (jsonMode) {
    process.stdout.write(JSON.stringify({
      schema_expected: EXPECTED_SCHEMA,
      rule: path.relative(ROOT, rulePath),
      convene_ref: '20260611T130035Z condition 4 / plan gate G4',
      findings
    }, null, 2) + '\n');
  } else {
    if (findings.length === 0) {
      console.log(`process-tier-rule-lint: clean (${path.relative(ROOT, rulePath)} valid ${EXPECTED_SCHEMA}; tier-consuming hooks add-ID disciplined)`);
    } else {
      for (const f of findings) {
        console.error(`FINDING [${f.type}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.reason}`);
      }
      console.error(`process-tier-rule-lint: ${findings.length} finding(s)`);
    }
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

module.exports = { lintHooks, lintRule, run };

if (require.main === module) {
  main();
}
