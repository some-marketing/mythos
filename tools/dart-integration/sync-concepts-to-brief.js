#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dart = require('./lib/dart-api');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_DARTBOARD = 'Mythos/System';
const DEFAULT_STATUS = 'To-do';
const DEFAULT_TYPE = 'Project';
const DEFAULT_TITLE = 'Control-plane maintenance concepts';
const DEFAULT_REPORT_DIR = '_dev/reports/analysis/dart-brief-proposals';
const DEFAULT_IDENTITY_REGISTRY = '_dev/state/dart-concept-brief-links.json';
const DEFAULT_PROPOSAL_INDEX = '_dev/state/dart-brief-proposal-index.json';
const DEFAULT_IDENTITY_SURFACE = 'registry';

const PROMOTION_READY_STATES = new Set([
  'accepted',
  'active',
  'brief-ready',
  'brief_ready',
  'promotion-ready',
  'promotion_ready',
  'ready',
  'stable',
]);

const WORKSTREAM_SCOPE_KEYS = ['workstream_scope', 'workstream', 'workstream_id'];
const PARENT_SCOPE_KEYS = ['parent_scope', 'parent', 'system_scope'];
const STATE_KEYS = ['stage', 'state', 'promotion_state', 'concept_state'];
const DART_ID_KEYS = ['dart_brief_id', 'dart_task_id', 'dart_id'];

function usage() {
  console.log(`
Draft or create a Dart Brief from stable _dev/concepts files.

Dry-run is the default. External Dart writes require both --execute and --confirmed.

Usage:
  npm run dart:concepts:brief -- --title "Control-plane maintenance concepts" --concept _dev/concepts/example.md
  npm run dart:concepts:brief -- --title "Control-plane maintenance concepts" --concept _dev/concepts/a.md --concept _dev/concepts/b.md --check-dart
  npm run dart:concepts:brief -- --title "Control-plane maintenance concepts" --concept _dev/concepts/a.md --execute --confirmed
  npm run dart:concepts:brief -- --title "Control-plane maintenance concepts" --concept _dev/concepts/a.md --check-dart --apply-description
  npm run dart:concepts:brief -- --title "Control-plane maintenance concepts" --concept _dev/concepts/a.md --execute --confirmed --apply-description --apply-confirmed --apply-proposal _dev/reports/analysis/dart-brief-proposals/reviewed.md
  npm run dart:concepts:brief -- --title "Control-plane maintenance concepts" --concept _dev/concepts/a.md --legacy-prototype

Options:
  --title <title>        Dart Brief title. Default: "${DEFAULT_TITLE}"
  --concept <path>      Concept file to include. Repeat for multiple concepts.
  --concepts <paths>    Comma-separated concept paths.
  --dartboard <name>    Dartboard. Default: "${DEFAULT_DARTBOARD}"
  --status <status>     Dart status. Default: "${DEFAULT_STATUS}"
  --type <type>         Dart type. Default: "${DEFAULT_TYPE}"
  --assignee <name>     Optional Dart assignee.
  --tag <tag>           Optional Dart tag. Repeat for multiple tags.
  --check-dart          Read Dart to detect an existing task with the same title.
  --execute             Perform the Dart write. Requires --confirmed.
  --confirmed           Human confirmation that the generated title and description are approved.
  --apply-description   For an existing Brief, replace the Dart description with the generated proposal.
                        Dry-run with --check-dart writes a reviewed proposal artifact.
                        Execute requires --execute --confirmed --apply-confirmed --apply-proposal.
  --apply-confirmed     Human confirmation that the reviewed description diff should be applied.
  --apply-proposal <path>
                        Prior reviewed proposal/report artifact required for execute/apply.
  --legacy-prototype    Use the old draft-concept eligibility gate for dry-run proposal recovery only.
  --identity-surface <surface>
                        Local identity writeback after execute: registry or frontmatter.
                        Default: "${DEFAULT_IDENTITY_SURFACE}".
  --identity-registry <path>
                        Registry path when --identity-surface registry is used.
                        Default: "${DEFAULT_IDENTITY_REGISTRY}".
  --identity-confirmed  Required for frontmatter identity stamping because it edits concept metadata.
  --no-report           Do not write a local proposal artifact.
  --report-path <path>  Write proposal artifact to this repo-relative path.
  --proposal-index <path>
                        Track proposal supersession metadata. Default: "${DEFAULT_PROPOSAL_INDEX}".
  --no-proposal-index   Do not update the proposal index.
  --json                Print structured output.
  --help                Show this help.
`.trim());
}

