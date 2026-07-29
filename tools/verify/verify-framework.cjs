#!/usr/bin/env node
/**
 * verify-framework.cjs — Validate a single Mythos framework's structure.
 *
 * Usage: node tools/verify/verify-framework.cjs <framework-id>
 *   e.g.: node tools/verify/verify-framework.cjs wordpress/qa
 *
 * Validates: manifest.json, guardrails.md, prompts/, skills, commands, agents,
 *            prompt count consistency, execution mode validity, cross-references.
 *
 * Exit code 0 = PASS/WARN, 1 = FAIL
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createSignal, addCheck, addNextAction, writeSignal, printSummary, printJsonOutput } = require('./lib/signal.cjs');
const checks = require('./lib/checks.cjs');

const projectRoot = path.resolve(__dirname, '../..');
const VALID_MODES = Object.freeze(['FINDINGS_ONLY', 'RUN_ONLY', 'REVIEW_ONLY', 'PATCH_ALLOWED', 'COORDINATOR', 'REPO_HYGIENE']);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value || '')).digest('hex')}`;
}

function normalizeMcpRequirements(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    if (typeof value === 'string') {
      return { schema: 'McpRequirement/1.0', name: value, required: true, degraded_allowed: false, source_shape: 'legacy_string' };
    }
    if (!value || typeof value !== 'object') throw new Error('MCP requirement must be a string or object');
    if (value.schema === 'McpRequirement/1.0') {
      if (value.required === true && value.degraded_allowed === true) throw new Error('Required MCP capability cannot allow degraded execution');
      const allowed = new Set(['schema', 'name', 'required', 'degraded_allowed', 'purpose']);
      if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('Typed MCP requirement contains undeclared fields');
      return { schema: value.schema, name: String(value.name || ''), required: value.required === true, degraded_allowed: value.degraded_allowed === true, purpose: String(value.purpose || ''), source_shape: 'typed' };
    }
    return { schema: 'McpRequirement/1.0', name: String(value.name || ''), required: true, degraded_allowed: false, purpose: String(value.purpose || ''), source_shape: 'legacy_object' };
  });
}

function evaluatePromptAuthority(descriptor, canonicalModes) {
  const modes = Array.isArray(canonicalModes) ? canonicalModes : [];
  const errors = [];
  if (!descriptor || descriptor.schema !== 'PromptAuthority/1.0') errors.push('descriptor_invalid');
  const allowed = new Set(['schema', 'prompt_id', 'mode', 'effects']);
  if (descriptor && Object.keys(descriptor).some((key) => !allowed.has(key))) errors.push('undeclared_field');
  const mode = descriptor && descriptor.mode;
  if (!VALID_MODES.includes(mode)) errors.push('mode_invalid');
  if (!modes.includes(mode)) errors.push('authority_expansion');
  const effects = descriptor && descriptor.effects || {};
  const effectKeys = new Set(['read', 'write', 'execute', 'dispatch', 'write_scope']);
  if (Object.keys(effects).some((key) => !effectKeys.has(key))) errors.push('undeclared_effect');
  if (['FINDINGS_ONLY', 'REVIEW_ONLY'].includes(mode) && (effects.write || effects.execute || effects.dispatch)) errors.push('read_only_mode_effect_denied');
  if (mode === 'RUN_ONLY' && effects.write && effects.write_scope !== 'reports_only') errors.push('run_only_write_scope_invalid');
  return { state: errors.length ? 'invalid' : 'ready', errors, mode: mode || null };
}

function buildMcpPreflightReceipt(requirements, capabilityFacts = []) {
  const normalized = normalizeMcpRequirements(requirements);
  const facts = new Map((Array.isArray(capabilityFacts) ? capabilityFacts : []).map((fact) => [String(fact && fact.name || ''), fact || {}]));
  const checksOut = normalized.map((requirement) => {
    const fact = facts.get(requirement.name) || {};
    const ready = fact.available === true && fact.authorized === true && fact.scope_bounded === true;
    return {
      name: requirement.name,
      required: requirement.required,
      degraded_allowed: requirement.degraded_allowed,
      available: fact.available === true,
      authorized: fact.authorized === true,
      scope_bounded: fact.scope_bounded === true,
      state: ready ? 'ready' : (!requirement.required && requirement.degraded_allowed ? 'degraded' : 'preflight_blocked')
    };
  });
  const state = checksOut.some((check) => check.state === 'preflight_blocked')
    ? 'preflight_blocked'
    : checksOut.some((check) => check.state === 'degraded') ? 'degraded' : 'ready';
  return {
    schema: 'McpPreflightReceipt/1.0',
    requirement_sha256: sha256(stableJson(normalized)),
    state,
    checks: checksOut,
    redaction: 'capability facts only; no configuration or environment values recorded'
  };
}

function safeFrameworkContractReport(manifest, capabilityFacts = []) {
  try {
    return {
      schema: 'FrameworkContractReport/1.0',
      state: 'reported',
      prompt_authority: (Array.isArray(manifest && manifest.prompt_authority) ? manifest.prompt_authority : [])
        .map((descriptor) => evaluatePromptAuthority(descriptor, manifest.execution_modes)),
      mcp_preflight: buildMcpPreflightReceipt(manifest && manifest.mcp_requirements, capabilityFacts),
      legacy_behavior_changed: false
    };
  } catch (error) {
    return { schema: 'FrameworkContractReport/1.0', state: 'report_error', reason: String(error && error.message || 'unknown').replace(/[^a-z0-9 _.-]/gi, ''), legacy_behavior_changed: false };
  }
}

function main(argv = process.argv) {

// Parse CLI: positional <framework-id> and optional --profile <id>, --json
let frameworkId = null;
let profileFlag = null;
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--profile' && argv[i + 1]) {
    profileFlag = argv[++i];
  } else if (argv[i] === '--json') {
    // handled by printJsonOutput via process.argv
  } else if (!argv[i].startsWith('--')) {
    frameworkId = argv[i];
  }
}

if (!frameworkId) {
  console.error('Usage: node tools/verify/verify-framework.cjs <service/framework> [--profile <id>]');
  console.error('  e.g.: node tools/verify/verify-framework.cjs wordpress/qa');
  process.exit(2);
}

const signalOpts = profileFlag ? { profileId: profileFlag, attempt: 1 } : {};

const frameworkDir = path.join(projectRoot, 'frameworks', frameworkId);
const manifestPath = path.join(frameworkDir, 'manifest.json');
const guardrailsPath = path.join(frameworkDir, 'guardrails.md');
const promptsDir = path.join(frameworkDir, 'prompts');
const manifestSchemaPath = path.join(projectRoot, 'tools', 'verify', 'schemas', 'framework-manifest.schema.json');

const signal = createSignal('verify-framework', `framework:${frameworkId}`, 'mechanical', signalOpts);

// ─── Structure checks ────────────────────────────────────────────────────

addCheck(signal, checks.dirExists(frameworkDir, {
  id: 'framework.dir',
  message: `Framework directory exists: frameworks/${frameworkId}`
}));

addCheck(signal, checks.fileExists(manifestPath, {
  id: 'manifest.exists',
  message: 'manifest.json exists'
}));

addCheck(signal, checks.jsonValid(manifestPath, {
  id: 'manifest.valid_json',
  message: 'manifest.json is valid JSON'
}));

addCheck(signal, checks.fileExists(manifestSchemaPath, {
  id: 'manifest.schema_exists',
  category: 'schema',
  message: 'framework-manifest.schema.json exists'
}));

addCheck(signal, checks.jsonSchemaValid(manifestPath, manifestSchemaPath, {
  id: 'manifest.schema_valid',
  category: 'schema',
  message: 'manifest.json matches shared framework manifest schema'
}));

addCheck(signal, checks.fileExists(guardrailsPath, {
  id: 'guardrails.exists',
  message: 'guardrails.md exists'
}));

addCheck(signal, checks.dirExists(promptsDir, {
  id: 'prompts.dir',
  message: 'prompts/ directory exists'
}));

// ─── Manifest content checks ─────────────────────────────────────────────

const manifestKeys = ['service_category', 'framework_name', 'version', 'prompt_count', 'execution_modes'];
addCheck(signal, checks.jsonHasKeys(manifestPath, manifestKeys, {
  id: 'manifest.required_keys',
  category: 'manifest',
  message: `manifest.json has required keys: ${manifestKeys.join(', ')}`
}));

// Load manifest for deeper checks
let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch { /* handled by jsonValid check */ }

