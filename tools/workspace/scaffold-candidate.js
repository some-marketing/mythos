#!/usr/bin/env node
'use strict';

const path = require('path');
const { parseArgs } = require('./lib/args');
const { ensureDir, exists, readJson, readText, writeJson, writeText, copyPath } = require('./lib/fs');
const { inspectCapture } = require('./lib/capture-candidate');
const {
  die,
  loadProject,
  readJsonl,
  relPosix,
  requireProjectRoot,
  slugify,
  timestampId,
  writeMarkdownTemplate
} = require('./lib/workspace');
const { initLedger } = require('./lib/learning-ledger');

function help() {
  console.log(`
Scaffold a framework candidate from one or more normalized captures.

Usage:
  node tools/workspace/scaffold-candidate.js --project <project-root> --captures <id,id,...> --service <service> --name <framework-name>
`.trim());
}

function resolveCaptureRoots(projectRoot, capturesArg) {
  const capturesRoot = path.join(projectRoot, 'captures');
  return String(capturesArg)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (path.isAbsolute(item) ? item : path.join(capturesRoot, item)));
}

function normalizeAction(action) {
  return String(action || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function summarizeCaptures(captures) {
  const actionStats = new Map();
  const variableHints = new Set();
  const branchHints = new Set();

  for (const capture of captures) {
    const seenInCapture = new Set();
    for (const step of capture.steps) {
      const key = normalizeAction(step.action);
      if (!key) continue;
      if (!actionStats.has(key)) {
        actionStats.set(key, { action: String(step.action).trim(), count: 0, notes: new Set() });
      }
      if (!seenInCapture.has(key)) {
        actionStats.get(key).count += 1;
        seenInCapture.add(key);
      }
      if (step.notes) actionStats.get(key).notes.add(String(step.notes).trim());
    }
    for (const decision of capture.decisions) {
      if (decision.decision) branchHints.add(String(decision.decision).trim());
      if (decision.reason) variableHints.add(String(decision.reason).trim());
    }
  }

  const stableActions = [];
  const conditionalActions = [];
  for (const stat of actionStats.values()) {
    const row = {
      action: stat.action,
      seen_in_captures: stat.count,
      notes: Array.from(stat.notes).filter(Boolean).slice(0, 3)
    };
    if (stat.count === captures.length) stableActions.push(row);
    else conditionalActions.push(row);
  }

  return {
    stableActions,
    conditionalActions,
    variableHints: Array.from(variableHints).slice(0, 8),
    branchHints: Array.from(branchHints).slice(0, 8)
  };
}

function promptTitle(name) {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function makePromptBody(title, mode, objective, steps, outputs) {
  return [
    `# ${title}`,
    '',
    '## Objective',
    objective,
    '',
    '## Mode',
    mode,
    '',
    '## Inputs',
    '- Project intake files',
    '- Candidate evidence summaries',
    '',
    '## Steps',
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Outputs',
    ...outputs.map((output) => `- ${output}`),
    '',
    '## Success Criteria',
    '- Produce deterministic artifacts that can be reviewed against the source captures',
    '- Avoid client-specific references in reusable framework files',
    '',
    '## Guardrails',
    '- Follow the candidate guardrails',
    '- Pause if hidden operator judgment is still required'
  ].join('\n') + '\n';
}

function createProposedFramework(candidateRoot, service, frameworkName, summary, captures) {
  const proposedRoot = path.join(candidateRoot, 'proposed_framework');
  ensureDir(proposedRoot);
  ensureDir(path.join(proposedRoot, 'prompts'));
  ensureDir(path.join(proposedRoot, 'schemas'));
  ensureDir(path.join(proposedRoot, 'schemas', 'output'));
  ensureDir(path.join(proposedRoot, 'templates'));
  ensureDir(path.join(proposedRoot, 'docs'));
  ensureDir(path.join(proposedRoot, '.claude', 'skills', frameworkName));
  ensureDir(path.join(proposedRoot, '.claude', 'commands', frameworkName));
  ensureDir(path.join(proposedRoot, '.claude', 'agents', frameworkName));

  const promptCount = summary.conditionalActions.length || summary.branchHints.length ? 4 : 3;
  const promptChain = {
    intake: ['01_INTAKE_FROM_CAPTURE'],
    execution: ['02_EXECUTE_STABLE_WORKFLOW'],
    review: ['03_REVIEW_AND_COMPARE']
  };
  if (promptCount === 4) {
    promptChain.iteration = ['04_HANDLE_BRANCHES_AND_RECOVERY'];
  }

  writeJson(path.join(proposedRoot, 'manifest.json'), {
    service_category: service,
    framework_name: frameworkName,
    version: '0.1.0',
    description: `Scaffolded from ${captures.length} normalized capture bundle(s)`,
    prompt_count: promptCount,
    input_contract: {
      required: [
        { name: 'intake.json', description: 'Normalized task inputs for a new execution' },
        { name: 'context.md', description: 'Non-secret context for the task run' }
      ],
      optional: [
        { name: 'reference_artifacts/', description: 'Optional supporting artifacts referenced during execution' }
      ]
    },
    output_contract: {
      directories: ['outputs/', 'reports/'],
      artifacts: ['execution summary', 'review notes']
    },
    output_contract_v2: {
      directories: [],
      artifacts: [],
      bundle_types: []
    },
    execution_modes: promptCount === 4 ? ['RUN_ONLY', 'REVIEW_ONLY', 'COORDINATOR'] : ['RUN_ONLY', 'REVIEW_ONLY'],
    mcp_requirements: [],
    prompt_chain: promptChain,
    harness_paths: {
      claude: {
        skills: `.claude/skills/${frameworkName}/`,
        commands: `.claude/commands/${frameworkName}/`,
        agents: `.claude/agents/${frameworkName}/`
      }
    },
    skills_path: `.claude/skills/${frameworkName}/`,
    commands_path: `.claude/commands/${frameworkName}/`,
    agents_path: `.claude/agents/${frameworkName}/`
  });

  writeMarkdownTemplate(path.join(proposedRoot, 'guardrails.md'), [
    `# ${promptTitle(frameworkName)} Guardrails`,
    '',
    '## Core Rules',
    '- Keep outputs project-scoped and non-destructive by default.',
    '- Do not copy client-specific identifiers into framework assets.',
    '- Escalate for human review if the task still depends on undocumented judgment.',
    '',
    '## Execution Modes',
    '- `RUN_ONLY` for deterministic execution steps.',
    '- `REVIEW_ONLY` for comparison and quality checks.',
    ...(promptCount === 4 ? ['- `COORDINATOR` when branch handling or recovery steps are required.'] : [])
  ]);

  writeText(
    path.join(proposedRoot, 'prompts', '01_INTAKE_FROM_CAPTURE.md'),
    makePromptBody(
      '01 Intake From Capture',
      'RUN_ONLY',
      'Collect the normalized task inputs and prepare a deterministic execution plan.',
      [
        'Read `intake.json`, `context.md`, and any project reference artifacts.',
        'Confirm the requested outcome aligns with the framework scope.',
        'Record any missing inputs before continuing.'
      ],
      ['Execution-ready input summary', 'Input gap report if anything is missing']
    )
  );

  writeText(
    path.join(proposedRoot, 'prompts', '02_EXECUTE_STABLE_WORKFLOW.md'),
    makePromptBody(
      '02 Execute Stable Workflow',
      'RUN_ONLY',
      'Run the stable workflow steps extracted from the successful captures.',
      [
        ...(summary.stableActions.length
          ? summary.stableActions.map((item) => `Execute the stable step: ${item.action}.`)
          : ['Execute the core workflow steps captured in the source evidence.']),
        'Write outputs into the project outputs directory.',
        'Record deviations from the known stable path.'
      ],
      ['Primary task outputs', 'Execution log']
    )
  );

  writeText(
    path.join(proposedRoot, 'prompts', '03_REVIEW_AND_COMPARE.md'),
    makePromptBody(
      '03 Review And Compare',
      'REVIEW_ONLY',
      'Compare the produced outputs to the source capture evidence and success criteria.',
      [
        'Review produced outputs against the normalized success criteria.',
        'Call out missing steps, vague instructions, or new dependencies.',
        'Summarize whether the workflow remains candidate-ready.'
      ],
      ['Review report', 'Improvement recommendations']
    )
  );

  if (promptCount === 4) {
    writeText(
      path.join(proposedRoot, 'prompts', '04_HANDLE_BRANCHES_AND_RECOVERY.md'),
      makePromptBody(
        '04 Handle Branches And Recovery',
        'COORDINATOR',
        'Handle conditional branches and recovery patterns found in the source captures.',
        [
          ...(summary.conditionalActions.length
            ? summary.conditionalActions.map((item) => `If needed, handle the conditional step: ${item.action}.`)
            : ['Handle any non-stable branch that appears during execution.']),
          'Document recovery behavior rather than improvising silently.',
          'Escalate unresolved manual judgment to a human gate.'
        ],
        ['Branch handling notes', 'Recovery summary']
      )
    );
  }

  writeMarkdownTemplate(path.join(proposedRoot, 'schemas', 'output', 'README.md'), [
    '# Output Schemas',
    '',
    'Place JSON Schema files here to validate framework runtime outputs.',
    '',
    'These schemas are referenced from `output_contract_v2.file_schemas` in the framework manifest.',
    'Each schema validates a specific artifact produced during framework execution.'
  ]);

  writeJson(path.join(proposedRoot, 'schemas', 'intake.schema.json'), {
    type: 'object',
    required: ['task_goal', 'context'],
    properties: {
      task_goal: { type: 'string' },
      context: { type: 'string' },
      reference_artifacts: { type: 'array' }
    }
  });

  writeJson(path.join(proposedRoot, 'schemas', 'review.schema.json'), {
    type: 'object',
    required: ['result', 'notes'],
    properties: {
      result: { type: 'string', enum: ['pass', 'fail', 'partial'] },
      notes: { type: 'array' }
    }
  });

  writeMarkdownTemplate(path.join(proposedRoot, 'docs', 'SCAFFOLD_SUMMARY.md'), [
    '# Scaffold Summary',
    '',
    `Source captures: ${captures.length}`,
    '',
    '## Stable Steps',
    ...(summary.stableActions.length ? summary.stableActions.map((item) => `- ${item.action}`) : ['- none detected']),
    '',
    '## Conditional Steps',
    ...(summary.conditionalActions.length ? summary.conditionalActions.map((item) => `- ${item.action}`) : ['- none detected']),
    '',
    '## Variable Hints',
    ...(summary.variableHints.length ? summary.variableHints.map((item) => `- ${item}`) : ['- none detected']),
    '',
    '## Branch Hints',
    ...(summary.branchHints.length ? summary.branchHints.map((item) => `- ${item}`) : ['- none detected'])
  ]);

  writeMarkdownTemplate(path.join(proposedRoot, 'templates', 'WORKFLOW_GUIDE.template.md'), [
    `# ${promptTitle(frameworkName)} Workflow Guide`,
    '',
    '## Recommended Flow',
    '1. Complete `intake.json` and `context.md`.',
    '2. Run the intake prompt.',
    '3. Run the stable workflow prompt.',
    '4. Run the review prompt.',
    ...(promptCount === 4 ? ['5. Use the branch/recovery prompt when the stable workflow diverges.'] : []),
    '',
    '## Notes',
    '- This framework was scaffolded from normalized capture evidence.',
    '- Re-run candidate replay after any prompt or schema changes.'
  ]);

  writeMarkdownTemplate(path.join(proposedRoot, '.claude', 'skills', frameworkName, 'SKILL.md'), [
    '---',
    `name: ${frameworkName}`,
    `description: Execute the scaffolded ${frameworkName} workflow.`,
    'version: 0.1.0',
    '---',
    '',
    '<skill>',
    '<objective>',
    `Run the ${frameworkName} workflow using the scaffolded prompt chain and review criteria.`,
    '</objective>',
    '',
    '<quick_start>',
    '1. Prepare intake inputs.',
    '2. Execute the stable workflow prompt.',
    '3. Review the outputs against success criteria.',
    '</quick_start>',
    '</skill>'
  ]);

  writeMarkdownTemplate(path.join(proposedRoot, '.claude', 'commands', frameworkName, 'run.md'), [
    '---',
    `description: Run the scaffolded ${frameworkName} workflow`,
    'argument-hint: <project-root>',
    'allowed-tools: [Read, Write, Edit, Glob, Grep]',
    '---',
    '',
    '<objective>',
    `Run the scaffolded ${frameworkName} framework against a project.`,
    '</objective>'
  ]);

  writeMarkdownTemplate(path.join(proposedRoot, '.claude', 'agents', frameworkName, 'workflow-agent.md'), [
    '---',
    `name: ${frameworkName}-workflow-agent`,
    `description: Executes the scaffolded ${frameworkName} workflow`,
    'tools: [Read, Write, Edit, Glob, Grep]',
    '---',
    '',
    `Use the prompt chain in this framework to execute the ${frameworkName} workflow.`
  ]);
}

/**
 * U2a: config-driven user service-category default. When --service is absent,
 * fall back to config/workspace.json's default_user_service_category (resolved
 * from the repo root, i.e. two levels up from tools/workspace/). Absent file,
 * unparseable file, or absent key all resolve to no default — byte-neutral with
 * today's behavior (still dies on missing --service). This lets a downstream
 * export target (e.g. mythos) ship its own config/workspace.json to default new
 * candidates into a reserved user-space category ("homebrew") without changing
 * anything for a repo that ships no such config at all.
 */
function loadDefaultUserServiceCategory(smosRoot) {
  const configPath = path.join(smosRoot, 'config', 'workspace.json');
  if (!exists(configPath)) return null;
  let config;
  try {
    config = readJson(configPath);
  } catch {
    return null;
  }
  const value = config && config.default_user_service_category;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const args = parseArgs(process.argv);
if (args.help || args.h) {
  help();
  process.exit(0);
}

const smosRoot = path.resolve(__dirname, '..', '..');
const projectArg = args.project;
const capturesArg = args.captures;
const defaultUserServiceCategory = args.service ? null : loadDefaultUserServiceCategory(smosRoot);
const service = slugify(args.service || defaultUserServiceCategory || '');
const frameworkName = slugify(args.name || '');

if (!projectArg) die('Missing --project <project-root>');
if (!capturesArg) die('Missing --captures <id,id,...>');
if (!service) die('Missing --service <service>');
if (!frameworkName) die('Missing --name <framework-name>');

const { projectRoot, workspaceRoot } = requireProjectRoot(projectArg);
const project = loadProject(projectRoot);
const captureRoots = resolveCaptureRoots(projectRoot, capturesArg);
const captures = captureRoots.map((captureRoot) => {
  if (!exists(captureRoot)) die(`Capture not found: ${captureRoot}`);
  const inspection = inspectCapture(captureRoot);
  if (!inspection.ready) {
    die(`Capture is not ready for scaffold: ${captureRoot} (missing: ${inspection.missing.join(', ')})`);
  }
  return inspection;
});

const candidateId = `${service}__${frameworkName}`;
const candidateRoot = path.join(projectRoot, 'framework_candidates', candidateId);
if (exists(candidateRoot)) die(`Candidate already exists: ${candidateRoot}`);
ensureDir(candidateRoot);
ensureDir(path.join(candidateRoot, 'evidence'));
ensureDir(path.join(candidateRoot, 'replay_cases'));
ensureDir(path.join(candidateRoot, 'replay_runs'));

for (const capture of captures) {
  const destRoot = path.join(candidateRoot, 'evidence', path.basename(capture.captureRoot));
  ensureDir(destRoot);
  for (const relFile of ['CAPTURE_META.json', 'goal.md', 'context.md', 'steps.jsonl', 'decisions.jsonl', 'success_criteria.json', 'retrospective.md']) {
    copyPath(path.join(capture.captureRoot, relFile), path.join(destRoot, relFile));
  }
}

const summary = summarizeCaptures(captures);
writeJson(path.join(candidateRoot, 'evidence', 'capture-summary.json'), {
  source_captures: captures.map((capture) => path.basename(capture.captureRoot)),
  stable_actions: summary.stableActions,
  conditional_actions: summary.conditionalActions,
  variable_hints: summary.variableHints,
  branch_hints: summary.branchHints
});

const replayCaseRoot = path.join(candidateRoot, 'replay_cases', 'example-case');
ensureDir(replayCaseRoot);
ensureDir(path.join(replayCaseRoot, 'inputs'));
writeJson(path.join(replayCaseRoot, 'case.json'), {
  case_id: 'example-case',
  name: 'Example replay case',
  source: 'Create a fresh replay input set before marking this case ready.',
  variant_type: 'adjacent',
  ready: false,
  expected_success: true
});
writeMarkdownTemplate(path.join(replayCaseRoot, 'notes.md'), [
  '# Replay Case Notes',
  '',
  '## What this case needs before it is ready',
  '',
  '1. Add input files to `inputs/` that are similar to, but not identical with, the source captures.',
  '2. Each input file must have substantive content (at least 50 bytes, no placeholder-only text).',
  '3. Include at minimum an `intake.json` and a `context.md` in `inputs/`.',
  '4. Set `case.json.ready` to `true` once the inputs are complete.',
  '',
  '## What "replay" means in the current tooling',
  '',
  'The current `replay-candidate.js` tool performs **preflight readiness checks**, not',
  'true prompt-chain execution. It validates that:',
  '- Input files exist and contain non-trivial content',
  '- The proposed framework has structural completeness (manifest, prompts, schemas)',
  '- Capture evidence bundles have normalized fields',
  '- No sanitization issues exist (leaked paths, emails, client references)',
  '',
  'Actual prompt-chain execution against these inputs must be done manually or via',
  'the `/run-framework` command once the candidate is promoted.',
  '',
  '## Minimum viable case requirements',
  '',
  '- At least 2 non-trivial input files',
  '- Inputs must represent a genuinely different scenario from the source captures',
  '- `case.json.ready` must be true',
  '- `case.json.variant_type` should accurately describe the relationship to source data'
]);

// Create learning directory with README, ledger, and subdirectories
const learningRoot = path.join(candidateRoot, 'learning');
ensureDir(learningRoot);
ensureDir(path.join(learningRoot, 'feedback'));
ensureDir(path.join(learningRoot, 'signals'));

writeMarkdownTemplate(path.join(learningRoot, 'README.md'), [
  '# Learning Evidence',
  '',
  'This directory holds explicit learning artifacts for the framework candidate.',
  '',
  '## Structure',
  '',
  '- `feedback/` -- User and operator feedback entries (JSON files matching feedback-entry.schema.json)',
  '- `signals/` -- Internal system signals from validation, replay, audit, health checks (JSON files matching signal-entry.schema.json)',
  '- `learning-ledger.json` -- Aggregated learning summary, recomputed from feedback and signal entries',
  '',
  '## Purpose',
  '',
  'Learning evidence tracks whether the framework is useful (external feedback) and',
  'correct (internal signals). Both signal classes must be present before promotion.',
  '',
  '## Adding entries',
  '',
  '### Feedback entries',
  'Record user or operator assessment of a framework run:',
  '```json',
  '{',
  '  "entry_id": "feedback-20260327T120000Z",',
  '  "framework_id": "service/name",',
  '  "outcome": "accepted",',
  '  "satisfaction": 4,',
  '  "fit_for_purpose": true,',
  '  "friction_notes": ["report was too long"],',
  '  "captured_at": "2026-03-27T12:10:00Z"',
  '}',
  '```',
  '',
  '### Signal entries',
  'Record internal system evidence:',
  '```json',
  '{',
  '  "entry_id": "signal-20260327T120000Z",',
  '  "signal_type": "validation",',
  '  "result": "pass",',
  '  "details": "All structural checks passed",',
  '  "source": "replay-candidate",',
  '  "captured_at": "2026-03-27T12:10:00Z"',
  '}',
  '```',
  '',
  '## Promotion requirements',
  '',
  'By default, promotion requires at least 1 feedback entry and at least 1 signal entry.',
  'This threshold is conservative and operates in advisory mode (warns but does not block).',
  'Set `learning_required: required` in candidate.json to make it a hard gate.'
]);

const frameworkIdForLedger = `${service}/${frameworkName}`;
const ledger = initLedger(frameworkIdForLedger);
writeJson(path.join(learningRoot, 'learning-ledger.json'), ledger);

createProposedFramework(candidateRoot, service, frameworkName, summary, captures);

writeJson(path.join(candidateRoot, 'candidate.json'), {
  candidate_id: candidateId,
  service_category: service,
  framework_name: frameworkName,
  status: captures.length >= 3 ? 'candidate' : 'seed',
  source_captures: captures.map((capture) => path.basename(capture.captureRoot)),
  source_origins: captures.map((capture) => capture.meta.source_root),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  owner: process.env.USER || 'unknown',
  promotion_ready: false,
  blocking_issues: [
    'Preflight checks have not been run yet. Run replay-candidate.js first.',
    'Example replay case is not populated with real inputs.'
  ],
  replay_summary: {
    total: 0,
    pass: 0,
    fail: 0,
    partial: 0,
    manual_intervention: 0,
    preflight_only: true
  },
  sanitization_passed: true,
  normalization_version: '1.0',
  learning_required: 'advisory'
});

writeText(
  path.join(candidateRoot, 'README.md'),
  [
    `# ${candidateId}`,
    '',
    `Project: \`${project.project_name || path.basename(projectRoot)}\``,
    `Workspace: \`${relPosix(workspaceRoot, projectRoot)}\``,
    '',
    '## Start here',
    '- `candidate.json` -- candidate status and promotion readiness',
    '- `evidence/capture-summary.json` -- source capture analysis',
    '- `learning/` -- learning evidence (feedback + signal entries)',
    '- `proposed_framework/` -- the draft framework to be promoted',
    '- `replay_cases/example-case/case.json` -- replay case template (needs population)',
    '',
    '## Before promotion',
    '',
    '1. Populate replay cases with real inputs (not copies of source captures).',
    '2. Add at least 1 feedback entry to `learning/feedback/` (user assessment).',
    '3. Add at least 1 signal entry to `learning/signals/` (internal evidence).',
    '4. Run `node tools/workspace/replay-candidate.js --candidate <this-dir>` to execute preflight checks.',
    '5. Resolve any blocking failures reported by preflight.',
    '6. Verify `candidate.json` shows `promotion_ready: true`.',
    '7. Run `node tools/workspace/promote-candidate.js --candidate <this-dir>`.',
    '',
    '## What "replay" means currently',
    '',
    'The replay tool performs **preflight readiness checks** (structural validation,',
    'input substance, evidence quality, sanitization). It does not execute the prompt',
    'chain. True replay requires running the framework manually against the case inputs.'
  ].join('\n') + '\n'
);

console.log(`OK scaffolded candidate: ${candidateRoot}`);
console.log(`- source captures: ${captures.length}`);
console.log(`- stable actions: ${summary.stableActions.length}`);
console.log(`- conditional actions: ${summary.conditionalActions.length}`);
