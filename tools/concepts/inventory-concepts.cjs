'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Optional config file, sibling to this script: inventory-concepts.config.json
 *
 * This tool ships with NO operator-specific routing data baked in. Every guild
 * that runs it against its own `_dev/concepts` populates its own config with
 * its own semantic-owner routing, closure-review notes, and owner-group
 * display order. See inventory-concepts.config.example.json for the schema
 * and one fully worked fictional example.
 *
 * Config shape:
 * {
 *   "parent_plan_id": "concept-program-inventory-and-implementation-order",
 *   "memory_mirror_root": null,                // optional sibling mirror repo, e.g. "../my-memories/concepts"
 *   "semantic_owner_rules": [
 *     { "pattern": "^my-concept-slug$", "owner_plan": "my-owner-plan-id",
 *       "owner_path": "_dev/reports/analysis/task-plans/my-owner-plan-id__plan.json",
 *       "route": "/amend-plan my-owner-plan-id" }
 *   ],
 *   "closure_review_rules": [
 *     { "pattern": "^some-superseded-slug$", "reason": "..." }
 *   ],
 *   "owner_group_priority_order": ["my-owner-plan-id", "..."],
 *   "reviewer_actor_id": "distinct-family-reviewer",
 *   "reviewer_harness_id": "external-cli"
 * }
 */
function loadConfig() {
  const configPath = path.join(__dirname, 'inventory-concepts.config.json');
  const defaults = {
    parent_plan_id: 'concept-program-inventory-and-implementation-order',
    memory_mirror_root: null,
    semantic_owner_rules: [],
    closure_review_rules: [],
    owner_group_priority_order: [],
    reviewer_actor_id: 'distinct-family-reviewer',
    reviewer_harness_id: 'external-cli'
  };
  if (!fs.existsSync(configPath)) return defaults;
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return { ...defaults, ...raw };
  } catch (_) {
    return defaults;
  }
}

const CONFIG = loadConfig();

const REPO_ROOT = process.cwd();
const SYSTEM_CONCEPT_ROOT = path.join(REPO_ROOT, '_dev/concepts');
const MEMORY_CONCEPT_ROOT = CONFIG.memory_mirror_root ? path.join(REPO_ROOT, CONFIG.memory_mirror_root) : null;
const SYSTEM_PLAN_ROOT = path.join(REPO_ROOT, '_dev/reports/analysis/task-plans');
const MEMORY_PLAN_ROOT = CONFIG.memory_mirror_root
  ? path.join(REPO_ROOT, CONFIG.memory_mirror_root, '..', 'reports/task-plans')
  : null;
const OUT_ROOT = path.join(REPO_ROOT, '_dev/reports/analysis/concept-inventory');
const CONVENE_ROOT = path.join(REPO_ROOT, '_dev/reports/analysis/convene-runs');
const PARENT_PLAN_ID = CONFIG.parent_plan_id;
const PARENT_PLAN_JSON = path.join(SYSTEM_PLAN_ROOT, `${PARENT_PLAN_ID}__plan.json`);
const PARENT_PLAN_MD = path.join(SYSTEM_PLAN_ROOT, `${PARENT_PLAN_ID}__plan.md`);
const FANOUT_RUNBOOK_JSON = path.join(OUT_ROOT, 'concept-fanout-runbook.json');
const FANOUT_RUNBOOK_MD = path.join(OUT_ROOT, 'concept-fanout-runbook.md');
const FANOUT_STATUS_JSON = path.join(OUT_ROOT, 'concept-fanout-status.json');
const FANOUT_STATUS_MD = path.join(OUT_ROOT, 'concept-fanout-status.md');
const TASK_PLAN_REVIEW_ROOT = path.join(REPO_ROOT, '_dev/reports/analysis/task-plan-reviews');

function amendmentSuffix() {
  return `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}__concept-inventory-fold`;
}

const CLOSED_STAGES = new Set([
  'implemented',
  'archived',
  'closed',
  'done',
  'complete',
  'source-material'
]);

const IGNORE_SLUGS = new Set([
  '_README',
  '_policy'
  // Add your own repo-specific non-concept filenames/dirs here (session-log
  // dumps, personal codename docs, etc.) that live under _dev/concepts but
  // aren't concept records.
]);

const CATEGORY_RULES = [
  ['continuity', /context|cross-session|session-boundary|handoff|resume|continuity|shutdown|next-session|rest/i],
  ['governance', /custody|gate|authority|permission|policy|law|safety|operator|debrief|closeout|evidence/i],
  ['orchestration', /orchestr|submind|actor|bridge|dispatch|router|worker|mind|council|convene|recursive/i],
  ['planning-visibility', /plan|task|dart|visibility|diagram|brief|concept-registry|breadcrumb/i],
  ['harness-runtime', /harness|reviewer-cli|claude|pi|gemini|opencode|hermes|cli|terminal|launcher/i],
  ['memory-retrieval', /memory|retrieval|dream|obsidian|vault|ledger|anchor/i],
  ['compute-infrastructure', /compute|host|vps|cloud|body|fabric|node|windows|local-model|ollama/i],
  ['frameworks', /framework|skill|capture|promotion|methodology|component|reusable/i],
  ['client-delivery', /client|patron|dealer|ads|ad-|marketing|reporting|wordpress|meta|google/i],
  ['voice-interface', /voice|speech|audio|mic|conversation|twilio|stt|tts/i],
  ['design-surface', /design|mockup|shadcn|visual|token|builder|dashboard|portal|ui/i],
  ['world-modeling', /world|simulation|life|personhood|conscious|doctrine|kernel|philosophy/i]
];

const PRIORITY_RULES = [
  ['P0', /context|cross-session|session-boundary|handoff|continuity|custody|debrief|permission|operator|repo-awareness|plan.*visibility|concept.*registry|dart.*brief|harness.*parity|bridge.*review/i],
  ['P1', /orchestr|submind|router|dispatch|memory|retrieval|framework|compute|body|host|cloud|voice|dashboard|ledger/i],
  ['P2', /client|patron|ads|marketing|design|portal|skill|api|mcp|reporting|creative/i]
];

// Populated from config (empty by default — see the header comment for the
// documented schema and inventory-concepts.config.example.json for a worked
// fictional example).
const SEMANTIC_OWNER_RULES = CONFIG.semantic_owner_rules.map((rule) => ({
  ...rule,
  pattern: new RegExp(rule.pattern)
}));

const CLOSURE_REVIEW_RULES = CONFIG.closure_review_rules.map((rule) => ({
  ...rule,
  pattern: new RegExp(rule.pattern)
}));

function listFiles(root) {
  if (!root || !fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function rel(file) {
  return path.relative(REPO_ROOT, file);
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return '';
  }
}

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch (_) {
    return null;
  }
}

function titleFromMarkdown(file, fallback) {
  const text = readText(file);
  const h1 = text.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return fallback.split('-').map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(' ');
}

function conceptRecords(root, source) {
  const records = new Map();
  if (!root || !fs.existsSync(root)) return records;

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '_templates' || entry.name === '_recovered' || entry.name === 'pattern-preservations') continue;
    const full = path.join(root, entry.name);
    let slug;
    let conceptPath;
    let statusPath;

    if (entry.isDirectory()) {
      slug = entry.name;
      conceptPath = path.join(full, 'concept.md');
      statusPath = path.join(full, 'status.json');
      if (!fs.existsSync(conceptPath) && !fs.existsSync(statusPath)) continue;
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      slug = entry.name.replace(/\.md$/, '');
      conceptPath = full;
    } else {
      continue;
    }

    if (IGNORE_SLUGS.has(slug)) continue;

    const status = statusPath && fs.existsSync(statusPath) ? readJson(statusPath) : null;
    const title = conceptPath && fs.existsSync(conceptPath) ? titleFromMarkdown(conceptPath, slug) : slug;
    const stage = String(status?.stage || status?.status || '').trim();
    const nextAction = status?.next_action || status?.next || '';
    const keyText = `${slug} ${title} ${stage} ${nextAction}`;

    records.set(slug, {
      slug,
      source,
      title,
      concept_path: conceptPath && fs.existsSync(conceptPath) ? rel(conceptPath) : null,
      status_path: statusPath && fs.existsSync(statusPath) ? rel(statusPath) : null,
      stage,
      next_action: nextAction,
      updated: status?.updated || status?.last_updated || '',
      dart_task_id: status?.dart?.task_id || status?.dart_task_id || '',
      category: categorize(keyText),
      priority: prioritize(keyText, stage),
      closed: CLOSED_STAGES.has(stage.toLowerCase())
    });
  }

  return records;
}

function categorize(text) {
  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(text)) return category;
  }
  return 'general-system';
}

function prioritize(text, stage) {
  if (CLOSED_STAGES.has(String(stage).toLowerCase())) return 'closed';
  for (const [priority, pattern] of PRIORITY_RULES) {
    if (pattern.test(text)) return priority;
  }
  return 'P3';
}

function planIndex() {
  const index = new Map();
  for (const [root, kind] of [[SYSTEM_PLAN_ROOT, 'system'], [MEMORY_PLAN_ROOT, 'memory']]) {
    for (const file of listFiles(root)) {
      const base = path.basename(file);
      const match = base.match(/^(.+?)__(plan|amendment|repair)(?:__.*)?\.(json|md|warning)$/);
      if (!match) continue;
      const slug = match[1];
      const rec = index.get(slug) || { system: [], memory: [], seen_basenames: new Set() };
      const pathRel = rel(file);
      if (kind === 'system') {
        rec.system.push(pathRel);
        rec.seen_basenames.add(base);
      } else if (!rec.seen_basenames.has(base)) {
        rec.memory.push(pathRel);
      }
      index.set(slug, rec);
    }
  }
  for (const rec of index.values()) {
    rec.system = sortPlanPaths(rec.system);
    rec.memory = sortPlanPaths(rec.memory);
  }
  return index;
}

