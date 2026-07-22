#!/usr/bin/env node
'use strict';

const path = require('path');
const { exists, readText } = require('./lib/io');

const rootDir = path.resolve(__dirname, '..', '..');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

// Load project-claude.yml as raw text (real YAML, not JSON)
const manifestPath = path.join(rootDir, '.claude', 'project-claude.yml');
if (!exists(manifestPath)) {
  fail('.claude/project-claude.yml not found');
  process.exit(1);
}

const raw = readText(manifestPath);

// Extract all `- path: <value>` entries and their context
const pathEntries = [];
const lines = raw.split('\n');
let currentSection = '';
let currentSubSection = '';

for (const line of lines) {
  // Track top-level sections (required_subagents, required_skills, etc.)
  const sectionMatch = line.match(/^(\w+):/);
  if (sectionMatch) {
    currentSection = sectionMatch[1];
    currentSubSection = '';
  }
  // Track sub-sections (system, frameworks)
  const subMatch = line.match(/^  (\w+):/);
  if (subMatch) {
    currentSubSection = subMatch[1];
  }
  // Extract path entries
  const pathMatch = line.match(/^\s+- path:\s+(.+)/);
  if (pathMatch) {
    pathEntries.push({
      section: currentSection,
      sub: currentSubSection,
      path: pathMatch[1].trim()
    });
  }
}

// Validate path entries for a given section and subsection
function validatePaths(entries, sectionName, subSection, label) {
  const filtered = entries.filter((e) => e.section === sectionName && e.sub === subSection);
  for (const entry of filtered) {
    const fullPath = path.join(rootDir, entry.path);
    if (exists(fullPath)) {
      pass(`${label} exists: ${entry.path}`);
    } else {
      fail(`${label} missing: ${entry.path}`);
    }
  }
}

// Validate system entries
validatePaths(pathEntries, 'required_subagents', 'system', 'Subagent');
validatePaths(pathEntries, 'required_skills', 'system', 'Skill');
validatePaths(pathEntries, 'required_commands', 'system', 'Command');

// Validate framework entries
validatePaths(pathEntries, 'required_subagents', 'frameworks', 'Framework subagent');
validatePaths(pathEntries, 'required_skills', 'frameworks', 'Framework skill');
validatePaths(pathEntries, 'required_commands', 'frameworks', 'Framework command');

// Validate all guardrail file paths exist
const guardrailPaths = pathEntries.filter((e) => e.section === 'required_guardrails');
for (const entry of guardrailPaths) {
  const fullPath = path.join(rootDir, entry.path);
  if (exists(fullPath)) {
    pass(`Guardrail file exists: ${entry.path}`);
  } else {
    fail(`Guardrail file missing: ${entry.path}`);
  }
}

// Extract guardrail sections (indented with 6+ spaces under sections:)
const sectionsMatch = raw.match(/sections:\n((?:\s{6,}-\s+\w+\n?)+)/);
if (sectionsMatch) {
  const sectionNames = sectionsMatch[1].match(/- (\w+)/g).map((s) => s.replace('- ', ''));
  // Find the guardrail file path
  const guardrailPathMatch = raw.match(/required_guardrails:\n\s+- path:\s+(.+)/);
  if (guardrailPathMatch) {
    const guardrailPath = path.join(rootDir, guardrailPathMatch[1].trim());
    if (exists(guardrailPath)) {
      const guardrailContent = readText(guardrailPath);
      for (const section of sectionNames) {
        // Normalize snake_case to Title Case with & for _and_
        const heading = section
          .replace(/_and_/g, ' & ')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`^## .*${escapedHeading}`, 'mi');
        if (pattern.test(guardrailContent)) {
          pass(`Guardrail section found: ${section} -> "${heading}"`);
        } else {
          fail(`Guardrail section missing: ${section} (expected heading matching "${heading}")`);
        }
      }
    }
  }
}

if (!process.exitCode) {
  console.log('Manifest validation complete: all references verified.');
}
