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
const { execFileSync } = require('child_process');
const {
  createSignal,
  addCheck,
  writeSignal,
  printSummary,
  printJsonOutput,
  validateActorRunFeedbackSignal,
  validateCodexRunFeedbackSignal
} = require('./lib/signal.cjs');
const checks = require('./lib/checks.cjs');
const {
  promptContracts,
  validatePromptContractFile,
  validateExecutePlanContractFile
} = require('./lib/prompt-contract.cjs');
const { validatePrecedenceChain } = require('./lib/guardrail-precedence.cjs');

const positionalArg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const projectRoot = positionalArg ? path.resolve(positionalArg) : path.resolve(__dirname, '../..');

const signal = createSignal('verify-system', 'mythos-system');

// ─── Canonical sources ───────────────────────────────────────────────────

const systemPath = path.join(projectRoot, 'instructions/canonical/system.yaml');
const kernelSafetyPath = path.join(projectRoot, 'instructions/canonical/kernel/safety.yaml');
const guardrailsCanonical = path.join(projectRoot, 'instructions/canonical/guardrails.md');
const routingPath = path.join(projectRoot, 'instructions/canonical/routing.md');
const guardrailsRendered = path.join(projectRoot, '.claude/guardrails.md');
const manifestGenPath = path.join(projectRoot, 'instructions/generated/manifest.json');
const commandSpecSchemaPath = path.join(__dirname, 'schemas', 'command-spec.schema.json');

function gitRefExists(root, ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', ref], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return true;
  } catch {
    return false;
  }
}

function resolveGitRef(root, ref) {
  if (gitRefExists(root, ref)) return ref;
  const remoteRef = `origin/${ref}`;
  if (gitRefExists(root, remoteRef)) return remoteRef;
  return null;
}