function sortPlanPaths(paths) {
  return [...paths].sort((a, b) => planPathRank(a) - planPathRank(b) || a.localeCompare(b));
}

function planPathRank(planPath) {
  const base = path.basename(planPath);
  if (/__plan\.json$/.test(base)) return 0;
  if (/__plan\.md$/.test(base)) return 1;
  if (/__amendment__.*\.json$/.test(base)) return 2;
  if (/__amendment__.*\.md$/.test(base)) return 3;
  if (/__repair__.*\.json$/.test(base)) return 4;
  if (/__repair__.*\.md$/.test(base)) return 5;
  return 9;
}

function semanticOwnerFor(slug) {
  return SEMANTIC_OWNER_RULES.find((rule) => rule.pattern.test(slug)) || null;
}

function closureReviewFor(slug) {
  return CLOSURE_REVIEW_RULES.find((rule) => rule.pattern.test(slug)) || null;
}

function actionFor(record) {
  if (record.closed) return 'closed-or-implemented';
  if (record.closure_review_reason) return 'closure-or-supersession-review';
  if (record.plan_paths.length > 0) return 'review-or-amend-existing-plan';
  if (record.semantic_owner_plan) return 'review-or-amend-semantic-owner';
  if (record.priority === 'P0' || record.priority === 'P1') return 'needs-plan-task';
  return 'inventory-backlog';
}

function mergeRecords() {
  const system = conceptRecords(SYSTEM_CONCEPT_ROOT, 'system');
  const memory = conceptRecords(MEMORY_CONCEPT_ROOT, 'memory-mirror');
  const plans = planIndex();
  const slugs = new Set([...system.keys(), ...memory.keys()]);
  const out = [];

  for (const slug of [...slugs].sort()) {
    const primary = system.get(slug) || memory.get(slug);
    const mirror = system.has(slug) && memory.has(slug);
    const planRecord = plans.get(slug) || { system: [], memory: [] };
    const planPaths = [...planRecord.system, ...planRecord.memory];
    const record = {
      ...primary,
      mirror_present: mirror,
      plan_paths: planPaths,
      system_plan_paths: planRecord.system,
      memory_plan_paths: planRecord.memory
    };
    const semanticOwner = semanticOwnerFor(slug);
    if (semanticOwner && fs.existsSync(path.join(REPO_ROOT, semanticOwner.owner_path))) {
      record.semantic_owner_plan = semanticOwner.owner_plan;
      record.semantic_owner_path = semanticOwner.owner_path;
      record.recommended_route = semanticOwner.route;
    }
    const closureReview = closureReviewFor(slug);
    if (closureReview) {
      record.closure_review_reason = closureReview.reason;
      record.recommended_route = `/review-progress ${record.concept_path || record.status_path}`;
    }
    record.action = actionFor(record);
    out.push(record);
  }

  return out;
}

function groupCounts(records, key) {
  const counts = {};
  for (const record of records) counts[record[key]] = (counts[record[key]] || 0) + 1;
  return counts;
}

