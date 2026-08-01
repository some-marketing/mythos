#!/usr/bin/env node
'use strict';
// PreToolUse hook — git custody gate (actor-custody-commit-gate, S2).
//
// Intercepts `git add` and `git commit` Bash commands and classifies each
// affected path as OWN / FOREIGN / UNKNOWN relative to the current session.
//
// GATE POSTURE (authoritative — see concept.md § Gate posture):
//   - OWN paths   → PASS.
//   - FOREIGN paths (positively in another live session's write_log.json,
//     other != current) → HARD BLOCK (exit 2). Enforcing from day one:
//     we only block on positive proof of foreignness.
//   - UNKNOWN paths (in no session's write_log) → PASS + record as
//     unresolved_custody in per-session state. Fail-open: unknown ≠ foreign.
//
// STRICT MODE: a second, harder mode ("block anything not positively OWN")
//   stays advisory-only behind env MYTHOS_GIT_CUSTODY_GATE=1.
//   Do NOT enable by default.
//
// KILL-SWITCH: _dev/state/git-custody-gate/disabled → observe-only (no block).
//
// PER-SESSION STATE: _dev/state/git-custody-gate/<session_id>.json
//   { gc_blocked, gc_observed, gc_log:[{ts, action, paths, classification}] }
//   Atomic write: temp file + rename.
//
// FAIL-OPEN INVARIANTS:
//   - Any internal error → treat paths as UNKNOWN → pass.
//   - A broken gate MUST NOT brick a session.
//   - Over-expansion (false block) is worse than under-expansion (miss).
//
// THREAT MODEL + SUPPORTED SHAPES (heuristic, not a shell parser):
//   This gate targets ACCIDENTAL cross-actor clobbering by concurrent sessions,
//   NOT a malicious actor deliberately evading enforcement. It recognizes git
//   add/commit across top-level compound segments (&&, ||, ;, |, &, newline),
//   leading/mid-chain `cd`, `git -C`, env/`env` prefixes, sh/bash/zsh -c and
//   eval wrappers, and single-level subshell/group wrappers ( ) / { }.
//   KNOWN UNCOVERED (out of scope by design — would need a real shell parser and
//   risks false-blocks, which this gate's posture rejects): command substitution
//   `$(git add x)`, paths piped into `xargs git add`, and deeper nested
//   indirection that keeps `git` out of top-level command position. These remain
//   fail-open MISSES, consistent with "over-block is worse than under-block".
//
// CONTRACT: exit 0 unless HARD BLOCKING a positively foreign path (exit 2).

const fsMod = require('fs');
const pathMod = require('path');
const { execSync } = require('child_process');

function resolveProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || '{MYTHOS_ROOT}';
}

// ── Session-id resolution ──────────────────────────────────────────────────────
// Precedence: payload.session_id → CLAUDE_SESSION_ID → CLAUDE_SESSION →
//   active-sessions _current-id → day-<date>
function resolveSessionId(payload, fs, projectDir) {
  if (payload && typeof payload.session_id === 'string' && payload.session_id.trim()) {
    return payload.session_id.trim();
  }
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  if (process.env.CLAUDE_SESSION) return process.env.CLAUDE_SESSION;
  try {
    const registry = require(
      pathMod.join(projectDir, 'tools', 'sessions', 'lib', 'active-session-registry.js')
    );
    if (registry && typeof registry.getActiveSessionDir === 'function') {
      const idPath = pathMod.join(registry.getActiveSessionDir(), '_current-id');
      const value = (fs || fsMod).readFileSync(idPath, 'utf8').trim();
      if (value) return value;
    }
  } catch (_) { /* best-effort */ }
  return 'day-' + new Date().toISOString().slice(0, 10);
}

// ── Git command detection ──────────────────────────────────────────────────────

