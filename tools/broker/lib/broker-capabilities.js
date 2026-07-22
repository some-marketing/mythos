'use strict';

/**
 * broker-capabilities.js — the Tool Broker's capability registry (the primitives
 * a brokered model may PROPOSE, each pinned to a permission layer).
 *
 * This is the structural heart of the 4-phase permission staging
 * (sovereign-core-harness concept §"4-phase Permission Staging"). Each capability
 * declares the layer it belongs to; the Tool Broker allows a capability only when
 * its layer is at or below the broker's current phase. Write and command
 * primitives are REAL entries here and classified at bounded-patch / autonomous.
 * Phase 1/2 deny them by ordinary layer classification. Phase 3 exposes only
 * fs.write through the dedicated reviewed sandbox executor; apply.diff and every
 * autonomous capability remain deny-only.
 *
 * Layer ordering (low -> high authority):
 *   read-only (1)  <  proposal (2)  <  bounded-patch (3)  <  autonomous (4)
 *
 * Read-only executors read bounded repo/signal/artifact surface (secret-denylist
 * enforced) and record analysis. Proposal executors write ONLY into the broker's
 * own proposals area (never the real target) — the reviewed-application path. The
 * broker itself never applies a proposal.
 */

const fs = require('fs');
const path = require('path');

const LAYER_ORDER = Object.freeze({
  'read-only': 1,
  proposal: 2,
  'bounded-patch': 3,
  autonomous: 4
});

const PHASE_TO_LAYER = Object.freeze({ 1: 'read-only', 2: 'proposal', 3: 'bounded-patch', 4: 'autonomous' });

// Secret-path denylist for read primitives (mirrors the run-openrouter-bridge
// egress denylist intent: a brokered read must never surface credential material).
const SECRET_PATH_DENYLIST = [
  (r) => /\.env(\.|$)/i.test(r) && !/\.example$/i.test(r),
  (r) => /credentials/i.test(r),
  (r) => /secrets?/i.test(r),
  (r) => /(^|[\\/.-])tokens?(\.[^/]+)?$/i.test(r),
  (r) => /password/i.test(r),
  (r) => /private[-_]key/i.test(r),
  (r) => /\.(pem|key)$/i.test(r),
  (r) => /keychain/i.test(r),
  (r) => /(^|[\\/])\.ssh[\\/]/i.test(r),
  (r) => /(^|[\\/])\.aws[\\/]/i.test(r)
];

function isSecretPath(rel) {
  return SECRET_PATH_DENYLIST.some((t) => t(rel));
}

/**
 * Resolve a caller-proposed relative path for a READ, enforcing:
 *   - resolution stays inside projectRoot (no traversal, no absolute escape),
 *   - the path is not on the secret denylist.
 * Returns { ok, absPath, rel, reason }.
 */
function safeResolveRead(projectRoot, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    return { ok: false, reason: 'missing path argument' };
  }
  const abs = path.resolve(projectRoot, relPath);
  const rel = path.relative(projectRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, reason: `path escapes project root: ${relPath}` };
  }
  if (isSecretPath(rel)) {
    return { ok: false, reason: `path is on the secret denylist: ${rel}` };
  }
  return { ok: true, absPath: abs, rel };
}

function readBoundedFile(projectRoot, relPath, maxBytes = 256 * 1024) {
  const resolved = safeResolveRead(projectRoot, relPath);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  if (!fs.existsSync(resolved.absPath)) {
    return { ok: false, reason: `file not found: ${resolved.rel}` };
  }
  const stat = fs.statSync(resolved.absPath);
  if (!stat.isFile()) return { ok: false, reason: `not a file: ${resolved.rel}` };
  const buf = fs.readFileSync(resolved.absPath);
  const truncated = buf.length > maxBytes;
  return {
    ok: true,
    rel: resolved.rel,
    bytes: buf.length,
    truncated,
    content: buf.slice(0, maxBytes).toString('utf8')
  };
}

