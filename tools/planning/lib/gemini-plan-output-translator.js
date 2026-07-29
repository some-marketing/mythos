'use strict';

const fs = require('fs');
const path = require('path');

const {
  NON_AUTHORITY_WARNING,
  classifyHarnessPlanOutput
} = require('./harness-plan-output-contract');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_CANDIDATE_ROOT = path.join('_dev', 'reports', 'analysis', 'harness-plan-output-candidates');
const FORBIDDEN_AUTHORITY_ROOTS = [
  path.join('_dev', 'reports', 'analysis', 'task-plans'),
  path.join('clients')
];

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'gemini-draft-plan';
}

function rel(filePath, rootDir = PROJECT_ROOT) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isUnder(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertCandidateOutputRoot(outputRoot, projectRoot = PROJECT_ROOT) {
  const abs = path.resolve(projectRoot, outputRoot || DEFAULT_CANDIDATE_ROOT);
  const activeSystemRoot = path.resolve(projectRoot, '_dev', 'reports', 'analysis', 'task-plans');
  if (isUnder(activeSystemRoot, abs)) {
    throw new Error('Refusing to write Gemini translated candidates into active system task-plan authority root.');
  }

  const clientsRoot = path.resolve(projectRoot, 'clients');
  if (isUnder(clientsRoot, abs) && /[\\/]plans([\\/]|$)/.test(abs)) {
    throw new Error('Refusing to write Gemini translated candidates into client task-plan authority roots.');
  }

  return abs;
}

function parseFrontmatter(lines) {
  if (lines[0] !== '---') return { data: {}, bodyStart: 0 };
  const data = {};
  let i = 1;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === '---') return { data, bodyStart: i + 1 };
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) data[match[1].trim()] = match[2].trim();
  }
  return { data: {}, bodyStart: 0 };
}

function parseSections(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const { data, bodyStart } = parseFrontmatter(lines);
  const sections = {};
  let current = '';
  for (let i = bodyStart; i < lines.length; i += 1) {
    const heading = lines[i].match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1].trim().toLowerCase();
      sections[current] = [];
      continue;
    }
    if (current) sections[current].push(lines[i]);
  }

  return {
    frontmatter: data,
    sections: Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, value.join('\n').trim()]))
  };
}

function parseSteps(text) {
  const lines = String(text || '').split('\n');
  const steps = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*]|\d+\.)\s*(.+?)\s*$/);
    if (!match) continue;
    const raw = match[1].trim();
    const idMatch = raw.match(/^`?([A-Za-z0-9_-]+)`?\s*[:\-]\s*(.+)$/);
    const stepId = idMatch ? idMatch[1] : `S${String(steps.length + 1).padStart(2, '0')}`;
    const description = idMatch ? idMatch[2].trim() : raw;
    steps.push({
      step_id: stepId,
      description,
      framework_step: null,
      mode: 'PATCH_ALLOWED',
      is_gap: true,
      route: {
        kind: 'gap',
        route_reason: 'Translated from Gemini draft output; requires review before promotion.'
      }
    });
  }
  return steps;
}

function requiredValue(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`Gemini draft is missing required field: ${label}`);
  return normalized;
}

function buildTaskPlanFromGeminiDraft(markdown, opts = {}) {
  const parsed = parseSections(markdown);
  const fm = parsed.frontmatter;
  const sections = parsed.sections;
  const title = requiredValue(fm.title || sections.title, 'title');
  const taskId = slugify(fm.task_id || title);
  const steps = parseSteps(sections.steps || sections['bounded plan']);
  if (steps.length === 0) {
    throw new Error('Gemini draft is missing required steps. Add a ## Steps section with list items.');
  }

  return {
    schema: 'TaskPlan/1.0',
    task_id: taskId,
    title,
    description: requiredValue(sections.description || sections.summary || title, 'description'),
    source: 'operator',
    requested_by: opts.requestedBy || 'Gemini translated candidate',
    timestamp: opts.timestamp || new Date().toISOString(),
    task_summary: requiredValue(sections.summary || sections.description || title, 'summary'),
    scope_type: fm.scope_type || 'system',
    scope_justification: sections['scope justification'] || 'Translated candidate from Gemini draft output; review before promotion.',
    storage_root: opts.storageRoot || DEFAULT_CANDIDATE_ROOT,
    current_state: requiredValue(sections['current state'], 'current state'),
    question_work: requiredValue(sections['question / work'] || sections.question || sections.work, 'question / work'),
    desired_state: requiredValue(sections['desired state'], 'desired state'),
    similarity_assessment: {
      top_framework: 'No direct framework match',
      match_score: 0,
      match_rationale: 'Translated from Gemini draft output; framework matching must be reviewed before promotion.',
      gaps: [
        'Framework matching was not performed by the translator.',
        'All translated steps are gap/tooling-only until reviewed.'
      ],
      applicable_modes: ['PATCH_ALLOWED', 'RUN_ONLY', 'REVIEW_ONLY'],
      trust_tier: 'no-match'
    },
    methodology_routing: {
      contract_id: 'FrameworkMethodologyRouting/1.0',
      enforcement: 'enforced',
      rationale: 'Translated candidate uses gap routes only until reviewed and promoted.'
    },
    bounded_plan: {
      steps,
      required_gates: [
        'This translated candidate is non-authority until reviewed and explicitly promoted.',
        'Do not run this candidate directly unless it is copied into an active task-plan root through a reviewed route.',
        'Preserve the original Gemini draft as provenance.'
      ],
      expected_outcomes: [
        'A reviewer can inspect a canonical TaskPlan/1.0 candidate derived from Gemini output.',
        'Defects can be repaired before any active task-plan promotion.'
      ],
      risk_notes: 'Generated by a deterministic translator from Gemini draft output. Treat as a candidate, not authority.',
      hardening_opportunity: 'Use reviewer findings to improve Gemini prompt templates or translator fixtures.'
    },
    routing_expectations: {
      risk_tier: 'medium',
      review_lane: 'verify-local',
      review_lane_rationale: 'Translated candidate requires local validation before any review/promotion decision.'
    },
    exact_next_command: `/review-task-plan ${taskId}`,
    produced_by_actor_id: 'gemini-translator',
    produced_by_actor_type: 'intelligence',
    produced_by_harness_id: 'gemini-cli-draft-via-mythos-translator',
    produced_at: opts.timestamp || new Date().toISOString(),
    outcome_delta: {
      completed: false,
      verification_passed: false,
      operator_accepted: false,
      divergences: [],
      gates_triggered: ['non-authority-translated-candidate'],
      corrections_made: [],
      should_harden_framework: true
    }
  };
}