function parseArgs(argv) {
  const args = {
    title: DEFAULT_TITLE,
    dartboard: DEFAULT_DARTBOARD,
    status: DEFAULT_STATUS,
    type: DEFAULT_TYPE,
    assignee: '',
    tags: ['mythos', 'concept'],
    concepts: [],
    checkDart: false,
    execute: false,
    confirmed: false,
    applyDescription: false,
    applyConfirmed: false,
    applyProposal: '',
    legacyPrototype: false,
    identitySurface: DEFAULT_IDENTITY_SURFACE,
    identityRegistry: DEFAULT_IDENTITY_REGISTRY,
    identityConfirmed: false,
    report: true,
    reportPath: '',
    proposalIndex: DEFAULT_PROPOSAL_INDEX,
    proposalIndexEnabled: true,
    json: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--title') {
      args.title = requireValue(argv, ++i, arg);
    } else if (arg === '--concept') {
      args.concepts.push(requireValue(argv, ++i, arg));
    } else if (arg === '--concepts') {
      const value = requireValue(argv, ++i, arg);
      args.concepts.push(...value.split(',').map((item) => item.trim()).filter(Boolean));
    } else if (arg === '--dartboard') {
      args.dartboard = requireValue(argv, ++i, arg);
    } else if (arg === '--status') {
      args.status = requireValue(argv, ++i, arg);
    } else if (arg === '--type') {
      args.type = requireValue(argv, ++i, arg);
    } else if (arg === '--assignee') {
      args.assignee = requireValue(argv, ++i, arg);
    } else if (arg === '--tag') {
      args.tags.push(requireValue(argv, ++i, arg));
    } else if (arg === '--check-dart') {
      args.checkDart = true;
    } else if (arg === '--execute') {
      args.execute = true;
    } else if (arg === '--confirmed') {
      args.confirmed = true;
    } else if (arg === '--apply-description') {
      args.applyDescription = true;
    } else if (arg === '--apply-confirmed') {
      args.applyConfirmed = true;
    } else if (arg === '--apply-proposal') {
      args.applyProposal = requireValue(argv, ++i, arg);
    } else if (arg === '--legacy-prototype') {
      args.legacyPrototype = true;
    } else if (arg === '--identity-surface') {
      args.identitySurface = requireValue(argv, ++i, arg);
    } else if (arg === '--identity-registry') {
      args.identityRegistry = requireValue(argv, ++i, arg);
    } else if (arg === '--identity-confirmed') {
      args.identityConfirmed = true;
    } else if (arg === '--no-report') {
      args.report = false;
    } else if (arg === '--report-path') {
      args.reportPath = requireValue(argv, ++i, arg);
    } else if (arg === '--proposal-index') {
      args.proposalIndex = requireValue(argv, ++i, arg);
    } else if (arg === '--no-proposal-index') {
      args.proposalIndexEnabled = false;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.title = args.title.trim();
  args.dartboard = args.dartboard.trim();
  args.status = args.status.trim();
  args.type = args.type.trim();
  args.assignee = args.assignee.trim();
  args.identitySurface = args.identitySurface.trim();
  args.identityRegistry = args.identityRegistry.trim();
  args.proposalIndex = args.proposalIndex.trim();
  args.applyProposal = args.applyProposal.trim();
  args.tags = unique(args.tags.map((tag) => tag.trim()).filter(Boolean));
  args.concepts = unique(args.concepts.map((concept) => concept.trim()).filter(Boolean));

  if (!args.help && args.concepts.length === 0) {
    throw new Error('At least one --concept path is required.');
  }
  if (!args.title) throw new Error('--title cannot be empty.');
  if (!args.dartboard) throw new Error('--dartboard cannot be empty.');
  if (args.execute && !args.confirmed) {
    throw new Error('Refusing Dart mutation. Re-run with --execute --confirmed after reviewing the generated title and description.');
  }
  if (args.execute && args.legacyPrototype) {
    throw new Error('--legacy-prototype is dry-run only and cannot be used with --execute.');
  }
  if (!['registry', 'frontmatter'].includes(args.identitySurface)) {
    throw new Error('--identity-surface must be either registry or frontmatter.');
  }
  if (args.execute && args.identitySurface === 'frontmatter' && !args.identityConfirmed) {
    throw new Error('Refusing concept frontmatter mutation. Re-run with --identity-confirmed after approving identity-stamp-only concept metadata updates.');
  }
  if (args.applyProposal && !args.applyDescription) {
    throw new Error('--apply-proposal can only be used with --apply-description.');
  }
  if (args.applyDescription && args.execute && (!args.confirmed || !args.applyConfirmed || !args.applyProposal)) {
    throw new Error('Refusing reviewed description apply. Re-run with --execute --confirmed --apply-description --apply-confirmed --apply-proposal <path> after reviewing the proposal diff.');
  }
  if (args.applyDescription && !args.execute && !args.checkDart) {
    throw new Error('Refusing description apply proposal without --check-dart; the proposal must include the current Dart description and diff.');
  }
  if (args.identitySurface === 'registry' && !args.identityRegistry) {
    throw new Error('--identity-registry cannot be empty when --identity-surface registry is used.');
  }

  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function unique(values) {
  return Array.from(new Set(values));
}

function resolveRepoPath(repoRelativePath, projectRoot = PROJECT_ROOT) {
  const resolvedRoot = path.resolve(projectRoot);
  const resolved = path.resolve(resolvedRoot, repoRelativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Path must stay inside repo: ${repoRelativePath}`);
  }
  return resolved;
}

function readConcept(repoRelativePath, options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const absolutePath = resolveRepoPath(repoRelativePath, projectRoot);
  const text = fs.readFileSync(absolutePath, 'utf8');
  const frontmatter = parseFrontmatter(text);
  const heading = firstMatch(text, /^#\s+(.+)$/m);
  const explicitTitle = frontmatter.title || '';
  const title = explicitTitle || heading || titleFromPath(repoRelativePath);
  const workstreamScope = firstFrontmatterValue(frontmatter, WORKSTREAM_SCOPE_KEYS);
  const parentScope = firstFrontmatterValue(frontmatter, PARENT_SCOPE_KEYS);
  const promotionState = firstFrontmatterValue(frontmatter, STATE_KEYS);
  const dartBriefId = firstFrontmatterValue(frontmatter, DART_ID_KEYS);
  const problem = extractSection(text, 'Problem');
  const decision = extractSection(text, 'Decision');
  const nextSteps = extractSection(text, 'Next Steps');
  const openQuestions = extractSection(text, 'Open Questions');
  const firstProblemParagraph = firstParagraph(problem);
  const firstDecisionParagraph = firstParagraph(decision);
  const firstNextStep = firstListItem(nextSteps);

  return {
    path: repoRelativePath,
    absolutePath,
    title,
    frontmatter,
    explicitTitle,
    workstreamScope,
    parentScope,
    promotionState,
    dartBriefId,
    stage: frontmatter.stage || promotionState || '',
    identified: frontmatter.identified || '',
    context: frontmatter.context || '',
    problem,
    decision,
    nextSteps,
    openQuestions,
    firstProblemParagraph,
    firstDecisionParagraph,
    firstNextStep,
  };
}

function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return {};
  const end = text.indexOf('\n---', 4);
  if (end === -1) return {};
  const block = text.slice(4, end).split(/\r?\n/);
  const result = {};
  for (const line of block) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return result;
}

function firstFrontmatterValue(frontmatter, keys) {
  for (const key of keys) {
    if (frontmatter[key]) return frontmatter[key];
  }
  return '';
}

function firstMatch(text, regex) {
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

function titleFromPath(repoRelativePath) {
  return path.basename(repoRelativePath, path.extname(repoRelativePath))
    .split('-')
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(' ');
}

function extractSection(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=^##\\s+|\\s*$)`, 'm');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

function firstParagraph(section) {
  if (!section) return '';
  return section
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .find(Boolean) || '';
}

function firstListItem(section) {
  if (!section) return '';
  const lines = section.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*]|\d+\.)\s+\[?\s*\]?\s*(.+)$/);
    if (match) return match[1].trim();
  }
  return firstParagraph(section);
}

function normalizeState(value) {
  return String(value || '').trim().toLowerCase();
}

function conceptMetadata(concept) {
  return {
    title: concept.explicitTitle || '',
    workstream_scope: concept.workstreamScope || '',
    parent_scope: concept.parentScope || '',
    promotion_state: concept.promotionState || '',
    dart_brief_id: concept.dartBriefId || '',
  };
}

