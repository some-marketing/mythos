#!/usr/bin/env node
/**
 * verify-system.cjs — Validate Mythos system integrity.
 *
 * Usage: node tools/verify/verify-system.cjs [project-root]
 *
 * Validates: system.yaml cross-refs, framework registration, agent/command presence,
 *            guardrails sections, generated file existence, orphaned frameworks.
 *
 * Exit code 0 = PASS/WARN, 1 = FAIL
 */

const fs = require('fs');
const path = require('path');
const { createSignal, addCheck, writeSignal, printSummary } = require('./lib/signal.cjs');
const checks = require('./lib/checks.cjs');

const projectRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../..');

const signal = createSignal('verify-system', 'mythos-system');

// ─── Canonical sources ───────────────────────────────────────────────────

const systemPath = path.join(projectRoot, 'instructions/canonical/system.yaml');
const kernelSafetyPath = path.join(projectRoot, 'instructions/canonical/kernel/safety.yaml');
const guardrailsCanonical = path.join(projectRoot, 'instructions/canonical/guardrails.md');
const routingPath = path.join(projectRoot, 'instructions/canonical/routing.md');
const guardrailsRendered = path.join(projectRoot, '.claude/guardrails.md');
const manifestGenPath = path.join(projectRoot, 'instructions/generated/manifest.json');

addCheck(signal, checks.fileExists(systemPath, {
  id: 'canonical.system_yaml',
  category: 'canonical',
  message: 'instructions/canonical/system.yaml exists'
}));

addCheck(signal, checks.jsonValid(systemPath, {
  id: 'canonical.system_yaml_valid',
  category: 'canonical',
  message: 'system.yaml is valid JSON'
}));

addCheck(signal, checks.fileExists(kernelSafetyPath, {
  id: 'canonical.kernel_safety',
  category: 'canonical',
  message: 'instructions/canonical/kernel/safety.yaml exists'
}));

addCheck(signal, checks.jsonValid(kernelSafetyPath, {
  id: 'canonical.kernel_safety_valid',
  category: 'canonical',
  message: 'kernel/safety.yaml is valid JSON'
}));

addCheck(signal, checks.fileExists(guardrailsCanonical, {
  id: 'canonical.guardrails',
  category: 'canonical',
  message: 'instructions/canonical/guardrails.md exists'
}));

addCheck(signal, checks.fileExists(routingPath, {
  id: 'canonical.routing',
  category: 'canonical',
  severity: 'warning',
  message: 'instructions/canonical/routing.md exists'
}));

// ─── Load system config ──────────────────────────────────────────────────

let system = null;
try {
  system = JSON.parse(fs.readFileSync(systemPath, 'utf8'));
} catch { /* handled by jsonValid check */ }

let kernelSafety = null;
try {
  kernelSafety = JSON.parse(fs.readFileSync(kernelSafetyPath, 'utf8'));
} catch { /* handled by jsonValid check */ }

