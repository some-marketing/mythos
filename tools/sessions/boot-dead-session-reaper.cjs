#!/usr/bin/env node
'use strict';

// Boot-time dead-session reaper (plan session-boundary-leak-repairs, S2).
//
// ADVISORY ONLY (gate G3): this reaper READS the pending boundary surface and
// the plan-task review-state markers and SURFACES orphaned / stale scopes with
// resume-or-tombstone options and evidence links. It NEVER consumes, archives,
// rewrites, or tombstones anything — there is no mutation code path in this
// file. Tombstoning is an operator (or explicitly delegated) action with its
// own receipt.
//
// It catches two classes the two half-boundaries used to miss:
//   1. crash-stub orphans — markers the session-end crash floor wrote for a
//      session that died without /shutdown (scope carries "unclosed-session").
//   2. stale-completed scopes — a pending marker whose referenced plan already
//      shows completion evidence in plan-task-review-state (last_event at an
//      approved/stamped/complete grade). The next consumer would RE-PLAN work
//      that is already done. Reconciliation case #1: a plan whose scope carries a versioned milestone id.

const fs = require('fs');
const path = require('path');
// READ-ONLY scan via peekPending: the advisory reaper never absorbs or moves
// the legacy single-file marker, so it performs zero writes. (The default list
// path's legacy-absorption step is a rename — a write; peekPending omits it.)
const { peekPending } = require('./lib/boundary-markers.cjs');
const { resolveCanonicalRoot } = require('../lib/canonical-root.cjs');

const REVIEW_STATE_REL = path.join('_dev', 'state', 'plan-task-review-state');
const BOUNDARY_LOG_REL = path.join('_dev', 'state', 'session-boundary-log.jsonl');

// Grade a plan-task-review-state last_event. Two distinct strengths, because an
// operator gate frequently remains AFTER distinct review passes:
//   'stale_completed'      — operator-final / explicit completion (operator_
//                            approved, operator_stamped, *_stamped, *_complete):
//                            strong "this work is done" evidence.
//   'stale_review_approved'— distinct-review approval only (distinct_review_
//                            approved*, distinct_review_complete, *_review_
//                            approved): review passed, but an operator gate may
//                            remain — sufficient to SURFACE, not to imply
//                            tombstone-readiness.
// Anything else (pending / recorded / repair / superseded) grades to null.
function gradeReviewEvent(lastEvent) {
  const e = String(lastEvent || '');
  if (!e) return null;
  // Review-chain approval is checked first so distinct_review_complete does not
  // get miscounted as operator-final by the '_complete' rule below.
  if (/^distinct_review_(approved|complete)/i.test(e) || /(^|_)review_approved$/i.test(e) || /approve[-_]with[-_](minor|repairs)/i.test(e)) {
    return 'stale_review_approved';
  }
  if (/operator_(approved|stamped)/i.test(e) || /(^|_)stamped$/i.test(e) || /(^|_)complete(d)?$/i.test(e) || /ledgers_stamped/i.test(e)) {
    return 'stale_completed';
  }
  return null;
}

function rootOf(rootOpts) {
  const opts = rootOpts || { mode: 'hard' };
  return opts.root ? opts.root : resolveCanonicalRoot(opts);
}

function safeReadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function toPosix(relPath) { return String(relPath).replace(/\\/g, '/'); }

// Candidate plan-ids a pending marker could reference: the scope itself, plus
// any non-flag, non-slash token in the recommended_next_command (e.g.
// "/plan-task example-milestone-feature-render --scope system").
function planIdCandidates(marker) {
  const out = new Set();
  if (marker.scope) out.add(String(marker.scope));
  const cmd = String(marker.recommended_next_command || '');
  const tokens = cmd.split(/\s+/);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || token.startsWith('-') || token.startsWith('/')) continue;
    // Skip a token that is the VALUE of a preceding flag (e.g. "--scope system",
    // "--client ACME"), which is a scope value, not a plan-id.
    if (i > 0 && tokens[i - 1].startsWith('--')) continue;
    out.add(token);
  }
  return [...out];
}