function validateConcept(concept, options = {}) {
  const missing = [];
  if (options.legacyPrototype) {
    if (!concept.title) missing.push('title');
    if (!concept.firstProblemParagraph) missing.push('Problem');
    if (!concept.firstNextStep) missing.push('Next Steps');
    return {
      path: concept.path,
      title: concept.title,
      stable_enough: missing.length === 0,
      legacy_prototype: true,
      missing,
      metadata: conceptMetadata(concept),
    };
  }

  if (!concept.explicitTitle) missing.push('frontmatter.title');
  if (!concept.workstreamScope) missing.push(`frontmatter.${WORKSTREAM_SCOPE_KEYS.join('|')}`);
  if (!concept.parentScope) missing.push(`frontmatter.${PARENT_SCOPE_KEYS.join('|')}`);
  if (!concept.promotionState) {
    missing.push(`frontmatter.${STATE_KEYS.join('|')}`);
  } else if (!PROMOTION_READY_STATES.has(normalizeState(concept.promotionState))) {
    missing.push(`promotion-ready state (${Array.from(PROMOTION_READY_STATES).sort().join(', ')})`);
  }
  if (!concept.firstProblemParagraph) missing.push('Problem');
  if (!concept.firstNextStep) missing.push('Next Steps');
  return {
    path: concept.path,
    title: concept.title,
    stable_enough: missing.length === 0,
    legacy_prototype: false,
    missing,
    metadata: conceptMetadata(concept),
  };
}

function buildDescription(concepts, options) {
  const conceptCount = concepts.length;
  const titleLine = conceptCount === 1 ? 'this concept' : `these ${conceptCount} concepts`;
  const lines = [
    '## What and Why',
    '',
    `This Brief registers ${titleLine} as visible Mythos/System collaboration work. The source concepts are already captured in \`_dev/concepts/\`; Dart should track ownership, status, handoff state, and later subtasks while the repo remains the deeper strategy and evidence surface.`,
    '',
    'The immediate purpose is to keep durable control-plane maintenance concepts from staying invisible after they are stable enough to steer future work. This Brief does not create implementation subtasks yet.',
    '',
    '## Open Questions',
    '',
    '1. Which active workstream should own the first bounded implementation slice?',
    '2. Which concepts are already covered by existing Dart tasks or active task plans?',
    '3. Which concepts should become subtasks later, and which should remain context only?',
    '',
    '## Needs Before Starting',
    '',
    '- [ ] Confirm this generated Brief is the right Dart surface for the source concepts.',
    '- [ ] Check the Mythos/System board for overlapping active work before creating child tasks.',
    '- [ ] Choose the first implementation slice and record the decision in this Brief.',
    '',
    '## Decision Log',
    '',
    `### ${today()} -- Proposed from concept files`,
    '- **Decision:** Drafted as a parent Brief from stable concept artifacts; no subtasks created yet.',
    '- **Decided by:** Mythos concept-to-Dart proposal automation, pending human confirmation before any Dart write.',
    '- **Context:** Local Dart policy says stable concepts should become visible parent Briefs, while Dart mutation still requires confirmation.',
    '- **Impact:** The board can track the workstream without fragmenting it into premature implementation tasks.',
    '',
    '## Subtask Plan',
    '',
  ];

  concepts.forEach((concept, index) => {
    lines.push(`${index + 1}. Triage "${concept.title}" into an owner workstream -- Investigation`);
  });

  lines.push('', '## Source Concepts', '');
  concepts.forEach((concept) => {
    lines.push(`### ${concept.title}`);
    lines.push(`- **Path:** \`${concept.path}\``);
    if (concept.stage) lines.push(`- **Stage:** \`${concept.stage}\``);
    if (concept.workstreamScope) lines.push(`- **Workstream scope:** \`${concept.workstreamScope}\``);
    if (concept.parentScope) lines.push(`- **Parent scope:** \`${concept.parentScope}\``);
    if (concept.dartBriefId) lines.push(`- **Dart Brief ID:** \`dart:${concept.dartBriefId}\``);
    if (concept.identified) lines.push(`- **Identified:** ${concept.identified}`);
    if (concept.context) lines.push(`- **Context:** ${concept.context}`);
    if (concept.firstProblemParagraph) lines.push(`- **Problem:** ${concept.firstProblemParagraph}`);
    if (concept.firstNextStep) lines.push(`- **First next step:** ${concept.firstNextStep}`);
    lines.push('');
  });

  lines.push('---');
  lines.push(`**Context:** ${concepts.map((concept) => `\`${concept.path}\``).join(', ')}`);
  lines.push(`**Generated by:** \`tools/dart-integration/sync-concepts-to-brief.js\``);
  lines.push(`**Target Dartboard:** \`${options.dartboard}\``);

  return lines.join('\n');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function buildTaskItem(description, options) {
  const item = {
    title: options.title,
    dartboard: options.dartboard,
    status: options.status,
    type: options.type,
    description,
    tags: options.tags,
  };
  if (options.assignee) item.assignee = options.assignee;
  return item;
}

function tasksFrom(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.results)) return result.results;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

async function findExistingTask(options, dartClient = dart) {
  const result = await dartClient.listTasks(options.dartboard, { is_completed: false, limit: 100 });
  const tasks = tasksFrom(result);
  return tasks.find((task) => String(task.title || '').trim() === options.title) || null;
}

function normalizeTask(task) {
  const item = task && task.item ? task.item : task;
  if (!item) return null;
  return {
    id: String(item.id || item.duid || ''),
    title: String(item.title || ''),
    status: String(item.status || ''),
    dartboard: String(item.dartboard || ''),
    description: String(item.description || ''),
  };
}

function registryEntriesByConceptPath(registryPath, options = {}) {
  const registry = loadIdentityRegistry(registryPath, options);
  const byPath = new Map();
  registry.entries.forEach((entry) => {
    if (entry && entry.concept_path && entry.dart_task_id) {
      byPath.set(entry.concept_path, entry);
    }
  });
  return byPath;
}

function conceptIdentityKey(concept) {
  return [
    normalizeComparable(concept.parentScope),
    normalizeComparable(concept.workstreamScope),
    normalizeComparable(concept.title),
    normalizeState(concept.promotionState),
  ].join('::');
}

function conceptContentFingerprint(concept) {
  const stableShape = [
    conceptIdentityKey(concept),
    normalizeComparable(concept.firstProblemParagraph),
    normalizeComparable(concept.firstNextStep),
  ].join('\n');
  return crypto.createHash('sha256').update(stableShape).digest('hex');
}