// ---------------------------------------------------------------------------
// Capability registry. `execute(ctx, args)` is present ONLY for capabilities the
// broker may actually run at its phase. The one bounded-patch executor delegates
// to the phase-3 sandbox boundary; autonomous capabilities remain execute:null.
// ctx: { projectRoot, proposalsDir, recordAnalysis(fn) }
// ---------------------------------------------------------------------------
const CAPABILITIES = Object.freeze({
  // ---- read-only (phase 1) -------------------------------------------------
  'repo.read': {
    layer: 'read-only',
    describe: 'read a bounded repo file (secret-denylisted)',
    execute(ctx, args) {
      const res = readBoundedFile(ctx.projectRoot, args && args.path);
      if (!res.ok) return { ok: false, reason: res.reason };
      return { ok: true, kind: 'repo.read', path: res.rel, bytes: res.bytes, truncated: res.truncated, content: res.content };
    }
  },
  'signal.read': {
    layer: 'read-only',
    describe: 'read a coordination signal file',
    execute(ctx, args) {
      const res = readBoundedFile(ctx.projectRoot, args && args.path);
      if (!res.ok) return { ok: false, reason: res.reason };
      return { ok: true, kind: 'signal.read', path: res.rel, content: res.content };
    }
  },
  'artifact.read': {
    layer: 'read-only',
    describe: 'read a report/artifact file',
    execute(ctx, args) {
      const res = readBoundedFile(ctx.projectRoot, args && args.path);
      if (!res.ok) return { ok: false, reason: res.reason };
      return { ok: true, kind: 'artifact.read', path: res.rel, content: res.content };
    }
  },
  'analysis.emit': {
    layer: 'read-only',
    describe: 'record the model\'s read-only analysis as the deliverable text',
    execute(ctx, args) {
      const text = args && typeof args.text === 'string' ? args.text : '';
      if (!text.trim()) return { ok: false, reason: 'analysis.emit requires non-empty text' };
      if (typeof ctx.recordAnalysis === 'function') ctx.recordAnalysis(text);
      return { ok: true, kind: 'analysis.emit', chars: text.length };
    }
  },

  // ---- proposal (phase 2) --------------------------------------------------
  // These write ONLY into the broker's proposals area — never the real target.
  // Applying a proposal is an out-of-band reviewed step; the broker never applies.
  'diff.propose': {
    layer: 'proposal',
    describe: 'record a proposed diff as a review artifact (never applied)',
    execute(ctx, args) {
      const target = args && typeof args.path === 'string' ? args.path : '(unspecified)';
      const diff = args && typeof args.diff === 'string' ? args.diff : '';
      if (!diff.trim()) return { ok: false, reason: 'diff.propose requires a non-empty diff' };
      const rationale = args && typeof args.rationale === 'string' ? args.rationale : '';
      const body = [
        `# Proposed diff (NOT applied)`,
        ``,
        `Target: ${target}`,
        rationale ? `\nRationale: ${rationale}\n` : '',
        '```diff',
        diff,
        '```',
        ''
      ].join('\n');
      const out = writeProposal(ctx, 'diff', body);
      return { ok: true, kind: 'diff.propose', target, proposal_artifact: out.rel };
    }
  },
  'artifact.draft': {
    layer: 'proposal',
    describe: 'draft an artifact into the proposals area (never the real path)',
    execute(ctx, args) {
      const content = args && typeof args.content === 'string' ? args.content : '';
      if (!content.trim()) return { ok: false, reason: 'artifact.draft requires content' };
      const intendedPath = args && typeof args.relpath === 'string' ? args.relpath : 'draft.md';
      const body = `# Drafted artifact (NOT written to its real path)\n\nIntended path: ${intendedPath}\n\n---\n\n${content}\n`;
      const out = writeProposal(ctx, 'draft', body);
      return { ok: true, kind: 'artifact.draft', intended_path: intendedPath, proposal_artifact: out.rel };
    }
  },
  'signal.suggest': {
    layer: 'proposal',
    describe: 'record a suggested next-step signal (advisory, not a live signal)',
    execute(ctx, args) {
      const suggestion = args && typeof args.suggestion === 'string' ? args.suggestion : '';
      if (!suggestion.trim()) return { ok: false, reason: 'signal.suggest requires a suggestion' };
      const body = `# Suggested next-step signal (advisory only)\n\n${suggestion}\n`;
      const out = writeProposal(ctx, 'signal-suggestion', body);
      return { ok: true, kind: 'signal.suggest', proposal_artifact: out.rel };
    }
  },

  // ---- bounded-patch (phase 3, P3) -----------------------------------------
  'fs.write': {
    layer: 'bounded-patch',
    describe: 'atomically write one review-approved repo file and run one sandboxed focused test',
    execute(ctx, args) {
      if (!ctx.phase3Executor || typeof ctx.phase3Executor.execute !== 'function') {
        return { ok: false, executed: false, reason: 'phase-3 executor unavailable' };
      }
      return ctx.phase3Executor.execute(args, { now: ctx.now });
    }
  },
  'apply.diff': {
    layer: 'bounded-patch',
    describe: 'directly apply a diff to a repo file — NEVER runs in P2 (this is the phase-2 direct-apply deny path)',
    execute: null
  },

  // ---- autonomous (phase 4, HARD-STOP non-goal — DENY-ONLY) ----------------
  'shell.exec': {
    layer: 'autonomous',
    describe: 'run a shell command — autonomous; a HARD-STOP non-goal, NEVER runs',
    execute: null
  }
});