// Peel sh -c / bash -c / zsh -c / eval '...' wrappers (mirrors write-boundary-gate).
function peelShWrapper(command) {
  const shRe = /^\s*(?:(?:ba|z)?sh\s+-c|eval)\s+(['"])(.*)\1\s*$/s;
  const m = shRe.exec(command);
  return m ? m[2] : command;
}

// Strip leading `cd <dir> &&` prefix; return { dir, rest } or null.
function stripCdPrefix(command) {
  const m = /^\s*cd\s+(['"]?)([^\s'";&|]+)\1\s*(?:&&|;)\s*(.*)/s.exec(command.trim());
  if (!m) return null;
  return { dir: m[2], rest: m[3].trim() };
}

// Normalize a command string, peeling wrappers and stripping cd prefixes.
// Returns { normalized: string, cwd: string }.
function normalizeCommand(command, baseCwd) {
  let cmd = peelShWrapper(command.trim());
  let cwd = baseCwd;
  const cd = stripCdPrefix(cmd);
  if (cd) {
    cwd = pathMod.isAbsolute(cd.dir) ? cd.dir : pathMod.resolve(baseCwd, cd.dir);
    cmd = cd.rest;
  }
  return { normalized: cmd.trim(), cwd };
}

// Git global options that consume a separate operand token (not a subcommand).
// Format: exact flag string -> true if it takes a separate next-token operand.
const GIT_GLOBAL_OPTS_WITH_ARG = new Set([
  '-C',             // -C <path>     working directory
  '-c',             // -c <name=val> config override
  '--git-dir',      // --git-dir=<path> or --git-dir <path>
  '--work-tree',    // --work-tree=<path> or --work-tree <path>
  '--namespace',    // --namespace=<name> or --namespace <name>
  '--exec-path',    // --exec-path[=<path>]
]);

// Git global boolean flags (no operand) — skip them while looking for subcommand.
const GIT_GLOBAL_BOOL_FLAGS = new Set([
  '-p', '--paginate',
  '-P', '--no-pager',
  '--version',
  '--help',
  '--html-path',
  '--man-path',
  '--info-path',
  '--bare',
  '--no-replace-objects',
  '--literal-pathspecs',
  '--glob-pathspecs',
  '--noglob-pathspecs',
  '--icase-pathspecs',
  '--no-optional-locks',
]);

// Tokenize a shell command string into tokens, preserving quoted strings as
// single tokens.  Returns an array of { text: string, end: number } where
// `end` is the character index in `source` just past this token.
//
// This is used by detectGitAction so we can recover the original substring
// AFTER the git subcommand (preserving quoting) to pass to parseGitArgs
// without losing multi-word quoted strings.
function shellTokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    // skip whitespace
    while (i < source.length && /\s/.test(source[i])) i++;
    if (i >= source.length) break;
    // collect a token
    let text = '';
    let inQuote = null;
    const start = i;
    while (i < source.length) {
      const ch = source[i];
      if (inQuote) {
        if (ch === inQuote) { inQuote = null; i++; }
        else { text += ch; i++; }
      } else if (ch === '"' || ch === "'") {
        inQuote = ch; i++;
      } else if (/\s/.test(ch)) {
        break;
      } else {
        text += ch; i++;
      }
    }
    tokens.push({ text, end: i });
  }
  return tokens;
}

// Return the index of the first UNQUOTED top-level shell control operator
// (&&, ||, ;, |, &, or newline) at or after `startIdx`, or source.length if
// none. Quote-aware: operators inside single/double quotes are ignored, so a
// commit message like -m "fix a && b" is not split. Used to bound a git
// command to its own segment, so `git add X && git status` does not leak
// `&& git status` into the pathspec parser.
function segmentEndFrom(source, startIdx) {
  let inQuote = null;
  for (let i = startIdx; i < source.length; i++) {
    const ch = source[i];
    // Backslash escapes the next char everywhere EXCEPT inside single quotes
    // (POSIX: inside '...' a backslash is literal). Skipping the escaped char
    // means an escaped quote (\") or escaped operator (\&) is not mis-read as a
    // quote toggle / segment boundary — e.g. git commit -m "a \" && b" -- x.txt.
    if (ch === '\\' && inQuote !== "'" && i + 1 < source.length) { i++; continue; }
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inQuote = ch; continue; }
    if (ch === '\n' || ch === ';' || ch === '|' || ch === '&') return i;
  }
  return source.length;
}

// Detect if a (possibly env-prefixed, globally-optioned) command is `git add`
// or `git commit`, handling all these bypass forms:
//   - VAR=val git add ...
//   - env VAR=val git add ...
//   - GIT_INDEX_FILE=x git commit ...
//   - git -C <dir> add ...
//   - git -c core.hooksPath=x add ...
//   - git --git-dir=x commit ...
//   - git --work-tree=x add ...
//   - git --namespace=x add ...
//   - git -p add ...  (and other boolean global flags)
//
// Returns { action: 'add'|'commit', args: string, gitCwd: string|null } or null.
// args is the ORIGINAL substring of `normalized` after the git subcommand
// (preserving quoting) so that downstream parseGitArgs tokenizes it correctly.
// gitCwd is populated when -C <dir> is found among git global options.
function detectGitAction(normalized) {
  const tokens = shellTokenize(normalized);

  if (tokens.length === 0) return null;

  let i = 0;

  // Step 1: strip leading env-var assignments: FOO=bar BAZ=qux git ...
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].text)) {
    i++;
  }

  // Step 2: strip a leading `env [VAR=val ...] ` prefix.
  if (i < tokens.length && tokens[i].text === 'env') {
    i++;
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].text)) {
      i++;
    }
  }

  // Step 3: expect `git`
  if (i >= tokens.length || tokens[i].text !== 'git') return null;
  i++;

  // Step 4: skip git global options, collecting -C <dir> as gitCwd.
  let gitCwd = null;
  while (i < tokens.length) {
    const tok = tokens[i].text;
    if (!tok.startsWith('-')) break; // not a flag → must be the subcommand

    // --flag=value forms (inline operand) — boolean semantics for detection
    if (tok.includes('=')) {
      i++;
      continue;
    }

    // Exact boolean global flags — skip
    if (GIT_GLOBAL_BOOL_FLAGS.has(tok)) {
      i++;
      continue;
    }

    // Known global options that take a separate next token
    if (GIT_GLOBAL_OPTS_WITH_ARG.has(tok)) {
      i++; // consume the flag
      if (i < tokens.length) {
        if (tok === '-C') {
          gitCwd = tokens[i].text;
        }
        i++; // consume the operand
      }
      continue;
    }

    // Unknown flag — skip (conservative: don't consume operand for unknown flags)
    i++;
  }

  // Step 5: the next token should be the git subcommand
  if (i >= tokens.length) return null;
  const subcommand = tokens[i].text;
  const afterSubcommandEnd = tokens[i].end;
  i++;

  // Remaining args: use the ORIGINAL source substring after the subcommand token,
  // BOUNDED to the first top-level shell segment. Without the bound,
  // `git add X && git status` would parse `X && git status` and treat `&&`,
  // `git`, and `status` as pathspecs — producing bogus custody classifications
  // (and false foreign-blocks). segmentEndFrom is quote-aware, so an operator
  // inside a quoted commit message (-m "a && b") is NOT treated as a separator.
  const remainingArgs = normalized
    .substring(afterSubcommandEnd, segmentEndFrom(normalized, afterSubcommandEnd))
    .trim();

  if (subcommand === 'add') {
    return { action: 'add', args: remainingArgs, gitCwd };
  }
  if (subcommand === 'commit') {
    return { action: 'commit', args: remainingArgs, gitCwd };
  }

  return null;
}