function normalizeComparable(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function registryEntryMatchesConcept(entry, concept) {
  if (!entry || !entry.dart_task_id) return false;
  const identityKey = conceptIdentityKey(concept);
  const fingerprint = conceptContentFingerprint(concept);
  if (entry.concept_identity_key && entry.concept_identity_key === identityKey) return true;
  if (entry.content_fingerprint && entry.content_fingerprint === fingerprint) return true;
  return normalizeComparable(entry.workstream_scope) === normalizeComparable(concept.workstreamScope)
    && normalizeComparable(entry.parent_scope) === normalizeComparable(concept.parentScope)
    && normalizeComparable(entry.concept_title) === normalizeComparable(concept.title);
}

function loadRegistryForCandidates(options = {}) {
  const registryPath = options.identityRegistry;
  if (!registryPath) {
    return {
      registry: { entries: [] },
      byPath: new Map(),
    };
  }
  try {
    const registry = loadIdentityRegistry(registryPath, {
      projectRoot: options.projectRoot || PROJECT_ROOT,
    });
    const byPath = new Map();
    registry.entries.forEach((entry) => {
      if (entry && entry.concept_path && entry.dart_task_id) {
        byPath.set(entry.concept_path, entry);
      }
    });
    return { registry, byPath };
  } catch (error) {
    if (fs.existsSync(resolveRepoPath(registryPath, options.projectRoot || PROJECT_ROOT))) {
      throw error;
    }
    return {
      registry: { entries: [] },
      byPath: new Map(),
    };
  }
}

function localIdentityResolution(concepts, options = {}) {
  const candidates = [];
  const seen = new Set();
  const ambiguousRegistryMatches = [];
  const registryReconciliations = [];
  const { registry, byPath: registryByPath } = loadRegistryForCandidates(options);

  function add(candidate) {
    const id = String(candidate.id || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    candidates.push({
      id,
      source: candidate.source,
      concept_path: candidate.concept_path || '',
      new_concept_path: candidate.new_concept_path || '',
      expected_title: candidate.expected_title || '',
      dartboard: candidate.dartboard || '',
      registry_reconciliation: candidate.registry_reconciliation || null,
    });
  }

  concepts.forEach((concept) => {
    if (concept.dartBriefId) {
      add({
        id: concept.dartBriefId,
        source: 'frontmatter',
        concept_path: concept.path,
        expected_title: concept.frontmatter.dart_brief_title || '',
        dartboard: concept.frontmatter.dart_brief_dartboard || '',
      });
    }

    const registryEntry = registryByPath.get(concept.path);
    if (registryEntry && registryEntry.dart_task_id) {
      add({
        id: registryEntry.dart_task_id,
        source: 'registry',
        concept_path: concept.path,
        expected_title: registryEntry.dart_task_title || '',
        dartboard: registryEntry.dartboard || '',
      });
      return;
    }

    const movedMatches = registry.entries
      .filter((entry) => entry && entry.concept_path !== concept.path)
      .filter((entry) => registryEntryMatchesConcept(entry, concept));
    if (movedMatches.length === 1) {
      const [match] = movedMatches;
      const reconciliation = {
        old_path: match.concept_path,
        new_path: concept.path,
        dart_task_id: match.dart_task_id,
        match_reason: match.content_fingerprint === conceptContentFingerprint(concept)
          ? 'content_fingerprint'
          : 'stable_metadata',
      };
      registryReconciliations.push(reconciliation);
      add({
        id: match.dart_task_id,
        source: 'registry_moved',
        concept_path: match.concept_path,
        new_concept_path: concept.path,
        expected_title: match.dart_task_title || '',
        dartboard: match.dartboard || '',
        registry_reconciliation: reconciliation,
      });
    } else if (movedMatches.length > 1) {
      ambiguousRegistryMatches.push({
        concept_path: concept.path,
        matches: movedMatches.map((entry) => ({
          concept_path: entry.concept_path,
          dart_task_id: entry.dart_task_id,
          dart_task_title: entry.dart_task_title || '',
        })),
      });
    }
  });

  return {
    candidates,
    ambiguousRegistryMatches,
    registryReconciliations,
  };
}

function localIdentityCandidates(concepts, options = {}) {
  return localIdentityResolution(concepts, options).candidates;
}

async function verifyLocalIdentityCandidate(candidate, dartClient) {
  if (typeof dartClient.getTask !== 'function') {
    return {
      candidate,
      task: null,
      verified: false,
      stale: false,
      reason: 'Dart client does not expose getTask; identity could not be live-verified.',
    };
  }

  try {
    const task = normalizeTask(await dartClient.getTask(candidate.id));
    if (!task || !task.id) {
      return {
        candidate,
        task: null,
        verified: false,
        stale: true,
        reason: `Dart getTask returned no task for local identity dart:${candidate.id}.`,
      };
    }
    return {
      candidate,
      task,
      verified: true,
      stale: false,
      reason: '',
    };
  } catch (error) {
    return {
      candidate,
      task: null,
      verified: false,
      stale: true,
      reason: `Dart getTask failed for local identity dart:${candidate.id}: ${error.message}`,
    };
  }
}

async function resolveExistingTask(concepts, options, dartClient = dart) {
  const localIdentity = localIdentityResolution(concepts, options);
  const identityCandidates = localIdentity.candidates;
  const identityLookups = [];

  if (localIdentity.ambiguousRegistryMatches.length > 0) {
    return {
      existingTask: null,
      dartChecked: true,
      resolutionSource: 'registry_ambiguous',
      identityCandidates,
      identityLookups,
      staleIdentity: null,
      ambiguousIdentity: localIdentity.ambiguousRegistryMatches,
      registryReconciliations: localIdentity.registryReconciliations,
      titleMatched: false,
    };
  }

  for (const candidate of identityCandidates) {
    const lookup = await verifyLocalIdentityCandidate(candidate, dartClient);
    identityLookups.push(lookup);
    if (lookup.task) {
      return {
        existingTask: lookup.task,
        dartChecked: true,
        resolutionSource: lookup.candidate.source,
        identityCandidates,
        identityLookups,
        staleIdentity: null,
        ambiguousIdentity: null,
        registryReconciliations: localIdentity.registryReconciliations,
        titleMatched: false,
      };
    }
    if (lookup.stale) {
      return {
        existingTask: null,
        dartChecked: true,
        resolutionSource: lookup.candidate.source,
        identityCandidates,
        identityLookups,
        staleIdentity: lookup,
        ambiguousIdentity: null,
        registryReconciliations: localIdentity.registryReconciliations,
        titleMatched: false,
      };
    }
  }

  const existingTask = await findExistingTask(options, dartClient);
  return {
    existingTask,
    dartChecked: true,
    resolutionSource: existingTask ? 'title' : '',
    identityCandidates,
    identityLookups,
    staleIdentity: null,
    ambiguousIdentity: null,
    registryReconciliations: localIdentity.registryReconciliations,
    titleMatched: Boolean(existingTask),
  };
}

function defaultReportPath(title) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const slug = slugify(title);
  return path.join(DEFAULT_REPORT_DIR, `${stamp}__${slug}.md`);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'dart-brief';
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function descriptionApplyGate(payload) {
  return {
    schema_version: 1,
    source: 'tools/dart-integration/sync-concepts-to-brief.js',
    title: payload.title,
    dartboard: payload.dartboard,
    existing_task_id: payload.existing_task_id || '',
    source_concepts: payload.concepts.map((concept) => concept.path),
    proposed_description: payload.item.description,
    current_description: payload.existing_task_description || '',
    description_diff: payload.description_diff || '',
    proposed_description_sha256: sha256Text(payload.item.description),
    current_description_sha256: sha256Text(payload.existing_task_description || ''),
    description_diff_sha256: sha256Text(payload.description_diff || ''),
  };
}

function extractReviewedApplyGate(reportText) {
  const heading = '## Reviewed Description Apply Gate';
  const headingIndex = reportText.indexOf(heading);
  if (headingIndex === -1) return null;
  const fenceStart = reportText.indexOf('```json', headingIndex);
  if (fenceStart === -1) return null;
  const jsonStart = reportText.indexOf('\n', fenceStart);
  if (jsonStart === -1) return null;
  const fenceEnd = reportText.indexOf('\n```', jsonStart + 1);
  if (fenceEnd === -1) return null;
  return JSON.parse(reportText.slice(jsonStart + 1, fenceEnd));
}

function loadReviewedApplyProposal(proposalPath, options = {}) {
  if (!proposalPath) {
    throw new Error('Refusing reviewed description apply without --apply-proposal <path>.');
  }
  const absolutePath = resolveRepoPath(proposalPath, options.projectRoot || PROJECT_ROOT);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Refusing reviewed description apply because --apply-proposal is not readable: ${proposalPath}`);
  }
  const text = fs.readFileSync(absolutePath, 'utf8');
  const gate = extractReviewedApplyGate(text);
  if (!gate) {
    throw new Error('Refusing reviewed description apply because --apply-proposal is missing a Reviewed Description Apply Gate.');
  }
  return { path: proposalPath, absolutePath, gate };
}

function verifyReviewedApplyProposal(proposalPath, payload, options = {}) {
  const reviewed = loadReviewedApplyProposal(proposalPath, options);
  const expected = descriptionApplyGate(payload);
  const mismatches = [];
  [
    'schema_version',
    'source',
    'title',
    'dartboard',
    'existing_task_id',
    'proposed_description',
    'current_description',
    'description_diff',
    'proposed_description_sha256',
    'current_description_sha256',
    'description_diff_sha256',
  ].forEach((key) => {
    if (String(reviewed.gate[key] || '') !== String(expected[key] || '')) {
      mismatches.push(key);
    }
  });
  if (JSON.stringify(reviewed.gate.source_concepts || []) !== JSON.stringify(expected.source_concepts)) {
    mismatches.push('source_concepts');
  }
  if (mismatches.length > 0) {
    throw new Error(`Refusing reviewed description apply because --apply-proposal does not match the current generated proposal: ${mismatches.join(', ')}.`);
  }
  return reviewed;
}

function assertDistinctApplyProposalAndReport(applyProposal, reportPath, options = {}) {
  if (!applyProposal || !reportPath) return;
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const proposalAbsolute = resolveRepoPath(applyProposal, projectRoot);
  const reportAbsolute = resolveRepoPath(reportPath, projectRoot);
  if (proposalAbsolute === reportAbsolute) {
    throw new Error('Refusing reviewed description apply because --report-path would overwrite the reviewed --apply-proposal artifact.');
  }
}

function writeReport(reportPath, payload, description, options = {}) {
  const absolutePath = resolveRepoPath(reportPath, options.projectRoot || PROJECT_ROOT);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const lines = [
    `# Dart Brief Proposal: ${payload.title}`,
    '',
    `**Generated:** ${new Date().toISOString()}`,
    `**Target Dartboard:** \`${payload.dartboard}\``,
    `**Status:** \`${payload.status}\``,
    `**Type:** \`${payload.type}\``,
    `**Action:** \`${payload.action}\``,
    `**Dart Checked:** \`${payload.dart_checked}\``,
  ];
  if (payload.existing_task_id) lines.push(`**Existing Task:** \`dart:${payload.existing_task_id}\``);
  if (payload.created_task_id) lines.push(`**Created Task:** \`dart:${payload.created_task_id}\``);
  if (payload.resolution_source) lines.push(`**Resolution Source:** \`${payload.resolution_source}\``);
  if (payload.stale_identity) lines.push(`**Stale Identity:** \`dart:${payload.stale_identity.id}\` from \`${payload.stale_identity.source}\``);
  if (payload.identity_surface) lines.push(`**Identity Surface:** \`${payload.identity_surface}\``);
  if (payload.identity_path) lines.push(`**Identity Path:** \`${payload.identity_path}\``);
  if (payload.proposal_status) lines.push(`**Proposal Status:** \`${payload.proposal_status}\``);
  if (payload.proposal_index_path) lines.push(`**Proposal Index:** \`${payload.proposal_index_path}\``);
  if (payload.description_apply_requested) lines.push(`**Description Apply Requested:** \`${payload.description_apply_requested}\``);
  if (payload.description_applied) lines.push(`**Description Applied:** \`${payload.description_applied}\``);
  if (payload.apply_proposal_path) lines.push(`**Apply Proposal:** \`${payload.apply_proposal_path}\``);
  if (payload.reviewed_apply_gate_verified) lines.push(`**Reviewed Apply Gate Verified:** \`${payload.reviewed_apply_gate_verified}\``);
  if (payload.ambiguous_identity && payload.ambiguous_identity.length > 0) {
    lines.push('', '## Ambiguous Local Identity', '');
    payload.ambiguous_identity.forEach((ambiguous) => {
      lines.push(`- \`${ambiguous.concept_path}\` matched ${ambiguous.matches.length} registry entries; no Dart mutation is allowed until this is reconciled.`);
      ambiguous.matches.forEach((match) => {
        lines.push(`  - \`${match.concept_path}\` -> \`dart:${match.dart_task_id}\` (${match.dart_task_title || 'untitled'})`);
      });
    });
  }
  if (payload.registry_reconciliations && payload.registry_reconciliations.length > 0) {
    lines.push('', '## Registry Reconciliation', '');
    payload.registry_reconciliations.forEach((reconciliation) => {
      lines.push(`- \`${reconciliation.old_path}\` -> \`${reconciliation.new_path}\` via \`${reconciliation.match_reason}\` for \`dart:${reconciliation.dart_task_id}\``);
    });
  }
  if (payload.identity_lookups && payload.identity_lookups.length > 0) {
    lines.push('', '## Local Identity Lookup', '');
    payload.identity_lookups.forEach((lookup) => {
      lines.push(`- \`dart:${lookup.id}\` from \`${lookup.source}\` (${lookup.concept_path}) -- verified: \`${lookup.verified}\`; stale: \`${lookup.stale}\`; task: \`${lookup.task_id || 'none'}\``);
      if (lookup.reason) lines.push(`  - ${lookup.reason}`);
    });
  }
  lines.push('', '## Concept Stability Check', '');
  payload.concepts.forEach((concept) => {
    const missing = concept.missing.length > 0 ? concept.missing.join(', ') : 'none';
    lines.push(`- \`${concept.path}\` -- stable enough: \`${concept.stable_enough}\`; missing: ${missing}`);
  });
  lines.push('', '## Proposed Dart Item', '');
  lines.push('```json');
  lines.push(JSON.stringify(payload.item, null, 2));
  lines.push('```');
  lines.push('', '## Proposed Description', '');
  lines.push(description);
  if (payload.description_apply_requested) {
    lines.push('', '## Reviewed Description Apply Gate', '');
    lines.push('```json');
    lines.push(JSON.stringify(descriptionApplyGate(payload), null, 2));
    lines.push('```');
    lines.push('', '## Existing Dart Description Preview', '');
    lines.push('```markdown');
    lines.push(payload.existing_task_description || '');
    lines.push('```');
    lines.push('', '## Description Diff Preview', '');
    lines.push('```diff');
    lines.push(payload.description_diff || '');
    lines.push('```');
  }
  lines.push('');
  fs.writeFileSync(absolutePath, lines.join('\n'));
}

function proposalConceptSetKey(concepts) {
  return crypto
    .createHash('sha256')
    .update(concepts.map((concept) => concept.path).sort().join('\n'))
    .digest('hex');
}

function loadProposalIndex(indexPath, options = {}) {
  const absolutePath = resolveRepoPath(indexPath, options.projectRoot || PROJECT_ROOT);
  if (!fs.existsSync(absolutePath)) {
    return {
      schema_version: 1,
      proposals: [],
    };
  }
  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  return {
    schema_version: parsed.schema_version || 1,
    proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
  };
}

function updateProposalIndex(indexPath, payload, concepts, options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const absolutePath = resolveRepoPath(indexPath, projectRoot);
  const index = loadProposalIndex(indexPath, { projectRoot });
  const conceptPaths = concepts.map((concept) => concept.path).sort();
  const conceptSetKey = proposalConceptSetKey(concepts);
  const titleKey = normalizeComparable(payload.title);
  const dartboardKey = normalizeComparable(payload.dartboard);
  const status = payload.dry_run ? 'latest' : 'executed';
  const nextEntry = {
    proposal_path: payload.report_path,
    title: payload.title,
    title_key: titleKey,
    dartboard: payload.dartboard,
    dartboard_key: dartboardKey,
    source_concepts: conceptPaths,
    concept_set_key: conceptSetKey,
    generated_at: payload.generated_at,
    action: payload.action,
    status,
    existing_task_id: payload.existing_task_id || '',
    created_task_id: payload.created_task_id || '',
  };

  const proposals = index.proposals
    .filter((entry) => entry && entry.proposal_path !== payload.report_path)
    .map((entry) => {
      if (entry.title_key !== titleKey || entry.dartboard_key !== dartboardKey) return entry;
      if (entry.concept_set_key === conceptSetKey) {
        return entry.status === 'executed' ? entry : { ...entry, status: 'superseded' };
      }
      return entry.status === 'latest' ? { ...entry, status: 'stale' } : entry;
    });
  proposals.push(nextEntry);
  proposals.sort((a, b) => String(a.generated_at || '').localeCompare(String(b.generated_at || '')));

  index.proposals = proposals;
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(index, null, 2) + '\n');
  return indexPath;
}

