#!/usr/bin/env node
/**
 * verify-skill-contract.cjs — Validate a skill file against the canonical
 * skill-contract.schema.yaml.
 *
 * Usage: node tools/verify/verify-skill-contract.cjs <skill-file-path>
 *   e.g.: node tools/verify/verify-skill-contract.cjs frameworks/wordpress/qa/contracts/skill-map.yaml
 *
 * Validates:
 *   - Required contract fields are present and non-empty
 *   - execution_mode is a valid mode from the canonical list
 *   - trust_tier is declared and is one of the 5 valid tiers
 *   - behavioral_laws references exist in instructions/canonical/contracts/
 *   - evidence_requirements are non-empty for modes above instruction_only
 *
 * Outputs a VerificationSignal/1.0 JSON to _dev/reports/signals/.
 *
 * Exit code 0 = PASS/WARN, 1 = FAIL
 */

const fs = require('fs');
const path = require('path');
const { createSignal, addCheck, writeSignal, printSummary, printJsonOutput } = require('./lib/signal.cjs');
const checks = require('./lib/checks.cjs');

const projectRoot = path.resolve(__dirname, '../..');

// ─── CLI parsing ────────────────────────────────────────────────────────────

let skillFilePath = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--json') continue;
  if (!process.argv[i].startsWith('--')) {
    skillFilePath = process.argv[i];
  }
}

if (!skillFilePath) {
  console.error('Usage: node tools/verify/verify-skill-contract.cjs <skill-file-path>');
  console.error('  e.g.: node tools/verify/verify-skill-contract.cjs frameworks/wordpress/qa/contracts/skill-map.yaml');
  process.exit(2);
}

// Resolve relative to project root if not absolute
const resolvedPath = path.isAbsolute(skillFilePath)
  ? skillFilePath
  : path.join(projectRoot, skillFilePath);

// ─── Constants ──────────────────────────────────────────────────────────────

const VALID_MODES = [
  'FINDINGS_ONLY',
  'RUN_ONLY',
  'REVIEW_ONLY',
  'PATCH_ALLOWED',
  'COORDINATOR',
  'REPO_HYGIENE'
];

const VALID_TRUST_TIERS = [
  'instruction_only',
  'report_write_scoped',
  'patch_scoped',
  'external_service_touching',
  'meta_modifying'
];

const REQUIRED_FIELDS = [
  'id',
  'name',
  'description',
  'scope',
  'execution_mode',
  'required_inputs',
  'expected_outputs',
  'behavioral_laws',
  'evidence_requirements',
  'verification',
  'trust_tier',
  'artifact_contract'
];

// ─── YAML Parsing (simple key-value and list extraction) ────────────────────

/**
 * Parse a simple YAML-like file to extract skill mappings.
 * This handles the skill-map.yaml format with a mappings array.
 * For individual skill files, it parses frontmatter + body.
 */
function parseSkillFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const skills = [];

  // Check if this is a skill-map.yaml with mappings array
  if (content.includes('mappings:')) {
    // Parse each mapping block
    const mappingBlocks = content.split(/^  - id:/m);
    for (let i = 1; i < mappingBlocks.length; i++) {
      const block = '  - id:' + mappingBlocks[i];
      const skill = parseYamlBlock(block);
      if (skill.id) skills.push(skill);
    }
  } else {
    // Single skill file (SKILL.md with frontmatter or standalone YAML)
    const skill = parseSingleSkill(content);
    if (skill) skills.push(skill);
  }

  return skills;
}