if (manifest) {
  if (process.env.FRAMEWORK_CONTRACT_V1 !== '0') {
    signal.framework_contract_report = safeFrameworkContractReport(manifest, []);
    if (frameworkId === 'meta/execution-normalization') {
      const chainPromptIds = Object.values(manifest.prompt_chain || {}).flat();
      const authorityPromptIds = Array.isArray(manifest.prompt_authority)
        ? manifest.prompt_authority.map((descriptor) => descriptor.prompt_id)
        : [];
      const authorityReady = signal.framework_contract_report.state === 'reported'
        && signal.framework_contract_report.prompt_authority.length === chainPromptIds.length
        && signal.framework_contract_report.prompt_authority.every((result) => result.state === 'ready')
        && chainPromptIds.every((promptId) => authorityPromptIds.includes(promptId))
        && signal.framework_contract_report.mcp_preflight.state === 'ready';
      addCheck(signal, {
        id: 'framework_contract.execution_normalization_pilot',
        category: 'framework_contract',
        severity: 'critical',
        message: 'Execution-normalization pilot has complete restrictive prompt authority and ready MCP preflight',
        test: () => authorityReady,
        detail: authorityReady
          ? 'All executable prompt-chain entries are restricted by ready typed authority descriptors'
          : 'Typed prompt authority is incomplete, invalid, expands authority, or MCP preflight is blocked',
        fix_hint: authorityReady ? undefined : 'Repair the typed pilot contract or set FRAMEWORK_CONTRACT_V1=0 to use the legacy verifier'
      });
    }
  }
  // Prompt count consistency
  let promptFiles = [];
  try {
    promptFiles = fs.readdirSync(promptsDir).filter(f => /^\d{2}[A-Z]?_.*\.md$/.test(f));
  } catch { /* handled by dirExists */ }

  addCheck(signal, checks.countMatches(promptFiles.length, manifest.prompt_count, 'prompt_count', {
    id: 'manifest.prompt_count',
    category: 'consistency',
    message: `prompt_count (${manifest.prompt_count}) matches actual prompt files (${promptFiles.length})`
  }));

  // Prompt chain resolution — every ID must resolve to a file in prompts/
  if (manifest.prompt_chain && typeof manifest.prompt_chain === 'object') {
    for (const [phase, ids] of Object.entries(manifest.prompt_chain)) {
      if (!Array.isArray(ids)) continue;
      for (const promptId of ids) {
        const candidates = promptFiles.map(f => f.replace(/\.md$/, ''));
        const resolved = candidates.includes(promptId);
        addCheck(signal, {
          id: `prompt_chain.${phase}.${promptId}`,
          category: 'prompt_chain',
          severity: 'critical',
          message: `prompt_chain.${phase}: "${promptId}" resolves to a prompt file`,
          test: () => resolved,
          detail: resolved ? `Resolved: prompts/${promptId}.md` : `No file matching prompts/${promptId}.md`,
          fix_hint: resolved ? undefined : `Create prompts/${promptId}.md or remove "${promptId}" from prompt_chain.${phase}`
        });
      }
    }
  }

  // Execution modes validity
  const validModes = ['FINDINGS_ONLY', 'RUN_ONLY', 'REVIEW_ONLY', 'PATCH_ALLOWED', 'COORDINATOR', 'REPO_HYGIENE'];
  if (manifest.execution_modes) {
    const invalidModes = manifest.execution_modes.filter(m => !validModes.includes(m));
    addCheck(signal, {
      id: 'manifest.valid_modes',
      category: 'manifest',
      severity: 'critical',
      message: `All execution_modes are valid`,
      test: () => invalidModes.length === 0,
      detail: invalidModes.length ? `Invalid: ${invalidModes.join(', ')}` : 'All valid',
      fix_hint: invalidModes.length ? `Remove invalid modes: ${invalidModes.join(', ')}` : undefined
    });
  }

  // Skills/commands/agents paths
  if (manifest.skills_path) {
    addCheck(signal, checks.dirExists(path.join(frameworkDir, manifest.skills_path), {
      id: 'manifest.skills_path',
      category: 'manifest',
      severity: 'warning',
      message: `skills_path exists: ${manifest.skills_path}`
    }));
  }
  if (manifest.commands_path) {
    addCheck(signal, checks.dirExists(path.join(frameworkDir, manifest.commands_path), {
      id: 'manifest.commands_path',
      category: 'manifest',
      severity: 'warning',
      message: `commands_path exists: ${manifest.commands_path}`
    }));
  }
  if (manifest.agents_path) {
    addCheck(signal, checks.dirExists(path.join(frameworkDir, manifest.agents_path), {
      id: 'manifest.agents_path',
      category: 'manifest',
      severity: 'warning',
      message: `agents_path exists: ${manifest.agents_path}`
    }));
  }

  if (manifest.harness_paths && typeof manifest.harness_paths === 'object') {
    for (const [harnessId, harnessPaths] of Object.entries(manifest.harness_paths)) {
      if (!harnessPaths || typeof harnessPaths !== 'object') continue;

      if (harnessPaths.skills) {
        addCheck(signal, checks.dirExists(path.join(frameworkDir, harnessPaths.skills), {
          id: `manifest.harness_paths.${harnessId}.skills`,
          category: 'manifest',
          severity: 'warning',
          message: `harness_paths.${harnessId}.skills exists: ${harnessPaths.skills}`
        }));
      }

      if (harnessPaths.commands) {
        addCheck(signal, checks.dirExists(path.join(frameworkDir, harnessPaths.commands), {
          id: `manifest.harness_paths.${harnessId}.commands`,
          category: 'manifest',
          severity: 'warning',
          message: `harness_paths.${harnessId}.commands exists: ${harnessPaths.commands}`
        }));
      }

      if (harnessPaths.agents) {
        addCheck(signal, checks.dirExists(path.join(frameworkDir, harnessPaths.agents), {
          id: `manifest.harness_paths.${harnessId}.agents`,
          category: 'manifest',
          severity: 'warning',
          message: `harness_paths.${harnessId}.agents exists: ${harnessPaths.agents}`
        }));
      }
    }
  }
}

