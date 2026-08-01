#!/usr/bin/env node
'use strict';

/**
 * generate-harness.js — Stamp out .claude/ harness trees for unharnessed frameworks.
 *
 * Reads manifest.json + guardrails.md + prompt files for each framework and generates:
 *   - .claude/skills/{framework_name}/SKILL.md
 *   - .claude/commands/{framework_name}/*.md (run + status + per-phase commands)
 *   - .claude/agents/{framework_name}/*.md (one agent per prompt)
 *
 * Also updates manifest.json skills/commands/agents arrays.
 *
 * Usage:
 *   node tools/workspace/generate-harness.js [--framework <service/name>] [--all] [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FRAMEWORKS_DIR = path.join(PROJECT_ROOT, 'frameworks');
const SPECS_DIR = path.join(PROJECT_ROOT, 'instructions', 'canonical', 'commands');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeReadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function safeRead(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function kebab(str) {
  return str.replace(/[_\s]+/g, '-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function titleCase(str) {
  return str.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Parse a prompt file header to extract Mode, Objective, Steps overview.
 */
function parsePromptHeader(promptPath) {
  const content = safeRead(promptPath);
  if (!content) return { mode: 'FINDINGS_ONLY', objective: '', title: '' };

  const lines = content.split('\n');
  let title = '';
  let mode = 'FINDINGS_ONLY';
  let objective = '';

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i].trim();
    if (line.startsWith('# ') && !title) {
      title = line.replace(/^#\s*\d*:?\s*/, '').trim();
    }
    if (line === '## Mode' && i + 1 < lines.length) {
      mode = lines[i + 1].trim();
    }
    if (line === '## Objective' && i + 1 < lines.length) {
      objective = lines[i + 1].trim();
    }
  }

  return { title, mode, objective };
}

/**
 * Derive a command name from a prompt filename.
 * 01_INTAKE_AND_SCOPE.md -> intake-and-scope
 * 02_TRACKING_PLAN.md -> tracking-plan
 */
function promptToCommandName(promptFile) {
  return promptFile
    .replace(/^\d+_/, '')
    .replace(/\.md$/i, '')
    .replace(/_/g, '-')
    .toLowerCase();
}

/**
 * Derive a short agent description from the prompt objective.
 */
function deriveAgentDescription(promptHeader) {
  if (promptHeader.objective) return promptHeader.objective;
  if (promptHeader.title) return promptHeader.title;
  return 'Execute this phase of the framework';
}

/**
 * Pick execution mode for a command based on prompt mode string.
 */
function normalizeMode(modeStr) {
  const m = String(modeStr || '').trim().toUpperCase();
  const valid = ['FINDINGS_ONLY', 'RUN_ONLY', 'REVIEW_ONLY', 'PATCH_ALLOWED', 'COORDINATOR', 'REPO_HYGIENE'];
  return valid.includes(m) ? m : 'FINDINGS_ONLY';
}

/**
 * Determine tools for an agent based on execution mode and MCP requirements.
 */
