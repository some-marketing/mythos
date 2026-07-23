#!/usr/bin/env node
'use strict';

/**
 * /amend-plan authority guard — ADVISORY CLI.
 *
 * Reads a PlanAmendment/1.0 artifact and reports whether any of its divergences
 * touch executable authority fields. If they do, /amend-plan's overlay will NOT
 * be honored by /run-plan (which executes the base bounded_plan) — the change
 * must be folded in via /repair-plan (or escalated to /plan-task on
 * scope_exceeded).
 *
 * This is the amend-side complement to the guard /repair-plan already enforces
 * via classifyPairedMutation. It is ADVISORY: it always exits 0 and never blocks.
 *
 * Usage:
 *   node tools/planning/amend-authority-guard.js <amendment.json | task-id> [--json]
 *
 * When given a task-id (not a .json path), the latest __amendment__*.json for
 * that plan is resolved via the shared task-plan resolver.
 */

const fs = require('fs');
const path = require('path');

const { classifyAmendmentDivergences } = require('./lib/repair-vs-amend-classifier');

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * Resolve the amendment JSON path from a ref that is either a direct path to an
 * amendment JSON or a task-id whose latest amendment we should locate.
 */
function resolveAmendmentPath(root, ref) {
  if (!ref) return null;
  const direct = path.isAbsolute(ref) ? ref : path.resolve(root, ref);
  if (/__amendment__.*\.json$/.test(ref) && fs.existsSync(direct)) return direct;

  // Treat ref as a task-id: find the latest __amendment__*.json via the resolver.
  let resolved;
  try {
    const { resolveTaskPlanPaths, listAmendments } = require('./lib/resolve-task-plan');
    resolved = resolveTaskPlanPaths(root, ref);
    if (resolved && resolved.storageRoot) {
      const amendments = listAmendments(resolved.storageRoot, ref) || [];
      if (amendments.length > 0) {
        // listAmendments returns chronological order; take the most recent.
        const last = amendments[amendments.length - 1];
        return last.jsonPath || last.json_path || null;
      }
    }
  } catch (_) {
    // fall through to direct-path attempt
  }
  return fs.existsSync(direct) ? direct : null;
}

function main(argv) {
  const args = Array.isArray(argv) ? argv : process.argv.slice(2);
  const asJson = args.includes('--json');
  const ref = args.find((a) => !a.startsWith('--'));
  const root = projectRoot();

  const out = (obj) => {
    if (asJson) {
      process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
    }
    return obj;
  };

  if (!ref) {
    out({ ok: false, error: 'usage: amend-authority-guard <amendment.json | task-id> [--json]' });
    if (!asJson) {
      process.stderr.write('usage: amend-authority-guard <amendment.json | task-id> [--json]\n');
    }
    return 0;
  }

  const amendmentPath = resolveAmendmentPath(root, ref);
  if (!amendmentPath || !fs.existsSync(amendmentPath)) {
    out({ ok: false, error: `no amendment JSON resolved for "${ref}"` });
    if (!asJson) process.stderr.write(`[amend-authority-guard] no amendment JSON resolved for "${ref}"\n`);
    return 0;
  }

  let amendment;
  try {
    amendment = readJson(amendmentPath);
  } catch (e) {
    out({ ok: false, error: `unreadable amendment JSON: ${e.message}`, path: amendmentPath });
    return 0;
  }

  const planId = amendment.plan_id || amendment.task_id || '<task-id>';
  const result = classifyAmendmentDivergences(amendment.divergences || []);

  const payload = {
    ok: true,
    amendment_path: path.relative(root, amendmentPath),
    plan_id: planId,
    route_recommendation: result.route_recommendation,
    authority_touching: result.authority_touching,
    overlay_only: result.overlay_only,
    reasons: result.reasons,
    advisory:
      result.route_recommendation === 'repair'
        ? `This amendment changes executable authority. /run-plan executes the base bounded_plan, so the overlay will NOT be honored. Fold it in via: /repair-plan ${planId}`
        : result.route_recommendation === 'plan-task'
          ? `This amendment exceeds amendment scope. Author a new bounded plan via: /plan-task <new-bounded-task>`
          : 'Overlay-only amendment — no authority fields touched. /amend-plan is sufficient.'
  };

  out(payload);
  if (!asJson) {
    if (result.route_recommendation === 'amend') {
      process.stdout.write(`[amend-authority-guard] ${planId}: overlay-only — /amend-plan is sufficient.\n`);
    } else {
      process.stdout.write(`[amend-authority-guard] ${planId}: ${payload.advisory}\n`);
      for (const r of result.reasons) process.stdout.write(`  - ${r}\n`);
    }
  }
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, resolveAmendmentPath };
