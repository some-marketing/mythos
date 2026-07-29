#!/usr/bin/env node
'use strict';
// pretool-loop-layer-gate.cjs — Self-Improving Loop Protocol classification hook.
//
// ROLE (post enforcement-rethink): this is an ADVISORY / TRIPWIRE layer, NOT
// the enforcement boundary. Per the 3-mind converged architecture
// (_dev/concepts/self-improving-loop-protocol/context/
// enforcement-architecture-recommendation.md), real enforcement is
// CAPABILITY-CONFINEMENT — an unprivileged loop worktree + operator-gated merge
// (see merge-gate.cjs) — because a loop can route around any in-harness
// interposition (Bash, path-traversal, env-spoof). This hook's job is to
// convert *accidental* drift into visible blocks + telemetry (a loop suddenly
// using Bash where Edit is blocked is itself a signal). It is fail-closed to a
// no-op so it can never brick the operator, and it MUST NOT be treated as the
// security boundary.
//
// SINGLE CLASSIFIER: path classification now comes from the shared policy
// module (tools/kernel/loop-protocol/policy) so the hook, the protected-set
// generator, and the merge-gate can never disagree about what a path is.
//
// STATUS: ARMED (real loop-instance detection). This hook exits 2 (deny) in
// exactly ONE case: a DEFINITIVELY-identified loop instance (env
// MYTHOS_LOOP_INSTANCE resolves to a real entry in protected-path-manifest.json)
// attempting a write to a path that is DEFINITIVELY L1/protected for it. In
// every other case — no loop signal, unknown instance, unreadable manifest,
// unparseable payload, or ANY internal error — it exits 0 (fail-open) and, when
// it would-block, emits a NOTICE on stderr. It is still NOT wired into
// dispatch-pretool.cjs; the main chain performs that one-line wiring after this
// proof (see tools/kernel/loop-protocol/KILL-SWITCH.md for rollback).
//
// WHAT IT ENFORCES (law: _dev/concepts/self-improving-loop-protocol/context/
// loop-protocol-law-candidate.md, §1 LAYER PHYSICS + §2 CLASSIFICATION
// AUTHORITY). Classification is default-deny: any enforcement-shaped or
// unmapped path is L1. An instance charter can only ADD restrictions, never
// subtract from auto_L1 physics.
//
//   L0    DRAFT               — evaluate/generate only; autonomous; no gate relaxed.
//   L0.5  FRAMEWORK-AUTONOMOUS — autonomous APPLY inside a GRANTED substrate,
//                                bounded by physics (guardrails/gate-shaped
//                                paths inside a grant stay L1) and by a grace
//                                deadline while under the adoption grace path.
//   L1    GOVERNANCE           — enforcement surface / protocol / classifier. Block-for-loop.
//   L2    OPERATOR             — money/live/irreversible/secrets/external. Block-for-loop.
//
// GATES an armed hook would apply (§ hook contract in INTERFACE.md):
//   * L1 / L2                         → block-for-loop
//   * floor tripwire                  → block (ambiguity → trip)
//   * fail→pass ratchet (a blocked/
//     unknown verdict turned into pass) → block
//   * novel / unmapped path           → L1 default-deny
//   * L0.5 with grace_deadline exceeded → block auto-apply
//
// LOOP-INSTANCE DETECTION (env-var contract, now live):
//   env MYTHOS_LOOP_INSTANCE — a NON-loop-writable signal stamped by the
//   control-loop-lobe at loop launch. Its value is the instance-id.
//     * absent / empty / whitespace-only  → actor is NOT a loop → pure no-op,
//       exit 0 (this is how the main chain and every interactive session run).
//     * present AND matches a key in manifest.instances → GOVERNED loop actor;
//       apply the layer-physics default-deny check to the pending write.
//     * present but NOT in manifest.instances → UNKNOWN instance → fail-open,
//       exit 0 (we cannot definitively govern an instance we can't resolve).
//
// Fail-open by construction: any internal error exits 0. The env var is the
// ONLY loop signal a non-loop actor could carry, and a non-loop actor never
// carries it, so a non-loop actor ALWAYS sees exit 0.

const fs = require('fs');
const path = require('path');

// SHARED policy module — the ONE classifier. See policy/index.js.
const policy = require('../loop-protocol/policy');
const {
  ROOT,
  DEFAULT_MANIFEST_PATH,
  globToRegExp,
  matchGlob,
  matchAny,
  relativize,
  loadManifest,
  isTaskPlanPath,
  contentTouchesGovernedField,
  classifyPath
} = policy;

