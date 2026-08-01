#!/usr/bin/env node
'use strict';
// PreToolUse hook — write-boundary gate (harness-critical).
//
// ENFORCEMENT_FAMILY: harness-critical
//   Severs any path that would write outside the Mythos workspace or into a
//   declared observed/external repository. Closes the consent/observer violation
//   identified in the 3-mind synthesis:
//     _dev/reports/analysis/convene-runs/20260619T001214Z-orchestrator-rule-enforcement-audit/synthesis.md
//
// DESIGN (Spec §a):
//   - Resolve the write/delete target for: Write, Edit, MultiEdit (file_path),
//     and Bash with mutation operators (>, >>, rm, mv, cp, touch, tee).
//   - ALLOWLIST: Mythos repo root, additional working dir, /tmp + /private/tmp,
//     ~/Desktop/{CLIENT_CODE}-recon-* scratch paths.
//   - DENYLIST: declared observed/external repos. Denylist wins over allowlist
//     and wins over the CLAUDE_SUBAGENT_ID exemption — the linchpin from Codex.
//   - RULE: block if the path resolves under a denylisted repo OR outside the
//     allowlist. Allow if inside the allowlist.
//
// FAIL-SAFETY INVARIANTS:
//   - Fail-OPEN (allow, exit 0) on: parse error, unreadable stdin, no path
//     found, any internal exception — a broken gate must never brick a session.
//   - Fail-CLOSED (block, exit 2) when a path clearly resolves under a
//     denylisted observed repo — even if CLAUDE_SUBAGENT_ID is set.
//
// OBSERVE-ONLY by default: enforces (exit 2) only when MYTHOS_WRITE_BOUNDARY_GATE=1.
//   Otherwise logs what it WOULD block to _dev/state/write-boundary-gate/
//   <session_id>.json and allows.
//
// INLINE BYPASS (A1-class escape hatch, mech-rebase-tranche-1 T2):
//   When ENFORCING, a tool call carrying a non-empty STRUCTURED
//   `tool_input.bypass_justification` string degrades the exit-2 block to an
//   exit-0 LOUD-WARN — but ONLY for the SOFT block reasons (foreign-code,
//   outside-allowlist). The event is appended to
//   _dev/state/write-boundary-gate/bypass-ledger.jsonl flagged
//   review_status=pending-async-review. Classification is unchanged — only the
//   status mapping degrades.
//
//   CARVE-OUT (mirrors the secret gate): the DENYLIST (declared observed/
//   external repo) case is FAIL-CLOSED. A bypass_justification does NOT degrade
//   a denylist block; it stays exit-2 and the attempt is ledgered with
//   review_status=denied. Only the operator correcting the denylist config can
//   change that outcome.
//
//   The bypass justification is read from the STRUCTURED field only. The former
//   Bash `# bypass_justification:` comment path was removed — it was spoofable
//   via heredoc/quoted content (Codex finding 2).
//
// KILL-SWITCH: _dev/state/write-boundary-gate/disabled → always allow.
//
// CONTRACT: never throws. Returns { status: 0|2, reason?, target? }.

const os = require('os');
const pathMod = require('path');
const fsMod = require('fs');

// ── Config ─────────────────────────────────────────────────────────────────────
// Resolved at module load; overridable via env for tests.

function resolveProjectDir() {
  return (
    process.env.CLAUDE_PROJECT_DIR ||
    '{MYTHOS_ROOT}'
  );
}

function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p.startsWith('~/')) return pathMod.join(os.homedir(), p.slice(2));
  if (p === '~') return os.homedir();
  return p;
}

// ── Ownership / provenance config ──────────────────────────────────────────────
//
// OWNED_ORIGINS: substring/regex patterns matched against a repo's `origin`
// remote URL. A repo whose origin matches ANY entry here is OWNED (writable).
//
// OPERATOR: add your GitHub org(s) or account(s) here, e.g.:
//   'github.com/some-marketing/',
//   'github.com/{OPERATOR_NAME}-',
//   or a regex: /github\.com\/your-org\//
//
// Conservative default: only the Mythos repo's own origin is pre-declared.
// Unknown / unresolvable origin = FOREIGN when enforcing.
//
// Belt-and-suspenders: if an origin is NOT in this list AND is not the Mythos
// repo, it defaults to FOREIGN. The hardcoded path list below is kept only as
// a secondary fallback and belt-and-suspenders safety layer.
const OWNED_ORIGINS = [
  // Mythos repo — replace with your actual remote if different
  'github.com/some-marketing/Mythos',
  'github.com/some-marketing/Mythos',
  // Add operator-controlled remotes here:
  // 'github.com/your-org/',
  // 'github.com/your-username/',
];

// Module-level cache: repoRoot → origin URL string (or null if no remote)
const _repoOriginCache = new Map();

/**
 * Walk up from `startPath` to find the nearest `.git` directory.
 * Returns the repo root (directory containing `.git`), or null if not found.
 * Uses the provided `fsImpl` for testability.
 */