function markdown(records) {
  const outstanding = records.filter((record) => record.action !== 'closed-or-implemented');
  const p0 = outstanding.filter((record) => record.priority === 'P0');
  const needsPlan = outstanding.filter((record) => record.action === 'needs-plan-task');
  const amend = outstanding.filter((record) => record.action === 'review-or-amend-existing-plan' || record.action === 'review-or-amend-semantic-owner');
  const lines = [];

  lines.push('# Mythos Concept Inventory');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total concept records: ${records.length}`);
  lines.push(`- Outstanding concept records: ${outstanding.length}`);
  lines.push(`- P0 system-build concepts: ${p0.length}`);
  lines.push(`- Concepts needing new /plan-task: ${needsPlan.length}`);
  lines.push(`- Concepts with exact or semantic owner plans to review/amend: ${amend.length}`);
  lines.push('');
  lines.push('## Counts By Priority');
  lines.push('');
  for (const [key, value] of Object.entries(groupCounts(records, 'priority')).sort()) lines.push(`- ${key}: ${value}`);
  lines.push('');
  lines.push('## Counts By Category');
  lines.push('');
  for (const [key, value] of Object.entries(groupCounts(outstanding, 'category')).sort()) lines.push(`- ${key}: ${value}`);
  lines.push('');
  lines.push('## Recommended Implementation Waves');
  lines.push('');
  lines.push('1. Continuity, custody, and operator gates: prevent context loss, duplicate work, or unsafe commits before adding more capability.');
  lines.push('2. Planning visibility and Dart concept registry: make all plans inspectable and correctable by the human operator.');
  lines.push('3. Orchestration and bridge/harness parity: make actor routing consistent across Claude, Codex, Pi, Gemini, and managed launchers.');
  lines.push('4. Memory/retrieval and repo-awareness: improve what each new session can reliably know without chat memory.');
  lines.push('5. Compute/host fabric and voice/interface features: expand capability only after the governance and visibility substrate can observe it.');
  lines.push('6. Client-delivery and creative/product concepts: implement as framework or client-work improvements once system custody is stable.');
  lines.push('');
  lines.push('## P0 Concepts');
  lines.push('');
  lines.push('| Concept | Category | Action | Owner plan | Source |');
  lines.push('|---|---|---|---|---|');
  for (const record of p0) {
    lines.push(`| ${record.slug} | ${record.category} | ${record.action} | ${record.plan_paths[0] || record.semantic_owner_path || ''} | ${record.concept_path || record.status_path || ''} |`);
  }
  lines.push('');
  lines.push('## Outstanding Inventory');
  lines.push('');
  lines.push('| Priority | Concept | Category | Stage | Action | Owner plan count | Source |');
  lines.push('|---|---|---|---|---|---:|---|');
  for (const record of outstanding.sort((a, b) => `${a.priority}:${a.category}:${a.slug}`.localeCompare(`${b.priority}:${b.category}:${b.slug}`))) {
    const ownerCount = record.plan_paths.length || (record.semantic_owner_plan ? 1 : 0);
    lines.push(`| ${record.priority} | ${record.slug} | ${record.category} | ${record.stage || ''} | ${record.action} | ${ownerCount} | ${record.concept_path || record.status_path || ''} |`);
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- This inventory is heuristic: it classifies from slug/title/first body text plus `status.json` where available.');
  lines.push('- Existing plans should be reviewed or amended before creating parallel plans.');
  lines.push('- your configured `memory_mirror_root` (if set) is treated as a mirror/source surface; `_dev/concepts` wins when both exist.');
  return lines.join('\n') + '\n';
}

function childPlanQueue(records) {
  const open = records.filter((record) => record.action !== 'closed-or-implemented');
  const p0 = open.filter((record) => record.priority === 'P0');
  const p1 = open.filter((record) => record.priority === 'P1');
  const ownerGroups = new Map();

  for (const record of open) {
    if (record.action !== 'review-or-amend-existing-plan' && record.action !== 'review-or-amend-semantic-owner') continue;
    const owner = record.semantic_owner_plan || ownerFromPlanPath(record.plan_paths[0]) || record.slug;
    const group = ownerGroups.get(owner) || {
      owner_plan: owner,
      route: record.recommended_route || `/review-task-plan ${owner}`,
      owner_path: record.semantic_owner_path || record.plan_paths[0] || null,
      priority_floor: record.priority,
      concepts: []
    };
    group.concepts.push({
      slug: record.slug,
      priority: record.priority,
      category: record.category,
      action: record.action,
      concept_path: record.concept_path
    });
    group.priority_floor = minPriority(group.priority_floor, record.priority);
    ownerGroups.set(owner, group);
  }

  const closureReviewCandidates = open
    .filter((record) => record.action === 'closure-or-supersession-review')
    .map((record) => ({
      slug: record.slug,
      priority: record.priority,
      category: record.category,
      concept_path: record.concept_path,
      recommended_route: record.recommended_route,
      reason: record.closure_review_reason
    }));

  const p0NewPlanCandidates = p0
    .filter((record) => record.action === 'needs-plan-task')
    .map((record) => ({
      slug: record.slug,
      category: record.category,
      stage: record.stage,
      concept_path: record.concept_path,
      recommended_route: `/plan-task --scope system ${record.slug}`,
      investigation_note: investigationNote(record)
    }));

  const p1Clusters = [];
  const p1NeedsPlan = p1.filter((record) => record.action === 'needs-plan-task');
  for (const category of [...new Set(p1NeedsPlan.map((record) => record.category))].sort()) {
    const concepts = p1NeedsPlan.filter((record) => record.category === category);
    p1Clusters.push({
      cluster_id: `p1-${category}`,
      category,
      recommended_route: `/plan-task --scope system p1-${category}-concept-cluster`,
      concepts: concepts.map((record) => ({
        slug: record.slug,
        action: record.action,
        owner_plan: record.semantic_owner_plan || ownerFromPlanPath(record.plan_paths[0]) || null,
        concept_path: record.concept_path
      }))
    });
  }

  const implementationFlow = [
    {
      wave: 0,
      name: 'Parent review and convene gate',
      route: `/review-task-plan ${PARENT_PLAN_ID}; /convene ${PARENT_PLAN_ID}`,
      rationale: 'Ratify the parent source of truth and resolve triad findings before fanout.'
    },
    {
      wave: 1,
      name: 'Existing owner-plan amendments',
      route: 'Run the owner_plan_groups in priority order.',
      rationale: 'Avoid duplicate plans; fold concepts into existing authority surfaces first.'
    },
    {
      wave: 2,
      name: 'Remaining P0 new plan-task candidates',
      route: 'Run p0_new_plan_candidates after overlap checks.',
      rationale: 'Create new plans only where no exact or semantic owner applies.'
    },
    {
      wave: 3,
      name: 'P1 concept cluster planning',
      route: 'Run p1_clusters by category.',
      rationale: 'Batch related concepts into cluster plans instead of one plan per minor concept.'
    },
    {
      wave: 4,
      name: 'P2/P3 backlog disposition',
      route: '/review-progress _dev/reports/analysis/concept-inventory/mythos-concepts-inventory.md',
      rationale: 'Defer client-delivery, source-material, and low-priority concepts until system custody and visibility are stable.'
    }
  ];

  return {
    schema: 'ConceptChildPlanQueue/1.0',
    generated_at: new Date().toISOString(),
    parent_task_id: PARENT_PLAN_ID,
    implementation_flow: implementationFlow,
    owner_plan_groups: [...ownerGroups.values()].sort(ownerGroupSort),
    closure_review_candidates: closureReviewCandidates,
    p0_new_plan_candidates: p0NewPlanCandidates,
    p1_clusters: p1Clusters,
    counts: {
      owner_plan_groups: ownerGroups.size,
      closure_review_candidates: closureReviewCandidates.length,
      p0_new_plan_candidates: p0NewPlanCandidates.length,
      p1_clusters: p1Clusters.length
    }
  };
}

function ownerGroupSort(a, b) {
  return ownerGroupRank(a) - ownerGroupRank(b)
    || priorityRank(a.priority_floor) - priorityRank(b.priority_floor)
    || a.owner_plan.localeCompare(b.owner_plan);
}

function ownerGroupRank(group) {
  // Populated from config.owner_group_priority_order (empty by default) —
  // unlisted owner plans fall through to the priority+alpha tie-break in
  // ownerGroupSort.
  const idx = CONFIG.owner_group_priority_order.indexOf(group.owner_plan);
  return idx === -1 ? 100 : idx;
}

function ownerFromPlanPath(planPath) {
  if (!planPath) return null;
  const match = path.basename(planPath).match(/^(.+?)__(plan|amendment|repair)/);
  return match ? match[1] : null;
}

function priorityRank(priority) {
  return { P0: 0, P1: 1, P2: 2, P3: 3, closed: 9 }[priority] ?? 8;
}

function minPriority(a, b) {
  return priorityRank(a) <= priorityRank(b) ? a : b;
}

function investigationNote(record) {
  if (record.stage === 'folded') return 'Verify fold target before creating a new plan.';
  if (/retirement/i.test(record.slug)) return 'Check whether this is superseded by the newer frontier-fable-removal proposal before planning.';
  if (/transcript/i.test(record.slug)) return 'Check privacy/operator-gate requirements before planning.';
  return 'Run existing-work overlap and create a bounded system-scope plan only if no owner applies.';
}

function routingNote(record) {
  if (record.action === 'review-or-amend-existing-plan') return 'Existing plan found; review or amend that owner instead of creating a duplicate plan.';
  if (record.action === 'review-or-amend-semantic-owner') return 'Semantic owner route found; amend or review that owner instead of creating a duplicate plan.';
  return investigationNote(record);
}

function childQueueMarkdown(queue) {
  const lines = [];
  lines.push('# Mythos Concept Child Plan Queue');
  lines.push('');
  lines.push(`Generated: ${queue.generated_at}`);
  lines.push(`Parent task: ${queue.parent_task_id}`);
  lines.push('');
  lines.push('## Implementation Flow');
  lines.push('');
  for (const item of queue.implementation_flow) {
    lines.push(`${item.wave}. ${item.name}`);
    lines.push(`   Route: ${item.route}`);
    lines.push(`   Rationale: ${item.rationale}`);
  }
  lines.push('');
  lines.push('## Owner Plan Groups');
  lines.push('');
  lines.push('| Owner plan | Route | Priority | Concepts |');
  lines.push('|---|---|---|---:|');
  for (const group of queue.owner_plan_groups) {
    lines.push(`| ${group.owner_plan} | ${group.route} | ${group.priority_floor} | ${group.concepts.length} |`);
  }
  lines.push('');
  lines.push('## Closure / Supersession Review');
  lines.push('');
  lines.push('| Concept | Priority | Route | Reason |');
  lines.push('|---|---|---|---|');
  for (const concept of queue.closure_review_candidates) {
    lines.push(`| ${concept.slug} | ${concept.priority} | ${concept.recommended_route} | ${concept.reason} |`);
  }
  lines.push('');
  lines.push('## P0 New Plan Candidates');
  lines.push('');
  lines.push('| Concept | Category | Route | Investigation note |');
  lines.push('|---|---|---|---|');
  for (const concept of queue.p0_new_plan_candidates) {
    lines.push(`| ${concept.slug} | ${concept.category} | ${concept.recommended_route} | ${concept.investigation_note} |`);
  }
  lines.push('');
  lines.push('## P1 Clusters');
  lines.push('');
  lines.push('| Cluster | Route | Concepts |');
  lines.push('|---|---|---:|');
  for (const cluster of queue.p1_clusters) {
    lines.push(`| ${cluster.cluster_id} | ${cluster.recommended_route} | ${cluster.concepts.length} |`);
  }
  return lines.join('\n') + '\n';
}

function routeForRecord(record) {
  if (record.closure_review_reason || record.recommended_route) return record.recommended_route;
  const owner = record.semantic_owner_plan || ownerFromPlanPath(record.plan_paths[0]);
  if (owner) return `/review-task-plan ${owner}`;
  if (record.action === 'needs-plan-task') return `/plan-task --scope system ${record.slug}`;
  return null;
}

function latestParentConveneReview() {
  if (!fs.existsSync(CONVENE_ROOT)) return null;
  const matches = fs.readdirSync(CONVENE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(`-${PARENT_PLAN_ID}-parent-review`))
    .map((entry) => path.join(CONVENE_ROOT, entry.name, 'synthesis.md'))
    .filter((file) => fs.existsSync(file))
    .sort((a, b) => b.localeCompare(a));
  return matches[0] ? rel(matches[0]) : null;
}

function latestParentTaskPlanReview() {
  const reviewPath = path.join(TASK_PLAN_REVIEW_ROOT, `${PARENT_PLAN_ID}__review.md`);
  return fs.existsSync(reviewPath) ? rel(reviewPath) : null;
}

function buildParentPlan(records, queue, inventoryPayload) {
  const existing = readJson(PARENT_PLAN_JSON) || {};
  const latestConveneReview = latestParentConveneReview();
  const latestTaskPlanReview = latestParentTaskPlanReview();
  const outstanding = records.filter((record) => record.action !== 'closed-or-implemented');
  const p0 = outstanding.filter((record) => record.priority === 'P0');
  const p1 = outstanding.filter((record) => record.priority === 'P1');
  const ownerGroups = {};

  for (const group of queue.owner_plan_groups) {
    ownerGroups[group.owner_plan] = group.concepts.map((concept) => concept.slug);
  }

  const conceptRow = (record) => ({
    slug: record.slug,
    category: record.category,
    action: record.action,
    owner_plan: record.semantic_owner_plan || ownerFromPlanPath(record.plan_paths[0]) || null,
    owner_path: record.semantic_owner_path || record.plan_paths[0] || null,
    recommended_route: routeForRecord(record),
    investigation_note: record.closure_review_reason || routingNote(record),
    source: record.concept_path || record.status_path || null
  });

  return {
    schema: 'TaskPlan/1.0',
    task_id: PARENT_PLAN_ID,
    title: 'Mythos Concept Program Inventory and Implementation Order',
    task_summary: 'Parent source-of-truth plan for outstanding Mythos concepts: inventory, priority, owner-plan routing, and implementation sequence.',
    scope_type: 'system',
    scope_justification: 'The work governs Mythos concept promotion, system-build ordering, planning surfaces, and cross-harness implementation sequencing.',
    storage_root: '_dev/reports/analysis/task-plans',
    origin_client_code: null,
    origin_project_id: null,
    description: 'Review the full concept surface, avoid duplicate concept plans, route concepts to existing owner plans where possible, and sequence remaining /plan-task work into an overarching Mythos system-build program.',
    source: 'operator',
    requested_by: 'human operator',
    timestamp: existing.timestamp || new Date().toISOString(),
    current_state: `Generated concept inventory exists at _dev/reports/analysis/concept-inventory/mythos-concepts-inventory.{json,md}. It currently finds ${inventoryPayload.counts.total} concept records, ${inventoryPayload.counts.outstanding} outstanding, ${inventoryPayload.counts.by_priority.P0 || 0} P0, ${inventoryPayload.counts.by_priority.P1 || 0} P1, ${queue.counts.owner_plan_groups} owner-plan groups, ${queue.counts.closure_review_candidates} closure/supersession reviews, ${queue.counts.p0_new_plan_candidates} P0 new-plan candidates, and ${queue.counts.p1_clusters} P1 planning clusters.`,
    question_work: 'Create the parent implementation plan and routing queue for outstanding Mythos concepts, then use it to drive /amend-plan, /review-task-plan, /review-progress, or /plan-task batches without duplicating existing owning plans.',
    desired_state: 'The human operator has one parent source of truth that orders concept implementation, names high-priority goals, identifies concepts needing investigation, and maps each concept to either an owner-plan amendment/review, closure/supersession review, or a new bounded /plan-task.',
    parent_task_id: null,
    scope_identity: {
      owned_artifacts: [
        'tools/concepts/inventory-concepts.cjs',
        '_dev/reports/analysis/concept-inventory/mythos-concepts-inventory.json',
        '_dev/reports/analysis/concept-inventory/mythos-concepts-inventory.md',
        '_dev/reports/analysis/concept-inventory/concept-child-plan-queue.json',
        '_dev/reports/analysis/concept-inventory/concept-child-plan-queue.md',
        '_dev/reports/analysis/concept-inventory/concept-fanout-runbook.json',
        '_dev/reports/analysis/concept-inventory/concept-fanout-runbook.md',
        '_dev/reports/analysis/concept-inventory/concept-fanout-status.json',
        '_dev/reports/analysis/concept-inventory/concept-fanout-status.md',
        `_dev/reports/analysis/task-plans/${PARENT_PLAN_ID}__plan.json`,
        `_dev/reports/analysis/task-plans/${PARENT_PLAN_ID}__plan.md`
      ],
      advisory_artifacts: [
        '_dev/reports/analysis/concept-inventory/distinct-family-reviewer-inventory-review.md',
        '_dev/reports/analysis/concept-inventory/distinct-family-reviewer-child-queue-review.md',
        latestConveneReview,
        latestTaskPlanReview
      ].filter(Boolean)
    },
    inventory_evidence: {
      inventory_json: '_dev/reports/analysis/concept-inventory/mythos-concepts-inventory.json',
      inventory_md: '_dev/reports/analysis/concept-inventory/mythos-concepts-inventory.md',
      inventory_tool: 'tools/concepts/inventory-concepts.cjs',
      submind_review: '_dev/reports/analysis/concept-inventory/distinct-family-reviewer-inventory-review.md',
      submind_review_status: 'historical-pre-refresh-provenance',
      child_queue_json: '_dev/reports/analysis/concept-inventory/concept-child-plan-queue.json',
      child_queue_md: '_dev/reports/analysis/concept-inventory/concept-child-plan-queue.md',
      fanout_runbook_json: '_dev/reports/analysis/concept-inventory/concept-fanout-runbook.json',
      fanout_runbook_md: '_dev/reports/analysis/concept-inventory/concept-fanout-runbook.md',
      fanout_status_json: '_dev/reports/analysis/concept-inventory/concept-fanout-status.json',
      fanout_status_md: '_dev/reports/analysis/concept-inventory/concept-fanout-status.md',
      child_queue_review: '_dev/reports/analysis/concept-inventory/distinct-family-reviewer-child-queue-review.md',
      child_queue_review_status: 'historical-pre-refresh-provenance',
      latest_convene_review: latestConveneReview,
      latest_task_plan_review: latestTaskPlanReview
    },
    concept_counts: inventoryPayload.counts,
    owner_groups: ownerGroups,
    high_priority_concepts: p0
      .sort((a, b) => `${a.action}:${a.category}:${a.slug}`.localeCompare(`${b.action}:${b.category}:${b.slug}`))
      .map(conceptRow),
    p1_concepts: p1
      .sort((a, b) => `${a.category}:${a.slug}`.localeCompare(`${b.category}:${b.slug}`))
      .map(conceptRow),
    child_plan_queue: {
      path: '_dev/reports/analysis/concept-inventory/concept-child-plan-queue.json',
      counts: queue.counts,
      implementation_flow: queue.implementation_flow,
      closure_review_candidates: queue.closure_review_candidates,
      p0_new_plan_candidates: queue.p0_new_plan_candidates,
      p1_clusters: queue.p1_clusters.map((cluster) => ({
        cluster_id: cluster.cluster_id,
        child_task_id: clusterPlanId(cluster),
        category: cluster.category,
        recommended_route: cluster.recommended_route,
        review_route: `/review-task-plan ${clusterPlanId(cluster)}`,
        concept_count: cluster.concepts.length
      }))
    },
    bounded_plan: {
      steps: [
        {
          step_id: 'S0-parent-kernel-review',
          mode: 'REVIEW_ONLY',
          is_gap: false,
          id: 'S0-parent-kernel-review',
          description: 'Review this parent source of truth before spawning new concept plans. Confirm the surface taxonomy and authority model: canonical source, event, derived view/cache, advisory memory, deprecated/ambiguous.',
          command: `/review-task-plan ${PARENT_PLAN_ID}`,
          outputs: ['review verdict or amendment notes for this parent plan'],
          gate: 'Operator reviews whether this parent remains the right integrator.'
        },
        {
          step_id: 'S0b-convene-and-bridge-review',
          mode: 'REVIEW_ONLY',
          is_gap: true,
          id: 'S0b-convene-and-bridge-review',
          description: 'Run /convene on the parent ordering and bridge review for consequential owner-plan changes before implementation begins.',
          command: `/convene ${PARENT_PLAN_ID}`,
          outputs: ['convene synthesis', 'bridge review artifact if owner-plan amendments change hooks, gates, or authority'],
          gate: 'Consequence-grade parent ordering and code-bearing child changes require distinct-mind review before implementation.'
        },
        {
          step_id: 'S1-existing-owner-plan-routing',
          mode: 'REVIEW_ONLY',
          is_gap: false,
          id: 'S1-existing-owner-plan-routing',
          description: 'Route first-wave concepts into existing owner plans instead of creating duplicates. Start with P0 owner-plan groups and then P1 owner-plan groups.',
          commands: queue.owner_plan_groups
            .filter((group) => ['P0', 'P1'].includes(group.priority_floor))
            .map((group) => group.route),
          outputs: ['amendment/review artifacts for owner plans', 'updated concept-to-plan routing table'],
          gate: 'Do not create a new /plan-task for any concept that cleanly belongs to an owner plan.'
        },
        {
          step_id: 'S2-closure-supersession-review',
          mode: 'REVIEW_ONLY',
          is_gap: true,
          id: 'S2-closure-supersession-review',
          description: 'Review folded or likely superseded P0 concepts before creating any new plans.',
          commands: queue.closure_review_candidates.map((concept) => concept.recommended_route),
          outputs: ['closure, supersession, or fold-target note per candidate'],
          gate: 'Operator approval is required before closing or superseding concept surfaces.'
        },
        {
          step_id: 'S3-new-p0-plan-tasks',
          mode: 'REVIEW_ONLY',
          is_gap: true,
          id: 'S3-new-p0-plan-tasks',
          description: 'Create bounded /plan-task artifacts only for P0 concepts with no exact or semantic owner after overlap checks.',
          commands: queue.p0_new_plan_candidates.map((concept) => concept.recommended_route),
          concepts: queue.p0_new_plan_candidates.map((concept) => concept.slug),
          outputs: ['one task plan or explicit no-plan disposition per remaining P0 concept'],
          gate: 'Each new plan must run existing-work overlap and name why no owner plan applies.'
        },
        {
          step_id: 'S4-p1-cluster-planning',
          mode: 'REVIEW_ONLY',
          is_gap: true,
          id: 'S4-p1-cluster-planning',
          description: 'Batch P1 concepts by category. Prefer parent cluster plans over one plan per minor concept.',
          commands: queue.p1_clusters.map((cluster) => cluster.recommended_route),
          clusters: queue.p1_clusters.map((cluster) => cluster.cluster_id),
          outputs: ['cluster plan queue and owner assignments for P1 concepts'],
          gate: 'No P1 execution until S0-S3 resolve authority, custody, closure, and visibility prerequisites.'
        },
        {
          step_id: 'S5-backlog-and-client-delivery-triage',
          mode: 'REVIEW_ONLY',
          is_gap: true,
          id: 'S5-backlog-and-client-delivery-triage',
          description: 'Classify P2/P3 concepts as backlog, client/framework improvements, source material, or closure candidates.',
          command: '/review-progress _dev/reports/analysis/concept-inventory/mythos-concepts-inventory.md',
          outputs: ['P2/P3 backlog disposition table'],
          gate: 'Client-specific execution remains outside this parent unless promoted as framework/system work.'
        }
      ],
      required_gates: [
        'Approve this parent ordering before bulk /plan-task fanout.',
        'Approve any closure/supersession of concepts marked folded, promoted, or obsolete.',
        'Approve any hook/gate behavior changes before implementation.'
      ],
      expected_outcomes: [
        'Regenerated concept inventory remains inspectable.',
        'P0 concepts are routed to existing owner plans, new /plan-task, or closure/supersession review.',
        'First-batch owner-plan amendment queue is explicit.',
        'No duplicate plans are created for concepts with an exact or semantic owner.',
        'Convene/bridge review is required before consequential implementation.'
      ],
      risk_notes: 'High-risk governance planning. The main risk is duplicate work or premature implementation across hooks, custody, cross-session, Dart, and harness surfaces. This parent plan is REVIEW_ONLY and must not execute child work directly.'
    },
    routing_expectations: {
      risk_tier: 'high',
      review_lane: 'operator-gate',
      review_lane_rationale: 'Parent ordering is operator-gated; authority, hook, or code-bearing child amendments escalate to a distinct-family-reviewer bridge before implementation.',
      escalation_triggers: [
        'Any concept would create a duplicate plan for an existing owner scope',
        'Any amendment changes operator gates, hook blocking behavior, custody, or cross-session semantics',
        'Any plan attempts to execute before its owner-plan review/amendment is accepted',
        'Any concept touches private surface, credentials, client data, or destructive operations'
      ]
    },
    operator_gates: [
      'Approve this parent ordering before bulk /plan-task fanout.',
      'Approve any closure/supersession of concepts marked folded, promoted, or obsolete.',
      'Approve any hook/gate behavior changes before implementation.'
    ],
    acceptance_criteria: [
      'Inventory artifacts exist and can be regenerated.',
      'Child plan queue exists and maps concepts to owner-plan review/amendment, closure/supersession review, new P0 /plan-task candidates, or P1 cluster planning.',
      'Every P0 concept is assigned to an owner-plan route, a new /plan-task route, or a closure/supersession investigation.',
      'Existing owner plans are preferred over duplicate task plans.',
      'A first-batch command queue is present.',
      'The plan names verification and review gates before implementation.'
    ],
    status: 'REVIEW_ONLY - parent plan drafted; implementation not started',
    dart_task_id: existing.dart_task_id || null
  };
}

function parentPlanMarkdown(plan) {
  const lines = [];
  lines.push('# Task Plan - Mythos Concept Program Inventory and Implementation Order');
  lines.push('');
  lines.push(`- task_id: ${plan.task_id}`);
  lines.push(`- Scope: ${plan.scope_type}`);
  lines.push(`- Status: ${plan.status}`);
  lines.push(`- Risk tier: ${plan.routing_expectations.risk_tier}`);
  lines.push(`- Review lane: ${plan.routing_expectations.review_lane}`);
  if (plan.dart_task_id) lines.push(`- Dart task id: ${plan.dart_task_id}`);
  lines.push('');
  lines.push('## Objective');
  lines.push('');
  lines.push(plan.description);
  lines.push('');
  lines.push('## Inventory Summary');
  lines.push('');
  lines.push(`- Total concept records: ${plan.concept_counts.total}`);
  lines.push(`- Outstanding concept records: ${plan.concept_counts.outstanding}`);
  lines.push(`- P0 concepts: ${plan.concept_counts.by_priority.P0 || 0}`);
  lines.push(`- P1 concepts: ${plan.concept_counts.by_priority.P1 || 0}`);
  lines.push(`- Owner-plan groups: ${plan.child_plan_queue.counts.owner_plan_groups}`);
  lines.push(`- Closure/supersession reviews: ${plan.child_plan_queue.counts.closure_review_candidates}`);
  lines.push(`- P0 new /plan-task candidates: ${plan.child_plan_queue.counts.p0_new_plan_candidates}`);
  lines.push(`- P1 clusters: ${plan.child_plan_queue.counts.p1_clusters}`);
  lines.push('');
  lines.push('## First Implementation Order');
  lines.push('');
  for (const item of plan.child_plan_queue.implementation_flow) {
    lines.push(`${item.wave}. ${item.name}`);
    lines.push(`   Route: ${item.route}`);
    lines.push(`   Rationale: ${item.rationale}`);
  }
  lines.push('');
  lines.push('## P0 Routing Table');
  lines.push('');
  lines.push('| Concept | Action | Owner / Route | Note |');
  lines.push('|---|---|---|---|');
  for (const concept of plan.high_priority_concepts) {
    lines.push(`| ${concept.slug} | ${concept.action} | ${concept.recommended_route || concept.owner_path || ''} | ${concept.investigation_note || ''} |`);
  }
  lines.push('');
  lines.push('## Closure / Supersession Review');
  lines.push('');
  lines.push('| Concept | Route | Reason |');
  lines.push('|---|---|---|');
  for (const concept of plan.child_plan_queue.closure_review_candidates) {
    lines.push(`| ${concept.slug} | ${concept.recommended_route} | ${concept.reason} |`);
  }
  lines.push('');
  lines.push('## P0 New Plan Candidates');
  lines.push('');
  for (const concept of plan.child_plan_queue.p0_new_plan_candidates) {
    lines.push(`- ${concept.recommended_route} — ${concept.investigation_note}`);
  }
  lines.push('');
  lines.push('## P1 Clusters');
  lines.push('');
  lines.push('| Cluster | Review Route | Create Route | Concepts |');
  lines.push('|---|---|---|---:|');
  for (const cluster of plan.child_plan_queue.p1_clusters) {
    lines.push(`| ${cluster.cluster_id} | ${cluster.review_route} | ${cluster.recommended_route} | ${cluster.concept_count} |`);
  }
  lines.push('');
  lines.push('## Review Gates');
  lines.push('');
  for (const gate of plan.operator_gates) lines.push(`- ${gate}`);
  lines.push('');
  lines.push('## Evidence');
  lines.push('');
  for (const [key, value] of Object.entries(plan.inventory_evidence)) lines.push(`- ${key}: ${value}`);
  lines.push('');
  lines.push('## Exact Next Command');
  lines.push('');
  lines.push(`/review-task-plan ${plan.task_id}`);
  return lines.join('\n') + '\n';
}

function buildFanoutRunbook(queue) {
  // Owner-plan batches are derived purely from computed priority_floor —
  // no hardcoded plan-id lists. If your guild wants finer-grained named
  // waves (e.g. "system spine" vs "harness/custody"), curate them yourself
  // via owner_group_priority_order in the config and re-group here.
  const ownerBatches = [
    {
      batch_id: 'wave1a-p0-owner-plans',
      purpose: 'Review or amend P0 owner plans before any lower-priority leaf planning.',
      routes: queue.owner_plan_groups
        .filter((group) => group.priority_floor === 'P0')
        .map(ownerRoute)
    },
    {
      batch_id: 'wave1b-owned-p1-and-lower',
      purpose: 'Review lower-priority concepts that already have exact or semantic owner plans before any cluster planning.',
      routes: queue.owner_plan_groups
        .filter((group) => priorityRank(group.priority_floor) >= priorityRank('P1'))
        .map(ownerRoute)
    }
  ].filter((batch) => batch.routes.length > 0);

  const closureBatch = {
    batch_id: 'wave2-closure-supersession',
    purpose: 'Resolve folded or likely superseded concepts before any new plans.',
    routes: queue.closure_review_candidates.map((concept) => ({
      target: concept.slug,
      route: concept.recommended_route,
      priority: concept.priority,
      concepts: [concept.slug],
      concept_paths: [concept.concept_path],
      prompt: `Review ${concept.slug} for closure or supersession. Confirm whether the reason is still valid: ${concept.reason} Return a closure, supersession, fold-target, or reopen recommendation with evidence.`
    }))
  };

  const p0NewBatch = {
    batch_id: 'wave3-p0-new-plan-tasks',
    purpose: 'Create P0 plans only for concepts with no owner after overlap checks.',
    routes: queue.p0_new_plan_candidates.map((concept) => ({
      target: concept.slug,
      route: concept.recommended_route,
      priority: 'P0',
      concepts: [concept.slug],
      concept_paths: [concept.concept_path],
      prompt: `Run /plan-task for ${concept.slug} only after confirming no exact or semantic owner plan applies. Include the overlap check and operator gates in the resulting plan.`
    }))
  };

  const clusterBatch = {
    batch_id: 'wave4-p1-cluster-plans',
    purpose: 'Review generated P1 cluster plans after P0 owner routing and closure review are accepted.',
    routes: queue.p1_clusters.map((cluster) => ({
      target: clusterPlanId(cluster),
      route: `/review-task-plan ${clusterPlanId(cluster)}`,
      priority: 'P1',
      concepts: cluster.concepts.map((concept) => concept.slug),
      concept_paths: cluster.concepts.map((concept) => concept.concept_path).filter(Boolean),
      prompt: `Review the generated cluster plan ${clusterPlanId(cluster)}. Treat this as a cluster plan, not one plan per concept. Preserve concept membership, identify common owner surfaces, and include gates preventing duplicate owner-plan creation.`
    }))
  };

  const batches = [
    ...ownerBatches,
    closureBatch,
    p0NewBatch,
    clusterBatch
  ].filter((batch) => batch.routes.length > 0 || batch.batch_id === 'wave3-p0-new-plan-tasks');

  return {
    schema: 'ConceptFanoutRunbook/1.0',
    generated_at: new Date().toISOString(),
    parent_task_id: PARENT_PLAN_ID,
    queue_path: rel(path.join(OUT_ROOT, 'concept-child-plan-queue.json')),
    execution_policy: {
      coordinator_role: 'Coordinator routes and integrates only; delegated actors own bounded review/amend/plan work.',
      preserve_dirty_work: true,
      no_git_add_all: true,
      before_execution_gate: `/review-task-plan ${PARENT_PLAN_ID}`,
      consequence_gate: latestParentConveneReview(),
      p0_new_plan_policy: 'Do not create new P0 plans unless p0_new_plan_candidates is non-empty after owner overlap checks.'
    },
    batches,
    exact_next_routes: batches.flatMap((batch) => batch.routes.map((route) => ({
      batch_id: batch.batch_id,
      target: route.target,
      route: route.route
    })))
  };
}

function ownerRoute(group) {
  return {
    target: group.owner_plan,
    route: group.route,
    priority: group.priority_floor,
    concepts: group.concepts.map((concept) => concept.slug),
    concept_paths: group.concepts.map((concept) => concept.concept_path).filter(Boolean),
    prompt: `Review or amend owner plan ${group.owner_plan} for these concepts: ${group.concepts.map((concept) => concept.slug).join(', ')}. Prefer the existing owner surface over duplicate task plans. Return changed files, review/amendment artifact paths, blockers, and the exact next route.`
  };
}

function fanoutRunbookMarkdown(runbook) {
  const lines = [];
  lines.push('# Mythos Concept Fanout Runbook');
  lines.push('');
  lines.push(`Generated: ${runbook.generated_at}`);
  lines.push(`Parent task: ${runbook.parent_task_id}`);
  lines.push(`Queue: ${runbook.queue_path}`);
  lines.push('');
  lines.push('## Execution Policy');
  lines.push('');
  lines.push(`- Coordinator role: ${runbook.execution_policy.coordinator_role}`);
  lines.push(`- Before execution gate: ${runbook.execution_policy.before_execution_gate}`);
  lines.push(`- Consequence gate: ${runbook.execution_policy.consequence_gate || '(none found)'}`);
  lines.push(`- Preserve dirty work: ${runbook.execution_policy.preserve_dirty_work}`);
  lines.push(`- Do not git add all: ${runbook.execution_policy.no_git_add_all}`);
  lines.push(`- P0 new-plan policy: ${runbook.execution_policy.p0_new_plan_policy}`);
  lines.push('');
  lines.push('## Batches');
  lines.push('');
  for (const batch of runbook.batches) {
    lines.push(`### ${batch.batch_id}`);
    lines.push('');
    lines.push(batch.purpose);
    lines.push('');
    lines.push('| Target | Priority | Route | Concepts |');
    lines.push('|---|---|---|---:|');
    for (const route of batch.routes) {
      lines.push(`| ${route.target} | ${route.priority} | ${route.route} | ${route.concepts.length} |`);
    }
    if (batch.routes.length === 0) lines.push('| (none) |  |  | 0 |');
    lines.push('');
  }
  lines.push('## Exact Next Routes');
  lines.push('');
  for (const route of runbook.exact_next_routes) {
    lines.push(`- ${route.batch_id}: ${route.route}`);
  }
  return lines.join('\n') + '\n';
}