if (system) {
  if (kernelSafety) {
    addCheck(signal, {
      id: 'canonical.kernel_immutable',
      category: 'canonical',
      severity: 'critical',
      message: 'kernel safety declares immutable=true',
      test: () => kernelSafety.immutable === true,
      detail: `immutable=${String(kernelSafety.immutable)}`,
      fix_hint: 'Set instructions/canonical/kernel/safety.yaml immutable to true'
    });

    const kernelRules = Array.isArray(kernelSafety.safety_rules) ? kernelSafety.safety_rules : [];
    const systemRules = Array.isArray(system.safety_rules) ? system.safety_rules : [];
    const missingRules = kernelRules.filter((rule) => !systemRules.includes(rule));

    addCheck(signal, {
      id: 'canonical.kernel_rule_subset',
      category: 'canonical',
      severity: 'critical',
      message: 'system safety_rules include all kernel safety rules',
      test: () => missingRules.length === 0,
      detail: missingRules.length ? `Missing from system.yaml: ${missingRules.join(', ')}` : 'All kernel rules preserved',
      fix_hint: missingRules.length
        ? `Add missing kernel rules to instructions/canonical/system.yaml: ${missingRules.join(', ')}`
        : undefined
    });
  }

  // ─── Framework registration ──────────────────────────────────────────

  const registeredIds = new Set();

  if (system.frameworks) {
    for (const fw of system.frameworks) {
      registeredIds.add(fw.id);

      // Manifest exists
      const manifestPath = path.join(projectRoot, fw.manifest);
      addCheck(signal, checks.fileExists(manifestPath, {
        id: `fw.${fw.id}.manifest`,
        category: 'frameworks',
        message: `Framework ${fw.id}: manifest exists`
      }));

      // Guardrails exists
      const grPath = path.join(projectRoot, fw.guardrails);
      addCheck(signal, checks.fileExists(grPath, {
        id: `fw.${fw.id}.guardrails`,
        category: 'frameworks',
        message: `Framework ${fw.id}: guardrails exists`
      }));

      // Mode subset check
      if (fs.existsSync(manifestPath)) {
        try {
          const fwManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          const systemModes = (system.execution_modes || []).map(m => m.id);
          const fwModes = fwManifest.execution_modes || [];
          const invalid = fwModes.filter(m => !systemModes.includes(m));

          addCheck(signal, {
            id: `fw.${fw.id}.mode_subset`,
            category: 'modes',
            severity: 'warning',
            message: `Framework ${fw.id}: execution_modes are valid system modes`,
            test: () => invalid.length === 0,
            detail: invalid.length ? `Invalid modes: ${invalid.join(', ')}` : 'All modes valid',
            fix_hint: invalid.length ? `Remove modes not in system.yaml: ${invalid.join(', ')}` : undefined
          });
        } catch {}
      }
    }
  }

  // ─── Orphaned frameworks ───────────────────────────────────────────────

  const frameworksDir = path.join(projectRoot, 'frameworks');
  try {
    for (const service of fs.readdirSync(frameworksDir, { withFileTypes: true })) {
      if (!service.isDirectory() || service.name.startsWith('_')) continue;
      const serviceDir = path.join(frameworksDir, service.name);
      for (const fw of fs.readdirSync(serviceDir, { withFileTypes: true })) {
        if (!fw.isDirectory()) continue;
        const fwId = `${service.name}/${fw.name}`;
        if (!registeredIds.has(fwId)) {
          addCheck(signal, {
            id: `orphan.${fwId.replace(/\//g, '_')}`,
            category: 'frameworks',
            severity: 'warning',
            status: 'WARN',
            message: `Orphaned framework: ${fwId} exists on disk but not in system.yaml`,
            fix_hint: `Register ${fwId} in instructions/canonical/system.yaml or remove the directory`
          });
        }
      }
    }
  } catch {}

  // ─── System agents ─────────────────────────────────────────────────────

  if (system.agents) {
    for (const agent of system.agents) {
      const agentPath = path.join(projectRoot, '.claude/agents', `${agent.id}.md`);
      addCheck(signal, checks.fileExists(agentPath, {
        id: `agent.${agent.id}`,
        category: 'agents',
        message: `System agent exists: ${agent.id}.md`
      }));
    }
  }

  // ─── System operations → commands ──────────────────────────────────────

  if (system.operations) {
    for (const op of system.operations) {
      const cmdPath = path.join(projectRoot, '.claude/commands', `${op.id}.md`);
      addCheck(signal, checks.fileExists(cmdPath, {
        id: `cmd.${op.id}`,
        category: 'commands',
        severity: 'warning',
        message: `Operation ${op.id} has command file`
      }));
    }
  }
}

// ─── Generated files ─────────────────────────────────────────────────────

addCheck(signal, checks.fileExists(manifestGenPath, {
  id: 'generated.manifest',
  category: 'generated',
  severity: 'warning',
  message: 'instructions/generated/manifest.json exists'
}));

try {
  const genManifest = JSON.parse(fs.readFileSync(manifestGenPath, 'utf8'));
  if (genManifest.files) {
    for (const file of genManifest.files) {
      const filePath = path.join(projectRoot, file.path);
      addCheck(signal, checks.fileExists(filePath, {
        id: `generated.${file.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        category: 'generated',
        severity: 'warning',
        message: `Generated file exists: ${file.path}`
      }));
    }
  }
} catch {}

// ─── Guardrails sections ─────────────────────────────────────────────────

const guardrailSections = [
  'forbidden labels',
  'required labels',
  'evidence standards',
  'file modification rules',
  'data safety',
  'mode checklists'
];

for (const section of guardrailSections) {
  addCheck(signal, checks.fileContains(guardrailsRendered, section, {
    id: `guardrails.section.${section.replace(/\s+/g, '_')}`,
    category: 'guardrails',
    severity: 'warning',
    message: `Guardrails has "${section}" section`,
    caseInsensitive: true
  }));
}

// ─── Output ──────────────────────────────────────────────────────────────

const scratchDir = path.join(projectRoot, '_dev', 'reports', 'signals');
const outputPath = path.join(scratchDir, 'verify-system.signal.json');
writeSignal(signal, outputPath);
printSummary(signal);
console.log(`\nSignal: ${outputPath}`);

process.exit(signal.gate_decision.proceed ? 0 : 1);