function resolveEnclosingGitRepo(startPath, fsImpl) {
  const fs = fsImpl || fsMod;
  let dir = pathMod.isAbsolute(startPath) ? startPath : pathMod.resolve(startPath);
  // If startPath is a file, start from its parent
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) dir = pathMod.dirname(dir);
  } catch (_) {
    dir = pathMod.dirname(dir);
  }

  const visited = new Set();
  while (true) {
    if (visited.has(dir)) break;
    visited.add(dir);
    try {
      const gitPath = pathMod.join(dir, '.git');
      if (fs.existsSync(gitPath)) return dir;
    } catch (_) { /* ignore */ }
    const parent = pathMod.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Read the `origin` remote URL for the given repo root.
 * Caches per repoRoot so we only read the git config once per process.
 * Returns the URL string, or null if no remote / can't read.
 * Uses the provided `fsImpl` for testability.
 */
function readRepoOrigin(repoRoot, fsImpl, _cacheOverride) {
  const cache = _cacheOverride !== undefined ? _cacheOverride : _repoOriginCache;
  if (cache.has(repoRoot)) return cache.get(repoRoot);

  const fs = fsImpl || fsMod;
  let origin = null;
  try {
    const configPath = pathMod.join(repoRoot, '.git', 'config');
    const raw = fs.readFileSync(configPath, 'utf8');
    // Find [remote "origin"] section and extract url =
    const match = raw.match(/\[remote\s+"origin"\][^\[]*url\s*=\s*([^\n\r]+)/s);
    if (match) origin = match[1].trim();
  } catch (_) { /* no config or unreadable */ }

  cache.set(repoRoot, origin);
  return origin;
}

/**
 * Check whether an origin URL matches any entry in OWNED_ORIGINS.
 * Each entry may be a string (substring match) or RegExp.
 */
function isOwnedOrigin(originUrl, ownedOrigins) {
  if (!originUrl) return false;
  const list = ownedOrigins || OWNED_ORIGINS;
  for (const pattern of list) {
    if (pattern instanceof RegExp) {
      if (pattern.test(originUrl)) return true;
    } else {
      if (originUrl.includes(pattern)) return true;
    }
  }
  return false;
}

/**
 * Classify a resolved path as OWNED or FOREIGN using provenance.
 *
 * Returns: 'owned' | 'foreign' | 'unknown'
 *   - 'owned': safe to write
 *   - 'foreign': block (another party's repo)
 *   - 'unknown': git resolution failed — caller applies fail-open/path-allowlist
 *
 * Precedence:
 *   1. Mythos workspace allowlist → owned (fast path, no git needed)
 *   2. .Mythos-owned marker file at repo root → owned
 *   3. origin in OWNED_ORIGINS → owned
 *   4. origin is a 3rd-party URL → foreign
 *   5. no remote configured → foreign (unknown provenance, treat conservative)
 *   6. git resolution failed (no .git found, read error) → 'unknown'
 */
function classifyOwnership(resolved, allowlist, fsImpl, ownedOrigins, _cacheOverride) {
  // Fast path: Mythos workspace allowlist (Desktop scratch handled by isAllowed)
  if (isAllowed(resolved, allowlist)) return 'owned';

  // Walk up to find enclosing git repo
  let repoRoot;
  try {
    repoRoot = resolveEnclosingGitRepo(resolved, fsImpl);
  } catch (_) {
    return 'unknown';
  }

  if (!repoRoot) {
    // Not inside any git repo — treat as foreign (unknown provenance)
    return 'foreign';
  }

  // Check for .Mythos-owned marker at repo root
  try {
    const marker = pathMod.join(repoRoot, '.Mythos-owned');
    if ((fsImpl || fsMod).existsSync(marker)) return 'owned';
  } catch (_) { /* ignore */ }

  // Read origin
  let origin;
  try {
    origin = readRepoOrigin(repoRoot, fsImpl, _cacheOverride);
  } catch (_) {
    return 'unknown';
  }

  if (isOwnedOrigin(origin, ownedOrigins)) return 'owned';

  // Origin exists but is not in our owned list → foreign
  if (origin !== null) return 'foreign';

  // No remote configured: treat as foreign (unknown provenance)
  return 'foreign';
}

// Allowlist: write-permitted roots (order does not matter for matching).
// We resolve lazily so tests can set CLAUDE_PROJECT_DIR before loading.
function getAllowlist() {
  const projectDir = resolveProjectDir();
  return [
    // Primary and alias Mythos roots
    pathMod.resolve(projectDir),
    pathMod.resolve('{MYTHOS_ROOT}'),
    // Tmp
    pathMod.resolve('/tmp'),
    pathMod.resolve('/private/tmp'),
    // Operator PII scratch (glob-style: ~/Desktop/{CLIENT_CODE}-recon-*)
    // We handle this via prefix matching in isAllowed().
    expandHome('~/Desktop'),
  ].map((p) => pathMod.resolve(p));
}

// Belt-and-suspenders path denylist (secondary check only — provenance is primary).
// Kept for fail-safe coverage when git resolution is unavailable.
function getDenylist() {
  return [
    '${HOME}/Documents/GitHub/{CLIENT_CODE}-rebuild',
    expandHome('~/Downloads/wp-content'),
    '/private/tmp/{CLIENT_CODE}-rebuild',
    '${HOME}/Documents/GitHub',
  ].map((p) => pathMod.resolve(p));
}

// ── Path resolution helpers ─────────────────────────────────────────────────────

/**
 * Resolve a raw path string against a base directory (for relative paths).
 * Returns the resolved absolute path, or null if the input is empty.
 */
function resolvePath(raw, cwd) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, ''); // strip surrounding quotes
  if (!trimmed) return null;
  if (pathMod.isAbsolute(trimmed)) return pathMod.resolve(trimmed);
  return pathMod.resolve(cwd || process.cwd(), trimmed);
}