// ─── Prompt naming convention ─────────────────────────────────────────────

try {
  const allPromptFiles = fs.readdirSync(promptsDir).filter(f => f.endsWith('.md') && f !== 'README.md');
  for (const file of allPromptFiles) {
    addCheck(signal, {
      id: `prompt.naming.${file}`,
      category: 'prompts',
      severity: 'warning',
      message: `Prompt follows NN_NAME.md convention: ${file}`,
      test: () => /^\d{2}[A-Z]?_/.test(file),
      fix_hint: `Rename ${file} to follow NN[x]_NAME.md pattern (e.g., 01_INTAKE.md or 05A_SUBSTAGE.md)`
    });
  }
} catch { /* promptsDir doesn't exist — already caught */ }

// ─── Skills checks ───────────────────────────────────────────────────────

const skillFiles = [];
function findSkills(dir) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) findSkills(full);
      else if (entry.name === 'SKILL.md' && !dir.includes('_template')) skillFiles.push(full);
    }
  } catch {}
}
findSkills(path.join(frameworkDir, '.claude', 'skills'));

for (const skillPath of skillFiles) {
  const rel = path.relative(frameworkDir, skillPath);
  const skillName = path.basename(path.dirname(skillPath));

  addCheck(signal, checks.yamlHasFrontmatter(skillPath, ['name', 'description'], {
    id: `skill.${skillName}.frontmatter`,
    category: 'skills',
    message: `Skill ${skillName} has frontmatter with name, description`
  }));

  addCheck(signal, checks.xmlHasTag(skillPath, 'objective', {
    id: `skill.${skillName}.objective`,
    category: 'skills',
    message: `Skill ${skillName} has <objective> tag`
  }));

  addCheck(signal, checks.xmlHasTag(skillPath, 'success_criteria', {
    id: `skill.${skillName}.success_criteria`,
    category: 'skills',
    message: `Skill ${skillName} has <success_criteria> tag`
  }));
}

