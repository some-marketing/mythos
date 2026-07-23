#!/usr/bin/env node
'use strict';

/**
 * pretool-arc-guard.cjs — PreToolUse hook (matcher: Write|Edit).
 * 
 * s05 ADVISORY scope-expansion guard.
 *
 * Checks if the tool write-target is within the authorized scope of the 
 * current arc. Prints an advisory warning if it is not.
 */

const path = require('path');
const { resolveActorId, readCurrentArc } = require('../lib/arc-state-writer.cjs');
const {
  checkWriteTargetAgainstArc,
  checkCrossSessionConflict
} = require('../lib/scope-expansion-detector.cjs');
const { resolveTarget } = require('../guard-now-write.cjs');
const { resolveCanonicalRoot } = require('../../lib/canonical-root.cjs');

// S0 canonical-root retrofit. This is the hot-path PreToolUse hook (Write|Edit):
// it is ADVISORY and MUST always exit 0 / NEVER block writes. Root resolution
// therefore happens INSIDE main() under the require.main try/catch: a
// location-relative mode:'hard' resolve gives us the cwd-independence fix, but if
// the root fails anchor validation (ECANONROOT) we degrade to an advisory no-op
// and return 0 rather than throwing — a broken/foreign root must never brick
// every Write/Edit in every session. The required library modules
// (arc-state-writer, scope-expansion-detector, guard-now-write) resolve their
// own root lazily, so merely loading this module also never throws.