/**
 * Resolve a path to its real (dereferenced) absolute path where possible.
 * Uses fs.realpathSync.native on the existing parent; falls back to lexical
 * path.resolve when the path or parent does not exist on disk.
 * The injected _fs is used so tests can stub this.
 */
function realResolvePath(resolved, _fs) {
  const fsImpl = _fs || fsMod;
  try {
    // If the path itself exists, realpath it directly
    return fsImpl.realpathSync.native(resolved);
  } catch (_) {
    // Path doesn't exist — try the parent dir
    try {
      const parent = pathMod.dirname(resolved);
      const realParent = fsImpl.realpathSync.native(parent);
      return pathMod.join(realParent, pathMod.basename(resolved));
    } catch (__) {
      // Parent also doesn't exist — fall back to lexical
      return resolved;
    }
  }
}

/**
 * Returns true if `resolved` is under (or equal to) `root`.
 */
function isUnder(resolved, root) {
  const r = root.endsWith(pathMod.sep) ? root : root + pathMod.sep;
  return resolved === root || resolved.startsWith(r);
}

/**
 * Returns true if the resolved path is under a denylist root.
 * Checks BOTH the lexical resolved path AND the real (symlink-dereferenced)
 * path so that a symlink under /tmp pointing into the denylist is blocked.
 * For /private/tmp/{CLIENT_CODE}-rebuild* we use prefix matching.
 */
function isDenied(resolved, denylist, _fs) {
  const paths = [resolved];
  // Also check the real path (dereferences symlinks)
  try {
    const real = realResolvePath(resolved, _fs);
    if (real && real !== resolved) paths.push(real);
  } catch (_) { /* ignore */ }

  for (const candidate of paths) {
    for (const d of denylist) {
      if (isUnder(candidate, d) || candidate === d) return true;
    }
    // Extra: /private/tmp/{CLIENT_CODE}-rebuild* glob
    const privateTmpPrefix = pathMod.resolve('/private/tmp/{CLIENT_CODE}-rebuild');
    if (candidate === privateTmpPrefix || candidate.startsWith(privateTmpPrefix)) return true;
  }
  return false;
}

/**
 * Returns true if the resolved path is under the Mythos allowlist.
 * Special case: ~/Desktop/{CLIENT_CODE}-recon-* is allowed even though ~/Desktop as a
 * whole is listed (we allow that prefix-matched directory).
 */
function isAllowed(resolved, allowlist) {
  // ~/Desktop/{CLIENT_CODE}-recon-* scratch paths (prefix match on the full dir name)
  const desktopBase = expandHome('~/Desktop');
  const desktopResolved = pathMod.resolve(desktopBase);
  if (isUnder(resolved, desktopResolved) || resolved === desktopResolved) {
    // Only allow {CLIENT_CODE}-recon-* subdirectories, not ~/Desktop as a whole
    const rel = pathMod.relative(desktopResolved, resolved);
    const topDir = rel.split(pathMod.sep)[0];
    if (topDir && topDir.startsWith('{CLIENT_CODE}-recon-')) return true;
    // If Desktop itself matches (edge case), deny unless {CLIENT_CODE}-recon prefix
    return false;
  }

  for (const root of allowlist) {
    // Skip the desktop root from the allowlist (handled above)
    if (root === desktopResolved) continue;
    if (isUnder(resolved, root) || resolved === root) return true;
  }
  return false;
}

// ── Bash path extraction ────────────────────────────────────────────────────────
// Extract write/delete target paths from a Bash command.
// Returns an array of { raw, cwd } objects — cwd is the effective working
// directory for that target (may differ from the hook's cwd when the command
// contains a cd segment).

/**
 * Split a shell command into pipe/semicolon segments for per-segment scanning.
 * Handles parenthesized subshells by stripping outer parens first.
 * Minimal: does not handle complex quoting, but good enough for hook scanning.
 */
function splitSegments(command) {
  // Strip outer subshell parens: ( cd foo && ... ) → cd foo && ...
  const stripped = command.trim().replace(/^\(\s*(.*)\s*\)$/, '$1');
  return stripped.split(/[|;&]+/);
}

/**
 * If `seg` starts with a `cd <dir>` form, return the dir string; else null.
 * Handles:  cd /abs/path   cd "quoted path"   cd 'quoted path'
 */
