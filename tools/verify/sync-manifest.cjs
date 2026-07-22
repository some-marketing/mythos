#!/usr/bin/env node
/**
 * sync-manifest.cjs — Scan disk and sync .claude/project-claude.yml
 *
 * Scans system-level and framework-level Claude assets on disk,
 * diffs against the current manifest, and updates it to match reality.
 *
 * Usage:
 *   node tools/verify/sync-manifest.cjs              # update manifest
 *   node tools/verify/sync-manifest.cjs --check      # report drift, exit 1 if stale
 *
 * Exit code 0 = in sync (or updated), 1 = drift detected (--check mode)
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const manifestPath = path.join(projectRoot, '.claude', 'project-claude.yml');
const checkOnly = process.argv.includes('--check');

// ─── Scanning helpers ──────────────────────────────────────────────────────

function globDir(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const regex = new RegExp(pattern);
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (regex.test(entry.name)) results.push(full);
    }
  };
  walk(dir);
  return results.sort();
}

function relPath(absPath) {
  return path.relative(projectRoot, absPath).replace(/\\/g, '/');
}

function basename(p) {
  return path.basename(p, path.extname(p));
}

// ─── Scan system assets ────────────────────────────────────────────────────

function scanSystemSkills() {
  const dir = path.join(projectRoot, '.claude', 'skills');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .filter(e => fs.existsSync(path.join(dir, e.name, 'SKILL.md')))
    .map(e => ({
      path: `.claude/skills/${e.name}/SKILL.md`,
      name: e.name
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function scanSystemCommands() {
  const dir = path.join(projectRoot, '.claude', 'commands');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => ({ path: `.claude/commands/${f}` }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function scanSystemAgents() {
  const dir = path.join(projectRoot, '.claude', 'agents');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => ({
      path: `.claude/agents/${f}`,
      name: basename(f)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Scan framework assets ─────────────────────────────────────────────────

function discoverFrameworks() {
  const fwRoot = path.join(projectRoot, 'frameworks');
  if (!fs.existsSync(fwRoot)) return [];
  const frameworks = [];
  for (const service of fs.readdirSync(fwRoot, { withFileTypes: true })) {
    if (!service.isDirectory() || service.name.startsWith('_')) continue;
    const serviceDir = path.join(fwRoot, service.name);
    for (const fw of fs.readdirSync(serviceDir, { withFileTypes: true })) {
      if (!fw.isDirectory()) continue;
      const manifestFile = path.join(serviceDir, fw.name, 'manifest.json');
      if (!fs.existsSync(manifestFile)) continue;
      frameworks.push({
        id: `${service.name}/${fw.name}`,
        dir: path.join(serviceDir, fw.name)
      });
    }
  }
  return frameworks.sort((a, b) => a.id.localeCompare(b.id));
}

function scanFrameworkSkills(fwDir, fwId) {
  const fwName = fwId.split('/')[1];
  let dir = path.join(fwDir, '.claude', 'skills', fwId);
  if (!fs.existsSync(dir)) {
    dir = path.join(fwDir, '.claude', 'skills', fwName);
  }
  if (!fs.existsSync(dir)) return [];
  const skills = globDir(dir, /^SKILL\.md$/);
  return skills;
}

function scanFrameworkCommands(fwDir, fwId) {
  const fwName = fwId.split('/')[1];
  let dir = path.join(fwDir, '.claude', 'commands', fwId);
  if (!fs.existsSync(dir)) {
    dir = path.join(fwDir, '.claude', 'commands', fwName);
  }
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md'));
}

function scanFrameworkAgents(fwDir, fwId) {
  const fwName = fwId.split('/')[1];
  let dir = path.join(fwDir, '.claude', 'agents', fwId);
  if (!fs.existsSync(dir)) {
    dir = path.join(fwDir, '.claude', 'agents', fwName);
  }
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md'));
}

// ─── Scan guardrails ───────────────────────────────────────────────────────

const REQUIRED_GUARDRAIL_SECTIONS = [
  'execution_modes',
  'observational_reporting',
  'evidence_standards',
  'file_modification_rules',
  'data_safety',
  'subagent_orchestration',
  'mode_checklists'
];

function scanGuardrails(frameworks) {
  const guardrails = [];

  // System guardrails
  const sysGuardrails = path.join(projectRoot, '.claude', 'guardrails.md');
  if (fs.existsSync(sysGuardrails)) {
    guardrails.push({
      path: '.claude/guardrails.md',
      sections: REQUIRED_GUARDRAIL_SECTIONS
    });
  }

  // Framework guardrails
  for (const fw of frameworks) {
    const fwGuardrails = path.join(fw.dir, 'guardrails.md');
    if (fs.existsSync(fwGuardrails)) {
      guardrails.push({
        path: `frameworks/${fw.id}/guardrails.md`
      });
    }
  }

  return guardrails;
}

// ─── YAML generation ───────────────────────────────────────────────────────

function indent(level) {
  return '  '.repeat(level);
}

function generateYaml(systemSkills, systemCommands, systemAgents, frameworks, guardrails) {
  const lines = [];

  lines.push('# Mythos Project Manifest');
  lines.push('# Machine-readable definition of all required Claude assets');
  lines.push('');
  lines.push('project:');
  lines.push('  name: Mythos');
  lines.push('  version: 1.0.0');
  lines.push('  description: LLM Operating System for agency framework execution');
  lines.push('');

  // Required skills
  lines.push('required_skills:');
  lines.push('  system:');
  for (const s of systemSkills) {
    lines.push(`    - path: ${s.path}`);
    lines.push(`      name: ${s.name}`);
  }
  lines.push('  frameworks:');
  for (const fw of frameworks) {
    const fwName = fw.id.split('/')[1];
    const skills = scanFrameworkSkills(fw.dir, fw.id);
    if (skills.length > 0) {
      let skillSubPath = fw.id;
      if (!fs.existsSync(path.join(fw.dir, '.claude', 'skills', fw.id))) {
        skillSubPath = fwName;
      }
      const skillsPath = `frameworks/${fw.id}/.claude/skills/${skillSubPath}/`;
      const desc = skills.length === 1
        ? fwName
        : `${fwName} (${skills.length} skills)`;
      lines.push(`    - path: ${skillsPath}`);
      lines.push(`      name: ${desc}`);
    }
  }
  lines.push('');

  // Required commands
  lines.push('required_commands:');
  lines.push('  system:');
  for (const c of systemCommands) {
    lines.push(`    - path: ${c.path}`);
  }
  lines.push('  frameworks:');
  for (const fw of frameworks) {
    const fwName = fw.id.split('/')[1];
    const cmds = scanFrameworkCommands(fw.dir, fw.id);
    if (cmds.length > 0) {
      let cmdSubPath = fw.id;
      if (!fs.existsSync(path.join(fw.dir, '.claude', 'commands', fw.id))) {
        cmdSubPath = fwName;
      }
      const cmdsPath = `frameworks/${fw.id}/.claude/commands/${cmdSubPath}/`;
      lines.push(`    - path: ${cmdsPath}`);
      lines.push(`      note: ${cmds.length} command${cmds.length === 1 ? '' : 's'}`);
    }
  }
  lines.push('');

  // Required subagents
  lines.push('required_subagents:');
  lines.push('  system:');
  for (const a of systemAgents) {
    lines.push(`    - path: ${a.path}`);
    lines.push(`      name: ${a.name}`);
  }
  lines.push('  frameworks:');
  for (const fw of frameworks) {
    const fwName = fw.id.split('/')[1];
    const agents = scanFrameworkAgents(fw.dir, fw.id);
    if (agents.length > 0) {
      let agentSubPath = fw.id;
      if (!fs.existsSync(path.join(fw.dir, '.claude', 'agents', fw.id))) {
        agentSubPath = fwName;
      }
      const agentsPath = `frameworks/${fw.id}/.claude/agents/${agentSubPath}/`;
      lines.push(`    - path: ${agentsPath}`);
      lines.push(`      note: ${agents.length} agent${agents.length === 1 ? '' : 's'}`);
    }
  }
  lines.push('');

  // Required guardrails
  lines.push('required_guardrails:');
  for (const g of guardrails) {
    lines.push(`  - path: ${g.path}`);
    if (g.sections) {
      lines.push('    sections:');
      for (const s of g.sections) {
        lines.push(`      - ${s}`);
      }
    }
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Diff ──────────────────────────────────────────────────────────────────

function diffManifest(currentContent, newContent) {
  const changes = [];
  const currentLines = currentContent.trim().split('\n');
  const newLines = newContent.trim().split('\n');

  if (currentLines.length !== newLines.length) {
    changes.push(`Line count: ${currentLines.length} -> ${newLines.length}`);
  }

  // Extract counts for a readable summary
  const countPattern = /- path: (.+)/g;
  const currentPaths = new Set(currentContent.match(countPattern) || []);
  const newPaths = new Set(newContent.match(countPattern) || []);

  for (const p of newPaths) {
    if (!currentPaths.has(p)) {
      changes.push(`+ ${p.replace('- path: ', '')}`);
    }
  }
  for (const p of currentPaths) {
    if (!newPaths.has(p)) {
      changes.push(`- ${p.replace('- path: ', '')}`);
    }
  }

  return changes;
}

// ─── Main ──────────────────────────────────────────────────────────────────

const systemSkills = scanSystemSkills();
const systemCommands = scanSystemCommands();
const systemAgents = scanSystemAgents();
const frameworks = discoverFrameworks();
const guardrails = scanGuardrails(frameworks);

const newYaml = generateYaml(systemSkills, systemCommands, systemAgents, frameworks, guardrails);

// Read current manifest
let currentContent = '';
if (fs.existsSync(manifestPath)) {
  currentContent = fs.readFileSync(manifestPath, 'utf8');
}

const changes = diffManifest(currentContent, newYaml);
const isDrifted = currentContent.trim() !== newYaml.trim();

if (!isDrifted) {
  console.log('PASS: project-claude.yml is in sync with disk');
  process.exit(0);
}

console.log(`Manifest drift detected (${changes.length} changes):\n`);
for (const c of changes) {
  console.log(`  ${c}`);
}
console.log('');

if (checkOnly) {
  console.log('FAIL: manifest is out of sync. Run `npm run manifest:sync` to fix.');
  process.exit(1);
} else {
  fs.writeFileSync(manifestPath, newYaml);
  console.log(`Updated: ${path.relative(projectRoot, manifestPath)}`);

  // Summary
  console.log(`\nManifest now contains:`);
  console.log(`  System skills:    ${systemSkills.length}`);
  console.log(`  System commands:  ${systemCommands.length}`);
  console.log(`  System agents:    ${systemAgents.length}`);
  console.log(`  Frameworks:       ${frameworks.length}`);
  console.log(`  Guardrail files:  ${guardrails.length}`);
  process.exit(0);
}