// Split a command into top-level shell segments at unquoted/unescaped control
// operators (&&, ||, ;, |, &, newline). Quote- and escape-aware (same rules as
// segmentEndFrom). Consecutive operator chars collapse into one boundary.
function splitTopLevelSegments(source) {
  const segments = [];
  let inQuote = null;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\' && inQuote !== "'" && i + 1 < source.length) { i++; continue; }
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inQuote = ch; continue; }
    if (ch === '\n' || ch === ';' || ch === '|' || ch === '&') {
      segments.push(source.slice(start, i));
      while (i + 1 < source.length && (source[i + 1] === '\n' || source[i + 1] === ';' ||
             source[i + 1] === '|' || source[i + 1] === '&')) i++;
      start = i + 1;
    }
  }
  segments.push(source.slice(start));
  return segments.map((s) => s.trim()).filter(Boolean);
}

// Detect EVERY git add/commit operation in a (possibly compound) command —
// CRITICAL: a single-segment scan let `git add own.txt && git commit -- foreign.txt`
// (or `git status && git add foreign.txt`) slip a foreign operation past the gate.
// Peels the sh-wrapper, splits into top-level segments, tracks mid-chain `cd` so
// each git action gets the right cwd, and returns one entry per git add/commit.
// Returns [{ action, args, cwd }].
function detectGitActions(rawCommand, baseCwd) {
  const cmd = peelShWrapper(String(rawCommand).trim());
  const actions = [];
  let cwd = baseCwd;
  for (const rawSeg of splitTopLevelSegments(cmd)) {
    // Strip subshell/group wrappers — only when the segment actually STARTS with
    // `(` or `{`, so a trailing `)`/`}` in a real pathspec (e.g. `git add foo)`)
    // is never altered.
    let seg = rawSeg.trim();
    if (/^[({]/.test(seg)) {
      seg = seg.replace(/^[({]+\s*/, '').replace(/\s*[)}]+$/, '').trim();
    }
    if (!seg) continue;
    const cdMatch = /^cd\s+(['"]?)([^\s'";&|]+)\1\s*$/.exec(seg);
    if (cdMatch) {
      const dir = cdMatch[2];
      cwd = pathMod.isAbsolute(dir) ? dir : pathMod.resolve(cwd, dir);
      continue;
    }
    const a = detectGitAction(seg);
    if (!a) continue;
    let actionCwd = cwd;
    if (a.gitCwd) {
      actionCwd = pathMod.isAbsolute(a.gitCwd) ? a.gitCwd : pathMod.resolve(cwd, a.gitCwd);
    }
    actions.push({ action: a.action, args: a.args, cwd: actionCwd });
  }
  return actions;
}

// ── Pathspec expansion ─────────────────────────────────────────────────────────

// Strip flag tokens from an args string. Returns { flags, rest }.
// Flags: tokens starting with -, and --message=..., -m <msg> (consumes next token).
// Tokenize a git args string, preserving quoted strings as single tokens.
function tokenizeGitArgs(args) {
  const tokens = [];
  let current = '';
  let inQuote = null;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (inQuote) {
      if (ch === inQuote) { inQuote = null; }
      else { current += ch; }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

// FIX 2: Options whose operands must be consumed (not treated as pathspecs).
// Each entry: short form (e.g. '-F') and/or long form (e.g. '--file').
// We handle BOTH `--file=<val>` (inline) and `--file <val>` (separate token).
const GIT_COMMIT_OPTION_WITH_ARG = new Set([
  '-F', '--file',
  '-m', '--message',
  '-C', '--reuse-message',
  '-c', '--reedit-message',
  '--fixup',
  '--squash',
  '-t', '--template',
  '--trailer',    // e.g. --trailer "Co-authored-by: x"
  '--pathspec-from-file',
  '--pathspec-file-nul',
  // Note: --amend is a BOOLEAN flag (no operand) but causes staged set to be used;
  // handled separately in expandCommitPaths via hasFlag.
]);

function parseGitArgs(args) {
  const tokens = tokenizeGitArgs(args);
  const flags = [];
  const paths = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === '--') { // end of flags
      i++;
      while (i < tokens.length) { paths.push(tokens[i++]); }
      break;
    }
    // Check for long-form --flag=value (inline operand): never a pathspec
    if (t.startsWith('--') && t.includes('=')) {
      flags.push(t);
      i++;
      continue;
    }
    // Check for known options that take a separate operand token
    if (GIT_COMMIT_OPTION_WITH_ARG.has(t)) {
      flags.push(t);
      i++; // consume the option itself
      if (i < tokens.length) {
        flags.push(tokens[i]); // consume the operand — NOT a pathspec
        i++;
      }
      continue;
    }
    if (t.startsWith('-')) { flags.push(t); i++; continue; }
    paths.push(t);
    i++;
  }
  return { flags, paths };
}

function hasFlag(args, ...names) {
  for (const n of names) {
    const re = new RegExp('(?:^|\\s)' + n.replace(/[-]/g, '\\-') + '(?:\\s|$)');
    if (re.test(' ' + args + ' ')) return true;
  }
  return false;
}

// Run a git command and return stdout lines. Returns [] on error (fail-open).
function gitLines(cmd, cwd, execFn) {
  try {
    const exec = execFn || execSync;
    const out = exec(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return String(out || '').split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

// Make path repo-relative from cwd. If it resolves to a relative path inside
// the project, return that. Otherwise return the absolute path.
function toRepoRelative(rawPath, cwd, projectDir) {
  const abs = pathMod.isAbsolute(rawPath) ? rawPath : pathMod.resolve(cwd, rawPath);
  const rel = pathMod.relative(projectDir, abs);
  if (rel.startsWith('..')) return abs;
  return rel;
}

// FIX 1: Expand a `git add <args>` pathspec to repo-relative paths.
//
// CRITICAL FIX: broad/dot/-A/-u/-all adds are NO LONGER uncertain-pass.
// Instead, we enumerate the concrete set of files that would be staged via
//   `git status --porcelain` (untracked + modified tracked + deleted)
// and classify each. If any is foreign, we BLOCK.  If enumeration fails,
// we fail-open (treat as uncertain) per the gate posture contract.
//
// FIX B: When the effective add is scoped by cwd (from `cd <dir> &&` or
// `git -C <dir>`) and/or an explicit pathspec, constrain the status
// enumeration to only paths within that cwd subtree.  This prevents
// `cd tools && git add .` from false-blocking a foreign file in clients/
// that would never be staged by the scoped add.
function expandAddPaths(args, cwd, projectDir, execFn) {
  const { paths } = parseGitArgs(args);

  const hasDot = paths.some((p) => p === '.' || p === '*' || p === ':/');
  const hasAll = hasFlag(args, '-A', '--all', '-u', '--update');
  const isBroad = hasDot || hasAll || paths.length === 0;

  if (isBroad) {
    // Enumerate the files that a broad add would stage, relative to cwd.
    // `git status --porcelain` format: XY <path>  (or rename: old -> new)
    // We only care about changes that would be staged by this add:
    //   - '-u' / '--update': tracked modified/deleted (M and D in worktree)
    //   - '.' / '-A' / '--all': all modified + untracked
    const isUpdateOnly = !hasDot && hasFlag(args, '-u', '--update') && !hasFlag(args, '-A', '--all');

    let statusRaw;
    try {
      // NOTE: gitLines trims each line; we need raw output for porcelain parsing.
      // Call execFn directly here (or fall back to execSync) to preserve whitespace.
      const execImpl = execFn || execSync;
      statusRaw = String(
        execImpl('git status --porcelain -uall', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) || ''
      );
    } catch (_) {
      return { paths: [], uncertain: true }; // fail-open on git error
    }

    // Compute the cwd-relative prefix for scope filtering.
    // When cwd differs from projectDir (i.e. `cd tools && git add .`), git
    // status returns paths relative to the repo root, but `git add .` from
    // tools/ would only stage files under tools/.  We filter to that subtree.
    //
    // `git add :/` or `git add .` from the repo root are intentionally broad —
    // no filtering needed when cwd === projectDir.
    let cwdPrefix = null; // null = no filter (add is truly repo-wide)
    if (cwd && projectDir) {
      const rel = pathMod.relative(projectDir, cwd);
      // Only filter when cwd is a subdirectory of projectDir (not '.' or '..')
      if (rel && !rel.startsWith('..') && rel !== '.') {
        // Normalize to forward slashes and ensure trailing /
        cwdPrefix = rel.replace(/\\/g, '/').replace(/\/?$/, '/');
      }
    }

    // Parse porcelain output preserving the leading XY status columns.
    // Format: XY SP path  (or XY SP orig SP -> SP dest  for renames)
    const statusLines = statusRaw.split('\n').filter((l) => l.length >= 3);

    if (statusLines.length === 0) {
      // Nothing to stage — treat as uncertain (no paths to classify)
      return { paths: [], uncertain: true };
    }

    const expanded = [];
    for (const line of statusLines) {
      if (line.length < 3) continue;
      // Porcelain v1: col 0 = index status, col 1 = worktree status, col 2 = space
      const idxStatus = line[0]; // index column
      const wtStatus = line[1];  // worktree column
      // Path starts at column 3
      let filePath = line.substring(3);
      // Handle rename / copy: "old -> new" — take destination
      const arrowIdx = filePath.indexOf(' -> ');
      if (arrowIdx !== -1) {
        filePath = filePath.substring(arrowIdx + 4);
      }
      filePath = filePath.trim();
      // Strip surrounding quotes (git uses them for paths with special chars)
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.slice(1, -1);
      }
      if (!filePath) continue;

      if (isUpdateOnly) {
        // -u/--update: only stage modifications to tracked files (not untracked '?')
        if (wtStatus === '?' || idxStatus === '?') continue; // untracked — skip
        if (wtStatus !== 'M' && wtStatus !== 'D' && idxStatus !== 'M' && idxStatus !== 'D') continue;
      }
      // For -A/./all: include everything

      // FIX B: constrain to cwd subtree when cwd is scoped below projectDir.
      // git status porcelain returns paths relative to the repo root; filter
      // to only paths that start with the cwd-relative prefix.
      if (cwdPrefix !== null) {
        const normalizedFilePath = filePath.replace(/\\/g, '/');
        if (!normalizedFilePath.startsWith(cwdPrefix)) {
          // This file is outside the scoped cwd — `git add .` from tools/ would
          // NOT stage it.  Skip it so we don't false-block on foreign files
          // outside the cwd subtree.
          continue;
        }
      }

      // git status --porcelain returns paths relative to the repo root (projectDir),
      // NOT relative to cwd.  Use projectDir as the base for toRepoRelative.
      expanded.push(toRepoRelative(filePath, projectDir, projectDir));
    }

    if (expanded.length === 0) {
      return { paths: [], uncertain: true }; // nothing to stage in scope
    }

    return { paths: expanded, uncertain: false };
  }

  // Explicit path list — user-supplied pathspecs are relative to cwd, not repo root
  return {
    paths: paths.map((p) => toRepoRelative(p, cwd, projectDir)),
    uncertain: false,
  };
}

// FIX 2: Expand a `git commit <args>` pathspec.
//
// CRITICAL FIX: Option operands (-F file, -C commit, -m msg, --fixup=hash,
// --squash=hash, -t template, --reuse-message, etc.) are now correctly consumed
// by parseGitArgs and do NOT appear in `paths`. The parsed `paths` array
// therefore only contains genuine pathspecs.
//
// - git commit -a / --all: staged + modified tracked files
// - git commit --amend (no pathspec): staged set (same as bare commit)
// - git commit <paths>: explicit paths only
// - bare git commit: staged files only
function expandCommitPaths(args, cwd, projectDir, execFn) {
  const { flags, paths } = parseGitArgs(args);
  const isAll = hasFlag(args, '-a', '--all');

  if (paths.length > 0) {
    // Explicit pathspecs — option operands have already been consumed by parseGitArgs.
    return {
      paths: paths.map((p) => toRepoRelative(p, cwd, projectDir)),
      uncertain: false,
    };
  }

  if (isAll) {
    // -a / --all: includes both staged and modified tracked files
    const staged = gitLines('git diff --cached --name-only', cwd, execFn);
    const modified = gitLines('git diff --name-only', cwd, execFn);
    const all = Array.from(new Set([...staged, ...modified])).filter(Boolean);
    return { paths: all, uncertain: all.length === 0 };
  }

  // Bare git commit or git commit --amend (no explicit pathspec):
  // commits only what is currently staged.
  const staged = gitLines('git diff --cached --name-only', cwd, execFn);
  return { paths: staged, uncertain: staged.length === 0 };
}

// ── Custody classification ─────────────────────────────────────────────────────

function loadWriteLog(logFile, fs) {
  try {
    const raw = (fs || fsMod).readFileSync(logFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.paths)) {
      return new Set(parsed.paths.map((e) => (typeof e === 'string' ? e : e.path)));
    }
  } catch (_) { /* missing or unreadable */ }
  return null; // null = unreadable (different from empty set)
}

// FIX E: Load owned_artifacts from ALL task-plan files EXCEPT the plan that
// belongs to the CURRENT SESSION.  The current-session plan is identified by
// matching scope_identity.session_or_run_id (primary), falling back to
// scope_identity.session_id / session_id.
//
// If no plan resolves to the current session, we log a warning and treat ALL
// other plans' owned_artifacts as foreign (safe: no current plan → no own
// exclusion via plans; write-ledger still provides own-path coverage).
//
// Returns a Map<repoRelPath, planName> of foreign artifacts.
// Fail-open: returns empty map on any read error.
let warnedNoPlan = false;

// FIX E: Load owned_artifacts from ALL task-plan files EXCEPT the plan that
// belongs to the CURRENT SESSION.  The current-session plan is identified by
// matching scope_identity.session_or_run_id (primary), falling back to
// scope_identity.session_id / session_id.
//
// If no plan resolves to the current session, we log a warning and treat ALL
// other plans' owned_artifacts as foreign (safe: no current plan → no own
// exclusion via plans; write-ledger still provides own-path coverage).
//
// Returns a Map<repoRelPath, planName> of foreign artifacts.
// Fail-open: returns empty map on any read error.
function loadForeignPlanArtifacts(projectDir, fs, path, sessionId, options = {}) {
  const foreignMap = new Map(); // repoRelPath → planName (the owning plan)

  // Resolve which plan file belongs to the current session so we can skip it.
  // A plan is considered "current" if any of these fields match sessionId:
  //   plan.scope_identity.session_or_run_id  (canonical per plan contract)
  //   plan.scope_identity.session_id         (legacy fallback)
  //   plan.scopeIdentity.session_or_run_id   (camelCase variant)
  //   plan.scopeIdentity.session_id          (camelCase legacy)
  //   plan.session_id                        (top-level legacy)
  function isCurrentPlan(plan) {
    if (!sessionId) return false; // no session → can't match
    const si = plan.scope_identity || plan.scopeIdentity || {};
    const candidates = [
      si.session_or_run_id,
      si.sessionOrRunId,
      si.session_id,
      si.sessionId,
      plan.session_id,
    ];
    return candidates.some((c) => typeof c === 'string' && c.trim() === sessionId.trim());
  }

  // Scan both known task-plan directories
  const planDirs = [
    (path || pathMod).join(projectDir, '_dev', 'reports', 'analysis', 'task-plans'),
    // Also scan clients/*/plans/ if they exist
  ];

  // Add client plan dirs dynamically
  try {
    const clientsDir = (path || pathMod).join(projectDir, 'clients');
    const clients = (fs || fsMod).readdirSync(clientsDir);
    for (const c of clients) {
      if (c.startsWith('.')) continue;
      planDirs.push((path || pathMod).join(clientsDir, c, 'plans'));
    }
  } catch (_) { /* clients dir absent or unreadable — not fatal */ }

  let foundOwnPlan = false;

  for (const planDir of planDirs) {
    let planFiles;
    try {
      planFiles = (fs || fsMod).readdirSync(planDir).filter((f) => f.endsWith('__plan.json'));
    } catch (_) {
      continue; // dir missing — not fatal
    }

    for (const pf of planFiles) {
      try {
        const raw = (fs || fsMod).readFileSync((path || pathMod).join(planDir, pf), 'utf8');
        const plan = JSON.parse(raw);

        // Skip this session's own plan — its owned_artifacts are OWN, not foreign
        if (isCurrentPlan(plan)) {
          foundOwnPlan = true;
          continue;
        }

        const si = (plan && (plan.scope_identity || plan.scopeIdentity)) || {};
        const artifacts = si.owned_artifacts || si.ownedArtifacts || [];
        for (const a of artifacts) {
          if (typeof a === 'string' && a) {
            // Normalize: strip leading slash if present
            const normalized = a.replace(/^\/+/, '');
            if (!foreignMap.has(normalized)) {
              foreignMap.set(normalized, pf.replace('__plan.json', ''));
            }
          }
        }
      } catch (_) {
        // Skip unreadable plan files — fail-open
      }
    }
  }

  if (!foundOwnPlan && sessionId && !warnedNoPlan && !options.silent) {
    warnedNoPlan = true;
    // No plan matched this session — warn but continue.  The write-ledger still
    // provides own-path coverage; this only means plan-declared owned_artifacts
    // for the current session are not being excluded from the foreign set.
    process.stderr.write(
      '[GIT-CUSTODY] WARNING: no task plan found for session ' + sessionId +
      ' — all plan owned_artifacts treated as foreign (write-ledger still provides own coverage)\n'
    );
  }

  return foreignMap;
}

// Returns: { classification: 'own'|'foreign'|'unknown', owningSession?: string, owningPlan?: string }
// - own: path is in this session's write_log
// - foreign: path is in another session's write_log OR another plan's owned_artifacts
// - unknown: not found in any session's write_log or plan
//
// FIX 3: Now also checks other plans' owned_artifacts as a second source of
// foreign-classification evidence, unioned with the session write_log check.
function classifyPath(repoRelPath, sessionId, sessionsDir, fs, projectDir, foreignPlanMap) {
  try {
    const sessionLogFile = pathMod.join(sessionsDir, sessionId, 'write_log.json');
    const ownLog = loadWriteLog(sessionLogFile, fs);
    if (ownLog && ownLog.has(repoRelPath)) {
      return { classification: 'own' };
    }

    // Scan other sessions' write_logs
    let otherDirs;
    try {
      otherDirs = (fs || fsMod).readdirSync(sessionsDir);
    } catch (_) {
      // Fall through to plan check even if sessions dir is unreadable
      otherDirs = [];
    }

    for (const dir of otherDirs) {
      if (dir === sessionId || dir.startsWith('.') || dir === '_current-id') continue;
      const otherLogFile = pathMod.join(sessionsDir, dir, 'write_log.json');
      const otherLog = loadWriteLog(otherLogFile, fs);
      if (otherLog && otherLog.has(repoRelPath)) {
        return { classification: 'foreign', owningSession: dir };
      }
    }

    // FIX 3 + FIX E: Check other task-plans' owned_artifacts as a secondary foreign signal.
    // Only classify as foreign if positively found in another plan — never if plans
    // directory is unreadable (fail-open).  Pass sessionId so the current plan is excluded.
    if (projectDir) {
      try {
        const foreignPlanArtifacts = foreignPlanMap || loadForeignPlanArtifacts(projectDir, fs, pathMod, sessionId);
        if (foreignPlanArtifacts.has(repoRelPath)) {
          const owningPlan = foreignPlanArtifacts.get(repoRelPath);
          return { classification: 'foreign', owningSession: 'plan:' + owningPlan, owningPlan };
        }
      } catch (_) {
        // Fail-open: plan artifact read error never promotes to foreign
      }
    }

    return { classification: 'unknown' };
  } catch (_) {
    return { classification: 'unknown' };
  }
}

// ── Per-session state ──────────────────────────────────────────────────────────

function loadGcState(stateFile, fs) {
  try {
    const raw = (fs || fsMod).readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        gc_blocked: Number.isFinite(parsed.gc_blocked) ? parsed.gc_blocked : 0,
        gc_observed: Number.isFinite(parsed.gc_observed) ? parsed.gc_observed : 0,
        gc_log: Array.isArray(parsed.gc_log) ? parsed.gc_log : [],
      };
    }
  } catch (_) { /* missing or corrupt */ }
  return { gc_blocked: 0, gc_observed: 0, gc_log: [] };
}

function saveGcState(stateFile, state, fs, path) {
  try {
    (fs || fsMod).mkdirSync((path || pathMod).dirname(stateFile), { recursive: true });
    const toWrite = {
      ...state,
      gc_log: (state.gc_log || []).slice(-50),
    };
    const tmp = stateFile + '.tmp.' + process.pid + '.' + Date.now();
    (fs || fsMod).writeFileSync(tmp, JSON.stringify(toWrite, null, 2) + '\n', 'utf8');
    (fs || fsMod).renameSync(tmp, stateFile);
  } catch (_) { /* best-effort; never throw */ }
}

// ── Custody grant check (S6 operator override) ────────────────────────────────

const cryptoMod = require('crypto');

function grantHash(repoRelPath, toSession) {
  return cryptoMod.createHash('sha256').update(`${repoRelPath}:${toSession}`).digest('hex');
}

// Check if an unconsumed grant covers this path for the given session.
// Returns the grant file path if valid, or null.
// Fail-open: if grants dir is unreadable, returns null.
function findValidGrant(repoRelPath, sessionId, grantsDir, fs, path) {
  try {
    const hash = grantHash(repoRelPath, sessionId);
    const grantFile = (path || pathMod).join(grantsDir, hash + '.json');
    let raw;
    try {
      raw = (fs || fsMod).readFileSync(grantFile, 'utf8');
    } catch (_) {
      return null; // no grant file
    }
    const grant = JSON.parse(raw);
    if (
      grant &&
      grant.schema === 'CustodyGrant/1.0' &&
      grant.consumed === false &&
      grant.to_session === sessionId &&
      grant.path === repoRelPath
    ) {
      return grantFile;
    }
    return null;
  } catch (_) {
    return null; // fail-open
  }
}

// Consume a grant: mark consumed:true + consumed_at, atomic write.
// Returns true on success, false on failure (fail-open caller).
function consumeGrant(grantFile, fs, path) {
  try {
    const raw = (fs || fsMod).readFileSync(grantFile, 'utf8');
    const grant = JSON.parse(raw);
    grant.consumed = true;
    grant.consumed_at = new Date().toISOString();
    const tmp = grantFile + '.tmp.' + process.pid + '.' + Date.now();
    (fs || fsMod).writeFileSync(tmp, JSON.stringify(grant, null, 2) + '\n', 'utf8');
    (fs || fsMod).renameSync(tmp, grantFile);
    return true;
  } catch (_) {
    return false;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main(options, _injected) {
  try {
    return _main(options, _injected);
  } catch (_) {
    return { status: 0, reason: 'fail-open-exception' };
  }
}

function _main(options, _injected) {
  // Accept injection from either options (test convenience) or _injected (DI pattern).
  const inj = _injected || options || {};
  const fs = inj.fs || fsMod;
  const path = inj.path || pathMod;
  const execFn = inj.exec || null;
  const projectDir = inj.projectDir || resolveProjectDir();
  const baseCwd = inj.cwd || process.cwd();

  // Read payload
  let payload = {};
  if (options && options.payload && typeof options.payload === 'object') {
    payload = options.payload;
  } else {
    try {
      const raw = fs.readFileSync(0, 'utf8');
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') payload = parsed;
      }
    } catch (_) { return { status: 0, reason: 'fail-open-stdin' }; }
  }

  // Only run on Bash tool
  const toolToken = String(
    (options && options.tool) ||
    payload.tool_name || payload.tool || process.env.CLAUDE_TOOL_NAME || ''
  );
  if (toolToken.toLowerCase() !== 'bash') {
    return { status: 0, reason: 'not-bash' };
  }

  const toolInput =
    (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input :
    (() => { try { return JSON.parse(process.env.CLAUDE_TOOL_INPUT || '{}') || {}; } catch { return {}; } })();

  const rawCommand = String(toolInput.command || toolInput.cmd || '').trim();
  if (!rawCommand) return { status: 0, reason: 'no-command' };

  // Detect EVERY git add/commit segment in the (possibly compound) command.
  // MULTI-SEGMENT: a single-segment scan let `git add own && git commit -- foreign`
  // and `git status && git add foreign` slip a foreign operation past the gate.
  const gitActions = detectGitActions(rawCommand, baseCwd);
  if (gitActions.length === 0) return { status: 0, reason: 'not-git-custody-command' };

  // Synthesized label for state logging / block messages (may span several segments).
  const action = { action: gitActions.map((a) => a.action).join('+') };

  // Kill-switch
  const gcStateDir = path.join(projectDir, '_dev', 'state', 'git-custody-gate');
  const disabledMarker = path.join(gcStateDir, 'disabled');
  const killed = (() => { try { return fs.existsSync(disabledMarker); } catch { return false; } })();

  const sessionId = resolveSessionId(payload, fs, projectDir);
  const stateFile = path.join(gcStateDir, sessionId + '.json');
  const sessionsDir = path.join(projectDir, '_dev', 'state', 'active-sessions');

  // Load foreign plan artifacts once per preflight invocation to avoid O(N*P) disk read loop (FIX GitCstSpam)
  let foreignPlanMap = null;
  if (projectDir) {
    try {
      foreignPlanMap = loadForeignPlanArtifacts(projectDir, fs, pathMod, sessionId);
    } catch (_) {
      // Fail-open
    }
  }

  // Strict mode: block non-own paths (advisory behind env MYTHOS_GIT_CUSTODY_GATE=1)
  const strictRaw = String(process.env.MYTHOS_GIT_CUSTODY_GATE || '').trim();
  const strictMode = ['1', 'true', 'yes', 'on'].includes(strictRaw.toLowerCase());

  // Expand + classify the paths of EVERY git action (each with its own cwd), unioned
  // and deduped, so a foreign path in ANY segment blocks the whole compound command.
  const foreignPaths = [];
  const ownPaths = [];
  const unknownPaths = [];
  const seen = new Set();
  let anyCertainPath = false;

  for (const ga of gitActions) {
    let expandResult;
    try {
      expandResult = ga.action === 'add'
        ? expandAddPaths(ga.args, ga.cwd, projectDir, execFn)
        : expandCommitPaths(ga.args, ga.cwd, projectDir, execFn);
    } catch (_) {
      expandResult = { paths: [], uncertain: true };
    }
    const { paths: expandedPaths, uncertain } = expandResult;
    if (uncertain || expandedPaths.length === 0) continue; // this segment uncertain — fail-open
    anyCertainPath = true;
    for (const p of expandedPaths) {
      if (seen.has(p)) continue; // dedup across segments
      seen.add(p);
      const result = classifyPath(p, sessionId, sessionsDir, fs, projectDir, foreignPlanMap);
      if (result.classification === 'own') {
        ownPaths.push(p);
      } else if (result.classification === 'foreign') {
        foreignPaths.push({ path: p, owningSession: result.owningSession });
      } else {
        unknownPaths.push(p);
      }
    }
  }

  // If no segment yielded a concrete path, treat as uncertain — fail-open.
  if (!anyCertainPath && foreignPaths.length === 0 && ownPaths.length === 0 && unknownPaths.length === 0) {
    const state = loadGcState(stateFile, fs);
    state.gc_observed = (state.gc_observed || 0) + 1;
    state.gc_log.push({
      ts: new Date().toISOString(),
      action: action.action,
      paths: [],
      classification: 'unknown',
      note: 'uncertain-expansion',
    });
    if (!killed) saveGcState(stateFile, state, fs, path);
    return { status: 0, reason: 'uncertain-expansion' };
  }

  // Build state update
  const state = loadGcState(stateFile, fs);
  const ts = new Date().toISOString();

  // Record unresolved_custody for unknown paths (non-blocking, advisory)
  if (unknownPaths.length > 0) {
    state.gc_observed = (state.gc_observed || 0) + 1;
    state.gc_log.push({
      ts,
      action: action.action,
      paths: unknownPaths,
      classification: 'unknown',
      note: 'unresolved_custody',
    });
  }

  // HARD BLOCK on foreign paths — enforcing from day one
  // S6: Before blocking, check for valid unconsumed operator-issued grants.
  if (foreignPaths.length > 0 && !killed) {
    const grantsDir = path.join(gcStateDir, 'grants');
    const blockedByGrant = [];   // foreign paths covered by a valid grant
    const stillForeign = [];     // foreign paths with no valid grant

    for (const fp of foreignPaths) {
      const grantFile = findValidGrant(fp.path, sessionId, grantsDir, fs, path);
      if (grantFile) {
        blockedByGrant.push({ ...fp, grantFile });
      } else {
        stillForeign.push(fp);
      }
    }

    // FIX 6: Consume grants FAIL-CLOSED: if consumeGrant() returns false (durable
    // write failed), the override does NOT apply — treat the path as stillForeign.
    // Only allow the override when consumption durably succeeded.
    for (const fp of blockedByGrant) {
      const consumed = consumeGrant(fp.grantFile, fs, path);
      if (consumed) {
        state.gc_log.push({
          ts,
          action: action.action,
          paths: [fp.path],
          classification: 'foreign',
          owning_sessions: [fp.owningSession],
          blocked: false,
          override: 'operator-grant',
          grant_file: fp.grantFile,
        });
      } else {
        // Consumption failed — treat as still-foreign (fail-closed)
        state.gc_log.push({
          ts,
          action: action.action,
          paths: [fp.path],
          classification: 'foreign',
          owning_sessions: [fp.owningSession],
          blocked: true,
          override: 'grant-consume-failed',
          grant_file: fp.grantFile,
        });
        stillForeign.push(fp);
      }
    }

    // If all foreign paths were covered by grants AND consumption succeeded, allow the commit
    if (stillForeign.length === 0) {
      saveGcState(stateFile, state, fs, path);
      return { status: 0, reason: 'override-consumed', grantedPaths: blockedByGrant.map((f) => f.path) };
    }

    // Some (or all) foreign paths are not covered — block
    state.gc_blocked = (state.gc_blocked || 0) + 1;
    state.gc_log.push({
      ts,
      action: action.action,
      paths: stillForeign.map((f) => f.path),
      classification: 'foreign',
      owning_sessions: stillForeign.map((f) => f.owningSession),
      blocked: true,
    });
    saveGcState(stateFile, state, fs, path);

    const foreignDesc = stillForeign
      .map((f) => `  ${f.path} (owned by session: ${f.owningSession})`)
      .join('\n');
    process.stderr.write(
      'BLOCKED_GIT_CUSTODY: git ' + action.action + ' rejected — ' +
      stillForeign.length + ' path(s) are positively owned by another active session.\n' +
      'Foreign paths:\n' + foreignDesc + '\n' +
      'These files were written by another actor. Only that actor may commit them.\n' +
      'If you need to commit these, use: smos-custody-grant <path> --to-session ' + sessionId + '\n'
    );
    return { status: 2, reason: 'foreign-custody', foreignPaths: stillForeign };
  }

  // Strict mode: block unknown paths when MYTHOS_GIT_CUSTODY_GATE=1
  if (strictMode && unknownPaths.length > 0 && !killed) {
    state.gc_blocked = (state.gc_blocked || 0) + 1;
    state.gc_log.push({
      ts,
      action: action.action,
      paths: unknownPaths,
      classification: 'unknown',
      blocked: true,
      note: 'strict-mode',
    });
    saveGcState(stateFile, state, fs, path);

    process.stderr.write(
      '[GIT-CUSTODY strict-mode] git ' + action.action + ' blocked — ' +
      unknownPaths.length + ' path(s) have unknown custody (not in any session write_log).\n' +
      'Unknown paths:\n' + unknownPaths.map((p) => '  ' + p).join('\n') + '\n' +
      'Strict mode active (MYTHOS_GIT_CUSTODY_GATE=1). Unset to pass unknown paths.\n'
    );
    return { status: 2, reason: 'strict-mode-unknown', unknownPaths };
  }

  // If killed (observe-only) and there were foreign paths, log but don't block
  if (foreignPaths.length > 0 && killed) {
    state.gc_observed = (state.gc_observed || 0) + 1;
    state.gc_log.push({
      ts,
      action: action.action,
      paths: foreignPaths.map((f) => f.path),
      classification: 'foreign',
      blocked: false,
      note: 'kill-switch-active',
    });
    saveGcState(stateFile, state, fs, path);
    process.stderr.write(
      '[GIT-CUSTODY observe-only] WOULD BLOCK: ' + foreignPaths.length + ' foreign path(s) — ' +
      'kill-switch active (_dev/state/git-custody-gate/disabled).\n'
    );
    return { status: 0, reason: 'kill-switch-observe', foreignPaths };
  }

  // Own/unknown paths — save state and pass
  if (ownPaths.length > 0 || unknownPaths.length > 0) {
    saveGcState(stateFile, state, fs, path);
  }

  return { status: 0, reason: 'allowed', ownPaths, unknownPaths };
}

module.exports = {
  main,
  // internals exported for tests
  detectGitAction,
  detectGitActions,
  splitTopLevelSegments,
  expandAddPaths,
  expandCommitPaths,
  classifyPath,
  normalizeCommand,
  resolveSessionId,
  loadForeignPlanArtifacts,
  shellTokenize,
};

if (require.main === module) {
  try {
    const result = main();
    process.exit(result && result.status === 2 ? 2 : 0);
  } catch (_) {
    process.exit(0);
  }
}