// ─── Command checks ──────────────────────────────────────────────────────

const commandFiles = [];
function findCommands(dir) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) findCommands(full);
      else if (entry.name.endsWith('.md')) commandFiles.push(full);
    }
  } catch {}
}
findCommands(path.join(frameworkDir, '.claude', 'commands'));

for (const cmdPath of commandFiles) {
  const cmdName = path.basename(cmdPath, '.md');

  addCheck(signal, checks.yamlHasFrontmatter(cmdPath, ['description'], {
    id: `cmd.${cmdName}.frontmatter`,
    category: 'commands',
    message: `Command ${cmdName} has frontmatter with description`
  }));
}

// ─── Agent checks ────────────────────────────────────────────────────────

const agentFiles = [];
function findAgents(dir) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) findAgents(full);
      else if (entry.name.endsWith('.md')) agentFiles.push(full);
    }
  } catch {}
}
findAgents(path.join(frameworkDir, '.claude', 'agents'));

for (const agentPath of agentFiles) {
  const agentName = path.basename(agentPath, '.md');

  addCheck(signal, checks.yamlHasFrontmatter(agentPath, ['name', 'description'], {
    id: `agent.${agentName}.frontmatter`,
    category: 'agents',
    message: `Agent ${agentName} has frontmatter with name, description`
  }));
}

