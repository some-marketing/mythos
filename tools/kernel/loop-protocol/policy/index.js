'use strict';
// policy/index.js — Self-Improving Loop Protocol SHARED POLICY MODULE.
//
// SINGLE SOURCE OF TRUTH for path classification. Every enforcement point
// (the advisory pretool hook, the protected-set generator, the promotion
// merge-gate) imports classifyPath from HERE so the classifier can never
// drift between "what the hook inspects" and "what an OS/merge boundary
// actually protects".
//
// classifyPath is a PURE function: (manifest, opts) -> { layer, reason, ... }.
// No fs, no env, no clock. loadManifest is the only fs touchpoint.
//
// CRITICAL FIX (kills C1 path-traversal + M5): normalizePath collapses `..`,
// rejects/So-classifies-as-L1 any path that escapes repo ROOT, and matching
// is casefolded. So both:
//    frameworks/../instructions/canonical/x.yaml   (was L0.5 — the C1 exploit)
//    frameworks/foo/GUARDRAILS.md                  (was L0.5 — casefold gap)
// now classify L1.
//
// Precedence (unchanged, review-passed):
//   auto_L1 (physics, unsubtractable)
//     > task-plan governed field
//     > instance floor tripwire
//     > instance L0.5 grant
//     > instance L0
//     > default-deny (L1)

const fs = require('fs');
const path = require('path');

// Repo root: this file lives at tools/kernel/loop-protocol/policy/index.js
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_MANIFEST_PATH = path.join(
  ROOT,
  'tools',
  'kernel',
  'loop-protocol',
  'protected-path-manifest.json'
);

// ---------------------------------------------------------------------------
// Glob -> RegExp. Semantics:
//   **/  -> zero-or-more path segments   (?:.*/)?
//   **   -> any chars incl. /            .*
//   *    -> any chars except /           [^/]*
// Matching is casefolded (see matchGlob), so authors may write globs in any
// case and a loop cannot dodge a rule with GUARDRAILS vs guardrails.
// ---------------------------------------------------------------------------
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$.|?+()[]{}'.indexOf(c) !== -1) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function matchGlob(glob, rel) {
  try {
    // Casefold BOTH sides so path/glob case can never be an evasion vector.
    return globToRegExp(String(glob).toLowerCase()).test(String(rel).toLowerCase());
  } catch (_) {
    return false;
  }
}

function matchAny(globs, rel) {
  if (!Array.isArray(globs)) return false;
  return globs.some((g) => matchGlob(g, rel));
}