function descriptionDiff(currentDescription, nextDescription) {
  const current = String(currentDescription || '').split(/\r?\n/);
  const next = String(nextDescription || '').split(/\r?\n/);
  if (String(currentDescription || '') === String(nextDescription || '')) {
    return ' descriptions are identical';
  }
  return [
    `- current lines: ${current.length}`,
    `+ proposed lines: ${next.length}`,
    '',
    ...current.slice(0, 20).map((line) => `- ${line}`),
    ...next.slice(0, 20).map((line) => `+ ${line}`),
  ].join('\n');
}

function loadIdentityRegistry(registryPath, options = {}) {
  const absolutePath = resolveRepoPath(registryPath, options.projectRoot || PROJECT_ROOT);
  if (!fs.existsSync(absolutePath)) {
    return {
      schema_version: 1,
      reason: 'Registry fallback is used by default because source concept files are content-protected unless identity-stamp frontmatter updates are explicitly approved.',
      entries: [],
    };
  }
  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  return {
    schema_version: parsed.schema_version || 1,
    reason: parsed.reason || 'Registry fallback for concept-to-Dart local identity persistence.',
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
  };
}

function writeIdentityRegistry(registryPath, concepts, taskId, options, action) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const absolutePath = resolveRepoPath(registryPath, projectRoot);
  const registry = loadIdentityRegistry(registryPath, { projectRoot });
  const now = new Date().toISOString();
  const byPath = new Map(registry.entries.map((entry) => [entry.concept_path, entry]));
  const reconciliations = Array.isArray(options.registryReconciliations) ? options.registryReconciliations : [];

  reconciliations.forEach((reconciliation) => {
    if (reconciliation && reconciliation.old_path && reconciliation.new_path) {
      byPath.delete(reconciliation.old_path);
    }
  });

  concepts.forEach((concept) => {
    const previous = byPath.get(concept.path) || {};
    const reconciliation = reconciliations.find((item) => item.new_path === concept.path && item.dart_task_id === taskId);
    const previousPaths = unique([
      ...(Array.isArray(previous.previous_paths) ? previous.previous_paths : []),
      ...(reconciliation && reconciliation.old_path ? [reconciliation.old_path] : []),
    ].filter(Boolean));
    byPath.set(concept.path, {
      ...previous,
      concept_path: concept.path,
      concept_title: concept.title,
      workstream_scope: concept.workstreamScope || previous.workstream_scope || '',
      parent_scope: concept.parentScope || previous.parent_scope || '',
      promotion_state: concept.promotionState || previous.promotion_state || '',
      concept_identity_key: conceptIdentityKey(concept),
      content_fingerprint: conceptContentFingerprint(concept),
      previous_paths: previousPaths,
      dart_task_id: taskId,
      dart_task_title: options.title,
      dartboard: options.dartboard,
      identity_surface: 'registry',
      last_action: action,
      last_reconciliation: reconciliation ? reconciliation.match_reason : previous.last_reconciliation || '',
      updated_at: now,
      source: 'tools/dart-integration/sync-concepts-to-brief.js',
    });
  });

  registry.entries = Array.from(byPath.values())
    .sort((a, b) => String(a.concept_path).localeCompare(String(b.concept_path)));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(registry, null, 2) + '\n');
  return registryPath;
}