// Every review-state marker linked to this pending scope, exact-id or
// scope-prefixed (example-milestone -> example-milestone-feature-render).
function linkedReviewStates(projectRoot, marker) {
  const dir = path.join(projectRoot, REVIEW_STATE_REL);
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const candidates = planIdCandidates(marker);
  const scope = String(marker.scope || '');
  const linked = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const base = name.replace(/\.json$/, '');
    const full = path.join(dir, name);
    const payload = safeReadJson(full);
    if (!payload) continue;
    const planId = String(payload.plan_id || base);
    const exact = candidates.includes(base) || candidates.includes(planId);
    const prefixed = Boolean(scope) && (base === scope || base.startsWith(`${scope}-`) || planId === scope || planId.startsWith(`${scope}-`));
    if (!exact && !prefixed) continue;
    linked.push({
      plan_id: planId,
      review_state_path: toPosix(path.relative(projectRoot, full)),
      last_event: payload.last_event || null,
      updated_at: payload.updated_at || null,
      notes: payload.notes || null,
      grade: gradeReviewEvent(payload.last_event),
      review_artifacts: Array.isArray(payload.distinct_reviews)
        ? payload.distinct_reviews.map((r) => ({ actor: r.actor || null, verdict: r.verdict || null, artifact: r.artifact || null, at: r.at || null }))
        : [],
      link: exact ? 'exact-plan-id' : 'scope-prefix'
    });
  }
  return linked;
}

function readBoundaryLog(projectRoot) {
  const logPath = path.join(projectRoot, BOUNDARY_LOG_REL);
  let raw;
  try { raw = fs.readFileSync(logPath, 'utf8'); } catch { return []; }
  return raw.split('\n').map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}

// Read-only scan. Returns a DeadSessionReaperReport/1.0 with a `surfaced` list
// of flagged scopes, each carrying advisory resume-or-tombstone options and
// evidence links. Never mutates the pending surface.
function reapDeadSessions(rootOpts) {
  const projectRoot = rootOf(rootOpts);
  // peekPending is strictly read-only — it never absorbs or moves the legacy
  // single-file marker (gate G3: the advisory scan performs zero writes).
  const pending = peekPending(rootOpts);
  const log = readBoundaryLog(projectRoot);
  const surfaced = [];

  for (const entry of pending) {
    const marker = entry.payload || {};
    const scope = String(marker.scope || entry.scope || '');
    const classifications = [];

    // Class 0: an unmigrated legacy single-file marker, surfaced in place. The
    // reaper never moves it — it just reports that it exists.
    if (entry.legacy) classifications.push('legacy_marker_unmigrated');

    // Class 1: crash-stub orphan (session died without /shutdown).
    const isCrashStub = /unclosed-session/i.test(scope)
      || /mechanical stub|session-end hook/i.test(String(marker.summary || ''))
      || /session-end-close/i.test(String(marker.written_by || ''));
    if (isCrashStub) classifications.push('crash_stub_orphan');

    // Class 2: referenced plan already shows review/completion evidence.
    const reviewStates = linkedReviewStates(projectRoot, marker);
    const graded = reviewStates.filter((r) => r.grade);
    for (const grade of new Set(graded.map((r) => r.grade))) classifications.push(grade);

    if (classifications.length === 0) continue;

    const consumeCommand = `node tools/sessions/consume-boundary.cjs ${scope}`;
    const hasOperatorFinal = graded.some((r) => r.grade === 'stale_completed');
    let tombstoneNote;
    if (graded.length > 0) {
      const plans = graded.map((c) => `${c.plan_id} (${c.grade}: ${c.last_event})`).join(', ');
      tombstoneNote = hasOperatorFinal
        ? `Tombstone ONLY after the operator confirms ${plans} is complete (see completion_evidence). Archiving the stale marker prevents a future session from re-planning finished work.`
        : `Distinct review has approved ${plans}, but an operator gate may still remain — this is sufficient to SURFACE, not to imply tombstone-readiness. Tombstone ONLY after the operator confirms the referenced work needs no further action.`;
    } else {
      tombstoneNote = 'Tombstone ONLY after the operator confirms this dead session has no unfinished thread. The reaper never archives it for you.';
    }

    surfaced.push({
      scope,
      marker_path: toPosix(path.relative(projectRoot, entry.path)),
      legacy_marker: Boolean(entry.legacy),
      handoff_path: marker.handoff_path || null,
      recommended_next_command: marker.recommended_next_command || null,
      written_at: marker.written_at || marker.written_by_session || null,
      classifications,
      completion_evidence: graded,
      linked_review_states: reviewStates,
      options: {
        resume: {
          command: consumeCommand,
          note: 'Resume this scope: loads the handoff and archives the pending marker.'
        },
        tombstone: {
          command: consumeCommand,
          note: tombstoneNote
        }
      }
    });
  }

  return {
    schema: 'DeadSessionReaperReport/1.0',
    generated_at: new Date().toISOString(),
    advisory: true,
    auto_tombstone: false,
    pending_count: pending.length,
    surfaced_count: surfaced.length,
    session_end_events: log.filter((e) => e && e.event === 'session_end').length,
    surfaced
  };
}

function main() {
  const report = reapDeadSessions({ mode: 'hard' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { reapDeadSessions, linkedReviewStates, planIdCandidates, gradeReviewEvent };