function main() {
  let PROJECT_ROOT;
  try {
    PROJECT_ROOT = resolveCanonicalRoot({ mode: 'hard' });
  } catch (err) {
    if (err && err.code === 'ECANONROOT') {
      process.stderr.write(
        `[pretool-arc-guard] canonical repo root failed validation; ` +
        `degrading to advisory no-op (not blocking). ${err.message}\n`
      );
      return 0;
    }
    throw err;
  }

  const actorId = resolveActorId();
  const currentArc = readCurrentArc(actorId);
  
  if (!currentArc) {
    // If no arc exists, we are in awaiting-authorization or not yet opted-in.
    // MVP: only warn if an arc is expected but missing? 
    // For now, fail-open (silent).
    return 0;
  }

  // Lifecycle check: only authorized/executing arcs can write.
  const isActionable = ['authorized-for-arc', 'executing', 'closing'].includes(currentArc.lifecycle_state);
  if (!isActionable) {
    process.stderr.write(`\nGUARDRAIL WARNING: Actor ${actorId} is in state '${currentArc.lifecycle_state}' but attempted a write.\n`);
    process.stderr.write(`(actor-arc-state-machine MVP — advisory only)\n\n`);
    return 0;
  }

  const raw = process.env.CLAUDE_TOOL_INPUT || '{}';
  let input;
  try {
    input = JSON.parse(raw);
  } catch (_) {
    input = {};
  }

  const target = resolveTarget(input);
  if (!target) {
    return 0;
  }

  const result = checkWriteTargetAgainstArc(currentArc, target);
  if (!result.allowed) {
    const rel = path.relative(PROJECT_ROOT, target);
    const msg = [
      '',
      '==============================================================',
      'GUARDRAIL WARNING: Scope expansion detected (ADVISORY)',
      `Actor: ${actorId}`,
      `Arc:   ${currentArc.arc_id}`,
      `Write: ${rel}`,
      `Reason: ${result.reason}`,
      '--------------------------------------------------------------',
      'The current unit of work has declared a restricted unit-of-write.',
      'This write is outside that set. In hard-mode, this will block.',
      'Verify that you are still working on the authorized workstream.',
      '==============================================================',
      ''
    ].join('\n');
    process.stderr.write(msg);
  }

  // S2.5(a) cross-session conflict detection — LOGGING-ONLY, NEVER BLOCKS.
  //
  // Orthogonal to the arc check above (which asks "may THIS actor write here per
  // its OWN declared write-set?"). This asks "does this write collide with a
  // DIFFERENT live actor's reserved write-set?" — the cross-session race this
  // workstream exists to kill. The detector reads the S1 write-set-registry and
  // emits a typed INFO advisory line via its default logger. On a real conflict
  // we ALSO emit a telemetry event so S2.5(b) can count verified true-positives.
  //
  // COVERAGE LIMITATION (documented for follow-up): this check runs ONLY in the
  // actionable path, reusing the already-resolved `target`. Writes that hit an
  // EARLY RETURN above are NOT inspected for cross-session conflicts:
  //   - no current arc (line ~51), non-actionable lifecycle (line ~59), and
  //     unresolved target (line ~73).
  // That is the minimal safe option: it reuses target resolution and never
  // duplicates arc/input parsing on the hot path. Broadening coverage to writes
  // with no/awaiting arc (which is exactly where the registry-coverage-gap
  // signal matters most) is deferred to a follow-up slice — by then the S2.5(b)
  // empirical gate will have validated the detector's true-positive behavior in
  // the actionable path first.
  //
  // Wrapped in its own try/catch (mirrors the ECANONROOT degrade pattern): any
  // failure here degrades to a silent no-op and never affects the hook or write.
  try {
    // Session-id resolution: CLAUDE_SESSION_ID is UNSET in the live PreToolUse
    // harness, so keying the cross-session check off it alone silently degrades
    // to "no session". Recover the real id from the PreToolUse stdin payload
    // (top-level `session_id`, mirroring snapshot-current-session.cjs), then the
    // active-session registry `_current-id`, then env. Read stdin once, tolerate
    // failure (this whole block already degrades to a silent no-op on error).
    let sessionId = process.env.CLAUDE_SESSION_ID || null;
    if (!sessionId) {
      try {
        const raw = require('fs').readFileSync(0, 'utf8');
        if (raw && raw.trim()) {
          const payload = JSON.parse(raw);
          if (payload && typeof payload.session_id === 'string' && payload.session_id) {
            sessionId = payload.session_id;
          }
        }
      } catch (_stdinErr) {
        // no stdin payload available — fall through to registry/env.
      }
    }
    if (!sessionId) {
      try {
        const registry = require('../../sessions/lib/active-session-registry.js');
        if (registry && typeof registry.getActiveSessionDir === 'function') {
          const idPath = path.join(registry.getActiveSessionDir(), '_current-id');
          const value = require('fs').readFileSync(idPath, 'utf8').trim();
          if (value) sessionId = value;
        }
      } catch (_registryErr) {
        // registry unavailable — leave sessionId null, lib will resolve ambient.
      }
    }
    // Let the lib resolve ambient session/pid (sessionId/pid forwarded as hints);
    // its default logger writes the typed INFO advisory line on conflict.
    const conflict = checkCrossSessionConflict(target, { sessionId, pid: process.pid }, {});
    if (conflict && conflict.conflict === true) {
      try {
        const { appendHookEvent } = require('../../claude/lib/hook-telemetry.cjs');
        appendHookEvent({
          matcher: 'Write|Edit',
          event: 'cross-session-conflict-detected',
          detail: {
            intended_path: conflict.intended_path,
            conflicting_actor_count: conflict.conflicting_actors.length,
            registry_coverage_gap: conflict.registry_coverage_gap
          }
        });
      } catch (_telemetryErr) {
        // Telemetry failure must never affect the hot-path hook — silent no-op.
      }
    }
  } catch (_conflictErr) {
    // Cross-session detection failure degrades to advisory no-op (never blocks).
  }

  return 0; // Never block in MVP
}

if (require.main === module) {
  try {
    const code = main();
    process.exit(code);
  } catch (err) {
    process.stderr.write(`[pretool-arc-guard] ${err.message}\n`);
    process.exit(0);
  }
}

module.exports = { main };