function parseYamlBlock(block) {
  const skill = {};
  const lines = block.split('\n');

  // Extract id from the first line (e.g., "  - id: \"wordpress/qa:compile-dev-bundle\"")
  const idMatch = lines[0].match(/^\s+-\s+id:\s*(.+)$/);
  if (idMatch) {
    skill.id = idMatch[1].trim().replace(/^["']|["']$/g, '');
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match top-level fields (4 spaces indent for mapping items)
    const fieldMatch = line.match(/^\s{4}(\w[\w_]*)\s*:\s*(.*)$/);
    if (fieldMatch) {
      const [, key, value] = fieldMatch;
      const trimmedValue = value.trim();

      if (trimmedValue && !trimmedValue.startsWith('>')) {
        // Simple scalar value (strip quotes)
        skill[key] = trimmedValue.replace(/^["']|["']$/g, '');
      } else if (trimmedValue === '' || trimmedValue === '>') {
        // Could be a list or multi-line value
        const listItems = [];
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j];
          // List item at deeper indent
          const listMatch = nextLine.match(/^\s{6}- (.+)$/);
          const deeperObjMatch = nextLine.match(/^\s{6}- name:\s*(.+)$/);
          if (listMatch) {
            listItems.push(listMatch[1].trim());
          } else if (nextLine.match(/^\s{8}/)) {
            // Continuation of multi-line or nested object
          } else if (nextLine.match(/^\s{4}\w/) || nextLine.match(/^\s{2}- id:/)) {
            break;
          }
          j++;
        }
        if (listItems.length > 0) {
          skill[key] = listItems;
        } else if (trimmedValue === '>') {
          // Multi-line scalar
          let multiLine = '';
          let k = i + 1;
          while (k < lines.length && lines[k].match(/^\s{6}/)) {
            multiLine += lines[k].trim() + ' ';
            k++;
          }
          skill[key] = multiLine.trim();
        }
      }
    }

    // Match nested objects (verification, artifact_contract)
    if (line.match(/^\s{4}(verification|artifact_contract)\s*:$/)) {
      const key = line.trim().replace(':', '');
      skill[key] = {};
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        const nestedMatch = nextLine.match(/^\s{6}(\w[\w_]*)\s*:\s*(.*)$/);
        if (nestedMatch) {
          const [, nKey, nValue] = nestedMatch;
          const nTrimmed = nValue.trim();
          if (nTrimmed && nTrimmed !== '>') {
            skill[key][nKey] = nTrimmed.replace(/^["']|["']$/g, '');
          } else {
            // Collect list items
            const items = [];
            let k = j + 1;
            while (k < lines.length) {
              const itemMatch = lines[k].match(/^\s{8}- (.+)$/);
              if (itemMatch) {
                items.push(itemMatch[1].trim());
              } else if (!lines[k].match(/^\s{8}/)) {
                break;
              }
              k++;
            }
            if (items.length > 0) {
              skill[key][nKey] = items;
            }
          }
        } else if (nextLine.match(/^\s{4}\w/) || nextLine.match(/^\s{2}- id:/) || !nextLine.match(/^\s/)) {
          break;
        }
        j++;
      }
    }
  }

  return skill;
}

function parseSingleSkill(content) {
  // Handle YAML frontmatter
  if (content.startsWith('---')) {
    const endIdx = content.indexOf('---', 3);
    if (endIdx !== -1) {
      const frontmatter = content.slice(3, endIdx);
      const skill = {};
      for (const line of frontmatter.split('\n')) {
        const match = line.match(/^(\w[\w_]*)\s*:\s*(.+)$/);
        if (match) {
          skill[match[1]] = match[2].trim();
        }
      }
      return skill;
    }
  }
  return null;
}

// ─── Verification ───────────────────────────────────────────────────────────

// Derive a skill-id for signal naming
function deriveSkillId(filePath, skills) {
  if (skills.length === 1 && skills[0].id) {
    return skills[0].id.replace(/[/:]/g, '__');
  }
  return path.basename(filePath, path.extname(filePath));
}

// ─── Signal creation ────────────────────────────────────────────────────────

const signal = createSignal(
  'verify-skill-contract',
  `skill-contract:${path.relative(projectRoot, resolvedPath)}`,
  'mechanical'
);

// File existence check
addCheck(signal, checks.fileExists(resolvedPath, {
  id: 'contract.file_exists',
  message: `Skill contract file exists: ${path.relative(projectRoot, resolvedPath)}`
}));

if (!fs.existsSync(resolvedPath)) {
  if (!printJsonOutput(signal)) {
    const outputPath = path.join(projectRoot, '_dev', 'reports', 'signals',
      `verify-skill-contract__${path.basename(resolvedPath, path.extname(resolvedPath))}.signal.json`);
    writeSignal(signal, outputPath);
    printSummary(signal);
    console.log(`\nSignal: ${outputPath}`);
  }
  process.exit(1);
}

// Parse the skill file
let skills = [];
try {
  skills = parseSkillFile(resolvedPath);
} catch (e) {
  addCheck(signal, {
    id: 'contract.parseable',
    category: 'structure',
    severity: 'critical',
    message: 'Skill contract file is parseable',
    test: () => false,
    detail: `Parse error: ${e.message}`,
    fix_hint: 'Fix YAML/frontmatter syntax in the skill file'
  });
}

if (skills.length === 0) {
  addCheck(signal, {
    id: 'contract.has_skills',
    category: 'structure',
    severity: 'critical',
    message: 'At least one skill mapping found',
    test: () => false,
    detail: 'No skill mappings found in the file',
    fix_hint: 'Add skill mappings with required contract fields'
  });
} else {
  addCheck(signal, {
    id: 'contract.has_skills',
    category: 'structure',
    severity: 'critical',
    message: `Found ${skills.length} skill mapping(s)`,
    test: () => true
  });
}

// ─── Per-skill checks ───────────────────────────────────────────────────────

for (const skill of skills) {
  const prefix = (skill.id || skill.name || 'unknown').replace(/[/:]/g, '_');

  // Required fields presence
  for (const field of REQUIRED_FIELDS) {
    const value = skill[field];
    const hasValue = value !== undefined && value !== null && value !== '';
    const isNonEmptyList = Array.isArray(value) ? value.length > 0 : true;
    const isNonEmptyObj = (typeof value === 'object' && !Array.isArray(value))
      ? Object.keys(value).length > 0
      : true;

    addCheck(signal, {
      id: `${prefix}.field.${field}`,
      category: 'contract_fields',
      severity: 'critical',
      message: `${prefix}: required field "${field}" is present and non-empty`,
      test: () => hasValue && isNonEmptyList && isNonEmptyObj,
      detail: hasValue ? `Value type: ${typeof value}` : 'Field missing or empty',
      fix_hint: hasValue ? undefined : `Add "${field}" to skill "${prefix}"`
    });
  }

  // execution_mode validity
  if (skill.execution_mode) {
    addCheck(signal, {
      id: `${prefix}.valid_mode`,
      category: 'execution',
      severity: 'critical',
      message: `${prefix}: execution_mode "${skill.execution_mode}" is valid`,
      test: () => VALID_MODES.includes(skill.execution_mode),
      detail: VALID_MODES.includes(skill.execution_mode)
        ? 'Valid mode'
        : `Invalid. Must be one of: ${VALID_MODES.join(', ')}`,
      fix_hint: VALID_MODES.includes(skill.execution_mode)
        ? undefined
        : `Change execution_mode to one of: ${VALID_MODES.join(', ')}`
    });
  }

  // trust_tier validity
  if (skill.trust_tier) {
    addCheck(signal, {
      id: `${prefix}.valid_trust_tier`,
      category: 'trust',
      severity: 'critical',
      message: `${prefix}: trust_tier "${skill.trust_tier}" is valid`,
      test: () => VALID_TRUST_TIERS.includes(skill.trust_tier),
      detail: VALID_TRUST_TIERS.includes(skill.trust_tier)
        ? 'Valid tier'
        : `Invalid. Must be one of: ${VALID_TRUST_TIERS.join(', ')}`,
      fix_hint: VALID_TRUST_TIERS.includes(skill.trust_tier)
        ? undefined
        : `Change trust_tier to one of: ${VALID_TRUST_TIERS.join(', ')}`
    });
  }

  // behavioral_laws references exist
  if (Array.isArray(skill.behavioral_laws)) {
    for (const lawRef of skill.behavioral_laws) {
      const lawPath = path.join(projectRoot, lawRef);
      addCheck(signal, checks.fileExists(lawPath, {
        id: `${prefix}.law_ref.${path.basename(lawRef, path.extname(lawRef))}`,
        category: 'references',
        severity: 'critical',
        message: `${prefix}: behavioral_law reference exists: ${lawRef}`
      }));
    }
  }

  // evidence_requirements non-empty for modes above instruction_only
  if (skill.trust_tier && skill.trust_tier !== 'instruction_only') {
    const evidenceReqs = skill.evidence_requirements;
    const hasEvidence = Array.isArray(evidenceReqs) ? evidenceReqs.length > 0
      : (typeof evidenceReqs === 'string' && evidenceReqs.trim() !== '');

    addCheck(signal, {
      id: `${prefix}.evidence_for_tier`,
      category: 'evidence',
      severity: 'critical',
      message: `${prefix}: evidence_requirements non-empty for trust_tier "${skill.trust_tier}"`,
      test: () => hasEvidence,
      detail: hasEvidence
        ? `${Array.isArray(evidenceReqs) ? evidenceReqs.length : 1} evidence requirement(s)`
        : 'Evidence requirements empty but trust_tier requires them',
      fix_hint: hasEvidence
        ? undefined
        : `Add evidence_requirements for trust_tier "${skill.trust_tier}" (required for tiers above instruction_only)`
    });
  }

  // verification has checks and verifier
  if (skill.verification && typeof skill.verification === 'object') {
    addCheck(signal, {
      id: `${prefix}.verification.has_checks`,
      category: 'verification',
      severity: 'critical',
      message: `${prefix}: verification.checks is present`,
      test: () => {
        const c = skill.verification.checks;
        return Array.isArray(c) ? c.length > 0 : (c !== undefined && c !== '');
      },
      fix_hint: 'Add verification.checks list to the skill'
    });

    addCheck(signal, {
      id: `${prefix}.verification.has_verifier`,
      category: 'verification',
      severity: 'critical',
      message: `${prefix}: verification.verifier is present`,
      test: () => {
        const v = skill.verification.verifier;
        return v !== undefined && v !== null && String(v).trim() !== '';
      },
      fix_hint: 'Add verification.verifier to the skill'
    });
  }

  // artifact_contract has immutable_inputs and mutable_outputs
  if (skill.artifact_contract && typeof skill.artifact_contract === 'object') {
    addCheck(signal, {
      id: `${prefix}.artifact.immutable_inputs`,
      category: 'artifact_contract',
      severity: 'critical',
      message: `${prefix}: artifact_contract.immutable_inputs is present`,
      test: () => {
        const ii = skill.artifact_contract.immutable_inputs;
        return Array.isArray(ii) ? ii.length > 0 : (ii !== undefined && ii !== '');
      },
      fix_hint: 'Add artifact_contract.immutable_inputs list'
    });

    addCheck(signal, {
      id: `${prefix}.artifact.mutable_outputs`,
      category: 'artifact_contract',
      severity: 'critical',
      message: `${prefix}: artifact_contract.mutable_outputs is present`,
      test: () => {
        const mo = skill.artifact_contract.mutable_outputs;
        return Array.isArray(mo) ? mo.length > 0 : (mo !== undefined && mo !== '');
      },
      fix_hint: 'Add artifact_contract.mutable_outputs list'
    });
  }
}

// ─── Output ─────────────────────────────────────────────────────────────────

const skillId = deriveSkillId(resolvedPath, skills);

if (!printJsonOutput(signal)) {
  const scratchDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const outputPath = path.join(scratchDir, `verify-skill-contract__${skillId}.signal.json`);
  writeSignal(signal, outputPath);
  printSummary(signal);
  console.log(`\nSignal: ${outputPath}`);
}

process.exit(signal.gate_decision.proceed ? 0 : 1);