function agentTools(mode, mcpRequirements) {
  const base = ['Read', 'Write', 'Glob', 'Grep'];
  if (['RUN_ONLY', 'PATCH_ALLOWED', 'COORDINATOR'].includes(mode)) {
    base.push('Bash');
  }
  if (mcpRequirements && mcpRequirements.includes('playwright')) {
    base.push('Browser');
  }
  return base;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

function mcpRequirementName(req) {
  if (req == null) return '';
  if (typeof req === 'string') return req;
  if (typeof req === 'object') return req.name || req.server || req.id || '';
  return String(req);
}

function generateSkillMd(manifest, frameworkName, prompts) {
  const desc = manifest.description || `${titleCase(frameworkName)} framework`;
  const modes = (manifest.execution_modes || []).map(m =>
    `  <mode name="${m}">${m.replace(/_/g, ' ').toLowerCase()}</mode>`
  ).join('\n');

  const refs = [
    '  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>'
  ];
  for (const p of prompts) {
    refs.push(`  <ref path="prompts/${p.file}" load="when_requested">${p.header.title || p.commandName}</ref>`);
  }

  const workflows = [];
  // Main "run" workflow
  const runSteps = prompts.map((p, i) =>
    `    <step>Run Prompt ${String(i + 1).padStart(2, '0')}: ${p.header.title || p.commandName}</step>`
  ).join('\n');
  workflows.push(`  <workflow name="run">\n${runSteps}\n  </workflow>`);
  workflows.push(`  <workflow name="status">\n    <step>Check which output artifacts exist</step>\n    <step>Report progress and next step</step>\n  </workflow>`);

  const mcpReqNames = (manifest.mcp_requirements || []).map(mcpRequirementName).filter(Boolean);
  const mcpReq = mcpReqNames.length > 0
    ? `<mcp_requirements>${mcpReqNames.join(', ')}</mcp_requirements>`
    : '';

  const inputDesc = (manifest.input_contract && manifest.input_contract.required || [])
    .map(inp => `- ${inp.name}: ${inp.description}`)
    .join('\n');

  const outputDesc = (manifest.output_contract && manifest.output_contract.artifacts || [])
    .map(a => typeof a === 'string' ? `- ${a}` : `- ${a.name || a.path_pattern}`)
    .join('\n');

  return `---
name: ${frameworkName}
description: >
  ${desc}
---

<skill>
<objective>
${desc}
</objective>
${mcpReq ? mcpReq + '\n' : ''}
<execution_modes>
${modes}
</execution_modes>

<quick_start>
<what_this_skill_does>

${desc}

</what_this_skill_does>

<core_workflow>

${prompts.map((p, i) => `${i + 1}. ${p.header.title || titleCase(p.commandName)}`).join('\n')}

</core_workflow>

<inputs>

${inputDesc || '(See manifest.json for input contract)'}

</inputs>

<outputs>

${outputDesc || '(See manifest.json for output contract)'}

</outputs>
</quick_start>

<references>
${refs.join('\n')}
</references>

<workflows>
${workflows.join('\n')}
</workflows>

<success_criteria>
  <criterion>All prompt chain phases executed in order</criterion>
  <criterion>Output artifacts match output contract in manifest.json</criterion>
  <criterion>Guardrails.md constraints respected throughout execution</criterion>
  <criterion>No approximations — exact data and provenance required</criterion>
</success_criteria>
</skill>
`;
}

function generateRunCommandMd(manifest, frameworkName, prompts, spec) {
  const args = (manifest.input_contract && manifest.input_contract.required || []).map(inp =>
    `  - name: ${inp.name}\n    description: ${inp.description}\n    required: true`
  ).join('\n');

  const optArgs = (manifest.input_contract && manifest.input_contract.optional || []).map(inp =>
    `  - name: ${inp.name}\n    description: ${inp.description}\n    required: false`
  ).join('\n');

  const allArgs = [args, optArgs].filter(Boolean).join('\n');

  const finalSteps = [];
  let stepIdx = 1;
  for (const s of (spec.process || [])) {
    if (s.includes('Iterate through the `prompt_chain`')) {
      for (let pi = 0; pi < prompts.length; pi++) {
        const p = prompts[pi];
        finalSteps.push(`${stepIdx++}. Run Prompt ${String(pi + 1).padStart(2, '0')}: ${p.header.title || titleCase(p.commandName)}`);
      }
    } else {
      finalSteps.push(`${stepIdx++}. ${s}`);
    }
  }

  return `---
name: run
description: ${spec.description || `Run the full ${titleCase(frameworkName)} pipeline`}
skill: ${frameworkName}
mode: ${spec.mode || (manifest.execution_modes && manifest.execution_modes.includes('PATCH_ALLOWED') ? 'PATCH_ALLOWED' : manifest.execution_modes && manifest.execution_modes[0] || 'FINDINGS_ONLY')}
${allArgs ? 'arguments:\n' + allArgs : ''}
---

${spec.objective || `Run the full ${titleCase(frameworkName)} pipeline.`}

${finalSteps.join('\n')}

Follow \`guardrails.md\` for all execution constraints.
`;
}

function generateStatusCommandMd(frameworkName, spec) {
  const steps = (spec.process || []).map((s, i) => `${i + 1}. ${s}`).join('\n');

  return `---
name: status
description: ${spec.description || `Check ${titleCase(frameworkName)} progress and remaining steps`}
skill: ${frameworkName}
mode: ${spec.mode || 'REVIEW_ONLY'}
---

${spec.objective || `Check which output artifacts exist and report progress.`}

${steps}
`;
}

function generatePhaseCommandMd(prompt, frameworkName, spec) {
  const mode = normalizeMode(prompt.header.mode);
  const steps = (spec.process || []).map((s, i) => {
    if (s.includes('Read the phase-specific prompt')) return `${i + 1}. Read \`prompts/${prompt.file}\` for detailed procedure`;
    return `${i + 1}. ${s}`;
  }).join('\n');

  return `---
name: ${prompt.commandName}
description: "${prompt.header.title || titleCase(prompt.commandName)}"
skill: ${frameworkName}
mode: ${mode}
---

${spec.objective || `Execute the ${prompt.header.title || titleCase(prompt.commandName)} phase.`}

${steps}
`;
}

function generateAgentMd(prompt, frameworkName, mcpRequirements) {
  const mode = normalizeMode(prompt.header.mode);
  const tools = agentTools(mode, mcpRequirements);
  const desc = deriveAgentDescription(prompt.header);

  return `---
name: ${prompt.commandName}-agent
description: "${desc}"
model: sonnet
mode: ${mode}
tools:
${tools.map(t => '  - ' + t).join('\n')}
---

# ${titleCase(prompt.commandName)} Agent

${desc}

## Before starting

1. Read \`guardrails.md\` for safety rules
2. Read \`prompts/${prompt.file}\` for detailed procedure

## Workflow

${prompt.header.objective ? prompt.header.objective : `Execute the ${prompt.header.title || titleCase(prompt.commandName)} phase following the prompt procedure exactly.`}

## Rules

- Follow execution mode: ${mode}
- Every output must cite its source data
- Follow all constraints in guardrails.md
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function generateHarness(frameworkId, specs, opts) {
  const [service, name] = frameworkId.split('/');
  const frameworkDir = path.join(FRAMEWORKS_DIR, service, name);
  const manifestPath = path.join(frameworkDir, 'manifest.json');
  const manifest = safeReadJson(manifestPath);

  if (!manifest) {
    console.error(`  ERROR: Could not load manifest.json for ${frameworkId}`);
    return false;
  }

  const frameworkName = manifest.framework_name || name;

  // Check if harness already exists
  const claudeDir = path.join(frameworkDir, '.claude');
  const skillPath = path.join(claudeDir, 'skills', frameworkName, 'SKILL.md');
  if (fs.existsSync(skillPath) && !opts.refresh) {
    console.log(`  SKIP: ${frameworkId} already has a harness (use --refresh to update)`);
    return true;
  }

  // Collect prompts
  const promptsDir = path.join(frameworkDir, 'prompts');
  const promptFiles = fs.existsSync(promptsDir)
    ? fs.readdirSync(promptsDir)
        .filter(f => f.endsWith('.md'))
        .sort()
    : [];

  if (promptFiles.length === 0) {
    console.error(`  ERROR: No prompt files found for ${frameworkId}`);
    return false;
  }

  const prompts = promptFiles.map(file => {
    const header = parsePromptHeader(path.join(promptsDir, file));
    const commandName = promptToCommandName(file);
    return { file, header, commandName };
  });

  const mcpReqs = (manifest.mcp_requirements || []).map(mcpRequirementName).filter(Boolean);

  // Generate all files
  const files = {};

  // 1. SKILL.md
  const skillDir = path.join(claudeDir, 'skills', frameworkName);
  files[path.join(skillDir, 'SKILL.md')] = generateSkillMd(manifest, frameworkName, prompts);

  // 2. Commands
  const cmdDir = path.join(claudeDir, 'commands', frameworkName);
  files[path.join(cmdDir, 'run.md')] = generateRunCommandMd(manifest, frameworkName, prompts, specs.run);
  files[path.join(cmdDir, 'status.md')] = generateStatusCommandMd(frameworkName, specs.status);

  for (const p of prompts) {
    // Skip generating duplicate if name would conflict with run/status
    if (p.commandName === 'run' || p.commandName === 'status') continue;
    files[path.join(cmdDir, `${p.commandName}.md`)] = generatePhaseCommandMd(p, frameworkName, specs.phase);
  }

  // 3. Agents
  const agentDir = path.join(claudeDir, 'agents', frameworkName);
  for (const p of prompts) {
    files[path.join(agentDir, `${p.commandName}-agent.md`)] = generateAgentMd(p, frameworkName, mcpReqs);
  }

  if (opts.dryRun) {
    console.log(`  DRY RUN: ${frameworkId} — would create/refresh ${Object.keys(files).length} files:`);
    for (const f of Object.keys(files)) {
      console.log(`    ${path.relative(PROJECT_ROOT, f)}`);
    }
    return true;
  }

  // Write files
  for (const [filePath, content] of Object.entries(files)) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf8');
  }

  // Update manifest.json arrays
  const skillEntries = [`${frameworkName}/SKILL.md`];
  const commandEntries = Object.keys(files)
    .filter(f => f.includes('/commands/'))
    .map(f => path.basename(f, '.md'));
  const agentEntries = Object.keys(files)
    .filter(f => f.includes('/agents/'))
    .map(f => path.basename(f, '.md'));

  manifest.skills = skillEntries;
  manifest.commands = commandEntries;
  manifest.agents = agentEntries;

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`  OK: ${frameworkId} — ${opts.refresh ? 'refreshed' : 'created'} ${Object.keys(files).length} files, updated manifest`);
  return true;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const all = args.includes('--all');
  const refresh = args.includes('--refresh');
  const fwIdx = args.indexOf('--framework');
  const framework = fwIdx >= 0 ? args[fwIdx + 1] : null;

  if (!all && !framework) {
    console.log(`Usage:
  node tools/workspace/generate-harness.js --all [--dry-run] [--refresh]
  node tools/workspace/generate-harness.js --framework <service/name> [--dry-run] [--refresh]`);
    process.exit(0);
  }

  // Load specs
  const specs = {
    run: safeReadJson(path.join(SPECS_DIR, 'framework-run.yaml')),
    status: safeReadJson(path.join(SPECS_DIR, 'framework-status.yaml')),
    phase: safeReadJson(path.join(SPECS_DIR, 'framework-phase.yaml'))
  };

  if (!specs.run || !specs.status || !specs.phase) {
    console.error('ERROR: Could not load base framework specs from instructions/canonical/commands/');
    process.exit(1);
  }

  // Load system.yaml for framework list
  const systemPath = path.join(PROJECT_ROOT, 'instructions', 'canonical', 'system.yaml');
  const system = safeReadJson(systemPath);
  if (!system) {
    console.error('ERROR: Could not load system.yaml');
    process.exit(1);
  }

  const targets = all
    ? system.frameworks.map(fw => fw.id)
    : [framework];

  console.log(`Generating/refreshing harness trees${dryRun ? ' (DRY RUN)' : ''}...\n`);

  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (const fwId of targets) {
    console.log(`${fwId}:`);
    const [service, name] = fwId.split('/');
    const manifest = safeReadJson(path.join(FRAMEWORKS_DIR, service, name, 'manifest.json'));
    const fwName = manifest ? (manifest.framework_name || name) : name;
    const claudeDir = path.join(FRAMEWORKS_DIR, service, name, '.claude');
    const skillPath = path.join(claudeDir, 'skills', fwName, 'SKILL.md');
    const alreadyHarnessed = fs.existsSync(skillPath);

    const result = generateHarness(fwId, specs, { dryRun, refresh });
    if (result) {
      if (alreadyHarnessed && !refresh && !dryRun) {
        skipped++;
      } else {
        generated++;
      }
    } else {
      errors++;
    }
  }

  console.log(`\nDone. Generated/Refreshed: ${generated}, Skipped: ${skipped}, Errors: ${errors}`);
}

main();