function buildFanoutStatus(runbook) {
  const rows = runbook.exact_next_routes.map((route) => {
    const review = readReviewForRoute(route.route);
    const progressReview = readProgressReviewForRoute(route.route, route.target);
    const amendment = readConceptInventoryAmendmentForRoute(route.route);
    return {
      batch_id: route.batch_id,
      target: route.target,
      route: route.route,
      review_status: review ? review.status : progressReview ? progressReview.status : amendment ? amendment.status : 'not-reviewed',
      blockers: review?.blockers || progressReview?.blockers || amendment?.blockers || [],
      warnings: review?.warnings || progressReview?.warnings || amendment?.warnings || [],
      review_artifact: review?._artifact || progressReview?._artifact || amendment?._artifact || null,
      next_command: review?.next_command || progressReview?.next_command || amendment?.next_command || route.route,
      classification: classifyFanoutRoute(route.route, review, progressReview, amendment)
    };
  });

  const counts = {};
  for (const row of rows) counts[row.classification] = (counts[row.classification] || 0) + 1;

  return {
    schema: 'ConceptFanoutStatus/1.0',
    generated_at: new Date().toISOString(),
    parent_task_id: PARENT_PLAN_ID,
    runbook_path: rel(FANOUT_RUNBOOK_JSON),
    counts,
    rows
  };
}