function quoteFrontmatterValue(value) {
  const text = String(value || '');
  if (/^[A-Za-z0-9_./:-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function updateFrontmatter(text, updates) {
  if (!text.startsWith('---\n')) {
    throw new Error('Cannot stamp Dart identity: concept is missing frontmatter.');
  }
  const end = text.indexOf('\n---', 4);
  if (end === -1) {
    throw new Error('Cannot stamp Dart identity: concept frontmatter is unterminated.');
  }
  const block = text.slice(4, end);
  const rest = text.slice(end);
  const lines = block.split(/\r?\n/);
  const next = [];
  const remaining = new Map(Object.entries(updates));

  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match && remaining.has(match[1])) {
      next.push(`${match[1]}: ${quoteFrontmatterValue(remaining.get(match[1]))}`);
      remaining.delete(match[1]);
    } else {
      next.push(line);
    }
  }

  for (const [key, value] of remaining) {
    next.push(`${key}: ${quoteFrontmatterValue(value)}`);
  }

  return `---\n${next.join('\n')}${rest}`;
}

function stampConceptFrontmatter(concepts, taskId, options, action) {
  const now = new Date().toISOString();
  concepts.forEach((concept) => {
    const original = fs.readFileSync(concept.absolutePath, 'utf8');
    fs.writeFileSync(concept.absolutePath, updateFrontmatter(original, {
      dart_brief_id: taskId,
      dart_brief_title: options.title,
      dart_brief_dartboard: options.dartboard,
      dart_brief_linked_at: now,
      dart_brief_last_action: action,
      dart_brief_sync_source: 'tools/dart-integration/sync-concepts-to-brief.js',
    }));
  });
  return concepts.map((concept) => concept.path);
}

function persistIdentity(concepts, taskId, options, action) {
  if (!taskId) {
    throw new Error('Cannot persist local Dart identity without a Dart task id.');
  }
  if (options.identitySurface === 'frontmatter') {
    return {
      surface: 'frontmatter',
      path: stampConceptFrontmatter(concepts, taskId, options, action).join(', '),
    };
  }
  return {
    surface: 'registry',
    path: writeIdentityRegistry(options.identityRegistry || DEFAULT_IDENTITY_REGISTRY, concepts, taskId, options, action),
  };
}

async function run(options, deps = {}) {
  const runOptions = {
    title: DEFAULT_TITLE,
    dartboard: DEFAULT_DARTBOARD,
    status: DEFAULT_STATUS,
    type: DEFAULT_TYPE,
    tags: ['mythos', 'concept'],
    report: true,
    checkDart: false,
    execute: false,
    confirmed: false,
    applyDescription: false,
    applyConfirmed: false,
    applyProposal: '',
    legacyPrototype: false,
    identitySurface: DEFAULT_IDENTITY_SURFACE,
    identityRegistry: DEFAULT_IDENTITY_REGISTRY,
    proposalIndex: DEFAULT_PROPOSAL_INDEX,
    proposalIndexEnabled: true,
    ...options,
    projectRoot: options.projectRoot || PROJECT_ROOT,
  };
  runOptions.applyProposal = String(runOptions.applyProposal || '').trim();
  const dartClient = deps.dart || dart;
  const concepts = runOptions.concepts.map((conceptPath) => readConcept(conceptPath, {
    projectRoot: runOptions.projectRoot,
  }));
  const validations = concepts.map((concept) => validateConcept(concept, runOptions));
  const notStable = validations.filter((validation) => !validation.stable_enough);
  if (notStable.length > 0) {
    const details = notStable.map((validation) => `${validation.path}: ${validation.missing.join(', ')}`).join('; ');
    throw new Error(`Concept files are not ready for Dart Brief proposal: ${details}`);
  }

  if (runOptions.execute && !runOptions.confirmed) {
    throw new Error('Refusing Dart mutation. Re-run with --execute --confirmed after reviewing the generated title and description.');
  }
  if (runOptions.execute && runOptions.legacyPrototype) {
    throw new Error('--legacy-prototype is dry-run only and cannot be used with --execute.');
  }
  if (!['registry', 'frontmatter'].includes(runOptions.identitySurface)) {
    throw new Error('--identity-surface must be either registry or frontmatter.');
  }
  if (runOptions.execute && runOptions.identitySurface === 'frontmatter' && !runOptions.identityConfirmed) {
    throw new Error('Refusing concept frontmatter mutation. Re-run with --identity-confirmed after approving identity-stamp-only concept metadata updates.');
  }
  if (runOptions.applyProposal && !runOptions.applyDescription) {
    throw new Error('--apply-proposal can only be used with --apply-description.');
  }
  if (runOptions.applyDescription && runOptions.execute && (!runOptions.confirmed || !runOptions.applyConfirmed || !runOptions.applyProposal)) {
    throw new Error('Refusing reviewed description apply. Re-run with --execute --confirmed --apply-description --apply-confirmed --apply-proposal <path> after reviewing the proposal diff.');
  }
  if (runOptions.applyDescription && !runOptions.execute && !runOptions.checkDart) {
    throw new Error('Refusing description apply proposal without --check-dart; the proposal must include the current Dart description and diff.');
  }

  const description = buildDescription(concepts, runOptions);
  const item = buildTaskItem(description, runOptions);
  let existingTask = null;
  let dartChecked = false;
  let createdTask = null;
  let commentResult = null;
  let identity = null;
  let resolutionSource = '';
  let identityCandidates = [];
  let identityLookups = [];
  let staleIdentity = null;
  let ambiguousIdentity = null;
  let registryReconciliations = [];
  let titleMatched = false;

  if (runOptions.checkDart || runOptions.execute) {
    const resolution = await resolveExistingTask(concepts, runOptions, dartClient);
    existingTask = resolution.existingTask;
    dartChecked = resolution.dartChecked;
    resolutionSource = resolution.resolutionSource;
    identityCandidates = resolution.identityCandidates;
    identityLookups = resolution.identityLookups;
    staleIdentity = resolution.staleIdentity;
    ambiguousIdentity = resolution.ambiguousIdentity;
    registryReconciliations = resolution.registryReconciliations || [];
    titleMatched = resolution.titleMatched;
    runOptions.registryReconciliations = registryReconciliations;
    if (staleIdentity && runOptions.execute) {
      throw new Error(`Refusing Dart mutation because local Dart identity is stale. ${staleIdentity.reason}`);
    }
    if (ambiguousIdentity && runOptions.execute) {
      throw new Error('Refusing Dart mutation because local registry identity reconciliation is ambiguous.');
    }
  }

  let action = runOptions.execute ? 'create' : 'would_create';
  if (existingTask) {
    action = runOptions.execute ? 'comment_existing' : 'would_comment_existing';
  } else if (staleIdentity) {
    action = 'stale_identity';
  } else if (ambiguousIdentity) {
    action = 'ambiguous_identity';
  }
  if (existingTask && runOptions.applyDescription) {
    action = runOptions.execute ? 'apply_description' : 'would_apply_description';
  }
  if (runOptions.applyDescription && !existingTask) {
    throw new Error('Refusing reviewed description apply because no existing Dart Brief was resolved.');
  }

  const reportPath = runOptions.reportPath || defaultReportPath(runOptions.title);
  const generatedAt = new Date().toISOString();
  const normalizedExistingTask = existingTask ? normalizeTask(existingTask) : null;
  const payload = {
    ok: true,
    generated_at: generatedAt,
    dry_run: !runOptions.execute,
    confirmed: runOptions.confirmed,
    title: runOptions.title,
    dartboard: runOptions.dartboard,
    status: runOptions.status,
    type: runOptions.type,
    action,
    dart_checked: dartChecked,
    resolution_source: resolutionSource,
    title_matched: titleMatched,
    ambiguous_identity: ambiguousIdentity,
    registry_reconciliations: registryReconciliations,
    identity_candidates: identityCandidates,
    identity_lookups: identityLookups.map((lookup) => ({
      id: lookup.candidate.id,
      source: lookup.candidate.source,
      concept_path: lookup.candidate.concept_path,
      verified: lookup.verified,
      stale: lookup.stale,
      reason: lookup.reason,
      task_id: lookup.task ? lookup.task.id : '',
      task_title: lookup.task ? lookup.task.title : '',
    })),
    stale_identity: staleIdentity ? {
      id: staleIdentity.candidate.id,
      source: staleIdentity.candidate.source,
      concept_path: staleIdentity.candidate.concept_path,
      reason: staleIdentity.reason,
    } : null,
    existing_task_id: existingTask ? normalizeTask(existingTask).id : '',
    existing_task_description: normalizedExistingTask ? normalizedExistingTask.description : '',
    created_task_id: '',
    commented: false,
    description_apply_requested: Boolean(runOptions.applyDescription),
    description_applied: false,
    description_diff: descriptionDiff(normalizedExistingTask ? normalizedExistingTask.description : '', description),
    apply_proposal_path: runOptions.execute && runOptions.applyDescription ? runOptions.applyProposal : '',
    reviewed_apply_gate_verified: false,
    identity_surface: runOptions.execute ? runOptions.identitySurface : '',
    identity_path: '',
    report_path: runOptions.report ? reportPath : '',
    proposal_status: runOptions.execute ? 'executed' : 'latest',
    proposal_index_path: runOptions.proposalIndexEnabled && runOptions.report ? runOptions.proposalIndex : '',
    concepts: validations,
    item,
  };

  if (runOptions.execute && runOptions.applyDescription) {
    assertDistinctApplyProposalAndReport(runOptions.applyProposal, runOptions.report ? reportPath : '', {
      projectRoot: runOptions.projectRoot,
    });
    verifyReviewedApplyProposal(runOptions.applyProposal, payload, {
      projectRoot: runOptions.projectRoot,
    });
    payload.reviewed_apply_gate_verified = true;
  }

  const shouldWriteInitialReport = runOptions.report && !(runOptions.execute && runOptions.applyDescription);
  if (shouldWriteInitialReport) {
    writeReport(reportPath, payload, description, { projectRoot: runOptions.projectRoot });
    if (runOptions.proposalIndexEnabled) {
      updateProposalIndex(runOptions.proposalIndex, payload, concepts, { projectRoot: runOptions.projectRoot });
    }
  }

  if (runOptions.execute) {
    if (existingTask) {
      const normalized = normalizeTask(existingTask);
      if (!normalized || !normalized.id) {
        throw new Error('Cannot comment existing Dart Brief because the duplicate check returned no task id.');
      }
      if (runOptions.applyDescription) {
        if (typeof dartClient.updateTask !== 'function') {
          throw new Error('Refusing reviewed description apply because the Dart client does not expose updateTask.');
        }
        await dartClient.updateTask(normalized.id, { id: normalized.id, description });
        payload.description_applied = true;
        identity = persistIdentity(concepts, normalized.id, runOptions, 'apply_description');
      } else {
        const comment = [
          `Concept-to-Dart sync found this existing Brief for \`${runOptions.title}\`.`,
          `Resolution source: \`${resolutionSource || 'unknown'}\`.`,
          payload.report_path ? `Proposal artifact: \`${payload.report_path}\`` : '',
          'Reviewed update path: this automation did not overwrite the Dart description; review the proposal before merging any description changes.',
          `Source concepts: ${concepts.map((concept) => `\`${concept.path}\``).join(', ')}`,
        ].filter(Boolean).join('\n');
        commentResult = await dartClient.addComment(normalized.id, comment);
        payload.commented = Boolean(commentResult);
        identity = persistIdentity(concepts, normalized.id, runOptions, 'comment_existing');
      }
    } else {
      createdTask = normalizeTask(await dartClient.createTask(item));
      payload.created_task_id = createdTask ? createdTask.id : '';
      identity = persistIdentity(concepts, payload.created_task_id, runOptions, 'create');
    }
    if (identity) {
      payload.identity_surface = identity.surface;
      payload.identity_path = identity.path;
    }
    if (runOptions.report) {
      writeReport(reportPath, payload, description, { projectRoot: runOptions.projectRoot });
      if (runOptions.proposalIndexEnabled) {
        updateProposalIndex(runOptions.proposalIndex, payload, concepts, { projectRoot: runOptions.projectRoot });
      }
    }
  }

  return payload;
}

function printResult(result, options) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Dart concept Brief sync: ${result.action}`);
  console.log(`- title: ${result.title}`);
  console.log(`- dartboard: ${result.dartboard}`);
  console.log(`- concepts: ${result.concepts.length}`);
  if (result.report_path) console.log(`- report: ${result.report_path}`);
  if (result.existing_task_id) console.log(`- existing task: dart:${result.existing_task_id}`);
  if (result.created_task_id) console.log(`- created task: dart:${result.created_task_id}`);
  if (result.resolution_source) console.log(`- resolution: ${result.resolution_source}`);
  if (result.stale_identity) console.log(`- stale identity: dart:${result.stale_identity.id} (${result.stale_identity.reason})`);
  if (result.identity_path) console.log(`- identity: ${result.identity_surface} -> ${result.identity_path}`);
  if (!result.dart_checked) console.log('- Dart was not queried; pass --check-dart to check for an existing matching task.');
  if (result.dry_run) console.log('- dry-run only; no Dart mutation performed.');
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    usage();
    return;
  }
  const result = await run(options);
  printResult(result, options);
}

if (require.main === module) {
  main().catch((error) => {
    if (process.argv.includes('--json')) {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    } else {
      console.error(`ERROR: ${error.message}`);
    }
    process.exit(1);
  });
}

module.exports = {
  buildDescription,
  buildTaskItem,
  conceptContentFingerprint,
  conceptIdentityKey,
  descriptionDiff,
  descriptionApplyGate,
  extractSection,
  findExistingTask,
  firstListItem,
  firstParagraph,
  localIdentityCandidates,
  localIdentityResolution,
  loadIdentityRegistry,
  loadProposalIndex,
  loadReviewedApplyProposal,
  parseArgs,
  parseFrontmatter,
  persistIdentity,
  readConcept,
  resolveExistingTask,
  resolveRepoPath,
  run,
  updateProposalIndex,
  updateFrontmatter,
  validateConcept,
  verifyReviewedApplyProposal,
  writeIdentityRegistry,
};
