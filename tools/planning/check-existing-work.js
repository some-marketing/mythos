#!/usr/bin/env node
'use strict';

/**
 * check-existing-work.js — Pre-plan overlap detector.
 *
 * Answers "does an existing task-plan already own this scope, AND has any
 * other actor (esp. the background automation track) recently dispatched or
 * raised signals for it?" — BEFORE a new /plan-task spawns a parallel plan.
 *
 * This hardens two lessons into a mechanical check (a reliable gate belongs in
 * code, not prose):
 *   1. don't-duplicate: route to /amend-plan when an owning plan exists.
 *   2. coordinate-with-background-automation: surface recent signals/dispatches
 *      for the scope so a session does not plan over the background track.
 *
 * READ-ONLY. Advisory: exits 0 always; communicates via has_overlap + JSON.
 *
 * Usage:
 *   node tools/planning/check-existing-work.js --task "bridge lifecycle telemetry cascade" [--json] [--days 3] [--threshold 0.12]
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SIGNALS_DIR = path.join(PROJECT_ROOT, '_dev/reports/signals');
const ANALYSIS_DIR = path.join(PROJECT_ROOT, '_dev/reports/analysis');

let listAllTaskPlans;
try {
  ({ listAllTaskPlans } = require('./lib/resolve-task-plan.js'));
} catch {
  listAllTaskPlans = null;
}

// --- tiny matching engine (same approach as assess-similarity.js) ----------

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, ' ')
    .split(/[\s\-_]+/)
    .filter(w => w.length > 2);
}

const STOP = new Set(['the', 'and', 'for', 'with', 'plan', 'task', 'system', 'review', 'codex', 'distinct', 'of', 'to', 'a']);

function meaningful(tokens) {
  return tokens.filter(t => !STOP.has(t));
}

function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / (setA.size + setB.size - inter);
}

// Overlap coefficient: intersection / min(|A|,|B|). Unlike Jaccard it does not
// penalize a long document, so a query sharing key terms with a short dense
// field (taskId, title) scores high regardless of summary length.
function overlapCoeff(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / Math.min(setA.size, setB.size);
}

function safeReadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// --- args ------------------------------------------------------------------

function parseArgs(argv) {
  const out = { task: '', json: false, days: 4, threshold: 0.12 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--task' || a === '--scope') out.task = argv[++i] || '';
    else if (a === '--json') out.json = true;
    else if (a === '--days') out.days = Number(argv[++i]) || 4;
    else if (a === '--threshold') out.threshold = Number(argv[++i]) || 0.12;
    else if (!a.startsWith('--') && !out.task) out.task = a;
  }
  return out;
}

// --- plan overlap ----------------------------------------------------------

function scorePlans(queryTokens, threshold) {
  if (!listAllTaskPlans) return null; // null = library unavailable, NOT "no overlap"
  const plans = listAllTaskPlans(PROJECT_ROOT);
  const hits = [];
  for (const p of plans) {
    const j = safeReadJson(p.jsonPath) || {};
    // Dense fields (taskId + title) score by overlap coefficient (length-robust);
    // full summary scores by Jaccard as a weaker signal. Take the strongest.
    const denseTokens = meaningful(tokenize([p.taskId, j.title].filter(Boolean).join(' ')));
    const fullTokens = meaningful(tokenize([p.taskId, j.title, j.task_summary, j.description].filter(Boolean).join(' ')));
    const score = Math.max(overlapCoeff(queryTokens, denseTokens), jaccard(queryTokens, fullTokens));
    if (score >= threshold) {
      hits.push({
        task_id: p.taskId,
        scope_type: p.scopeType,
        client_code: p.clientCode,
        lifecycle_status: j.lifecycle_status || null,
        dart: j.dart_task_url || j.dart_task_id || null,
        score: Number(score.toFixed(3)),
        json_path: path.relative(PROJECT_ROOT, p.jsonPath)
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

// --- recent signal / dispatch activity (the background-track surface) -------

function recentActivity(queryTokens, days, threshold) {
  const cutoff = Date.now() - days * 86400000;
  const hits = [];
  const scan = (dir, kind, filter) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (!filter(f)) continue;
      const full = path.join(dir, f);
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile() || st.mtimeMs < cutoff) continue;
      // Filenames are often timestamp-dominated (codex-cli-run__<ts>__codex),
      // so also tokenize the scope-bearing CONTENT: signal_scope from JSON
      // signals, and the first chunk of dispatch markdown. Length-robust
      // overlap coefficient so a long body does not dilute the match.
      let bodyTokens = [];
      try {
        if (f.endsWith('.json')) {
          const j = safeReadJson(full) || {};
          bodyTokens = meaningful(tokenize([j.signal_scope, j.scope, j.recommended_next_command, j.title].filter(Boolean).join(' ')));
        } else {
          bodyTokens = meaningful(tokenize(fs.readFileSync(full, 'utf8').slice(0, 800)));
        }
      } catch { /* best-effort */ }
      const score = Math.max(
        overlapCoeff(queryTokens, meaningful(tokenize(f))),
        overlapCoeff(queryTokens, bodyTokens)
      );
      if (score >= threshold) {
        hits.push({
          kind,
          file: path.relative(PROJECT_ROOT, full),
          score: Number(score.toFixed(3)),
          mtime: new Date(st.mtimeMs).toISOString()
        });
      }
    }
  };
  // Live signals (any actor, incl. background track)
  scan(SIGNALS_DIR, 'signal', f => f.endsWith('.json'));
  // Recent codex/dispatch run artifacts (background bridge dispatches land here)
  scan(ANALYSIS_DIR, 'dispatch', f => /^(codex-cli-run|dispatch-bridge|codex-last-message)/.test(f) && f.endsWith('.md'));
  return hits.sort((a, b) => b.score - a.score);
}