// ─── Guardrails content checks ───────────────────────────────────────────

addCheck(signal, checks.fileContains(guardrailsPath, 'execution mode', {
  id: 'guardrails.execution_modes',
  category: 'guardrails',
  severity: 'warning',
  message: 'Guardrails has execution modes section',
  caseInsensitive: true
}));

addCheck(signal, checks.fileContains(guardrailsPath, 'observational', {
  id: 'guardrails.observational',
  category: 'guardrails',
  severity: 'warning',
  message: 'Guardrails mentions observational reporting',
  caseInsensitive: true
}));

// ─── Advisory next_actions (v1.1, when profile active) ──────────────────

if (signal.next_actions) {
  for (const check of signal.checks) {
    if (check.status !== 'FAIL') continue;

    if (check.id === 'manifest.prompt_count') {
      addNextAction(signal, {
        type: 'patch_file',
        target: `frameworks/${frameworkId}/manifest.json`,
        reason: 'Update prompt_count to match actual prompt file count',
        safe: true
      });
    } else if (check.id === 'manifest.skills_path' || check.id === 'manifest.commands_path' || check.id === 'manifest.agents_path') {
      addNextAction(signal, {
        type: 'run_command',
        command: `mkdir -p ${check.evidence || ''}`,
        reason: `Create missing directory: ${check.id.replace('manifest.', '')}`,
        safe: true
      });
    } else if (check.id === 'guardrails.execution_modes' || check.id === 'guardrails.observational') {
      addNextAction(signal, {
        type: 'escalate_to_llm',
        reason: `Guardrails content requires semantic authoring (${check.id})`,
        safe: false
      });
    } else if (check.id === 'manifest.valid_modes') {
      addNextAction(signal, {
        type: 'escalate_to_llm',
        reason: 'Execution mode selection requires semantic judgment',
        safe: false
      });
    }
  }
}

// ─── Output ──────────────────────────────────────────────────────────────

if (!printJsonOutput(signal)) {
  const scratchDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const outputPath = path.join(scratchDir, `verify-framework__${frameworkId.replace(/\//g, '_')}.signal.json`);
  writeSignal(signal, outputPath);
  printSummary(signal);
  console.log(`\nSignal: ${outputPath}`);
}

process.exit(signal.gate_decision.proceed ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  buildMcpPreflightReceipt,
  evaluatePromptAuthority,
  main,
  normalizeMcpRequirements,
  safeFrameworkContractReport,
  stableJson
};