// ---------------------------------------------------------------------------
// normalizePath — the C1/M5 fix. Returns { rel, escapes }.
//   - trims, converts backslashes to POSIX separators
//   - makes absolute paths repo-relative
//   - collapses `.` and `..` segments (posix.normalize)
//   - flags any result that escapes repo ROOT (leading `..`) as `escapes`
// The caller treats an escaping path as L1 (default-deny) — a loop cannot
// traverse out of a granted substrate into a protected dir, nor out of the
// repo entirely.
// ---------------------------------------------------------------------------
function normalizePath(fp) {
  let p = String(fp || '').trim();
  if (!p) return { rel: '', escapes: false };

  // Normalize separators to POSIX up front (handles Windows-style inputs).
  p = p.split('\\').join('/');

  if (path.isAbsolute(p) || /^[A-Za-z]:\//.test(p)) {
    // Absolute (POSIX or drive-letter) → relativize against ROOT.
    const abs = p.split('/').join(path.sep);
    let r = path.relative(ROOT, abs).split(path.sep).join('/');
    if (r === '' ) r = '.';
    const escapes = r === '..' || r.startsWith('../');
    return { rel: escapes ? p : r, escapes };
  }

  // Relative: collapse . and .. purely lexically (no fs, stays pure).
  const norm = path.posix.normalize(p).replace(/^\.\//, '');
  const escapes = norm === '..' || norm.startsWith('../');
  return { rel: norm, escapes };
}

// Back-compat alias: the hook historically called this "relativize".
function relativize(fp) {
  return normalizePath(fp).rel;
}

function loadManifest(manifestPath) {
  const p = manifestPath || DEFAULT_MANIFEST_PATH;
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Task-plan governed-field detection. A PreToolUse hook only sees {file_path,
// content}. A governed field (review_lane, required_gates, …) is enforcement
// physics wherever it lives inside a task plan, so a task-plan write whose
// content touches a governed field key is L1.
// ---------------------------------------------------------------------------
function isTaskPlanPath(manifest, rel) {
  const globs = (manifest && manifest.task_plan_path_globs) || [];
  return matchAny(globs, rel);
}

function contentTouchesGovernedField(manifest, content) {
  const fields = (manifest && manifest.task_plan_governed_fields) || [];
  if (!content) return null;
  const text = String(content);
  for (const f of fields) {
    // Match the field as a JSON/YAML key: "review_lane" or review_lane:
    const re = new RegExp('["\']?' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']?\\s*[:=]');
    if (re.test(text)) return f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// classifyPath — the core physics. PURE. Returns { layer, reason, field? }.
// Precedence: escape-guard > auto_L1 > task-plan governed field > instance
// floor > instance L0.5 grant > instance L0 > default-deny (L1).
// ---------------------------------------------------------------------------
function classifyPath(manifest, opts) {
  const { rel, escapes } = normalizePath(opts && opts.file_path);
  const content = opts && opts.content;
  const instanceId = opts && opts.instanceId;

  if (!rel) {
    return { layer: 'L1', reason: 'empty-path-default-deny' };
  }

  // 0. Confinement guard — a path that escapes repo ROOT (`..` traversal or an
  //    absolute path outside the tree) is L1. This is what kills C1: the
  //    exploit relied on `frameworks/..` NOT being collapsed; now it is, and if
  //    the collapse lands outside ROOT it default-denies.
  if (escapes) {
    return { layer: 'L1', reason: 'path-escapes-root' };
  }

  // 1. auto_L1 physics — wins even over an instance grant (e.g. a guardrails
  //    file inside a granted frameworks/** substrate stays L1). Casefolded, so
  //    frameworks/foo/GUARDRAILS.md matches **/*guardrails*.
  if (matchAny(manifest.auto_L1_globs, rel)) {
    return { layer: 'L1', reason: 'auto_L1_glob' };
  }

  // 2. task-plan governed field.
  if (isTaskPlanPath(manifest, rel)) {
    const field = contentTouchesGovernedField(manifest, content);
    if (field) {
      return { layer: 'L1', reason: 'task_plan_governed_field', field };
    }
  }

  // 3. instance-scoped mapping (add-only; default-deny outside it).
  const inst = manifest.instances && manifest.instances[instanceId];
  if (inst) {
    if (matchAny(inst.floor_tripwire_globs, rel)) {
      return { layer: 'floor', reason: 'floor_tripwire_glob' };
    }
    if (matchAny(inst.L05_grant_globs, rel)) {
      return { layer: 'L0.5', reason: 'instance_L05_grant' };
    }
    if (matchAny(inst.L0_globs, rel)) {
      return { layer: 'L0', reason: 'instance_L0_glob' };
    }
  }

  // 4. Novel / unmapped path → default-deny L1.
  return { layer: 'L1', reason: 'default_deny_unmapped' };
}

// A path is "protected" (must be operator-owned / merge-gated) iff, ignoring
// any instance grant, it classifies to a governance/operator layer. Used by
// the protected-set generator and the merge-gate.
function isProtectedLayer(layer) {
  return layer === 'L1' || layer === 'L2' || layer === 'floor';
}

module.exports = {
  ROOT,
  DEFAULT_MANIFEST_PATH,
  globToRegExp,
  matchGlob,
  matchAny,
  normalizePath,
  relativize,
  loadManifest,
  isTaskPlanPath,
  contentTouchesGovernedField,
  classifyPath,
  isProtectedLayer
};