function readReviewForRoute(route) {
  const match = String(route || '').match(/^\/(?:review-task-plan|amend-plan)\s+(.+)$/);
  if (!match) return null;
  const taskId = match[1].trim().replace(/\s+.*/, '');
  const reviewPath = path.join(TASK_PLAN_REVIEW_ROOT, `${taskId}__review.json`);
  const review = readJson(reviewPath);
  if (!review) return null;
  review._artifact = rel(reviewPath);
  return review;
}

function readProgressReviewForRoute(route, target) {
  if (!String(route || '').startsWith('/review-progress ')) return null;
  const safeTarget = String(target || '').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safeTarget) return null;
  const jsonPath = path.join(REPO_ROOT, '_dev/reports/analysis', `review-progress__${safeTarget}.expectation-failures.json`);
  const payload = readJson(jsonPath);
  if (!payload) return null;
  const failures = Array.isArray(payload.failures) ? payload.failures : [];
  return {
    status: failures.length > 0 ? 'reviewed-with-findings' : 'reviewed-clean',
    blockers: failures.filter((failure) => String(failure.severity || '').toLowerCase() === 'blocker'),
    warnings: failures.filter((failure) => String(failure.severity || '').toLowerCase() !== 'blocker'),
    _artifact: rel(jsonPath),
    next_command: payload.disposition?.recommended_next_action || route
  };
}