function extractCdTarget(seg) {
  // Match: optional leading whitespace, cd, whitespace, optional quote, path, optional quote
  const m = /^\s*cd\s+(['"]?)([^\s'";&|]+)\1\s*$/.exec(seg.trim());
  if (m) return m[2];
  return null;
}

/**
 * Extract paths from a single shell segment based on mutation operators.
 * `effectiveCwd` is the cwd that applies to relative paths in this segment
 * (may have been set by a preceding `cd` in the same command chain).
 *
 * Returns an array of { raw, cwd } objects.
 */
function extractPathsFromSegment(seg, effectiveCwd) {
  const items = [];

  // 1) Redirect write:  ... > path  or  ... >> path
  //    Exclude >&, 2>, fd redirects. Capture the token after > or >>
  const redirectRe = /(?:^|[^0-9&>])>>?\s*([^\s|;&>]+)/g;
  let m;
  while ((m = redirectRe.exec(seg)) !== null) {
    const tok = m[1].replace(/^['"]|['"]$/g, '');
    if (tok) items.push({ raw: tok, cwd: effectiveCwd });
  }

  // 2) rm, mv, cp — take the last non-flag token(s) from the segment
  //    rm: all non-flag tokens are targets
  //    mv: ALL tokens are mutation targets (source = delete, dest = write)
  //    cp: destination-only
  const trimmed = seg.trim();

  const rmRe = /(?:^|\s)rm\b([^|;&]*)/;
  const rmM = rmRe.exec(trimmed);
  if (rmM) {
    const tokens = rmM[1].trim().split(/\s+/).filter((t) => t && !t.startsWith('-'));
    for (const t of tokens) {
      const tok = t.replace(/^['"]|['"]$/g, '');
      if (tok) items.push({ raw: tok, cwd: effectiveCwd });
    }
  }

  const mvRe = /(?:^|\s)mv\b([^|;&]*)/;
  const mvM = mvRe.exec(trimmed);
  if (mvM) {
    const tokens = mvM[1].trim().split(/\s+/).filter((t) => t && !t.startsWith('-'));
    // mv: every operand is a mutation target (source = delete-from, dest = write-to)
    for (const t of tokens) {
      const tok = t.replace(/^['"]|['"]$/g, '');
      if (tok) items.push({ raw: tok, cwd: effectiveCwd });
    }
  }

  const cpRe = /(?:^|\s)cp\b([^|;&]*)/;
  const cpM = cpRe.exec(trimmed);
  if (cpM) {
    const tokens = cpM[1].trim().split(/\s+/).filter((t) => t && !t.startsWith('-'));
    if (tokens.length >= 1) {
      const dest = tokens[tokens.length - 1].replace(/^['"]|['"]$/g, '');
      if (dest) items.push({ raw: dest, cwd: effectiveCwd });
    }
  }

  // 3) touch — all non-flag tokens are new files to create
  const touchRe = /(?:^|\s)touch\b([^|;&]*)/;
  const touchM = touchRe.exec(trimmed);
  if (touchM) {
    const tokens = touchM[1].trim().split(/\s+/).filter((t) => t && !t.startsWith('-'));
    for (const t of tokens) {
      const tok = t.replace(/^['"]|['"]$/g, '');
      if (tok) items.push({ raw: tok, cwd: effectiveCwd });
    }
  }

  // 4) tee [opts] path... — ALL non-flag tokens after tee are output files
  const teeRe = /(?:^|\s)tee\b([^|;&]*)/;
  const teeM = teeRe.exec(trimmed);
  if (teeM) {
    const tokens = teeM[1].trim().split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      if (tok.startsWith('-')) continue;
      items.push({ raw: tok.replace(/^['"]|['"]$/g, ''), cwd: effectiveCwd });
      // do NOT break — collect ALL non-flag paths
    }
  }

  return items.filter((x) => x.raw);
}

/**
 * Extract all candidate write/delete target paths from a Bash command.
 * Returns an array of { raw, cwd } objects where cwd is the effective
 * working directory for resolving relative paths in that target.
 *
 * Handles cwd-changing forms:
 *   cd <dir> && <cmd>
 *   cd <dir>; <cmd>
 *   ( cd <dir> && <cmd> )
 *   sh -c 'cd <dir> && <cmd>'
 *   eval 'cd <dir> && <cmd>'
 */
function extractBashTargetPaths(command, baseCwd) {
  if (!command || typeof command !== 'string') return [];

  // Peel sh -c '...' and eval '...' wrappers to get the inner command
  const shRe = /^\s*(?:sh\s+-c|eval)\s+(['"])(.*)\1\s*$/s;
  const shMatch = shRe.exec(command);
  if (shMatch) {
    // Recursively process the inner command with the same baseCwd
    return extractBashTargetPaths(shMatch[2], baseCwd);
  }

  const segments = splitSegments(command);
  const items = [];

  // Track the effective cwd as we walk segments left-to-right.
  // A `cd <dir>` segment updates it; subsequent segments inherit it.
  let effectiveCwd = baseCwd || process.cwd();

  for (const seg of segments) {
    const trimmedSeg = seg.trim();
    if (!trimmedSeg) continue;

    // Check if this segment is purely a `cd` command
    const cdTarget = extractCdTarget(trimmedSeg);
    if (cdTarget !== null) {
      // Update the effective cwd for subsequent segments
      if (pathMod.isAbsolute(cdTarget)) {
        effectiveCwd = cdTarget;
      } else {
        effectiveCwd = pathMod.resolve(effectiveCwd, cdTarget);
      }
      // A bare `cd` does not itself write anything
      continue;
    }

    // If the segment starts with `cd <dir>` followed by other content on the
    // same segment (shouldn't normally happen after split, but guard it)
    const inlineCdRe = /^\s*cd\s+(['"]?)([^\s'";&|]+)\1\s+(.+)$/s;
    const inlineCd = inlineCdRe.exec(trimmedSeg);
    if (inlineCd) {
      const dir = inlineCd[2];
      const rest = inlineCd[3];
      const segCwd = pathMod.isAbsolute(dir) ? dir : pathMod.resolve(effectiveCwd, dir);
      // Extract from the rest using the new cwd
      items.push(...extractPathsFromSegment(rest, segCwd));
      continue;
    }

    items.push(...extractPathsFromSegment(trimmedSeg, effectiveCwd));
  }

  return items;
}

// ── State helpers (mirrors pretool-write-boundary-gate.cjs) ───────────────

function resolveSessionId(payload) {
  return (
    String((payload && payload.session_id) || '').trim() ||
    process.env.CLAUDE_SESSION_ID ||
    process.env.CLAUDE_SESSION ||
    ('day-' + new Date().toISOString().slice(0, 10))
  );
}

function loadWbState(stateFile, fs) {
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      // Spread parsed FIRST (carries forward unknown keys), then
      // override the three critical fields with validated values so a
      // malformed state file cannot overwrite them with invalid types
      // (e.g. a non-array wb_log would cause push() to throw and
      // trigger the fail-open catch in main(), disabling enforcement).
      return {
        ...parsed,
        wb_blocked: Number.isFinite(parsed.wb_blocked) ? parsed.wb_blocked : 0,
        wb_observed: Number.isFinite(parsed.wb_observed) ? parsed.wb_observed : 0,
        wb_log: Array.isArray(parsed.wb_log) ? parsed.wb_log : [],
      };
    }
  } catch (_) {
    // missing or corrupt
  }
  return { wb_blocked: 0, wb_observed: 0, wb_log: [] };
}

function saveWbState(stateFile, state, fs, path) {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const toWrite = {
      ...state,
      wb_log: (state.wb_log || []).slice(-50),
    };
    fs.writeFileSync(stateFile, JSON.stringify(toWrite, null, 2) + '\n');
  } catch (_) {
    // best-effort; never throw
  }
}

// ── Block messages ─────────────────────────────────────────────────────────────
// Contract (grounding adjustment 4): every block message states
// rule (what fired), evidence (what matched), next-step (sanctioned way out).

// blockMessage: the SOFT outside-workspace case (outside-allowlist, git-unknown).
// This case DOES have an inline bypass path, so it advertises it.
function blockMessage(target) {
  return (
    'BLOCKED_WRITE_BOUNDARY: rule: writes must stay inside the Mythos workspace. ' +
    'evidence: Target ' + (target || '<unknown>') + ' resolves outside the workspace allowlist. ' +
    'next-step: write under the Mythos workspace (or /tmp scratch) instead; if this block is wrong, ' +
    're-issue the call with a bypass_justification string (degrades to loud-warn, ledgered for async review).'
  );
}

// denylistBlockMessage: the HARD observed-repo case. Fail-CLOSED — there is NO
// inline bypass path for a denylisted observed repo (Codex findings 1 & 3), so
// this message must NOT advertise one. A supplied bypass_justification is
// ledgered as a DENIED attempt, not honored.
function denylistBlockMessage(target) {
  return (
    'BLOCKED_WRITE_BOUNDARY: rule: this path is a declared observed/external repo — ' +
    'we are observers and never write there. This is a HARD, fail-closed block. ' +
    'evidence: Target ' + (target || '<unknown>') + ' resolves under a denylisted observed repo. ' +
    'next-step: write under the Mythos workspace (or /tmp scratch) instead. There is NO inline ' +
    'bypass for observed-repo writes; a bypass_justification will be ledgered as a DENIED attempt. ' +
    'If this denylist entry is wrong, the operator must correct the denylist configuration.'
  );
}

function foreignBlockMessage(target) {
  return (
    'BLOCKED_FOREIGN_CODE: rule: this path belongs to a repo we observe, not own — ' +
    'we don\'t modify another party\'s code. ' +
    'evidence: Target ' + (target || '<unknown>') + ' classified foreign by git-origin provenance. ' +
    'next-step: route the change through the handoff framework ' +
    '(observational handoff + tests for them to apply); if this block is wrong, ' +
    're-issue the call with a bypass_justification string (degrades to loud-warn, ledgered for async review).'
  );
}

// ── Inline bypass (A1-class degrade path) ──────────────────────────────────────

const BYPASS_LEDGER_FILENAME = 'bypass-ledger.jsonl';

/**
 * Extract an inline bypass justification from the tool call, if present.
 * STRUCTURED-ONLY source: the `tool_input.bypass_justification` field.
 *
 * The prior Bash `# bypass_justification: <text>` comment path was REMOVED
 * (Codex finding 2, spoofing): it scanned the whole command with a multiline
 * `$`, so a heredoc body or quoted string containing that comment could
 * spoof-authorize a bypass. Only the structured field — which the model must
 * set deliberately on the tool call — is honored now.
 *
 * `toolToken` is retained for signature stability but is no longer consulted.
 * Returns the trimmed justification string, or null.
 */
function extractBypassJustification(toolToken, toolInput) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  if (typeof input.bypass_justification === 'string' && input.bypass_justification.trim()) {
    return input.bypass_justification.trim();
  }
  return null;
}

/**
 * Append a bypass event to the gate's soak/bypass ledger, flagged for async
 * review. Best-effort: never throws.
 */
function appendBypassLedger(stateDir, entry, fs, path) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.appendFileSync(
      path.join(stateDir, BYPASS_LEDGER_FILENAME),
      JSON.stringify(entry) + '\n'
    );
  } catch (_) {
    // best-effort; never throw
  }
}

/**
 * Degrade an enforcing-mode block to an exit-0 loud-warn because the tool call
 * carried a bypass_justification. Records the event in session state AND the
 * bypass ledger (review_status: pending-async-review), then allows.
 */
function bypassDegrade(ctx) {
  const {
    reason, resolved, toolToken, isSubagent, sessionId, justification,
    msg, state, stateFile, stateDir, fs, path,
  } = ctx;
  state.wb_bypassed = (state.wb_bypassed || 0) + 1;
  saveWbState(stateFile, state, fs, path);
  appendBypassLedger(stateDir, {
    ts: new Date().toISOString(),
    gate: 'write-boundary',
    session_id: sessionId,
    reason,
    target: resolved,
    tool: toolToken,
    subagent: isSubagent,
    bypass_justification: justification,
    review_status: 'pending-async-review',
  }, fs, path);
  process.stderr.write(
    '[WRITE-BOUNDARY BYPASS] LOUD-WARN: exit-2 block degraded to allow by inline ' +
    'bypass_justification — event ledgered to ' + BYPASS_LEDGER_FILENAME +
    ' and FLAGGED FOR ASYNC REVIEW. justification: "' + justification + '". ' + msg + '\n'
  );
  return { status: 0, reason: reason + '-bypassed', target: resolved };
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * main({ tool, payload, _fs, _path, _allowlist, _denylist, _cwd })
 *   → { status: 0|2, reason?, target? }
 *
 * tool: lowercase tool token (optional — extracted from payload.tool_name if omitted)
 * payload: the PreToolUse JSON payload from stdin
 * _fs / _path: dependency injection for tests
 * _allowlist / _denylist: override config arrays for tests
 * _cwd: override cwd for tests
 */
function main(options, _injected) {
  // SAFETY: always fail-open on any internal exception
  try {
    return _main(options, _injected);
  } catch (_err) {
    return { status: 0, reason: 'fail-open-exception' };
  }
}

function _main(options, _injected) {
  const fs = (_injected && _injected.fs) || require('fs');
  const path = (_injected && _injected.path) || pathMod;
  const cwd = (_injected && _injected.cwd) || process.cwd();

  const allowlist = (_injected && _injected.allowlist) || getAllowlist();
  const denylist = (_injected && _injected.denylist) || getDenylist();
  // Ownership config: injectable for tests
  const ownedOrigins = (_injected && _injected.ownedOrigins) || OWNED_ORIGINS;
  // Per-call cache override: tests pass a fresh Map per call to avoid cross-test pollution
  const repoOriginCache = (_injected && _injected.repoOriginCache) || undefined;

  // ── Resolve payload ──────────────────────────────────────────────────────────
  let payload = {};
  if (options && options.payload && typeof options.payload === 'object') {
    payload = options.payload;
  } else if (!options || !options.payload) {
    try {
      const raw = fs.readFileSync(0, 'utf8');
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') payload = parsed;
      }
    } catch (_) {
      // unreadable stdin → fail-open (SAFETY INVARIANT)
      return { status: 0, reason: 'fail-open-stdin' };
    }
  }

  // ── Tool identification ──────────────────────────────────────────────────────
  const toolToken =
    String((options && options.tool) || '').trim() ||
    String(payload.tool_name || payload.tool || process.env.CLAUDE_TOOL_NAME || '').toLowerCase();

  if (!toolToken) {
    return { status: 0, reason: 'no-tool-name' };
  }

  const toolInput =
    (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input :
    (() => {
      try { return JSON.parse(process.env.CLAUDE_TOOL_INPUT || '{}') || {}; } catch { return {}; }
    })();

  // ── Collect candidate target paths ──────────────────────────────────────────
  // Each item is { raw: string, cwd: string } where cwd is the effective
  // working directory for resolving relative paths (may differ from hook cwd
  // when the Bash command contains a `cd` prefix).
  const rawPathItems = [];

  if (toolToken === 'write' || toolToken === 'edit') {
    const fp = String(toolInput.file_path || '');
    if (fp) rawPathItems.push({ raw: fp, cwd });
  } else if (toolToken === 'multiedit') {
    const fp = String(toolInput.file_path || '');
    if (fp) rawPathItems.push({ raw: fp, cwd });
    if (Array.isArray(toolInput.edits)) {
      for (const e of toolInput.edits) {
        const efp = e && String(e.file_path || '');
        if (efp) rawPathItems.push({ raw: efp, cwd });
      }
    }
  } else if (toolToken === 'bash') {
    const cmd = String(toolInput.command || toolInput.cmd || '');
    rawPathItems.push(...extractBashTargetPaths(cmd, cwd));
  } else {
    // Not a write-family tool — nothing to check
    return { status: 0, reason: 'not-write-tool' };
  }

  // No candidate paths found → fail-open (SAFETY INVARIANT)
  if (rawPathItems.length === 0) {
    return { status: 0, reason: 'no-path-found' };
  }

  // ── Resolve + classify each candidate path ──────────────────────────────────
  const projectDir = resolveProjectDir();
  const sessionId = resolveSessionId(payload);
  const stateDir = path.join(projectDir, '_dev', 'state', 'write-boundary-gate');
  const stateFile = path.join(stateDir, sessionId + '.json');

  // Kill-switch: _dev/state/write-boundary-gate/disabled → always allow
  const disabledMarker = path.join(stateDir, 'disabled');
  const killed = (() => { try { return fs.existsSync(disabledMarker); } catch { return false; } })();
  if (killed) {
    return { status: 0, reason: 'kill-switch-file' };
  }

  // Gate mode
  const enforcingRaw = String(process.env.MYTHOS_WRITE_BOUNDARY_GATE || '').trim().toLowerCase();
  const enforcing = ['1', 'true', 'yes', 'on'].includes(enforcingRaw);

  // Subagent flag — used below with denylist-aware exemption
  const isSubagent = !!process.env.CLAUDE_SUBAGENT_ID;

  // Inline bypass justification (A1-class escape hatch) — only consulted when
  // enforcing; never changes classification, only the status mapping.
  const bypassJustification = extractBypassJustification(toolToken, toolInput);

  // Scan all candidate paths
  for (const { raw, cwd: itemCwd } of rawPathItems) {
    const resolved = resolvePath(raw, itemCwd);
    if (!resolved) continue;

    const denied = isDenied(resolved, denylist, fs);
    const allowed = isAllowed(resolved, allowlist);

    // Case 1: Path is under a denylisted observed repo.
    //   HARD BLOCK even for subagents. FAIL-CLOSED — no inline bypass degrade.
    //   (Codex finding 1: a bypass_justification must NOT downgrade a denylist
    //   block. This mirrors the secret-gate carve-out. Any justification present
    //   is ledgered as an attempted-and-DENIED bypass, never honored.)
    if (denied) {
      const msg = denylistBlockMessage(resolved);
      const logEntry = {
        ts: new Date().toISOString(),
        gate: 'write-boundary',
        reason: 'denylist',
        target: resolved,
        tool: toolToken,
        mode: enforcing ? 'blocking' : 'observe-only',
        subagent: isSubagent,
      };
      const state = loadWbState(stateFile, fs);
      state.wb_log.push(logEntry);
      if (enforcing) {
        state.wb_blocked = (state.wb_blocked || 0) + 1;
        // Denylist is fail-closed: a supplied bypass_justification is recorded
        // as a DENIED bypass attempt and does NOT change the exit-2 outcome.
        if (bypassJustification) {
          logEntry.bypass_attempted = true;
          logEntry.bypass_denied = true;
          appendBypassLedger(stateDir, {
            ts: new Date().toISOString(),
            gate: 'write-boundary',
            session_id: sessionId,
            reason: 'denylist',
            target: resolved,
            tool: toolToken,
            subagent: isSubagent,
            bypass_justification: bypassJustification,
            review_status: 'denied',
            note: 'denylist is fail-closed; inline bypass NOT honored (observed-repo write)',
          }, fs, path);
        }
        saveWbState(stateFile, state, fs, path);
        process.stderr.write(msg + '\n');
        if (bypassJustification) {
          process.stderr.write(
            '[WRITE-BOUNDARY] inline bypass_justification IGNORED for denylist ' +
            '(fail-closed observed-repo block) — attempt ledgered review_status=denied. ' +
            'justification: "' + bypassJustification + '".\n'
          );
        }
        return { status: 2, reason: 'denylist', target: resolved };
      } else {
        state.wb_observed = (state.wb_observed || 0) + 1;
        saveWbState(stateFile, state, fs, path);
        process.stderr.write(
          '[WRITE-BOUNDARY observe-only] WOULD BLOCK (denylist): ' + resolved +
          ' — set MYTHOS_WRITE_BOUNDARY_GATE=1 to enforce. ' + msg + '\n'
        );
        return { status: 0, reason: 'denylist-observed', target: resolved };
      }
    }

    // Case 2: Path is outside the allowlist (and not denied — covered above).
    //   PRIMARY CHECK: classify ownership via git repo provenance.
    //   Subagents are exempt from non-foreign paths unless denylist applies.
    if (!allowed) {
      // ── Provenance classification ──────────────────────────────────────────
      // Fail-safe: if git resolution fails → 'unknown'; we treat 'unknown'
      // as fail-open (fall back to path-allowlist behaviour: block outside
      // allowlist in enforce mode, log in observe-only). We never brick a
      // session on git errors.
      let ownership;
      try {
        ownership = classifyOwnership(resolved, allowlist, fs, ownedOrigins, repoOriginCache);
      } catch (_) {
        ownership = 'unknown';
      }

      // OWNED via provenance → allow (e.g., owned fork whose origin is in OWNED_ORIGINS,
      // or .Mythos-owned marker, or allowlist fast-path — already handled above but
      // classifyOwnership checks allowlist internally too as belt-and-suspenders)
      if (ownership === 'owned') {
        // owned by provenance but outside the explicit allowlist roots — allow + log
        process.stderr.write(
          '[WRITE-BOUNDARY] provenance-owned (not in allowlist roots but git origin is ours): ' + resolved + '\n'
        );
        continue;
      }

      // FOREIGN via provenance → use dedicated foreign-code block message
      if (ownership === 'foreign') {
        const msg = foreignBlockMessage(resolved);
        const logEntry = {
          ts: new Date().toISOString(),
          gate: 'write-boundary',
          reason: 'foreign-code',
          target: resolved,
          tool: toolToken,
          mode: enforcing ? 'blocking' : 'observe-only',
          subagent: isSubagent,
          ownership,
        };
        const state = loadWbState(stateFile, fs);
        state.wb_log.push(logEntry);
        if (enforcing && !isSubagent && bypassJustification) {
          logEntry.bypass = true;
          return bypassDegrade({
            reason: 'foreign-code', resolved, toolToken, isSubagent, sessionId,
            justification: bypassJustification, msg, state, stateFile, stateDir, fs, path,
          });
        }
        if (enforcing && !isSubagent) {
          state.wb_blocked = (state.wb_blocked || 0) + 1;
          saveWbState(stateFile, state, fs, path);
          process.stderr.write(msg + '\n');
          return { status: 2, reason: 'foreign-code', target: resolved };
        } else {
          state.wb_observed = (state.wb_observed || 0) + 1;
          saveWbState(stateFile, state, fs, path);
          if (isSubagent && enforcing) {
            process.stderr.write(
              '[WRITE-BOUNDARY observe-only] subagent exempt (foreign-code, not denied): ' + resolved + '\n'
            );
          } else {
            process.stderr.write(
              '[WRITE-BOUNDARY observe-only] WOULD BLOCK (foreign-code): ' + resolved +
              ' — set MYTHOS_WRITE_BOUNDARY_GATE=1 to enforce. ' + msg + '\n'
            );
          }
          return { status: 0, reason: 'foreign-code-observed', target: resolved };
        }
      }

      // UNKNOWN (git resolution failed) — fall back to pre-provenance logic:
      // subagent-exempt or outside-allowlist block/observe
      if (isSubagent) {
        const logEntry = {
          ts: new Date().toISOString(),
          gate: 'write-boundary',
          reason: 'outside-allowlist-subagent-exempt',
          target: resolved,
          tool: toolToken,
          mode: enforcing ? 'blocking' : 'observe-only',
          subagent: true,
          ownership: 'unknown',
        };
        const state = loadWbState(stateFile, fs);
        state.wb_log.push(logEntry);
        state.wb_observed = (state.wb_observed || 0) + 1;
        saveWbState(stateFile, state, fs, path);
        process.stderr.write(
          '[WRITE-BOUNDARY observe-only] subagent exempt (outside allowlist, git-unknown): ' + resolved + '\n'
        );
        continue;
      }

      const msg = blockMessage(resolved);
      const logEntry = {
        ts: new Date().toISOString(),
        gate: 'write-boundary',
        reason: 'outside-allowlist',
        target: resolved,
        tool: toolToken,
        mode: enforcing ? 'blocking' : 'observe-only',
        subagent: false,
        ownership: 'unknown',
      };
      const state = loadWbState(stateFile, fs);
      state.wb_log.push(logEntry);
      if (enforcing && bypassJustification) {
        logEntry.bypass = true;
        return bypassDegrade({
          reason: 'outside-allowlist', resolved, toolToken, isSubagent, sessionId,
          justification: bypassJustification, msg, state, stateFile, stateDir, fs, path,
        });
      }
      if (enforcing) {
        state.wb_blocked = (state.wb_blocked || 0) + 1;
        saveWbState(stateFile, state, fs, path);
        process.stderr.write(msg + '\n');
        return { status: 2, reason: 'outside-allowlist', target: resolved };
      } else {
        state.wb_observed = (state.wb_observed || 0) + 1;
        saveWbState(stateFile, state, fs, path);
        process.stderr.write(
          '[WRITE-BOUNDARY observe-only] WOULD BLOCK (outside allowlist, git-unknown): ' + resolved +
          ' — set MYTHOS_WRITE_BOUNDARY_GATE=1 to enforce. ' + msg + '\n'
        );
        return { status: 0, reason: 'outside-allowlist-observed', target: resolved };
      }
    }
    // else: allowed — continue checking remaining paths
  }

  // All resolved paths are within the allowlist
  return { status: 0, reason: 'allowed' };
}

// ── Exports (for tests and dispatcher wiring) ──────────────────────────────────
module.exports = {
  appendBypassLedger,
  blockMessage,
  denylistBlockMessage,
  BYPASS_LEDGER_FILENAME,
  classifyOwnership,
  extractBypassJustification,
  extractBashTargetPaths,
  extractCdTarget,
  foreignBlockMessage,
  getAllowlist,
  getDenylist,
  isAllowed,
  isDenied,
  isOwnedOrigin,
  isUnder,
  main,
  OWNED_ORIGINS,
  readRepoOrigin,
  realResolvePath,
  resolvePath,
  resolveEnclosingGitRepo,
};

// ── Standalone entry ────────────────────────────────────────────────────────────
if (require.main === module) {
  try {
    const result = main();
    process.exit(result && result.status === 2 ? 2 : 0);
  } catch (_) {
    // fail-open
    process.exit(0);
  }
}