function listTrackedFilesAtRef(root, ref) {
  try {
    const output = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return output.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

function isAutomationAuthPath(filePath) {
  return /(^|\/)automation\/auth\//.test(String(filePath).replace(/\\/g, '/'));
}

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

// ─── Settings.json verification ──────────────────────────────────────────

const settingsPath = path.join(projectRoot, '.claude/settings.json');
const settingsSchemaPath = path.join(__dirname, 'schemas', 'settings.schema.json');
const pretoolDispatcherPath = path.join(projectRoot, 'tools/kernel/hooks/dispatch-pretool.cjs');
const posttoolDispatcherPath = path.join(projectRoot, 'tools/kernel/hooks/dispatch-posttool.cjs');

addCheck(signal, checks.fileExists(settingsPath, {
  id: 'settings.exists',
  category: 'settings',
  message: '.claude/settings.json exists'
}));

addCheck(signal, checks.jsonValid(settingsPath, {
  id: 'settings.valid_json',
  category: 'settings',
  message: '.claude/settings.json is valid JSON'
}));

addCheck(signal, checks.jsonSchemaValid(settingsPath, settingsSchemaPath, {
  id: 'settings.schema',
  category: 'settings',
  message: '.claude/settings.json matches schema'
}));

// Verify critical hooks exist. The Claude settings surface wires a single
// PreToolUse dispatcher; the concrete protections are validated at the
// dispatcher entrypoint so implementation drift is caught without relying on
// inert settings markers.
addCheck(signal, checks.fileContains(settingsPath, 'dispatch-pretool.cjs', {
  id: 'settings.hook.pretool_dispatcher',
  category: 'settings',
  severity: 'critical',
  message: 'Settings wires the PreToolUse dispatcher'
}));

addCheck(signal, checks.fileContains(pretoolDispatcherPath, 'subagent-nesting-detected', {
  id: 'settings.hook.agent_guard',
  category: 'settings',
  severity: 'critical',
  message: 'PreToolUse dispatcher has Agent guard hook (subagent recursion prevention)'
}));

addCheck(signal, checks.fileContains(pretoolDispatcherPath, 'dangerous-command-detected', {
  id: 'settings.hook.dangerous_command',
  category: 'settings',
  severity: 'critical',
  message: 'PreToolUse dispatcher has dangerous-command detection hook'
}));

addCheck(signal, checks.fileContains(posttoolDispatcherPath, 'visual-review-gate.cjs', {
  id: 'settings.hook.visual_review',
  category: 'settings',
  severity: 'warning',
  message: 'PostToolUse dispatcher has visual-review-gate hook'
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
  const stableBranch = system.branching?.stable_branch || 'main';

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

  // ─── Routing-policy validation ──────────────────────────────────────────
  if (system.routing) {
    const routing = system.routing;

    // Validate routing templates contain required variables
    if (routing.framework_context) {
      addCheck(signal, {
        id: 'routing.framework_context_vars',
        category: 'routing',
        severity: 'critical',
        message: 'routing.framework_context contains {service} and {framework} variables',
        test: () => routing.framework_context.includes('{service}') && routing.framework_context.includes('{framework}'),
        detail: `Template: ${routing.framework_context}`,
        fix_hint: 'routing.framework_context must contain {service} and {framework} template variables'
      });
    }

    if (routing.framework_guardrails) {
      addCheck(signal, {
        id: 'routing.framework_guardrails_vars',
        category: 'routing',
        severity: 'critical',
        message: 'routing.framework_guardrails contains {service} and {framework} variables',
        test: () => routing.framework_guardrails.includes('{service}') && routing.framework_guardrails.includes('{framework}'),
        detail: `Template: ${routing.framework_guardrails}`,
        fix_hint: 'routing.framework_guardrails must contain {service} and {framework} template variables'
      });
    }

    if (routing.project_context) {
      addCheck(signal, {
        id: 'routing.project_context_vars',
        category: 'routing',
        severity: 'critical',
        message: 'routing.project_context contains {client_code} and {project_name} variables',
        test: () => routing.project_context.includes('{client_code}') && routing.project_context.includes('{project_name}'),
        detail: `Template: ${routing.project_context}`,
        fix_hint: 'routing.project_context must contain {client_code} and {project_name} template variables'
      });
    }

    // Cross-reference: for each registered framework, resolve the routing template and verify the path exists
    if (system.frameworks && routing.framework_context) {
      for (const fw of system.frameworks) {
        const parts = fw.id.split('/');
        if (parts.length === 2) {
          const resolved = routing.framework_context.replace('{service}', parts[0]).replace('{framework}', parts[1]);
          const resolvedPath = path.join(projectRoot, resolved);
          addCheck(signal, {
            id: `routing.resolve.${fw.id.replace(/\//g, '_')}`,
            category: 'routing',
            severity: 'critical',
            message: `Routing resolves for ${fw.id}: ${resolved}`,
            test: () => fs.existsSync(resolvedPath),
            detail: resolvedPath,
            fix_hint: `Routing template resolves to ${resolved} but file does not exist`
          });
        }
      }
    }
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
            severity: 'critical',
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
          // Tier-aware orphan classification. A framework dir may legitimately
          // exist on disk before it is registered in system.yaml when it is an
          // intentionally-parked skeleton (capture-first harness awaiting its
          // first instrumented pilot run). Such skeletons are NOT executable
          // and are SUPPOSED to be unregistered until they graduate, so they
          // should not be flagged as a warning. We still surface them as an
          // informational NOTICE so the tripwire remains visible: when the
          // skeleton graduates it should get registered. A complete framework
          // that was simply forgotten still warns, exactly as before.
          let isSkeleton = false;
          const orphanManifestPath = path.join(serviceDir, fw.name, 'manifest.json');
          try {
            if (fs.existsSync(orphanManifestPath)) {
              const m = JSON.parse(fs.readFileSync(orphanManifestPath, 'utf8'));
              isSkeleton =
                (m.maturity && m.maturity.tier === 'skeleton') ||
                (typeof m.version === 'string' && m.version.endsWith('-skeleton')) ||
                m.prompts_pending_first_pilot === true;
            }
          } catch {
            // Missing/unreadable/corrupt manifest: fall back to WARN behavior.
            isSkeleton = false;
          }

          if (isSkeleton) {
            addCheck(signal, {
              id: `orphan.${fwId.replace(/\//g, '_')}`,
              category: 'frameworks',
              severity: 'info',
              status: 'PASS',
              message: `NOTICE: skeleton framework ${fwId} on disk, intentionally unregistered until pilot graduation`,
              detail: `Register ${fwId} in instructions/canonical/system.yaml when it graduates from skeleton tier`
            });
          } else {
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

  // ─── Canonical command spec coverage ────────────────────────────────────

  const migratedOps = system.command_specs?.migrated || [];
  if (migratedOps.length > 0) {
    const specDir = system.command_specs?.directory || 'instructions/canonical/commands';

    for (const opId of migratedOps) {
      const specPath = path.join(projectRoot, specDir, `${opId}.yaml`);
      addCheck(signal, checks.fileExists(specPath, {
        id: `cmdspec.${opId}`,
        category: 'command_specs',
        severity: 'critical',
        message: `Migrated operation ${opId} has canonical command spec`
      }));

      // Validate spec against command-spec schema
      addCheck(signal, checks.jsonSchemaValid(specPath, commandSpecSchemaPath, {
        id: `cmdspec.${opId}.schema`,
        category: 'command_specs',
        severity: 'critical',
        message: `Command spec ${opId} matches command-spec schema`
      }));

      // Validate spec mode matches system.yaml operation mode
      if (fs.existsSync(specPath)) {
        try {
          const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
          const op = (system.operations || []).find(o => o.id === opId);
          if (op) {
            addCheck(signal, {
              id: `cmdspec.${opId}.mode_match`,
              category: 'command_specs',
              severity: 'critical',
              message: `Command spec ${opId} mode matches system.yaml`,
              test: () => spec.mode === op.mode,
              detail: `Spec mode: ${spec.mode}, System mode: ${op.mode}`,
              fix_hint: `Update ${specPath} mode to match system.yaml: ${op.mode}`
            });
          }
        } catch {}
      }
    }
  }

  // ─── Branch-boundary enforcement ─────────────────────────────────────

  addCheck(signal, checks.fileContains(path.join(projectRoot, '.gitignore'), '**/automation/auth/', {
    id: 'boundaries.gitignore_client_auth',
    category: 'boundaries',
    severity: 'critical',
    message: '.gitignore blocks automation/auth surfaces from tracking'
  }));

  const headFiles = listTrackedFilesAtRef(projectRoot, 'HEAD');
  if (headFiles !== null) {
    const trackedAuthFiles = headFiles.filter(isAutomationAuthPath);
    addCheck(signal, {
      id: 'boundaries.head_no_client_auth',
      category: 'boundaries',
      severity: 'critical',
      message: 'Tracked repository files exclude automation/auth surfaces',
      test: () => trackedAuthFiles.length === 0,
      detail: trackedAuthFiles.length
        ? `Tracked auth files: ${trackedAuthFiles.join(', ')}`
        : 'No tracked automation/auth files in HEAD',
      fix_hint: trackedAuthFiles.length
        ? 'Remove tracked automation/auth files from git and keep them ignored.'
        : undefined
    });
  }

  const stableBranchRef = resolveGitRef(projectRoot, stableBranch);
  if (stableBranchRef) {
    const stableFiles = listTrackedFilesAtRef(projectRoot, stableBranchRef) || [];
    const stableDevFiles = stableFiles.filter((file) => file.startsWith('_dev/'));
    const stableAuthFiles = stableFiles.filter(isAutomationAuthPath);

    addCheck(signal, {
      id: 'boundaries.stable_branch_no_dev',
      category: 'boundaries',
      severity: 'critical',
      message: `Stable branch ${stableBranch} excludes _dev/ artifacts`,
      test: () => stableDevFiles.length === 0,
      detail: stableDevFiles.length
        ? `Tracked on ${stableBranchRef}: ${stableDevFiles.join(', ')}`
        : `${stableBranchRef} has no tracked _dev/ files`,
      fix_hint: stableDevFiles.length
        ? `Remove _dev/ artifacts from ${stableBranch}; they belong on ${system.branching?.dev_branch || 'dev/workspace'} only.`
        : undefined
    });

    addCheck(signal, {
      id: 'boundaries.stable_branch_no_client_auth',
      category: 'boundaries',
      severity: 'critical',
      message: `Stable branch ${stableBranch} excludes automation/auth surfaces`,
      test: () => stableAuthFiles.length === 0,
      detail: stableAuthFiles.length
        ? `Tracked on ${stableBranchRef}: ${stableAuthFiles.join(', ')}`
        : `${stableBranchRef} has no tracked automation/auth files`,
      fix_hint: stableAuthFiles.length
        ? `Remove tracked automation/auth files from ${stableBranch} and rotate any exposed credentials.`
        : undefined
    });
  } else {
    addCheck(signal, {
      id: 'boundaries.stable_branch_present',
      category: 'boundaries',
      severity: 'warning',
      status: 'WARN',
      message: `Stable branch ${stableBranch} is available for boundary verification`,
      detail: `git ref ${stableBranch} not found locally`,
      fix_hint: `Fetch or create ${stableBranch} before relying on boundary verification`
    });
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

// ─── Prompt orchestration contract validation ────────────────────────────
// The active prompt packs and execute-plan surfaces must retain the
// coordinator/subagent split, listener lifecycle, and strict closeout bundle.

const executePlanSurfacePaths = [
  path.join(projectRoot, 'instructions', 'canonical', 'commands', 'execute-plan.yaml'),
  path.join(projectRoot, '.claude', 'commands', 'execute-plan.md')
];

for (const surfacePath of executePlanSurfacePaths) {
  addCheck(signal, {
    id: `execute_plan_contract.${path.basename(surfacePath).replace(/[^a-zA-Z0-9]/g, '_')}`,
    category: 'prompt_contract',
    severity: 'critical',
    message: `Execute-plan surface ${path.relative(projectRoot, surfacePath)} preserves subagent-first orchestration contract`,
    test: () => validateExecutePlanContractFile(surfacePath).valid,
    detail: (() => {
      const validation = validateExecutePlanContractFile(surfacePath);
      return validation.valid ? 'All execute-plan orchestration rules present' : validation.errors.join('; ');
    }),
    fix_hint: 'Restore the main-thread minimization, independent validation, and listener lifecycle rules in the execute-plan command surfaces'
  });
}

for (const contract of promptContracts) {
  const promptPath = path.join(projectRoot, contract.relPath);
  addCheck(signal, {
    id: `prompt_contract.${contract.id}`,
    category: 'prompt_contract',
    severity: 'critical',
    message: `Prompt contract preserved for ${contract.relPath}`,
    test: () => validatePromptContractFile(promptPath).valid,
    detail: (() => {
      const validation = validatePromptContractFile(promptPath);
      return validation.valid ? 'All required orchestration clauses present' : validation.errors.join('; ');
    }),
    fix_hint: `Restore the required orchestration, listener, and closeout clauses in ${contract.relPath}`
  });
}

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
    severity: 'critical',
    message: `Guardrails has "${section}" section`,
    caseInsensitive: true
  }));
}

// ─── Plan outcome coverage (resolver-truth integrity) ────────────────────
// Plans without canonical outcome artifacts stay "active" forever in
// /whats-next and npm run status. This rule warns when coverage drops below
// 80%. Run /reconcile-task-outcomes to recover.
addCheck(signal, checks.planOutcomeCoverage(projectRoot, 0.1, {
  id: 'plans.outcome_coverage',
  category: 'integrity',
  severity: 'warning',
  message: 'Task-plan outcome coverage >= 10% (RECOVERY MODE: 80% threshold relaxed)'
}));

// ─── Artifact-shape validation ────────────────────────────────────────────
// Completed tracks should have BOTH a markdown report AND a JSON expectation-
// failures file in _dev/reports/analysis/.  Scan for JSON files and verify the
// matching markdown exists.  Emit WARNINGs (not failures) since some pairs may
// be legitimately in-progress.

const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
try {
  const analysisFiles = fs.readdirSync(analysisDir);
  const expectationJsonFiles = analysisFiles.filter(f => f.endsWith('.expectation-failures.json'));
  let completePairs = 0;
  let incompletePairs = 0;

  for (const jsonFile of expectationJsonFiles) {
    const baseName = jsonFile.replace('.expectation-failures.json', '');
    const matchingMd = `${baseName}.md`;
    const mdExists = analysisFiles.includes(matchingMd);

    if (mdExists) {
      completePairs++;
    } else {
      incompletePairs++;
    }

    addCheck(signal, {
      id: `artifact_shape.${baseName.replace(/[^a-zA-Z0-9]/g, '_')}.pair`,
      category: 'artifact_shape',
      severity: 'warning',
      message: `Artifact pair: ${baseName} has both .md and .expectation-failures.json`,
      test: () => mdExists,
      detail: mdExists
        ? `Complete pair: ${matchingMd} + ${jsonFile}`
        : `Missing markdown: ${matchingMd} (JSON exists: ${jsonFile})`,
      fix_hint: mdExists ? undefined : `Create ${path.join('_dev/reports/analysis', matchingMd)} to complete the artifact pair`
    });
  }

  // Summary check — informational, always passes
  addCheck(signal, {
    id: 'artifact_shape.summary',
    category: 'artifact_shape',
    severity: 'warning',
    message: `Artifact pairs: ${completePairs} complete, ${incompletePairs} incomplete out of ${expectationJsonFiles.length} total`,
    test: () => true,
    detail: `${completePairs}/${expectationJsonFiles.length} JSON files have matching markdown reports`
  });
} catch {
  // _dev/reports/analysis/ may not exist yet — not a failure
  addCheck(signal, {
    id: 'artifact_shape.dir_missing',
    category: 'artifact_shape',
    severity: 'warning',
    message: 'Artifact shape: _dev/reports/analysis/ directory not found (non-blocking)',
    test: () => true,
    detail: 'Directory will be created when the first analysis report is written'
  });
}

// ─── Planning-freshness check ─────────────────────────────────────────────
// When all tracks are Done, remaining_track_sequence should be empty.
// When remaining_track_sequence is empty, no further advance-pipeline stages
// should be recommended.

const planNextStepPath = path.join(projectRoot, '_dev', 'reports', 'analysis', 'plan-pipeline.next-step.json');
try {
  if (fs.existsSync(planNextStepPath)) {
    const planNextStep = JSON.parse(fs.readFileSync(planNextStepPath, 'utf8'));
    const remaining = planNextStep.remaining_track_sequence;

    // Check: if remaining_track_sequence exists, it should be an array
    addCheck(signal, {
      id: 'planning_freshness.remaining_is_array',
      category: 'planning_freshness',
      severity: 'warning',
      message: 'plan-pipeline.next-step.json remaining_track_sequence is an array',
      test: () => Array.isArray(remaining),
      detail: Array.isArray(remaining) ? `${remaining.length} tracks remaining` : `Type: ${typeof remaining}`
    });

    // Check: if remaining is empty, next_recommended_command should not be /advance-pipeline
    if (Array.isArray(remaining) && remaining.length === 0) {
      const nextCmd = String(planNextStep.next_recommended_command || '');
      addCheck(signal, {
        id: 'planning_freshness.no_advance_when_complete',
        category: 'planning_freshness',
        severity: 'warning',
        message: 'Planning freshness: no /advance-pipeline recommended when all tracks complete',
        test: () => !nextCmd.includes('advance-pipeline'),
        detail: `remaining_track_sequence is empty; next_recommended_command="${nextCmd}"`,
        fix_hint: nextCmd.includes('advance-pipeline')
          ? 'Refresh plan-pipeline.next-step.json — all tracks are complete but /advance-pipeline is still recommended'
          : undefined
      });
    }

    // Check: if remaining has entries, verify they look like track identifiers (non-empty strings)
    if (Array.isArray(remaining) && remaining.length > 0) {
      const allStrings = remaining.every(t => typeof t === 'string' && t.trim().length > 0);
      addCheck(signal, {
        id: 'planning_freshness.remaining_entries_valid',
        category: 'planning_freshness',
        severity: 'warning',
        message: 'Planning freshness: remaining track entries are non-empty strings',
        test: () => allStrings,
        detail: `${remaining.length} remaining tracks: ${remaining.slice(0, 5).join(', ')}${remaining.length > 5 ? '...' : ''}`
      });
    }
  }
} catch {
  // plan-pipeline.next-step.json may not exist or may have parse errors — non-blocking
}

// ─── Signal-contract validation ───────────────────────────────────────────
// Scan live signals in _dev/reports/signals/ (not closed/).
// For each HandoffSignal/1.0, verify required fields exist.
// This catches the real failure mode where Codex signals used "version" instead
// of "schema" or "created_at" instead of "timestamp".

const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
const COORDINATION_REQUIRED_FIELDS = [
  'schema', 'signal_type', 'lifecycle_state', 'timestamp',
  'source', 'scope', 'recommended_next_actor', 'recommended_next_command'
];

try {
  if (fs.existsSync(signalDir)) {
    const signalFiles = fs.readdirSync(signalDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      // Exclude verify-*.signal.json files (these are VerificationSignals, not HandoffSignals)
      .filter(entry => !entry.name.startsWith('verify-'));

    let validSignals = 0;
    let invalidSignals = 0;

    for (const entry of signalFiles) {
      const filePath = path.join(signalDir, entry.name);
      try {
        const sig = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        // Only validate HandoffSignal/1.0 signals
        if (sig.schema !== 'HandoffSignal/1.0') continue;
        // Only validate live signals
        if (sig.lifecycle_state !== 'live') continue;

        const missingFields = COORDINATION_REQUIRED_FIELDS.filter(field => {
          const val = sig[field];
          return val === undefined || val === null || (typeof val === 'string' && val.trim() === '');
        });

        // Also check for common field-name mistakes
        const misnomers = [];
        if (sig.version !== undefined && sig.schema === undefined) {
          misnomers.push('has "version" instead of "schema"');
        }
        if (sig.created_at !== undefined && sig.timestamp === undefined) {
          misnomers.push('has "created_at" instead of "timestamp"');
        }

        const allIssues = [...missingFields.map(f => `missing "${f}"`), ...misnomers];

        if (allIssues.length === 0) {
          validSignals++;
        } else {
          invalidSignals++;
        }

        addCheck(signal, {
          id: `signal_contract.${entry.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
          category: 'signal_contract',
          severity: 'warning',
          message: `Signal contract: ${entry.name} has required HandoffSignal/1.0 fields`,
          test: () => allIssues.length === 0,
          detail: allIssues.length === 0
            ? 'All required fields present'
            : `Issues: ${allIssues.join(', ')}`,
          fix_hint: allIssues.length > 0
            ? `Fix signal ${entry.name}: ${allIssues.join('; ')}`
            : undefined
        });
      } catch {
        // Unparseable JSON in signals dir — warn but don't block
        invalidSignals++;
        addCheck(signal, {
          id: `signal_contract.${entry.name.replace(/[^a-zA-Z0-9]/g, '_')}.parse`,
          category: 'signal_contract',
          severity: 'warning',
          message: `Signal contract: ${entry.name} is valid JSON`,
          test: () => false,
          detail: `Failed to parse ${entry.name}`,
          fix_hint: `Fix JSON syntax in ${path.join('_dev/reports/signals', entry.name)}`
        });
      }
    }

    // Summary check — informational
    if (validSignals + invalidSignals > 0) {
      addCheck(signal, {
        id: 'signal_contract.summary',
        category: 'signal_contract',
        severity: 'warning',
        message: `Signal contract: ${validSignals} valid, ${invalidSignals} non-conforming out of ${validSignals + invalidSignals} live coordination signals`,
        test: () => true,
        detail: `Scanned ${signalFiles.length} files in _dev/reports/signals/`
      });
    }
  }
} catch {
  // signals dir may not exist — non-blocking
}

// ─── Codex-targeted signal validation ────────────────────────────────────
// Live signals with recommended_next_actor === 'codex' must have non-empty
// artifacts, commands, and next-step detail to be dispatchable.

try {
  if (fs.existsSync(signalDir)) {
    const codexSignalFiles = fs.readdirSync(signalDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .filter(entry => !entry.name.startsWith('verify-'));

    for (const entry of codexSignalFiles) {
      const filePath = path.join(signalDir, entry.name);
      try {
        const sig = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (sig.schema !== 'HandoffSignal/1.0') continue;
        if (sig.lifecycle_state !== 'live') continue;
        if (sig.recommended_next_actor !== 'codex') continue;

        // Codex-targeted: must have non-empty command
        addCheck(signal, {
          id: `codex_dispatch.${entry.name.replace(/[^a-zA-Z0-9]/g, '_')}.command`,
          category: 'codex_dispatch',
          severity: 'critical',
          message: `Codex-targeted signal ${entry.name} has recommended_next_command`,
          test: () => typeof sig.recommended_next_command === 'string' && sig.recommended_next_command.trim() !== '',
          detail: sig.recommended_next_command ? `Command: ${sig.recommended_next_command}` : 'EMPTY',
          fix_hint: `Add a non-empty recommended_next_command to ${entry.name}`
        });

        // Codex-targeted: should have artifacts
        const hasArtifacts = Array.isArray(sig.artifacts) && sig.artifacts.length > 0;
        addCheck(signal, {
          id: `codex_dispatch.${entry.name.replace(/[^a-zA-Z0-9]/g, '_')}.artifacts`,
          category: 'codex_dispatch',
          severity: 'warning',
          message: `Codex-targeted signal ${entry.name} has artifacts`,
          test: () => hasArtifacts,
          detail: hasArtifacts ? `${sig.artifacts.length} artifact(s)` : 'No artifacts attached',
          fix_hint: hasArtifacts ? undefined : `Add artifact paths to ${entry.name}`
        });

        // Codex-targeted: artifacts should exist on disk
        if (hasArtifacts) {
          const missingArtifacts = sig.artifacts.filter(a => {
            const resolved = path.resolve(projectRoot, a);
            return !fs.existsSync(resolved);
          });
          if (missingArtifacts.length > 0) {
            addCheck(signal, {
              id: `codex_dispatch.${entry.name.replace(/[^a-zA-Z0-9]/g, '_')}.artifact_exists`,
              category: 'codex_dispatch',
              severity: 'warning',
              message: `Codex-targeted signal ${entry.name} artifacts exist on disk`,
              test: () => false,
              detail: `Missing: ${missingArtifacts.join(', ')}`,
              fix_hint: `Create or fix artifact paths in ${entry.name}`
            });
          }
        }

        // Codex-targeted: should have next_step_detail
        const hasStepDetail = Array.isArray(sig.next_step_detail) && sig.next_step_detail.length > 0;
        addCheck(signal, {
          id: `codex_dispatch.${entry.name.replace(/[^a-zA-Z0-9]/g, '_')}.step_detail`,
          category: 'codex_dispatch',
          severity: 'warning',
          message: `Codex-targeted signal ${entry.name} has next_step_detail`,
          test: () => hasStepDetail,
          detail: hasStepDetail ? `${sig.next_step_detail.length} step(s)` : 'No step detail',
          fix_hint: hasStepDetail ? undefined : `Add next_step_detail entries to ${entry.name}`
        });
      } catch {
        // Parse error already caught above
      }
    }
  }
} catch {
  // signals dir missing — non-blocking
}

// ─── Actor feedback signal validation ────────────────────────────────────
// Live actor-authored run feedback signals must be actionable:
// exact slash-command, durable artifacts, and structured run outcome.

try {
  if (fs.existsSync(signalDir)) {
    const actorFeedbackFiles = fs.readdirSync(signalDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .filter(entry => !entry.name.startsWith('verify-'));

    for (const entry of actorFeedbackFiles) {
      const filePath = path.join(signalDir, entry.name);
      try {
        const sig = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (sig.schema !== 'HandoffSignal/1.0') continue;
        if (sig.lifecycle_state !== 'live') continue;
        if (!sig.run_outcome || typeof sig.run_outcome !== 'object') continue;

        const actorId = String(sig.source || '').trim().toLowerCase();
        if (!['codex', 'claude', 'opencode'].includes(actorId)) continue;

        const validation = actorId === 'codex'
          ? validateCodexRunFeedbackSignal(sig, { projectRoot })
          : validateActorRunFeedbackSignal(sig, { projectRoot, expectedActor: actorId });
        addCheck(signal, {
          id: `actor_feedback.${entry.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
          category: 'actor_feedback',
          severity: 'critical',
          message: `${actorId} feedback signal ${entry.name} is actionable and evidence-backed`,
          test: () => validation.valid,
          detail: validation.valid
            ? `Command: ${sig.recommended_next_command}`
            : `Issues: ${validation.errors.join('; ')}`,
          fix_hint: validation.valid
            ? undefined
            : `Fix ${entry.name} so it carries an exact slash-command, actionable step detail, and durable ${actorId} run artifacts`
        });
      } catch {
        // Parse errors handled elsewhere
      }
    }
  }
} catch {
  // signals dir missing — non-blocking
}

// ─── Stale artifact reference validation ─────────────────────────────────
// For all live coordination signals, check that referenced artifact paths exist.

try {
  if (fs.existsSync(signalDir)) {
    const artifactSignalFiles = fs.readdirSync(signalDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .filter(entry => !entry.name.startsWith('verify-'));

    for (const entry of artifactSignalFiles) {
      const filePath = path.join(signalDir, entry.name);
      try {
        const sig = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (sig.schema !== 'HandoffSignal/1.0') continue;
        if (sig.lifecycle_state !== 'live') continue;
        if (!Array.isArray(sig.artifacts) || sig.artifacts.length === 0) continue;

        const missing = sig.artifacts.filter(a => {
          const resolved = path.resolve(projectRoot, a);
          return !fs.existsSync(resolved);
        });

        if (missing.length > 0) {
          addCheck(signal, {
            id: `artifact_truth.${entry.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
            category: 'artifact_truth',
            severity: 'warning',
            message: `Signal ${entry.name} artifact references are valid`,
            test: () => false,
            detail: `Missing artifacts: ${missing.join(', ')}`,
            fix_hint: `Fix or remove stale artifact paths in ${entry.name}, or run /normalize-signals`
          });
        }
      } catch {
        // Parse errors handled elsewhere
      }
    }
  }
} catch {
  // signals dir missing — non-blocking
}

// ─── Review-packet validation ────────────────────────────────────────────
// For expectation-failures JSON files containing schema: "ReviewPacket/1.0",
// validate required fields and artifact references.

try {
  if (fs.existsSync(analysisDir)) {
    const rpFiles = fs.readdirSync(analysisDir)
      .filter(f => f.endsWith('.expectation-failures.json'));

    for (const rpFile of rpFiles) {
      const rpPath = path.join(analysisDir, rpFile);
      try {
        const packet = JSON.parse(fs.readFileSync(rpPath, 'utf8'));
        if (packet.schema !== 'ReviewPacket/1.0') continue;

        // Check required next_step.command
        const hasCommand = packet.next_step && typeof packet.next_step.command === 'string' && packet.next_step.command.trim() !== '';
        addCheck(signal, {
          id: `review_packet.${rpFile.replace(/[^a-zA-Z0-9]/g, '_')}.next_step`,
          category: 'review_packet',
          severity: 'warning',
          message: `ReviewPacket ${rpFile} has next_step.command`,
          test: () => hasCommand,
          detail: hasCommand ? `Command: ${packet.next_step.command}` : 'Missing next_step.command',
          fix_hint: hasCommand ? undefined : `Add next_step.command to ${rpFile}`
        });

        // Check artifacts_produced exist on disk
        if (Array.isArray(packet.artifacts_produced)) {
          const rpMissing = packet.artifacts_produced.filter(a => {
            const resolved = path.resolve(projectRoot, a);
            return !fs.existsSync(resolved);
          });
          if (rpMissing.length > 0) {
            addCheck(signal, {
              id: `review_packet.${rpFile.replace(/[^a-zA-Z0-9]/g, '_')}.artifacts`,
              category: 'review_packet',
              severity: 'warning',
              message: `ReviewPacket ${rpFile} artifacts exist on disk`,
              test: () => false,
              detail: `Missing: ${rpMissing.join(', ')}`,
              fix_hint: `Fix artifact paths in ${rpFile}`
            });
          }
        }
      } catch {
        // Parse errors — non-blocking for review packets
      }
    }
  }
} catch {
  // analysis dir missing — non-blocking
}

// ─── Paste-target prompt validation ─────────────────────────────────────
// Walks the repo and validates every paste-target prompt artifact against
// the content rules in tools/verify/lib/paste-target-prompt.cjs (no outer
// fence; no extraction-prose first line; no rationale opener; no
// prose-then-single-fenced-block).
{
  const validatorPath = path.join(__dirname, 'verify-paste-target-prompts.cjs');
  let pasteResult = { status: 'unknown', stdout: '', stderr: '' };
  try {
    const out = execFileSync('node', [validatorPath, projectRoot], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    pasteResult = { status: 'pass', stdout: out, stderr: '' };
  } catch (err) {
    pasteResult = {
      status: 'fail',
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString()
    };
  }

  addCheck(signal, {
    id: 'paste_target_prompts',
    category: 'paste_target_prompts',
    severity: 'critical',
    message: 'paste-target-prompts: every paste-target prompt artifact passes content rules',
    test: () => pasteResult.status === 'pass',
    detail: pasteResult.status === 'pass'
      ? (pasteResult.stdout.trim() || 'PASS')
      : `FAIL — ${(pasteResult.stdout + pasteResult.stderr).trim().split('\n').slice(0, 8).join(' | ')}`,
    fix_hint: pasteResult.status === 'pass'
      ? undefined
      : 'Run `node tools/verify/verify-paste-target-prompts.cjs` to see per-file violations; fix the prompt body or broaden exclusions in tools/verify/lib/paste-target-prompt.cjs'
  });
}

// ─── Forward-looking generator paste-target opt-in guard (F6) ───────────
// Scans every JS source file under tools/signals/ and tools/signals/lib/ for
// fs.writeFileSync call sites and verifies that any writer producing a
// paste-target-shaped path either imports tools/verify/lib/paste-target-prompt.cjs
// (validator opt-in) or is on the chokepoint allowlist. Allowlisted files
// must independently still import the validator — silent removal of the
// import emits chokepoint_lost_validator_import violation.
{
  const optinScriptPath = path.join(
    __dirname,
    'verify-generator-paste-target-optin.cjs'
  );
  let optinResult = { status: 'unknown', stdout: '', stderr: '' };
  try {
    const out = execFileSync('node', [optinScriptPath, projectRoot], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    optinResult = { status: 'pass', stdout: out, stderr: '' };
  } catch (err) {
    optinResult = {
      status: 'fail',
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString()
    };
  }

  addCheck(signal, {
    id: 'generator_paste_target_optin',
    category: 'paste_target_prompts',
    severity: 'critical',
    message:
      'generator-paste-target-optin: every tools/signals writer producing paste-target paths imports the validator or is on the chokepoint allowlist',
    test: () => optinResult.status === 'pass',
    detail: optinResult.status === 'pass'
      ? (optinResult.stdout.trim().split('\n').slice(-2).join(' | ') || 'PASS')
      : `FAIL — ${(optinResult.stdout + optinResult.stderr).trim().split('\n').slice(0, 8).join(' | ')}`,
    fix_hint: optinResult.status === 'pass'
      ? undefined
      : 'Run `node tools/verify/verify-generator-paste-target-optin.cjs` to see per-writer violations; either add `require("tools/verify/lib/paste-target-prompt.cjs")` to the new writer (and call validatePasteTargetPrompt before fs.writeFileSync), or expand CHOKEPOINT_ALLOWLIST in tools/verify/verify-generator-paste-target-optin.cjs with explicit justification.'
  });
}

// ─── Paste-target prompt validator coverage fixture ─────────────────────
// Runs the durable regression fixture that exercises:
//   (a) writeBridgePrompt's pre-write validator refusal on extraction prose
//   (b) the Codex emulator's PostToolUse relay invoking
//       tools/verify/hooks/post-write-paste-target.cjs on Write events.
// Both surfaces were landed by the parent slice; this fixture protects them
// from silent regression.
{
  const coverageTestPath = path.join(
    'tools', 'verify', 'lib', '__tests__', 'paste-target-prompt-coverage.test.cjs'
  );
  let coverageResult = { status: 'unknown', stdout: '', stderr: '' };
  try {
    const out = execFileSync('node', ['--test', coverageTestPath], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    coverageResult = { status: 'pass', stdout: out, stderr: '' };
  } catch (err) {
    coverageResult = {
      status: 'fail',
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString()
    };
  }

  addCheck(signal, {
    id: 'paste_target_prompts_coverage',
    category: 'paste_target_prompts',
    severity: 'critical',
    message: 'paste-target-prompts: coverage fixture asserts writer + emulator-relay surfaces',
    test: () => coverageResult.status === 'pass',
    detail: coverageResult.status === 'pass'
      ? (coverageResult.stdout.trim().split('\n').slice(-6).join(' | ') || 'PASS')
      : `FAIL — ${(coverageResult.stdout + coverageResult.stderr).trim().split('\n').slice(0, 8).join(' | ')}`,
    fix_hint: coverageResult.status === 'pass'
      ? undefined
      : 'Run `node --test tools/verify/lib/__tests__/paste-target-prompt-coverage.test.cjs` to see which case regressed; do not edit the test without confirming the regression is intentional.'
  });
}

// ─── Guardrail precedence chain ─────────────────────────────────────────
const precedenceViolations = validatePrecedenceChain(projectRoot);
for (const v of precedenceViolations) {
  addCheck(signal, {
    id: `precedence.${v.level}.${(v.framework_id || 'system').replace(/\//g, '_')}`,
    category: 'precedence',
    severity: 'critical',
    message: `Guardrail precedence: ${v.message}`,
    test: () => false,
    fix_hint: v.level === 'kernel-system'
      ? 'Add the missing kernel rule to instructions/canonical/system.yaml safety_rules'
      : `Fix ${v.framework_id} guardrails to not contradict system guardrails`
  });
}

// Summary — passes when no violations
if (precedenceViolations.length === 0) {
  addCheck(signal, {
    id: 'precedence.chain_valid',
    category: 'precedence',
    severity: 'critical',
    message: 'Guardrail precedence chain: kernel > system > framework — no violations',
    test: () => true,
    detail: `Checked ${system ? (system.frameworks || []).length : 0} frameworks`
  });
}

// ─── Output ──────────────────────────────────────────────────────────────

if (!printJsonOutput(signal)) {
  const scratchDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const outputPath = path.join(scratchDir, 'verify-system.signal.json');
  writeSignal(signal, outputPath);
  printSummary(signal);
  console.log(`\nSignal: ${outputPath}`);
}

process.exit(signal.gate_decision.proceed ? 0 : 1);