function readConceptInventoryAmendmentForRoute(route) {
  const match = String(route || '').match(/^\/amend-plan\s+(.+)$/);
  if (!match) return null;
  const taskId = match[1].trim().replace(/\s+.*/, '');
  const jsonPath = path.join(SYSTEM_PLAN_ROOT, `${taskId}__amendment__${amendmentSuffix()}.json`);
  const payload = readJson(jsonPath);
  if (!payload) return null;
  return {
    status: payload.lifecycle_state || 'open',
    blockers: [],
    warnings: [],
    _artifact: rel(jsonPath),
    next_command: payload.next_command || `/review-task-plan ${taskId}`
  };
}

function classifyFanoutRoute(route, review, progressReview = null, amendment = null) {
  if (!String(route || '').startsWith('/review-task-plan ')) {
    if (String(route || '').startsWith('/amend-plan ')) {
      if (!amendment) return 'needs-amend-plan';
      if (!review) return 'amended-needs-review';
      if (review.blockers && review.blockers.length > 0) return 'amended-blocked-review';
      if (review.warnings && review.warnings.length > 0) return 'amended-reviewed-with-warnings';
      return 'amended-reviewed-clean';
    }
    if (String(route || '').startsWith('/plan-task ')) return 'needs-plan-task';
    if (String(route || '').startsWith('/review-progress ')) {
      if (!progressReview) return 'needs-review-progress';
      if (progressReview.blockers && progressReview.blockers.length > 0) return 'blocked-review-progress';
      if (progressReview.warnings && progressReview.warnings.length > 0) return 'reviewed-progress-with-findings';
      return 'reviewed-progress-clean';
    }
    return 'needs-route';
  }
  if (!review) return 'needs-review-task-plan';
  if (review.blockers && review.blockers.length > 0) return 'blocked-review';
  if (review.warnings && review.warnings.length > 0) return 'reviewed-with-warnings';
  return 'reviewed-clean';
}

function fanoutStatusMarkdown(status) {
  const lines = [];
  lines.push('# Mythos Concept Fanout Status');
  lines.push('');
  lines.push(`Generated: ${status.generated_at}`);
  lines.push(`Parent task: ${status.parent_task_id}`);
  lines.push(`Runbook: ${status.runbook_path}`);
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  for (const [key, value] of Object.entries(status.counts).sort()) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push('');
  lines.push('## Rows');
  lines.push('');
  lines.push('| Batch | Target | Classification | Blockers | Warnings | Route |');
  lines.push('|---|---|---|---:|---:|---|');
  for (const row of status.rows) {
    lines.push(`| ${row.batch_id} | ${row.target} | ${row.classification} | ${row.blockers.length} | ${row.warnings.length} | ${row.route} |`);
  }
  lines.push('');
  lines.push('## Blocked Reviews');
  lines.push('');
  const blocked = status.rows.filter((row) => row.classification === 'blocked-review');
  if (blocked.length === 0) {
    lines.push('- None.');
  } else {
    for (const row of blocked) {
      lines.push(`- ${row.target}: ${row.blockers.map(formatIssue).join('; ')}. Review: ${row.review_artifact || '(missing)'}`);
    }
  }
  lines.push('');
  lines.push('## Reviewed With Warnings');
  lines.push('');
  const warnings = status.rows.filter((row) => row.classification === 'reviewed-with-warnings');
  if (warnings.length === 0) {
    lines.push('- None.');
  } else {
    for (const row of warnings) {
      lines.push(`- ${row.target}: ${row.warnings.map(formatIssue).join('; ')}. Review: ${row.review_artifact || '(missing)'}`);
    }
  }
  return lines.join('\n') + '\n';
}

function clusterPlanId(cluster) {
  return `${cluster.cluster_id}-concept-cluster`;
}

function titleFromClusterId(clusterId) {
  return clusterId
    .split('-')
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(' ');
}

