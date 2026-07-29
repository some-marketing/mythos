#!/usr/bin/env node
/**
 * verify-skill.cjs — Deep validation of a single SKILL.md file.
 *
 * Usage: node tools/verify/verify-skill.cjs <path-to-SKILL.md>
 *
 * Validates: frontmatter, required XML tags, quality checks, execution mode,
 *            model recommendation, markdown heading avoidance.
 *
 * Exit code 0 = PASS/WARN, 1 = FAIL
 */

const fs = require('fs');
const path = require('path');
const { createSignal, addCheck, writeSignal, printSummary, printJsonOutput } = require('./lib/signal.cjs');
const checks = require('./lib/checks.cjs');

const skillPath = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;

if (!skillPath) {
  console.error('Usage: node tools/verify/verify-skill.cjs <path-to-SKILL.md>');
  process.exit(2);
}

const fullPath = path.resolve(skillPath);
const skillName = path.basename(path.dirname(fullPath));

const signal = createSignal('verify-skill', `skill:${skillName}`);

// ─── Basics ──────────────────────────────────────────────────────────────

addCheck(signal, checks.fileExists(fullPath, {
  id: 'skill.exists',
  message: `SKILL.md exists: ${skillName}`
}));

addCheck(signal, checks.fileMinSize(fullPath, 500, {
  id: 'skill.min_size',
  severity: 'warning',
  message: `SKILL.md >= 500 bytes (non-trivial content)`
}));

// ─── Frontmatter ─────────────────────────────────────────────────────────

addCheck(signal, checks.yamlHasFrontmatter(fullPath, ['name', 'description'], {
  id: 'skill.frontmatter',
  category: 'frontmatter',
  message: 'Has YAML frontmatter with name, description'
}));

// ─── Required XML tags ──────────────────────────────────────────────────

addCheck(signal, checks.xmlHasTag(fullPath, 'objective', {
  id: 'skill.tag.objective',
  category: 'structure',
  message: 'Has <objective> tag'
}));

addCheck(signal, checks.xmlHasTag(fullPath, 'quick_start', {
  id: 'skill.tag.quick_start',
  category: 'structure',
  message: 'Has <quick_start> tag'
}));

addCheck(signal, checks.xmlHasTag(fullPath, 'success_criteria', {
  id: 'skill.tag.success_criteria',
  category: 'structure',
  message: 'Has <success_criteria> tag'
}));

// ─── Recommended XML tags ────────────────────────────────────────────────

const recommendedTags = ['execution_mode', 'execution_rules', 'safety_rules'];
for (const tag of recommendedTags) {
  addCheck(signal, checks.xmlHasTag(fullPath, tag, {
    id: `skill.tag.${tag}`,
    category: 'recommended',
    severity: 'warning',
    message: `Has <${tag}> tag (recommended)`
  }));
}

// Check for workflow tag (either <automated_workflow> or <workflow>)
addCheck(signal, {
  id: 'skill.tag.workflow',
  category: 'recommended',
  severity: 'warning',
  message: 'Has workflow definition (<automated_workflow> or <workflow>)',
  evidence: fullPath,
  test: () => {
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      return content.includes('<automated_workflow') || content.includes('<workflow');
    } catch { return false; }
  },
  fix_hint: 'Add <automated_workflow> or <workflow> section with step definitions'
});

// ─── Quality: no markdown headings in body ───────────────────────────────

addCheck(signal, checks.xmlNoMarkdownHeadings(fullPath, {
  id: 'skill.no_md_headings',
  message: 'No ## or ### headings in body (uses XML tags instead)'
}));

// ─── Execution mode declaration ──────────────────────────────────────────

const validModes = ['FINDINGS_ONLY', 'RUN_ONLY', 'REVIEW_ONLY', 'PATCH_ALLOWED', 'COORDINATOR', 'REPO_HYGIENE'];

addCheck(signal, {
  id: 'skill.mode_declared',
  category: 'mode',
  severity: 'warning',
  message: 'Declares a valid execution mode',
  evidence: fullPath,
  test: () => {
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      return validModes.some(mode => content.includes(mode));
    } catch { return false; }
  },
  fix_hint: `Declare an execution mode (one of: ${validModes.join(', ')})`
});

// ─── Model recommendation ────────────────────────────────────────────────

addCheck(signal, {
  id: 'skill.model_declared',
  category: 'mode',
  severity: 'warning',
  message: 'Declares a model recommendation (opus, sonnet, or haiku)',
  evidence: fullPath,
  test: () => {
    try {
      const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
      return content.includes('opus') || content.includes('sonnet') || content.includes('haiku');
    } catch { return false; }
  },
  fix_hint: 'Add <model_recommendation> section declaring opus, sonnet, or haiku'
});

// ─── References directory ────────────────────────────────────────────────

const refsDir = path.join(path.dirname(fullPath), 'references');
if (fs.existsSync(refsDir)) {
  try {
    const refFiles = fs.readdirSync(refsDir).filter(f => f.endsWith('.md'));
    addCheck(signal, {
      id: 'skill.refs_populated',
      category: 'references',
      severity: 'warning',
      message: `references/ directory has ${refFiles.length} .md file(s)`,
      test: () => refFiles.length > 0,
      fix_hint: 'Add reference .md files or remove the empty references/ directory'
    });
  } catch {}
}

// ─── Output ──────────────────────────────────────────────────────────────

if (!printJsonOutput(signal)) {
  const projectRoot = path.resolve(__dirname, '../..');
  const scratchDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const outputPath = path.join(scratchDir, `verify-skill__${skillName}.signal.json`);
  writeSignal(signal, outputPath);
  printSummary(signal);
  console.log(`\nSignal: ${outputPath}`);
}

process.exit(signal.gate_decision.proceed ? 0 : 1);