function writeProposal(ctx, kind, body) {
  const dir = ctx.proposalsDir;
  fs.mkdirSync(dir, { recursive: true });
  const stamp = (ctx.now || new Date().toISOString()).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const name = `${stamp}__${kind}__${Math.random().toString(36).slice(2, 8)}.md`;
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, body);
  return { abs, rel: path.relative(ctx.projectRoot, abs) };
}

function getCapability(name) {
  return CAPABILITIES[name] || null;
}

/**
 * Rule on a proposed capability against a broker phase WITHOUT executing it.
 * Returns { verdict, layer, reason }. verdict is 'allow' | 'deny' | 'escalate'.
 *   - unknown capability            -> deny (unregistered tool)
 *   - capability layer <= phase     -> allow
 *   - capability layer  > phase     -> deny (insufficient permission stage)
 */
function ruleCapability(name, phase) {
  const phaseLayer = PHASE_TO_LAYER[phase];
  if (!phaseLayer) return { verdict: 'deny', layer: null, reason: `invalid broker phase: ${phase}` };
  const cap = getCapability(name);
  if (!cap) {
    return { verdict: 'deny', layer: null, reason: `unregistered capability: "${name}"` };
  }
  if (LAYER_ORDER[cap.layer] <= LAYER_ORDER[phaseLayer]) {
    // Even an allowed layer requires an executor to exist for the broker to run
    // it; a null-executor capability at/under phase is a contract error, denied.
    if (typeof cap.execute !== 'function') {
      return { verdict: 'deny', layer: cap.layer, reason: `capability "${name}" has no executor (layer ${cap.layer})` };
    }
    return { verdict: 'allow', layer: cap.layer, reason: `layer ${cap.layer} permitted at phase ${phase}` };
  }
  return {
    verdict: 'deny',
    layer: cap.layer,
    reason: `capability "${name}" is layer ${cap.layer}; broker phase ${phase} permits only up to ${phaseLayer}`
  };
}

module.exports = {
  CAPABILITIES,
  LAYER_ORDER,
  PHASE_TO_LAYER,
  getCapability,
  ruleCapability,
  safeResolveRead,
  readBoundedFile,
  isSecretPath
};