function renderTaskPlanMarkdown(plan) {
  const lines = [
    `# ${plan.title}`,
    '',
    NON_AUTHORITY_WARNING,
    '',
    `Task ID: \`${plan.task_id}\``,
    '',
    'This is a translated Gemini candidate. It is not active Mythos plan authority until reviewed and explicitly promoted.',
    '',
    '## Current State',
    '',
    plan.current_state,
    '',
    '## Question / Work',
    '',
    plan.question_work,
    '',
    '## Desired State',
    '',
    plan.desired_state,
    '',
    '## Steps',
    ''
  ];
  plan.bounded_plan.steps.forEach((step, index) => {
    lines.push(`${index + 1}. \`${step.step_id}\` — ${step.description}`);
  });
  lines.push('', '## Gates', '');
  plan.bounded_plan.required_gates.forEach((gate, index) => {
    lines.push(`${index + 1}. ${gate}`);
  });
  return `${lines.join('\n')}\n`;
}

function writeGeminiPlanCandidate(markdown, opts = {}) {
  const projectRoot = opts.projectRoot || PROJECT_ROOT;
  const outputRoot = assertCandidateOutputRoot(opts.outputRoot || DEFAULT_CANDIDATE_ROOT, projectRoot);
  const plan = buildTaskPlanFromGeminiDraft(markdown, {
    requestedBy: opts.requestedBy,
    timestamp: opts.timestamp,
    storageRoot: rel(outputRoot, projectRoot)
  });
  const candidateDir = path.join(outputRoot, plan.task_id);
  assertCandidateOutputRoot(candidateDir, projectRoot);
  ensureDir(candidateDir);

  const jsonPath = path.join(candidateDir, `${plan.task_id}__plan.json`);
  const markdownPath = path.join(candidateDir, `${plan.task_id}__plan.md`);
  const sourcePath = path.join(candidateDir, `${plan.task_id}__source.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, renderTaskPlanMarkdown(plan), 'utf8');
  fs.writeFileSync(sourcePath, String(markdown || ''), 'utf8');

  const validation = classifyHarnessPlanOutput({
    jsonPath,
    markdownPath,
    harness: 'gemini',
    category: 'adapter_mediated_translator'
  }, { projectRoot });

  const manifest = {
    schema: 'GeminiPlanTranslation/1.0',
    warning: NON_AUTHORITY_WARNING,
    task_id: plan.task_id,
    source_path: rel(sourcePath, projectRoot),
    json_path: rel(jsonPath, projectRoot),
    markdown_path: rel(markdownPath, projectRoot),
    output_root: rel(outputRoot, projectRoot),
    authority_boundary: 'candidate-only; do not run or promote without reviewed operator route',
    validation,
    created_at: opts.timestamp || new Date().toISOString()
  };
  const manifestPath = path.join(candidateDir, `${plan.task_id}__translation.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    plan,
    manifest,
    paths: {
      jsonPath,
      markdownPath,
      sourcePath,
      manifestPath
    }
  };
}

module.exports = {
  DEFAULT_CANDIDATE_ROOT,
  assertCandidateOutputRoot,
  buildTaskPlanFromGeminiDraft,
  parseSections,
  parseSteps,
  renderTaskPlanMarkdown,
  writeGeminiPlanCandidate
};