function buildP1ClusterPlan(cluster, existing = {}) {
  const taskId = clusterPlanId(cluster);
  const conceptSlugs = cluster.concepts.map((concept) => concept.slug);
  const conceptPaths = cluster.concepts.map((concept) => concept.concept_path).filter(Boolean);
  const title = `${titleFromClusterId(cluster.cluster_id)} Concept Cluster`;

  return {
    schema: 'TaskPlan/1.0',
    task_id: taskId,
    title,
    task_summary: `Cluster plan for ${cluster.concepts.length} P1 ${cluster.category} concept(s) that do not yet have an owner plan.`,
    scope_type: 'system',
    scope_justification: 'The clustered concepts govern Mythos system behavior, planning surfaces, framework/runtime behavior, or cross-client substrate design rather than client delivery.',
    storage_root: '_dev/reports/analysis/task-plans',
    origin_client_code: null,
    origin_project_id: null,
    description: `Create a bounded planning surface for the P1 ${cluster.category} concept cluster. Preserve concept membership, avoid duplicate owner-plan creation, and route implementation only after higher-priority P0 owner-plan and closure routes have been reviewed.`,
    client_code: null,
    project_id: null,
    source: 'operator',
    requested_by: 'human operator via Mythos concept-program inventory',
    timestamp: existing.timestamp || new Date().toISOString(),
    parent_task_id: PARENT_PLAN_ID,
    similarity_assessment: {
      top_framework: 'meta/execution-normalization',
      match_score: 35,
      match_rationale: 'This is system planning and concept routing work. Registered frameworks provide only partial operational-planning patterns; no hardened framework owns bulk concept-cluster promotion.',
      gaps: [
        'No registered framework owns P1 concept-cluster task-plan generation.',
        'The cluster needs operator review before any concept graduates into implementation.',
        'The plan must prevent duplicate owner-plan creation when later overlap evidence appears.'
      ],
      applicable_modes: ['REVIEW_ONLY', 'PATCH_ALLOWED'],
      trust_tier: 'partial-coverage'
    },
    existing_work_overlap: {
      has_overlap: false,
      evidence_basis: '_dev/reports/analysis/concept-inventory/concept-child-plan-queue.json',
      reason_for_new_plan: 'The parent concept inventory found no exact or semantic owner plan for these P1 concepts and deliberately clusters them to avoid one plan per minor concept.'
    },
    lived_context: {
      parent_plan: `_dev/reports/analysis/task-plans/${PARENT_PLAN_ID}__plan.json`,
      child_queue: '_dev/reports/analysis/concept-inventory/concept-child-plan-queue.json',
      fanout_runbook: '_dev/reports/analysis/concept-inventory/concept-fanout-runbook.json',
      fanout_status: '_dev/reports/analysis/concept-inventory/concept-fanout-status.json',
      concept_paths: conceptPaths
    },
    scope_identity: {
      owned_artifacts: [
        `_dev/reports/analysis/task-plans/${taskId}__plan.json`,
        `_dev/reports/analysis/task-plans/${taskId}__plan.md`
      ],
      referenced_not_owned: [
        `_dev/reports/analysis/task-plans/${PARENT_PLAN_ID}__plan.json`,
        '_dev/reports/analysis/concept-inventory/concept-child-plan-queue.json',
        '_dev/reports/analysis/concept-inventory/concept-fanout-runbook.json',
        '_dev/reports/analysis/concept-inventory/concept-fanout-status.json',
        ...conceptPaths
      ]
    },
    concept_cluster: {
      cluster_id: cluster.cluster_id,
      category: cluster.category,
      priority: 'P1',
      concepts: cluster.concepts
    },
    bounded_plan: {
      steps: [
        {
          step_id: 'S1-review-membership',
          description: 'Review the cluster membership against the parent concept inventory and confirm that each concept still lacks a stronger owner plan.',
          framework_step: null,
          mode: 'REVIEW_ONLY',
          is_gap: true,
          outputs: ['confirmed concept list', 'owner-plan exceptions if found']
        },
        {
          step_id: 'S2-rank-within-cluster',
          description: 'Rank the cluster concepts by system value, dependency order, and risk. Keep speculative or high-uncertainty concepts behind investigation gates.',
          framework_step: null,
          mode: 'REVIEW_ONLY',
          is_gap: true,
          outputs: ['within-cluster priority order', 'investigation list']
        },
        {
          step_id: 'S3-split-or-fold',
          description: 'Decide whether the cluster should remain one owner plan, split into smaller owner plans, fold into an existing owner discovered during review, or stay in backlog.',
          framework_step: null,
          mode: 'REVIEW_ONLY',
          is_gap: true,
          outputs: ['split/fold/backlog disposition per concept']
        },
        {
          step_id: 'S4-author-next-slice',
          description: 'Only after review, author the first implementation slice or amendment route for concepts that are mature enough to execute.',
          framework_step: null,
          mode: 'PATCH_ALLOWED',
          is_gap: true,
          outputs: ['bounded child plan, amendment route, or explicit backlog disposition'],
          gate: 'No implementation until /review-task-plan passes for this cluster plan.'
        }
      ],
      required_gates: [
        `Review parent plan ${PARENT_PLAN_ID} before acting on this child cluster.`,
        'Run /review-task-plan for this cluster plan before implementation.',
        'Re-run existing-work overlap if any concept appears to match an owner plan during review.',
        'Escalate to operator-gate before adding hooks, authority changes, private-surface access, or destructive operations.'
      ],
      expected_outcomes: [
        'The P1 cluster has a durable concept membership list.',
        'The operator can see why the concepts are grouped together.',
        'Each concept gets a next disposition: owner-plan fold, new child plan, investigation, or backlog.',
        'No duplicate task plans are created for concepts that belong in an existing owner plan.'
      ],
      risk_notes: 'Medium-risk system planning. These plans intentionally organize P1 concepts only; implementation is blocked until parent authority, P0 owner-plan routes, and this cluster review are accepted.',
      hardening_opportunity: 'If the cluster-planning pattern works, promote it into the deterministic concept inventory/fanout workflow so future concept sweeps produce reviewable cluster plans automatically.'
    },
    routing_expectations: {
      risk_tier: 'medium',
      review_lane: 'operator-gate',
      review_lane_rationale: 'Cluster membership and priority are judgment-heavy; implementation may later affect system authority, hooks, or framework/runtime behavior.',
      escalation_triggers: [
        'A concept appears to have an existing owner plan after review',
        'The cluster would modify canonical instructions, hooks, custody, cross-session behavior, or private-surface access',
        'The cluster would create more than one new implementation plan',
        'The cluster touches client-specific delivery rather than system-level design'
      ]
    },
    operator_guidance: {
      next_options: [
        {
          condition: 'If the cluster grouping is acceptable',
          command: `/review-task-plan ${taskId}`,
          why: 'Review the child cluster plan before any implementation or split/fold decision.'
        },
        {
          condition: 'If one concept obviously belongs to an existing owner',
          command: `/amend-plan <owner-plan-id>`,
          why: 'Prefer the existing owner plan over creating a duplicate child plan.'
        },
        {
          condition: 'If the cluster is too speculative',
          command: `/review-progress _dev/reports/analysis/concept-inventory/concept-child-plan-queue.md`,
          why: 'Record backlog or investigation disposition without spawning execution work.'
        }
      ]
    },
    acceptance_criteria: [
      'Cluster plan artifact exists as JSON and Markdown.',
      'Every concept in the cluster is named with its source path.',
      'The plan declares parent relationship to the concept-program source of truth.',
      'The plan blocks implementation until review passes.',
      'The plan includes duplicate-owner safeguards.'
    ],
    status: 'REVIEW_ONLY - cluster child plan drafted; implementation not started'
  };
}

function p1ClusterPlanMarkdown(plan) {
  const lines = [];
  lines.push(`# Task Plan - ${plan.title}`);
  lines.push('');
  lines.push(`- task_id: ${plan.task_id}`);
  lines.push(`- parent_task_id: ${plan.parent_task_id}`);
  lines.push(`- Scope: ${plan.scope_type}`);
  lines.push(`- Status: ${plan.status}`);
  lines.push(`- Risk tier: ${plan.routing_expectations.risk_tier}`);
  lines.push(`- Review lane: ${plan.routing_expectations.review_lane}`);
  lines.push('');
  lines.push('## Objective');
  lines.push('');
  lines.push(plan.description);
  lines.push('');
  lines.push('## Concept Membership');
  lines.push('');
  lines.push('| Concept | Source |');
  lines.push('|---|---|');
  for (const concept of plan.concept_cluster.concepts) {
    lines.push(`| ${concept.slug} | ${concept.concept_path || ''} |`);
  }
  lines.push('');
  lines.push('## Plan Steps');
  lines.push('');
  for (const step of plan.bounded_plan.steps) {
    lines.push(`### ${step.step_id}`);
    lines.push('');
    lines.push(step.description);
    lines.push('');
    lines.push(`- Mode: ${step.mode}`);
    lines.push(`- Gap: ${step.is_gap}`);
    if (step.gate) lines.push(`- Gate: ${step.gate}`);
    if (step.outputs) lines.push(`- Outputs: ${step.outputs.join(', ')}`);
    lines.push('');
  }
  lines.push('## Required Gates');
  lines.push('');
  for (const gate of plan.bounded_plan.required_gates) lines.push(`- ${gate}`);
  lines.push('');
  lines.push('## Expected Outcomes');
  lines.push('');
  for (const outcome of plan.bounded_plan.expected_outcomes) lines.push(`- ${outcome}`);
  lines.push('');
  lines.push('## Risk Notes');
  lines.push('');
  lines.push(plan.bounded_plan.risk_notes);
  lines.push('');
  lines.push('## Next Options');
  lines.push('');
  for (const option of plan.operator_guidance.next_options) {
    lines.push(`- ${option.condition}: ${option.command} — ${option.why}`);
  }
  lines.push('');
  lines.push('## Exact Next Command');
  lines.push('');
  lines.push(`/review-task-plan ${plan.task_id}`);
  return lines.join('\n') + '\n';
}

