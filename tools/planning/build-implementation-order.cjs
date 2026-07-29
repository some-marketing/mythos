#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PLAN_DIR = path.join(PROJECT_ROOT, '_dev/reports/analysis/task-plans');
const OUTCOME_DIR = path.join(PROJECT_ROOT, '_dev/reports/analysis/task-outcomes');
const REVIEW_DIR = path.join(PROJECT_ROOT, '_dev/reports/analysis/task-plan-reviews');
const OUT_JSON = path.join(PROJECT_ROOT, '_dev/reports/analysis/project-plan-implementation-order__all-plans.json');
const OUT_MD = path.join(PROJECT_ROOT, '_dev/reports/analysis/project-plan-implementation-order__all-plans.md');

const SPINE_ORDER = [
  'pixar-rule4-omitted-dispatch-coverage',
  'pixar-rule2-hardening-liveness-check',
  'pixar-rule1-5-keystone-memory-edge',
  'mythos-distributed-workflow-kernel',
  'cross-session-scope-isolation',
  'debrief-before-close-enforcement',
  'actor-specific-debrief-synthesis',
  'concept-to-dart-outstanding-hardening',
  'concept-to-dart-brief-governance-script',
  'operator-ux-improvements',
  'plan-visibility-surface',
  'harness-protocol-parity',
  'actor-custody-commit-gate',
  'task-custody-chain-propagation',
  'macos-tcc-durable-permissions',
  'auto-injection-hook-for-contextual-mind-tier0',
  'kernel-training-methodology',
  'vps-context-hub'
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function safeReadJson(filePath) {
  try {
    return readJson(filePath);
  } catch (_) {
    return null;
  }
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function rel(filePath) {
  return path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
}

function planFiles() {
  return fs.readdirSync(PLAN_DIR)
    .filter((name) => name.endsWith('__plan.json'))
    .sort()
    .map((name) => path.join(PLAN_DIR, name));
}

function markdownReviewPath(id) {
  return path.join(REVIEW_DIR, `${id}__review.md`);
}

function jsonReviewPath(id) {
  return path.join(REVIEW_DIR, `${id}__review.json`);
}

function outcomePath(id) {
  return path.join(OUTCOME_DIR, `${id}.json`);
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function riskWeight(risk) {
  const r = normalizeStatus(risk);
  if (r === 'high') return 3;
  if (r === 'medium') return 2;
  if (r === 'low') return 1;
  return 2;
}

function familyOf(id, plan) {
  if (/^pixar-rule/.test(id)) return 'simulation';
  if (/^{CLIENT_CODE}-|^{CLIENT_CODE}-|^{CLIENT_CODE}-|^{CLIENT_CODE}-|^something-{CLIENT_CODE}|^delesign-|^respond-to-client|^website-|^wp/.test(id)) return 'client-delivery';
  if (/voice|speech|discord/.test(id)) return 'voice-comms';
  if (/harness|bridge|actor|task-custody|cross-session|debrief|kernel|vps|repo-aware|plan-visibility|concept-to-dart|operator-ux|distributed-workflow/.test(id)) return 'system-spine';
  if (/framework|wordpress|paid-media|seo|media-video/.test(id)) return 'frameworks';
  if (/memory|retrieval|cascade|telemetry/.test(id)) return 'memory-observability';
  if (plan.scope_type === 'system') return 'system';
  return 'other';
}

function phaseFor(id, plan, outcome, reviewed, reviewBlockers, reviewWarnings) {
  const status = normalizeStatus(plan.status);
  if (outcome || status === 'complete' || plan.exact_next_command === 'none') {
    return 'done-or-closeout-only';
  }
  if (reviewBlockers > 0) return 'blocked-repair-before-run';
  if (!reviewed) return 'needs-review-before-run';
  if (SPINE_ORDER.includes(id)) return 'front-of-queue';
  if (reviewWarnings > 0) return 'ready-with-warning-review-first';
  const family = familyOf(id, plan);
  if (family === 'system-spine' || family === 'memory-observability') return 'ready-system-follow-on';
  if (family === 'frameworks') return 'ready-framework-follow-on';
  if (family === 'client-delivery') return 'client-delivery-when-client-priority';
  return 'ready-backlog';
}

function priorityScore(id, plan, outcome, reviewed, reviewBlockers, reviewWarnings) {
  const status = normalizeStatus(plan.status);
  if (outcome || status === 'complete' || plan.exact_next_command === 'none') return 9000;
  if (reviewBlockers > 0) return 8000 + reviewBlockers;
  if (!reviewed) return 5000 - riskWeight(plan.routing_expectations?.risk_tier || plan.risk_tier);
  const spineIndex = SPINE_ORDER.indexOf(id);
  if (spineIndex !== -1) return 100 + spineIndex;
  let score = 1000;
  const family = familyOf(id, plan);
  if (family === 'system-spine') score -= 300;
  if (family === 'memory-observability') score -= 220;
  if (family === 'frameworks') score -= 120;
  if (family === 'client-delivery') score += 900;
  score -= riskWeight(plan.routing_expectations?.risk_tier || plan.risk_tier) * 20;
  score += reviewWarnings * 25;
  return score;
}

function reviewCounts(id, plan) {
  const jsonPath = jsonReviewPath(id);
  const mdPath = markdownReviewPath(id);
  const declaredReview = (plan.scope_identity?.owned_artifacts || [])
    .find((artifact) => /(^|\/)task-plan-reviews\/.+__review\.(json|md)$/.test(String(artifact)) && exists(path.join(PROJECT_ROOT, artifact)));
  const declaredReviewPath = declaredReview ? path.join(PROJECT_ROOT, declaredReview) : null;
  const reviewed = exists(jsonPath) || exists(mdPath) || Boolean(declaredReviewPath);
  const json = safeReadJson(jsonPath);
  let blockers = 0;
  let warnings = 0;
  if (json) {
    blockers = Array.isArray(json.blockers) ? json.blockers.length : Number(json.summary?.blockers || 0);
    warnings = Array.isArray(json.warnings) ? json.warnings.length : Number(json.summary?.warnings || 0);
  } else if (exists(mdPath)) {
    const text = fs.readFileSync(mdPath, 'utf8');
    const blockerMatch = text.match(/Blockers?:\s*(\d+)/i);
    const warningMatch = text.match(/Warnings?:\s*(\d+)/i);
    blockers = blockerMatch ? Number(blockerMatch[1]) : (/blocking/i.test(text) && !/No blocking/i.test(text) ? 1 : 0);
    warnings = warningMatch ? Number(warningMatch[1]) : 0;
  }
  return {
    reviewed,
    blockers,
    warnings,
    review_path: exists(jsonPath) ? rel(jsonPath) : (exists(mdPath) ? rel(mdPath) : (declaredReviewPath ? rel(declaredReviewPath) : null))
  };
}

function buildRows() {
  return planFiles().map((file) => {
    const plan = readJson(file);
    const id = plan.task_id || path.basename(file).replace(/__plan\.json$/, '');
    const outPath = outcomePath(id);
    const outcome = exists(outPath);
    const review = reviewCounts(id, plan);
    const risk = plan.routing_expectations?.risk_tier || plan.risk_tier || null;
    const phase = phaseFor(id, plan, outcome, review.reviewed, review.blockers, review.warnings);
    const score = priorityScore(id, plan, outcome, review.reviewed, review.blockers, review.warnings);
    return {
      task_id: id,
      title: plan.title || plan.description || '',
      family: familyOf(id, plan),
      phase,
      priority_score: score,
      status: plan.status || null,
      risk_tier: risk,
      review_lane: plan.routing_expectations?.review_lane || plan.review_lane || null,
      reviewed: review.reviewed,
      review_blockers: review.blockers,
      review_warnings: review.warnings,
      review_path: review.review_path,
      outcome_exists: outcome,
      outcome_path: outcome ? rel(outPath) : null,
      exact_next_command: plan.exact_next_command || null,
      plan_path: rel(file)
    };
  }).sort((a, b) => a.priority_score - b.priority_score || a.task_id.localeCompare(b.task_id));
}

function summarize(rows) {
  const byPhase = {};
  const byFamily = {};
  for (const row of rows) {
    byPhase[row.phase] = (byPhase[row.phase] || 0) + 1;
    byFamily[row.family] = (byFamily[row.family] || 0) + 1;
  }
  return {
    generated_at: new Date().toISOString(),
    total_plans: rows.length,
    by_phase: byPhase,
    by_family: byFamily
  };
}

function mdTable(rows) {
  const lines = [
    '| Rank | Task | Family | Phase | Risk | Reviewed | Warnings | Next |',
    '|---:|---|---|---|---|---|---:|---|'
  ];
  rows.forEach((row, index) => {
    const next = row.exact_next_command ? row.exact_next_command.replace(/\|/g, '\\|') : '';
    lines.push(`| ${index + 1} | \`${row.task_id}\` | ${row.family} | ${row.phase} | ${row.risk_tier || ''} | ${row.reviewed ? 'yes' : 'no'} | ${row.review_warnings} | ${next} |`);
  });
  return lines.join('\n');
}

function writeReports(rows, summary) {
  const report = {
    schema: 'ProjectPlanImplementationOrder/1.0',
    ...summary,
    rows
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const activeRows = rows.filter((row) => !['done-or-closeout-only'].includes(row.phase));
  const frontRows = rows.filter((row) => row.phase === 'front-of-queue');
  const needsReview = rows.filter((row) => row.phase === 'needs-review-before-run').slice(0, 30);
  const warningRows = rows.filter((row) => row.phase === 'ready-with-warning-review-first').slice(0, 30);
  const md = [
    '# All-Plan Implementation Order',
    '',
    `Generated: ${summary.generated_at}`,
    '',
    '## Summary',
    '',
    `- Total plans: ${summary.total_plans}`,
    `- Active/non-closeout rows: ${activeRows.length}`,
    `- Front-of-queue rows: ${frontRows.length}`,
    `- Needs review before run: ${rows.filter((row) => row.phase === 'needs-review-before-run').length}`,
    `- Ready with warning review first: ${rows.filter((row) => row.phase === 'ready-with-warning-review-first').length}`,
    '',
    '## Recommended Front Queue',
    '',
    mdTable(frontRows),
    '',
    '## Next Ready System/Framework Rows',
    '',
    mdTable(rows.filter((row) => ['ready-system-follow-on', 'ready-framework-follow-on', 'ready-backlog'].includes(row.phase)).slice(0, 40)),
    '',
    '## Needs Review Before Run',
    '',
    mdTable(needsReview),
    '',
    '## Ready With Warning Review First',
    '',
    mdTable(warningRows),
    '',
    '## Notes',
    '',
    '- This is a sortable mechanical queue, not an execution grant.',
    '- High-risk, operator-gate, hook, canonical, runtime, credential, or client-surface work still requires its declared gates.',
    '- Client-delivery rows are pushed later unless the human operator names a current client priority.'
  ].join('\n');
  fs.writeFileSync(OUT_MD, md + '\n', 'utf8');
}

function main() {
  const rows = buildRows();
  const summary = summarize(rows);
  writeReports(rows, summary);
  console.log(JSON.stringify({
    ok: true,
    json: rel(OUT_JSON),
    markdown: rel(OUT_MD),
    total_plans: rows.length,
    front_queue: rows.filter((row) => row.phase === 'front-of-queue').map((row) => row.task_id)
  }, null, 2));
}

if (require.main === module) main();

module.exports = { buildRows, summarize, familyOf, phaseFor, priorityScore };