// --- main ------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);
  if (!args.task.trim()) {
    console.error('Usage: node tools/planning/check-existing-work.js --task "<scope description>" [--json] [--days N] [--threshold F]');
    process.exit(2);
  }
  const queryTokens = meaningful(tokenize(args.task));
  const warnings = [];

  // Min-token guard: a 1-2 token query makes the overlap coefficient fire at ~1.0
  // on any plan sharing that token (false positive that could suppress new work).
  if (queryTokens.length < 3) {
    warnings.push(`query has only ${queryTokens.length} meaningful token(s) — overlap scores are unreliable; pass a fuller description.`);
  }

  const plans = scorePlans(queryTokens, args.threshold); // null = library unavailable
  const activity = recentActivity(queryTokens, args.days, args.threshold);
  const planLibraryAvailable = plans !== null;
  if (!planLibraryAvailable) {
    warnings.push('task-plan library unavailable (resolve-task-plan.js not loaded) — plan scan SKIPPED; result is UNCERTAIN, not clear.');
  }

  const foundSomething = (plans && plans.length > 0) || activity.length > 0;
  // has_overlap is null (UNCERTAIN) when we could not actually scan plans and found nothing —
  // never present an unverified clearance as a clean "no overlap".
  const has_overlap = foundSomething ? true : (planLibraryAvailable ? false : null);

  let recommendation;
  if (has_overlap === true) {
    recommendation = 'OVERLAP FOUND — prefer /amend-plan on the highest-scoring owning plan; check recent_activity for in-flight background dispatches before planning.';
  } else if (has_overlap === null) {
    recommendation = 'UNCERTAIN — could not fully scan (see warnings). Do NOT treat as clear; manually check task-plans + recent debriefs before planning.';
  } else {
    recommendation = 'No KEYWORD overlap detected — proceed with /plan-task, but also consult recent debrief artifacts and the expand-with-lived-context step for non-obvious connections this keyword check cannot surface.';
  }

  const result = {
    schema: 'CheckExistingWork/1.0',
    query: args.task,
    query_tokens: queryTokens,
    threshold: args.threshold,
    days: args.days,
    plan_library_available: planLibraryAvailable,
    has_overlap,
    warnings,
    overlapping_plans: plans || [],
    recent_activity: activity,
    recommendation
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return; // exit 0 (advisory)
  }

  console.log(`\nPre-plan overlap check — "${args.task}"`);
  console.log(`(threshold ${args.threshold}, last ${args.days}d)\n`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  if (warnings.length) console.log('');
  if (has_overlap === null) {
    console.log('  ? UNCERTAIN — could not fully scan; do NOT treat as clear.\n');
    return;
  }
  if (has_overlap === false) {
    console.log('  ✓ No keyword overlap — proceed, but lived-context/debrief may hold non-obvious links.\n');
    return;
  }
  if (plans && plans.length) {
    console.log('  OWNING / OVERLAPPING PLANS (prefer /amend-plan):');
    for (const p of plans) {
      console.log(`    [${p.score}] ${p.task_id} (${p.scope_type}${p.client_code ? ':' + p.client_code : ''}${p.lifecycle_status ? ', ' + p.lifecycle_status : ''})${p.dart ? ' — ' + p.dart : ''}`);
    }
    console.log('');
  }
  if (activity.length) {
    console.log('  RECENT SIGNAL / DISPATCH ACTIVITY (incl. background track — coordinate before planning):');
    for (const a of activity.slice(0, 12)) {
      console.log(`    [${a.score}] ${a.kind}  ${a.mtime.slice(0, 16)}  ${a.file}`);
    }
    console.log('');
  }
  console.log('  → ' + result.recommendation + '\n');
}

main();