function writeP1ClusterPlans(queue) {
  const written = [];
  for (const cluster of queue.p1_clusters) {
    const taskId = clusterPlanId(cluster);
    const jsonPath = path.join(SYSTEM_PLAN_ROOT, `${taskId}__plan.json`);
    const mdPath = path.join(SYSTEM_PLAN_ROOT, `${taskId}__plan.md`);
    const existing = readJson(jsonPath) || {};
    const plan = buildP1ClusterPlan(cluster, existing);
    fs.writeFileSync(jsonPath, JSON.stringify(plan, null, 2) + '\n');
    fs.writeFileSync(mdPath, p1ClusterPlanMarkdown(plan));
    written.push(jsonPath, mdPath);
  }
  return written;
}

function buildConceptInventoryAmendment(group, existingPlan = {}) {
  const planId = group.owner_plan;
  const risk = existingPlan.routing_expectations?.risk_tier || existingPlan.risk_tier || 'medium';
  const lane = existingPlan.routing_expectations?.review_lane || existingPlan.review_lane || CONFIG.reviewer_harness_id;
  const divergences = group.concepts.map((concept) => ({
    id: `concept-fold-${concept.slug}`,
    type: 'output_changed',
    step_id: null,
    original: `Baseline plan ${planId} did not explicitly carry concept-inventory membership for ${concept.slug}.`,
    observed: `The refreshed Mythos concept inventory routes ${concept.slug} to owner plan ${planId} rather than a duplicate new task plan.`,
    evidence_refs: [
      '_dev/reports/analysis/concept-inventory/concept-child-plan-queue.json',
      concept.concept_path
    ].filter(Boolean),
    recommended_action: `Treat ${concept.slug} as folded into ${planId}; review the owner plan for any missing acceptance criteria before execution.`
  }));

  return {
    schema: 'PlanAmendment/1.0',
    plan_id: planId,
    plan_path: `_dev/reports/analysis/task-plans/${planId}__plan.json`,
    amendment_id: `${planId}__amendment__${amendmentSuffix()}`,
    timestamp: new Date().toISOString(),
    lifecycle_state: 'open',
    amended_by_actor_id: CONFIG.reviewer_actor_id,
    amended_by_harness_id: CONFIG.reviewer_harness_id,
    trigger: 'Mythos concept-program inventory found additional concepts that semantically belong to this owner plan and should not spawn duplicate task plans.',
    divergences,
    risk_reassessment: {
      original_risk_tier: risk,
      amended_risk_tier: risk,
      original_review_lane: lane,
      amended_review_lane: lane,
      rationale: 'This amendment changes routing/membership only. It does not authorize implementation or lower review gates.'
    },
    plan_still_executable: false,
    next_command: `/review-task-plan ${planId}`,
    supersedes_prior_amendment: null
  };
}

function conceptInventoryAmendmentMarkdown(amendment) {
  const lines = [];
  lines.push(`# Plan Amendment - ${amendment.plan_id}`);
  lines.push('');
  lines.push(`- amendment_id: ${amendment.amendment_id}`);
  lines.push(`- timestamp: ${amendment.timestamp}`);
  lines.push(`- lifecycle_state: ${amendment.lifecycle_state}`);
  lines.push(`- next_command: ${amendment.next_command}`);
  lines.push('');
  lines.push('## Trigger');
  lines.push('');
  lines.push(amendment.trigger);
  lines.push('');
  lines.push('## Divergences');
  lines.push('');
  for (const divergence of amendment.divergences) {
    lines.push(`### ${divergence.id}`);
    lines.push('');
    lines.push(`- Type: ${divergence.type}`);
    lines.push(`- Original: ${divergence.original}`);
    lines.push(`- Observed: ${divergence.observed}`);
    lines.push(`- Recommended action: ${divergence.recommended_action}`);
    lines.push(`- Evidence: ${divergence.evidence_refs.join(', ')}`);
    lines.push('');
  }
  lines.push('## Risk Reassessment');
  lines.push('');
  lines.push(`- Risk tier: ${amendment.risk_reassessment.original_risk_tier} -> ${amendment.risk_reassessment.amended_risk_tier}`);
  lines.push(`- Review lane: ${amendment.risk_reassessment.original_review_lane} -> ${amendment.risk_reassessment.amended_review_lane}`);
  lines.push(`- Rationale: ${amendment.risk_reassessment.rationale}`);
  lines.push('');
  lines.push('## Exact Next Command');
  lines.push('');
  lines.push(amendment.next_command);
  return lines.join('\n') + '\n';
}

function writeConceptInventoryAmendments(queue) {
  const written = [];
  for (const group of queue.owner_plan_groups.filter((item) => String(item.route || '').startsWith('/amend-plan '))) {
    const planId = group.owner_plan;
    const planPath = path.join(SYSTEM_PLAN_ROOT, `${planId}__plan.json`);
    const existingPlan = readJson(planPath) || {};
    const amendment = buildConceptInventoryAmendment(group, existingPlan);
    const suffix = amendmentSuffix();
    const jsonPath = path.join(SYSTEM_PLAN_ROOT, `${planId}__amendment__${suffix}.json`);
    const mdPath = path.join(SYSTEM_PLAN_ROOT, `${planId}__amendment__${suffix}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(amendment, null, 2) + '\n');
    fs.writeFileSync(mdPath, conceptInventoryAmendmentMarkdown(amendment));
    written.push(jsonPath, mdPath);
  }
  return written;
}

function formatIssue(issue) {
  if (typeof issue === 'string') return issue;
  if (!issue || typeof issue !== 'object') return String(issue);
  const pathText = issue.path ? `${issue.path}: ` : '';
  if (issue.message) return `${pathText}${issue.message}`;
  if (issue.detail) return `${pathText}${issue.detail}`;
  return JSON.stringify(issue);
}

function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  fs.mkdirSync(SYSTEM_PLAN_ROOT, { recursive: true });
  const records = mergeRecords();
  const queue = childPlanQueue(records);
  const payload = {
    generated_at: new Date().toISOString(),
    roots: {
      system_concepts: rel(SYSTEM_CONCEPT_ROOT),
      memory_concepts: MEMORY_CONCEPT_ROOT ? rel(MEMORY_CONCEPT_ROOT) : null,
      system_plans: rel(SYSTEM_PLAN_ROOT),
      memory_plans: MEMORY_PLAN_ROOT ? rel(MEMORY_PLAN_ROOT) : null
    },
    counts: {
      total: records.length,
      outstanding: records.filter((record) => record.action !== 'closed-or-implemented').length,
      by_priority: groupCounts(records, 'priority'),
      by_category_outstanding: groupCounts(records.filter((record) => record.action !== 'closed-or-implemented'), 'category')
    },
    records
  };

  const jsonPath = path.join(OUT_ROOT, 'mythos-concepts-inventory.json');
  const mdPath = path.join(OUT_ROOT, 'mythos-concepts-inventory.md');
  const queueJsonPath = path.join(OUT_ROOT, 'concept-child-plan-queue.json');
  const queueMdPath = path.join(OUT_ROOT, 'concept-child-plan-queue.md');
  const parentPlan = buildParentPlan(records, queue, payload);
  const clusterPlanPaths = writeP1ClusterPlans(queue);
  const amendmentPaths = writeConceptInventoryAmendments(queue);
  const fanoutRunbook = buildFanoutRunbook(queue);
  const fanoutStatus = buildFanoutStatus(fanoutRunbook);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n');
  fs.writeFileSync(mdPath, markdown(records));
  fs.writeFileSync(queueJsonPath, JSON.stringify(queue, null, 2) + '\n');
  fs.writeFileSync(queueMdPath, childQueueMarkdown(queue));
  fs.writeFileSync(PARENT_PLAN_JSON, JSON.stringify(parentPlan, null, 2) + '\n');
  fs.writeFileSync(PARENT_PLAN_MD, parentPlanMarkdown(parentPlan));
  fs.writeFileSync(FANOUT_RUNBOOK_JSON, JSON.stringify(fanoutRunbook, null, 2) + '\n');
  fs.writeFileSync(FANOUT_RUNBOOK_MD, fanoutRunbookMarkdown(fanoutRunbook));
  fs.writeFileSync(FANOUT_STATUS_JSON, JSON.stringify(fanoutStatus, null, 2) + '\n');
  fs.writeFileSync(FANOUT_STATUS_MD, fanoutStatusMarkdown(fanoutStatus));
  console.log(`Wrote ${rel(jsonPath)}`);
  console.log(`Wrote ${rel(mdPath)}`);
  console.log(`Wrote ${rel(queueJsonPath)}`);
  console.log(`Wrote ${rel(queueMdPath)}`);
  console.log(`Wrote ${rel(PARENT_PLAN_JSON)}`);
  console.log(`Wrote ${rel(PARENT_PLAN_MD)}`);
  for (const file of clusterPlanPaths) console.log(`Wrote ${rel(file)}`);
  for (const file of amendmentPaths) console.log(`Wrote ${rel(file)}`);
  console.log(`Wrote ${rel(FANOUT_RUNBOOK_JSON)}`);
  console.log(`Wrote ${rel(FANOUT_RUNBOOK_MD)}`);
  console.log(`Wrote ${rel(FANOUT_STATUS_JSON)}`);
  console.log(`Wrote ${rel(FANOUT_STATUS_MD)}`);
}

if (require.main === module) main();