// ============================================================================
// ARMING FLAG — OPERATOR AUTHORITY ONLY.
// Do NOT flip to true without a GATE-bootstrap ConveneReceipt and the rollback
// step in tools/kernel/loop-protocol/KILL-SWITCH.md. While false, this hook is
// a pure classification/notice engine that never blocks anything.
//
// NOTE: arming this hook does NOT make it the enforcement boundary — it makes
// the tripwire actively block accidental drift. The security boundary is
// capability-confinement (unprivileged worktree + merge-gate.cjs).
// ============================================================================
const ARMED = true;

// Verdict token sets for fail→pass ratchet detection.
const NEGATIVE_VERDICTS = new Set([
  'fail', 'failed', 'failing', 'block', 'blocked', 'deny', 'denied',
  'reject', 'rejected', 'unknown', 'error', 'false', 'no'
]);
const POSITIVE_VERDICTS = new Set([
  'pass', 'passed', 'passing', 'allow', 'allowed', 'ok', 'success',
  'approved', 'accept', 'accepted', 'true', 'yes'
]);

// classifyPath, the glob helpers, relativize, loadManifest, and the governed-
// field detectors are now imported from the shared policy module above — one
// classifier for the hook, the merge-gate, and the protected-set generator.

// ---------------------------------------------------------------------------
// fail→pass ratchet. Compares old vs new content: a shared verdict-like key
// whose value moves from a NEGATIVE verdict to a POSITIVE verdict is a ratchet
// event (turning a blocked/unknown into a pass) and must block.
// ---------------------------------------------------------------------------
function extractVerdicts(text) {
  const map = {};
  if (!text) return map;
  const re = /["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*[:=]\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?/g;
  let m;
  while ((m = re.exec(String(text))) !== null) {
    map[m[1].toLowerCase()] = m[2].toLowerCase();
  }
  return map;
}

function detectFailToPass(oldContent, newContent) {
  if (!oldContent || !newContent) return null;
  const before = extractVerdicts(oldContent);
  const after = extractVerdicts(newContent);
  for (const key of Object.keys(before)) {
    if (!(key in after)) continue;
    const ov = before[key];
    const nv = after[key];
    if (ov === nv) continue;
    if (NEGATIVE_VERDICTS.has(ov) && POSITIVE_VERDICTS.has(nv)) {
      return { key, from: ov, to: nv };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// grace deadline. An L0.5 grant under the adoption grace path may only
// auto-apply until its declared grace_deadline_iso. After it, auto-apply blocks.
// ---------------------------------------------------------------------------
function isGraceExpired(instance, now) {
  if (!instance || !instance.grace_deadline_iso) return false;
  const deadline = Date.parse(instance.grace_deadline_iso);
  if (Number.isNaN(deadline)) return false;
  const t = now instanceof Date ? now.getTime() : Date.parse(now) || Date.now();
  return t > deadline;
}

// ---------------------------------------------------------------------------
// evaluate — full decision an ARMED hook would make. Never side-effects.
// Returns { layer, reason, wouldBlock, blockReason, isLoop, notice }.
// ---------------------------------------------------------------------------
function evaluate(opts) {
  const manifest = opts.manifest;
  const instanceId = opts.instanceId || null;
  const now = opts.now || new Date();

  // Not a loop-instance → the protocol does not govern this actor. No-op.
  if (!instanceId) {
    return {
      layer: null,
      reason: 'not-a-loop-instance',
      wouldBlock: false,
      blockReason: null,
      isLoop: false,
      notice: null
    };
  }

  // FAIL-OPEN: a present-but-unresolvable instance id (not a key in the
  // manifest) is NOT a definitively-identified loop instance we can govern.
  // We must never block on an actor we cannot resolve → exit-0 no-op.
  const inst = manifest && manifest.instances && manifest.instances[instanceId];
  if (!inst) {
    return {
      layer: null,
      reason: 'unknown-instance',
      wouldBlock: false,
      blockReason: null,
      isLoop: true,
      unknownInstance: true,
      notice: '[loop-layer-gate NOTICE] loop-instance="' + instanceId +
        '" not found in protected-path-manifest — fail-open, exit 0.'
    };
  }

  const cls = classifyPath(manifest, {
    file_path: opts.file_path,
    content: opts.content,
    instanceId
  });

  const ratchet = detectFailToPass(opts.oldContent, opts.content);
  const graceExpired = cls.layer === 'L0.5' && isGraceExpired(inst, now);

  let wouldBlock = false;
  let blockReason = null;

  if (cls.layer === 'floor') {
    wouldBlock = true;
    blockReason = 'floor-tripwire';
  } else if (cls.layer === 'L1' || cls.layer === 'L2') {
    wouldBlock = true;
    blockReason = 'governance-layer(' + cls.reason + ')';
  } else if (graceExpired) {
    wouldBlock = true;
    blockReason = 'L0.5-grace-deadline-exceeded';
  }
  // A fail→pass ratchet blocks regardless of nominal layer.
  if (ratchet) {
    wouldBlock = true;
    blockReason = (blockReason ? blockReason + '+' : '') +
      'fail->pass-ratchet(' + ratchet.key + ':' + ratchet.from + '->' + ratchet.to + ')';
  }

  const rel = relativize(opts.file_path);
  const notice = wouldBlock
    ? '[loop-layer-gate NOTICE — UNARMED, no-op] WOULD BLOCK ' +
      'instance=' + instanceId + ' path=' + rel +
      ' layer=' + cls.layer + ' reason=' + blockReason +
      ' — arming is operator-gated at GATE-bootstrap.'
    : null;

  return {
    layer: cls.layer,
    reason: cls.reason,
    field: cls.field,
    ratchet,
    graceExpired,
    wouldBlock,
    blockReason,
    isLoop: true,
    notice
  };
}

// ---------------------------------------------------------------------------
// main — runtime entry. ALWAYS returns { status: 0 } while UNARMED.
// ---------------------------------------------------------------------------
function main(input) {
  try {
    const payload = (input && input.payload) || {};
    const toolInput =
      (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input :
      (payload.toolInput && typeof payload.toolInput === 'object') ? payload.toolInput :
      payload;

    const filePath = String(toolInput.file_path || '');
    const content =
      typeof toolInput.content === 'string' ? toolInput.content :
      typeof toolInput.new_string === 'string' ? toolInput.new_string : '';

    // Loop-instance detection: non-loop-writable env signal. Absent, empty, or
    // whitespace-only → NOT a loop → pure no-op below. A non-loop actor (the
    // main chain, this session) never carries this var, so it always no-ops.
    const rawInstance =
      (input && input.instanceId != null ? input.instanceId : process.env.MYTHOS_LOOP_INSTANCE);
    const instanceId = (rawInstance != null && String(rawInstance).trim() !== '')
      ? String(rawInstance).trim()
      : null;

    // No path, or not a loop actor → pure no-op.
    if (!filePath || !instanceId) {
      return { status: 0, isLoop: false };
    }

    let manifest;
    try {
      manifest = (input && input.manifest) || loadManifest(input && input.manifestPath);
    } catch (_) {
      // Manifest unreadable → fail-open no-op.
      return { status: 0, manifest_error: true };
    }

    // Pre-edit disk content is the ratchet baseline (best-effort).
    let oldContent = input && input.oldContent;
    if (oldContent === undefined) {
      try {
        const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
        oldContent = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
      } catch (_) {
        oldContent = '';
      }
    }

    const decision = evaluate({
      manifest,
      instanceId,
      file_path: filePath,
      content,
      oldContent,
      now: input && input.now
    });

    // ARMED path: the ONLY blocking case — a definitively-identified loop
    // instance writing a definitively-protected (L1/L2/floor/ratchet/grace)
    // path. decision.wouldBlock can only be true when the instance resolved
    // (unknown/absent instances short-circuit to wouldBlock:false above).
    if (ARMED && decision.wouldBlock) {
      return { status: 2, message: decision.notice, notice: decision.notice, decision };
    }

    // Not blocking: allow. Emit any NOTICE for telemetry.
    return { status: 0, decision, notice: decision.notice };
  } catch (_) {
    // Fail-open.
    return { status: 0 };
  }
}

module.exports = {
  ARMED,
  ROOT,
  DEFAULT_MANIFEST_PATH,
  NEGATIVE_VERDICTS,
  POSITIVE_VERDICTS,
  globToRegExp,
  matchGlob,
  matchAny,
  relativize,
  loadManifest,
  isTaskPlanPath,
  contentTouchesGovernedField,
  classifyPath,
  extractVerdicts,
  detectFailToPass,
  isGraceExpired,
  evaluate,
  main
};

if (require.main === module) {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    const payload = raw && raw.trim() ? JSON.parse(raw) : {};
    const result = main({ payload });
    // Emit any NOTICE to stderr (telemetry). Exit 2 ONLY on a definitive block
    // while ARMED; otherwise exit 0. Any throw is caught below → exit 0.
    if (result && result.notice) {
      process.stderr.write(result.notice + '\n');
    }
    if (ARMED && result && result.status === 2) {
      process.exit(2);
    }
    process.exit(0);
  } catch (_) {
    process.exit(0);
  }
}
