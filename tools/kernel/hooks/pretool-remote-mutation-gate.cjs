#!/usr/bin/env node
'use strict';

/**
 * pretool-remote-mutation-gate.cjs — mechanical G-REMOTE-MUTATION gate.
 *
 * INTENDED CANONICAL PATH: tools/kernel/hooks/pretool-remote-mutation-gate.cjs
 * (staged here because the convene perimeter gate protects tools/kernel/ and no
 * ConveneReceipt/1.0 covering that path exists — see the blocked-repair record
 * in the session report).
 *
 * WHY THIS EXISTS
 * ---------------
 * Codex ruling TT-R3-001 (MAJOR): "A convention-only safety gate cannot support
 * unattended execution." Until now G-REMOTE-MUTATION — the rule that a mutating
 * operation against the orwell Hyper-V host requires an operator stamp — was
 * honoured by agent diligence alone. This module refuses instead.
 *
 * SHAPE
 * -----
 * PreToolUse / Bash. Same contract as the other kernel gates:
 *   main({ tool, payload }, { projectDir?, fs?, nowMs? })
 *     -> { status: 0|2, reason, message?, keys?, stamp_id? }
 * Never throws. Returns status 2 to deny.
 *
 * FAIL-CLOSED, DELIBERATELY
 * -------------------------
 * Unlike the hygiene-family gates, this one does NOT fail open. Any of:
 *   no stamp, expired stamp, voided/superseded stamp, scope mismatch,
 *   unparseable sidecar, unknown remote script, unprovable ssh payload
 * denies. An internal exception denies too, *when the command touches the
 * remote surface at all* (touchesRemoteSurface()); commands with nothing to do
 * with orwell are never affected by a fault in this module.
 *
 * There is no agent-settable bypass: no kill-switch env var, no inline
 * self-justification field, no repo-writable disable file. The only way through is a
 * stamp sidecar under _dev/state/remote-mutation-stamps/, which records an
 * operator authorization line verbatim.
 *
 * Codex ruling TT-R4-001 (MAJOR): unrecognized commands touching the remote
 * surface used to fall through classifySegment's exe branches to
 * `{ applies: false }` — gate-does-not-apply, not deny. rsync had no
 * classifier at all, and a new wrapper script that shells to ssh/scp/rsync
 * internally (without the invoking command line ever naming orwell) was
 * invisible to the gate. Fixed: rsync now classifies push/pull like scp; any
 * unrecognized executable that names the orwell host or a D:\HyperV path
 * directly is fail-closed MUTATING; any unrecognized `.sh`/`.ps1` invocation
 * is scanned for remote-mutation indicators in its body and denied if found
 * or if the body cannot be read at all. See scanUnknownScript() and the
 * RECOGNIZED_EXES / catch-all block in classifySegment().
 *
 * Convene review 20260805T130427Z (codex NOW + gemini OMEGA) found three more:
 *   B1 variable-expansion bypass — `ssh "$REMOTE_HOST" cmd` or
 *       `TARGET=orwell; ssh $TARGET stop-vm` parsed to a literal host of
 *       `$TARGET`, failed strict host equality, and returned applies:false.
 *       Now: any ssh/scp/rsync/sftp/plink host or destination argument (and any
 *       ssh or psrun payload) containing $VAR, ${VAR}, $(...) or a backtick is
 *       MUTATING. The gate cannot prove the target is not orwell, and by its own
 *       law ambiguity refuses. See containsShellExpansion().
 *   B2 interpreter-wrapper blindness — scanUnknownScript only ran for
 *       `.sh`/`.ps1`, so `node mutate.js` (whose body shells to
 *       `ssh orwell stop-vm`) was invisible. Now: recognized interpreters
 *       (node/python/ruby/perl/pwsh/bash/sh/...) have their script argument or
 *       their inline -e/-c code resolved and body-scanned, and .js/.mjs/.cjs/.py
 *       and friends are scannable extensions. See interpreterTarget() and
 *       SCRIPT_EXT_RE.
 *   B3 load-failure fallback fails open — the dispatcher's fallback regex did
 *       not cover `D:\HyperV`. touchesRemoteSurface() is now documented and
 *       exported as THE authoritative surface predicate, and the registration
 *       patch's fallback denies ALL Bash when the module cannot load rather
 *       than carrying a second, driftable copy of the taxonomy.
 *
 * INHERENT LIMITS THIS MODULE CANNOT CLOSE: it is a Bash PreToolUse checker.
 * MCP tools, non-Bash execution lanes, and processes already running in the
 * background are outside it entirely. This is a Bash-only lock on a house with
 * multiple doors — not host-level enforcement.
 */

const pathMod = require('path');
const fsMod = require('fs');
// ticktock-remote-mutation-canary-stamp-collision S2: the scope-broadness
// guard is the load-bearing call site (see stampInvalidReason() below) --
// a standalone-but-uncalled validator protects nothing.
const { stampScopeTooBroad } = require('./validate-stamp-scope.cjs');
// Codex PR#20 F1 (kernel-triad convene 20260817T184138Z): stamps are now
// HMAC-signed with the same Keychain-backed operator secret ConveneReceipt/1.0
// uses -- see tools/kernel/hooks/lib/stamp-mac.cjs for the full rationale.
const { resolveStampSecret, verifyStampMac } = require('./lib/stamp-mac.cjs');

// ── Config ───────────────────────────────────────────────────────────────────

const STATE_SUBDIR = pathMod.join('_dev', 'state', 'remote-mutation-stamps');
const STAMP_DOC_DIR = pathMod.join('_dev', 'reports', 'analysis');
const STAMP_SCHEMA = 'RemoteMutationStamp/1.0';
const REMOTE_HOST = 'orwell';

// Scripts whose remote effect is READ-ONLY. Curated: membership here is the
// human proof. The content scan below is drift detection on top of it — an
// allowlisted script that grows a hard-mutation token loses its allowlist
// standing automatically.
//
// NOTE (reported to the operator): verify-membrane.ps1 and console-capture.ps1
// were proposed for this list but are NOT read-only — verify-membrane.ps1 calls
// Start-VM/Stop-VM/Remove-Item, console-capture.ps1 calls Start-VM/Stop-VM/
// New-Item/Remove-Item. They classify as MUTATING.
const READ_ONLY_SCRIPTS = new Set([
  'check-provisioning.ps1',
  'watch-turn-health.ps1',
  'pull-results.sh',
]);

// Named mutating scripts (informational — an unlisted script is mutating by
// default, so this set is for message quality, not for the decision).
const KNOWN_MUTATING_SCRIPTS = new Set([
  'load-courier.ps1',
  'first-boot.ps1',
  'refresh-seed.ps1',
  'run-job.ps1',
  'attach-courier.ps1',
  'provision-vm.ps1',
  'seal-golden.ps1',
  'revert-to-golden.ps1',
  'teardown-vm.ps1',
  'harvest-results.ps1',
  'verify-membrane.ps1',
  'console-capture.ps1',
]);

// Hard mutation tokens: presence anywhere in an ssh payload, or in the body of
// a script claiming read-only standing, forces MUTATING.
const HARD_MUTATION_TOKENS = [
  'start-vm', 'stop-vm', 'new-vm', 'remove-vm', 'set-vm',
  'add-vmharddiskdrive', 'remove-vmharddiskdrive',
  'mount-vhd', 'dismount-vhd', 'new-vhd', 'set-vhd', 'optimize-vhd',
  'checkpoint-vm', 'restore-vmcheckpoint', 'remove-vmcheckpoint',
  'remove-item', 'copy-item', 'move-item', 'rename-item', 'new-item',
  'set-content', 'add-content', 'out-file', 'set-itemproperty',
  'format-volume', 'initialize-disk', 'clear-content',
  'start-process', 'invoke-webrequest', 'invoke-restmethod',
];

// PowerShell verbs whose cmdlets only read. Used to prove an ad-hoc ssh payload
// read-only. Anything outside this set (or any hard token above) denies.
const READ_ONLY_VERBS = new Set([
  'get', 'test', 'select', 'sort', 'format', 'measure', 'where',
  'compare', 'group', 'convertto', 'convertfrom', 'resolve', 'split',
  'join', 'write', 'read',
]);

// Verb-noun pairs that look read-only by verb but write. Checked before verbs.
const VERB_EXCEPTIONS = new Set(['out-file', 'join-path' /* harmless, kept read */]);

// Executables classifySegment already understands explicitly. Anything else
// that references the remote surface (catch-all below) or that looks like an
// invoked repo script (wrapper detection below) is fail-closed by default.
const RECOGNIZED_EXES = new Set([
  'psrun.sh', 'psrunfile.sh', 'inbound-push.sh', 'build-export.sh',
  'pull-results.sh', 'ssh', 'scp', 'rsync',
]);

// Executables capable of reaching another host. ssh/scp/rsync have their own
// classifier branches; the rest are caught by the catch-all so that an
// unexpanded target argument on any of them fails closed (B1).
const REMOTE_CAPABLE_EXES = new Set([
  'ssh', 'scp', 'rsync', 'sftp', 'plink', 'pscp', 'psftp', 'psexec',
  'ssh.exe', 'scp.exe', 'sftp.exe',
]);

// Interpreters whose script argument must be resolved and body-scanned exactly
// like a .sh wrapper (B2 — gemini's interpreter-wrapper blindness).
const INTERPRETER_EXES = new Set([
  'node', 'nodejs', 'bun', 'deno', 'tsx', 'ts-node',
  'python', 'python2', 'python3', 'ruby', 'perl', 'php',
  'pwsh', 'powershell', 'powershell.exe', 'pwsh.exe',
  'bash', 'sh', 'zsh',
]);

// Interpreter flags that introduce inline code (the code text itself is scanned).
const INLINE_CODE_FLAGS = new Set(['-e', '--eval', '-c', '--command', '--eval-file', '-p', '--print']);

// Interpreter flags that consume a following value which is NOT a script path
// (module names, preloads, loader ids). Skipped without being treated as the
// script token, so `python3 -m pytest` is not mistaken for a script invocation.
const VALUE_FLAGS = new Set([
  '-m', '--module', '-r', '--require', '-I', '-X', '-W', '-w',
  '--import', '--loader', '--experimental-loader', '--file',
]);

// Extensions this gate is willing to treat as a resolvable script body.
const SCRIPT_EXT_RE = /\.(sh|bash|zsh|ps1|psm1|js|mjs|cjs|ts|mts|cts|py|rb|pl)$/i;

// Unexpanded shell constructs: $VAR, ${VAR}, $(...), `...`, and positional/
// special parameters. Their presence in a host, destination, or payload means
// the gate cannot prove the target is not the remote host.
const SHELL_EXPANSION_RE = /\$\{[^}]*\}|\$\([^)]*\)?|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9@*#?!$-]|`/;

function describeShellExpansion(text) {
  const m = String(text || '').match(SHELL_EXPANSION_RE);
  return m ? m[0] : null;
}

// ── S0: syntactic inertness ─────────────────────────────────────────────────
//
// WHY THIS EXISTS. Authorization review 20260805T174845Z found that several
// branches below hand back a READ-ONLY verdict on the strength of the executable
// alone -- pull-results.sh unconditionally, scp/rsync pulls by direction,
// build-export.sh when unchained, and ssh payloads that pass a read-only verb
// heuristic. None of them looked at whether the segment ALSO carried a
// redirection or a substitution. splitSegments() below separates `|`, `&&`, `;`,
// `&` and newlines, but NOT `>`, `>>`, `<`; and containsShellExpansion() was
// applied only to remote-capable executables and PowerShell payloads.
//
// So `pull-results.sh > D:\HyperV\x` or `scp orwell:/a ./b > /somewhere` could
// reach the read-only lane with no grammar proof at all. That is the gate being
// too LOOSE, in a codebase whose reputation is that it is too strict -- and it
// is the reason the tightening lands before any relaxation.
//
// The predicate is deliberately blunt and fail-closed: it answers "is this
// segment free of every construct that could redirect output, substitute a
// command, or smuggle execution through an argument?" Anything it cannot prove
// inert is NOT inert.
const REDIRECTION_RE = /(^|[^0-9<>&])(&>>?|>>|>&|>|<<<|<<|<\(|>\(|<)/;
const ARG_BORNE_EXEC_RE = /(^|\s)-(exec|execdir|ok|okdir)(\s|$)/i;

function describeNonInert(segment) {
  const s = String(segment || '');
  if (!s.trim()) return null;
  const expansion = describeShellExpansion(s);
  if (expansion) return `shell expansion or command substitution (${expansion})`;
  const redir = s.match(REDIRECTION_RE);
  if (redir) return `redirection or process substitution (${redir[0].trim()})`;
  if (ARG_BORNE_EXEC_RE.test(s)) return 'argument-borne execution (-exec/-execdir/-ok)';
  return null;
}

/**
 * S0. True only when the segment carries no redirection, no command or process
 * substitution, no shell expansion, and no argument-borne execution flag.
 *
 * Every read-only exemption in this module is gated on this. A branch that
 * wants to return `mutating: false` must first prove the segment is inert;
 * otherwise the exemption is withdrawn and the command is judged as mutating,
 * because a read-only ACTION with a mutating REDIRECT is a mutation.
 */
function segmentIsSyntacticallyInert(segment) {
  return describeNonInert(segment) === null;
}

/**
 * Withdraw a read-only verdict when the segment is not syntactically inert.
 * Call sites pass the verdict they WOULD have returned; this returns either that
 * verdict unchanged, or a mutating verdict naming the construct that revoked it.
 */
function guardReadOnlyVerdict(verdict, segment, key) {
  const why = describeNonInert(segment);
  if (!why) return verdict;
  return {
    applies: true,
    mutating: true,
    key: key || verdict.key || 'unknown:non-inert',
    evidence: `read-only exemption WITHDRAWN: ${why}. A read-only action carrying a redirect or substitution is not read-only (S0, authorization review 20260805T174845Z).`,
    raw: verdict.raw
  };
}

function containsShellExpansion(text) {
  return SHELL_EXPANSION_RE.test(String(text || ''));
}

/**
 * Narrow S0 guard for the unexpanded-source pull lanes (convene
 * 20260811T1950Z): withdraw the read-only verdict on redirection or
 * argument-borne execution, but NOT on shell expansion — the branch granting
 * this verdict has already reasoned about the expansion in the source token,
 * and the destination is separately proven literal-local.
 */
function withdrawUnlessRedirectFree(verdict, segment) {
  const s = String(segment || '');
  const redir = s.match(REDIRECTION_RE);
  const why = redir
    ? `redirection or process substitution (${redir[0].trim()})`
    : (ARG_BORNE_EXEC_RE.test(s) ? 'argument-borne execution (-exec/-execdir/-ok)' : null);
  if (!why) return verdict;
  return {
    applies: true,
    mutating: true,
    key: verdict.key,
    evidence: `read-only exemption WITHDRAWN: ${why}. A read-only action carrying a redirect is not read-only (S0).`,
    raw: verdict.raw,
  };
}

// ── Utilities ────────────────────────────────────────────────────────────────

function resolveProjectDir() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try {
    const { resolveCanonicalRoot } = require('../../lib/canonical-root.cjs');
    return resolveCanonicalRoot({ mode: 'circuit-breaker' });
  } catch (_) {
    return pathMod.resolve(__dirname, '../../..');
  }
}

/**
 * THE authoritative remote-surface predicate.
 *
 * B3 (codex): this function is the single source of truth for "does this command
 * touch the remote surface at all". It is exported so that no other file —
 * dispatcher included — ever re-implements it as a local regex. The registration
 * patch's load-failure fallback deliberately does NOT carry a copy: when the
 * module cannot load, this predicate is unavailable, and an unavailable
 * predicate means the fallback must deny every Bash call rather than guess.
 *
 * Used two ways:
 *  - internally, to decide whether a *failure* of this module denies (remote
 *    surface) or is ignored (everything else);
 *  - internally, to keep the audit log free of unrelated commands.
 */
function touchesRemoteSurface(command) {
  const c = String(command || '').toLowerCase();
  if (!c) return false;
  // B1: a remote-capable executable carrying an unexpanded construct is on the
  // remote surface for fail-closed purposes — the target cannot be ruled out.
  if (/\b(ssh|scp|rsync|sftp|plink|pscp|psftp)\b/.test(c) && containsShellExpansion(c)) return true;
  // Codex re-review (2026-08-17, round 3): a FOURTH raw-text REMOTE_HOST
  // match site, unpatched by the tokenize()/scanScriptBody()/catch-all
  // fixes -- this is the module's own EXPORTED authoritative fallback
  // predicate (consulted, per this function's own doc comment above, when
  // the gate module itself fails to load, i.e. the highest-stakes fail-
  // closed decision point in the whole file). Same backslash-stripped
  // projection fix as the other three sites, applied ONLY to the
  // substring checks -- NOT to the D:\HyperV regex, whose backslash is
  // real, meaningful path content rather than a shell escape sequence;
  // stripping it would destroy the very character that regex looks for
  // and make that arm permanently unmatchable on the stripped text.
  const stripped = c.replace(/\\(.)/g, '$1');
  return (
    c.includes(REMOTE_HOST) ||
    c.includes('psrun.sh') ||
    c.includes('psrunfile.sh') ||
    c.includes('inbound-push.sh') ||
    c.includes('build-export.sh') ||
    c.includes('pull-results.sh') ||
    /\bd:\\hyperv/i.test(c) ||
    stripped.includes(REMOTE_HOST) ||
    stripped.includes('psrun.sh') ||
    stripped.includes('psrunfile.sh') ||
    stripped.includes('inbound-push.sh') ||
    stripped.includes('build-export.sh') ||
    stripped.includes('pull-results.sh')
  );
}

/** Split a command line into pipeline/list segments, honouring quotes. */
function splitSegments(command) {
  const out = [];
  let cur = '';
  let quote = null;
  const s = String(command || '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === quote && s[i - 1] !== '\\') quote = null;
      continue;
    }
    // Backslash-newline line continuation (POSIX shell): `foo \` followed by
    // a real newline is ONE logical command wrapped across lines, not two
    // commands. Without this, any multi-flag invocation written the normal
    // way (each flag on its own line, trailing `\`) gets shredded into one
    // fragment per line -- each fragment typically starts with a bare flag
    // like `--item "..."`, which is not a recognized executable and falls
    // into the unrecognized-command catch-all below. If ANY line's argument
    // text happens to mention the remote host, the whole-command haystack
    // check in that catch-all then flags every OTHER line's harmless
    // fragment as mutating too -- a real, reproduced false-positive that
    // made this gate's own stamp-minting remedy self-blocking (a stamp
    // authorizing an orwell-scoped action necessarily has "orwell" somewhere
    // in its --scope/--conditions text).
    //
    // Convene review (kernel-gate-backslash-newline-fix, 20260818T0256Z):
    // the FIRST version of this fix collapsed the continuation to a single
    // SPACE, which OMEGA/gemini caught as a real, newly-introduced evasion:
    // a real POSIX shell deletes `\<newline>` entirely (zero characters), so
    // `admin@or\<newline>well` is the literal token `admin@orwell` to the
    // shell -- but a space-collapse would instead produce the two tokens
    // `admin@or` and `well`, neither of which contains the host substring,
    // letting a hostname split across the continuation evade every check
    // below. Collapsing to NOTHING (skip both characters, append nothing)
    // is the version that actually matches shell semantics and closes that
    // evasion, while still fixing the false-positive above (fewer segments
    // than before, never more; a token that WOULD have been flagged
    // un-merged is still flagged once merged, because merging can only make
    // a dangerous substring MORE contiguous, never less).
    if (ch === '\\' && s[i + 1] === '\n') { i += 1; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||') { out.push(cur); cur = ''; i += 1; continue; }
    if (ch === ';' || ch === '|' || ch === '\n' || ch === '&') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Tokenize a segment, stripping the outer quotes of quoted words. */
function tokenize(segment) {
  const tokens = [];
  let cur = '';
  let quote = null;
  let had = false;
  const s = String(segment || '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === quote && s[i - 1] !== '\\') { quote = null; continue; }
      cur += ch;
      continue;
    }
    if (ch === '\\') {
      // Unquoted backslash escapes the next character (POSIX shell lexical
      // rule): 'orw\ell' is the literal text 'orwell' to the shell, and
      // 'foo\ bar' is ONE token 'foo bar', not a delimiter split. Consume the
      // escaped character (including whitespace) literally; drop the
      // backslash. A trailing unquoted backslash (nothing left to escape) is
      // conservatively retained as a literal backslash rather than dropped,
      // so it cannot silently create an allow-through path. Fixes codex
      // PR#20 F2 (kernel-triad convene 20260817T184138Z): strict REMOTE_HOST
      // string comparisons must see the same text the shell actually
      // resolves, not the raw escape sequence. Only applies outside quotes --
      // quoted backslash handling above is unchanged.
      if (i + 1 < s.length) {
        cur += s[i + 1];
        had = true;
        i += 1;
      } else {
        cur += ch;
        had = true;
      }
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; had = true; continue; }
    if (/\s/.test(ch)) {
      if (cur || had) { tokens.push(cur); cur = ''; had = false; }
      continue;
    }
    cur += ch;
  }
  if (cur || had) tokens.push(cur);
  return tokens;
}

function base(token) {
  return pathMod.basename(String(token || '')).toLowerCase();
}

/** Drop leading env assignments and shell wrappers (bash/sh/env/time/nohup). */
function effectiveTokens(tokens) {
  let t = tokens.slice();
  const wrappers = new Set(['bash', 'sh', 'zsh', 'env', 'time', 'nohup', 'command', 'exec']);
  for (;;) {
    while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) t = t.slice(1);
    if (t.length && wrappers.has(base(t[0]))) {
      let i = 1;
      while (i < t.length && t[i].startsWith('-')) i += 1;
      t = t.slice(i);
      continue;
    }
    break;
  }
  return t;
}

function containsHardMutation(text) {
  const lower = String(text || '').toLowerCase();
  return HARD_MUTATION_TOKENS.find((tok) => lower.includes(tok)) || null;
}

/**
 * Is an ad-hoc PowerShell payload provably read-only?
 * Returns { readOnly: bool, evidence }.
 */
function classifyPowerShellPayload(payload) {
  const text = String(payload || '');
  // B1: a payload that is itself a variable (or contains one) cannot be proven
  // read-only — the gate never sees the text that actually runs.
  if (containsShellExpansion(text)) {
    return {
      readOnly: false,
      evidence: `unexpanded shell construct '${describeShellExpansion(text)}' in the payload — ` +
        'the gate cannot see what actually runs (fail closed)',
    };
  }
  const hard = containsHardMutation(text);
  if (hard) return { readOnly: false, evidence: `mutating cmdlet '${hard}'` };
  if (/[^>]>[^>]|>>/.test(text)) return { readOnly: false, evidence: 'output redirection' };
  const pairs = text.match(/\b[A-Za-z]+-[A-Za-z][A-Za-z0-9]*\b/g) || [];
  const verbNouns = pairs.map((p) => p.toLowerCase());
  if (!verbNouns.length) {
    return { readOnly: false, evidence: 'no recognizable cmdlets — read-only cannot be proven' };
  }
  for (const vn of verbNouns) {
    if (VERB_EXCEPTIONS.has(vn) && vn === 'out-file') {
      return { readOnly: false, evidence: `writing cmdlet '${vn}'` };
    }
    const verb = vn.split('-')[0];
    if (!READ_ONLY_VERBS.has(verb)) {
      return { readOnly: false, evidence: `unproven cmdlet '${vn}'` };
    }
  }
  return { readOnly: true, evidence: `cmdlets all read-verb: ${verbNouns.join(', ')}` };
}

/**
 * Read-only standing of a script invoked through psrun/psrunfile.
 * Curated allowlist + content drift detection. Unknown script => MUTATING.
 */
function classifyScript(scriptToken, { projectDir, fs, segment }) {
  const name = base(scriptToken);
  if (!name) return { mutating: true, key: 'psrun:<no-script>', evidence: 'no script argument — cannot classify' };
  if (!READ_ONLY_SCRIPTS.has(name)) {
    return {
      mutating: true,
      key: name,
      evidence: KNOWN_MUTATING_SCRIPTS.has(name)
        ? 'known mutating remote script'
        : 'script not on the read-only allowlist (fail closed)',
    };
  }
  // Drift check: read the script if we can find it.
  const candidates = [];
  if (pathMod.isAbsolute(scriptToken)) candidates.push(scriptToken);
  candidates.push(pathMod.join(projectDir, '_dev', 'sim-runs', 'vm', 'orwell', name));
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const body = fs.readFileSync(p, 'utf8');
        const hard = containsHardMutation(body);
        if (hard) {
          return {
            mutating: true,
            key: name,
            evidence: `allowlisted script drifted: body contains '${hard}'`,
          };
        }
        return { mutating: false, key: name, evidence: 'allowlisted and body clean of mutation tokens' };
      }
    } catch (_) { /* fall through to allowlist-only standing */ }
  }
  return { mutating: false, key: name, evidence: 'allowlisted (body not resolvable for drift check)' };
  void segment;
}

/**
 * Candidate on-disk locations for a script token that classifySegment cannot
 * otherwise identify. Mirrors classifyScript's search (absolute path, the
 * orwell script directory) plus a repo-root-relative resolution, since an
 * unrecognized wrapper invoked directly (not through psrun/psrunfile) is
 * typically given as a relative repo path.
 */
function resolveScriptCandidates(scriptToken, projectDir) {
  const candidates = [];
  const token = String(scriptToken || '');
  if (pathMod.isAbsolute(token)) {
    candidates.push(token);
  } else if (token) {
    candidates.push(pathMod.join(projectDir, token));
  }
  const name = base(token);
  if (name) {
    candidates.push(pathMod.join(projectDir, '_dev', 'sim-runs', 'vm', 'orwell', name));
    candidates.push(pathMod.join(projectDir, '_dev', 'sim-runs', 'vm', name));
  }
  return candidates;
}

/**
 * Wrapper-script detection (TT-R4-001c). A repo script invoked directly
 * (`bash foo.sh`, `./foo.sh`, a bare `.ps1` path) that is not one of the
 * recognized executables and not on the read-only allowlist is scanned for
 * remote-mutation indicators: hard mutation tokens, or an ssh/scp/rsync
 * reference to the orwell host inside the script body. Found, or the body
 * cannot be read at all -> MUTATING. Resolvable and clean -> not a remote
 * concern, no gate applies.
 *
 * `requireTransportEvidence` (codex PR#20 F3, kernel-triad convene
 * 20260817T184138Z, corrected after gemini caught a bypass in the first
 * proposed fix): remote-transport evidence alone is ALWAYS fully sufficient
 * on its own regardless of this flag -- a script/payload that shells to the
 * remote host is remote-mutating whether or not its body happens to contain
 * one of the hardcoded HARD_MUTATION_TOKENS strings (a custom remote script
 * name never will).
 *
 * What the flag controls is whether a hard-mutation token with NO
 * remote-transport evidence is, on its own, also sufficient:
 *   - false (default): yes, still sufficient -- the original maximally
 *     conservative behavior. Used for inline eval/-e/-c code, which is
 *     transient, freshly constructed at invocation time, and impossible to
 *     pre-audit as a stable repo artifact -- it deserves to stay maximally
 *     suspect.
 *   - true: no, a local mutation token alone no longer gates. Used ONLY for
 *     resolvable script FILES read off disk (scanUnknownScript below) --
 *     real, named, auditable repo artifacts where the false-positive this
 *     narrowing fixes (gpu-preflight.ps1, gaming-login-bootstrap.ps1: local
 *     mutation verbs, zero remote-transport indicators anywhere in the whole
 *     file) is the actual problem, and the file's full content is available
 *     to verify that absence.
 */
function scanScriptBody(body, { origin, requireTransportEvidence }) {
  const text = String(body || '');
  const lower = text.toLowerCase();
  const hard = containsHardMutation(text);
  // Codex re-review (2026-08-17): F2's tokenize() fix only normalized
  // unquoted backslash escapes on the COMMAND-LINE path -- this function
  // does its own separate raw-text substring match over a whole SCRIPT
  // FILE's contents, and was left unpatched. 'ssh orw\ell "..."' inside a
  // script body still evaded lower.includes(REMOTE_HOST) (a literal
  // backslash breaks the contiguous substring), exactly the same class of
  // bypass F2 closed on the command line. Also test a backslash-stripped
  // projection of the text: a script file is not a single shell command
  // line, so full tokenize() semantics don't directly apply, but shell
  // escapes are never meaningful content in a hostname reference, so
  // stripping them before the substring test closes the gap without
  // over-matching (stripping cannot turn an absent "orwell" into a present
  // one; it can only reveal one that was already there under an escape).
  const strippedLower = lower.replace(/\\(.)/g, '$1');
  const shellsToRemote =
    (/\b(ssh|scp|rsync|sftp)\b/.test(lower) && lower.includes(REMOTE_HOST))
    || (/\b(ssh|scp|rsync|sftp)\b/.test(strippedLower) && strippedLower.includes(REMOTE_HOST));
  if (shellsToRemote) {
    return {
      resolved: true,
      mutating: true,
      evidence: hard
        ? `${origin} shells to the ${REMOTE_HOST} remote host and contains mutating token '${hard}'`
        : `${origin} shells to the ${REMOTE_HOST} remote host`
    };
  }
  if (hard && !requireTransportEvidence) {
    return { resolved: true, mutating: true, evidence: `${origin} contains mutating token '${hard}'` };
  }
  return {
    resolved: true,
    mutating: false,
    evidence: hard
      ? `${origin} contains local mutation token '${hard}' but no ${REMOTE_HOST} remote-transport reference -- not gated as remote-mutating`
      : `${origin} resolvable and clean of remote-mutation indicators`
  };
}

function scanUnknownScript(scriptToken, { projectDir, fs }) {
  const candidates = resolveScriptCandidates(scriptToken, projectDir);
  for (const p of candidates) {
    let body;
    try {
      if (!fs.existsSync(p)) continue;
      body = fs.readFileSync(p, 'utf8');
    } catch (_) {
      continue; // try the next candidate location
    }
    return scanScriptBody(body, { origin: 'script body', requireTransportEvidence: true });
  }
  return {
    resolved: false,
    mutating: true,
    evidence: 'unrecognized script — body not resolvable, read-only cannot be proven (fail closed)',
  };
}

/**
 * What is a recognized interpreter actually being asked to execute?
 * Returns { kind: 'inline', text } | { kind: 'script', token } | null.
 * Value-taking flags (`-m pytest`, `-r preload`) are skipped rather than
 * mistaken for a script path, so ordinary local module invocations are not
 * dragged into fail-closed script resolution.
 */
function interpreterTarget(args) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (INLINE_CODE_FLAGS.has(a)) {
      return { kind: 'inline', text: args[i + 1] || '' };
    }
    if (VALUE_FLAGS.has(a)) { i += 1; continue; }
    if (a.startsWith('-')) continue;
    return { kind: 'script', token: a };
  }
  return null;
}

/** Classify one segment. */
function classifySegment(segment, ctx) {
  const raw = String(segment || '');
  const tokens = effectiveTokens(tokenize(raw));
  if (!tokens.length) return { applies: false };
  const exe = base(tokens[0]);
  const args = tokens.slice(1);

  // ── psrun.sh / psrunfile.sh ────────────────────────────────────────────────
  if (exe === 'psrun.sh' || exe === 'psrunfile.sh') {
    const first = args.find((a) => !a.startsWith('-'));
    // psrun.sh with an inline PowerShell string (mis-use form seen in the
    // 08-04 packet): classify the string as an ad-hoc payload.
    if (first && !/\.(ps1|sh)$/i.test(first)) {
      const verdict = classifyPowerShellPayload(args.join(' '));
      return verdict.readOnly
        ? { applies: true, mutating: false, key: `${exe}:inline`, evidence: verdict.evidence, raw }
        : { applies: true, mutating: true, key: `${exe}:inline`, evidence: verdict.evidence, raw };
    }
    const verdict = classifyScript(first || '', { ...ctx, segment: raw });
    return { applies: true, mutating: verdict.mutating, key: verdict.key, evidence: verdict.evidence, raw };
  }

  // ── inbound-push.sh ───────────────────────────────────────────────────────
  if (exe === 'inbound-push.sh') {
    return { applies: true, mutating: true, key: 'inbound-push.sh', evidence: 'pushes payload to the remote host', raw };
  }

  // ── build-export.sh ───────────────────────────────────────────────────────
  // Local build on its own. Mutating when it heads a push chain.
  if (exe === 'build-export.sh') {
    const chained = /inbound-push\.sh|orwell:/i.test(ctx.wholeCommand || '');
    if (chained) {
      return { applies: true, mutating: true, key: 'build-export.sh', evidence: 'build-export chained into a remote push', raw };
    }
    // S0: "local build only" is only true if nothing redirects or substitutes.
    const why = describeNonInert(raw);
    if (why) {
      return { applies: true, mutating: true, key: 'build-export.sh', evidence: `local-build exemption WITHDRAWN: ${why}`, raw };
    }
    // Ambiguity-inversion (convene 20260811T1950Z): this is a POSITIVE
    // read-only verdict, not applies:false — under the inverted default,
    // touches-remote with zero applicable verdicts denies, and a proven local
    // build must stay in the proven-read-only lane.
    return { applies: true, mutating: false, key: 'build-export.sh', evidence: 'local build only, no push in the chain, segment syntactically inert', raw };
  }

  // ── pull-results.sh ───────────────────────────────────────────────────────
  if (exe === 'pull-results.sh') {
    // S0: was unconditional. A harvest that redirects into the remote surface,
    // or whose arguments carry a substitution, is not a read-only harvest.
    return guardReadOnlyVerdict(
      { applies: true, mutating: false, key: 'pull-results.sh', evidence: 'read-only harvest (scp from remote), segment syntactically inert', raw },
      raw,
      'pull-results.sh'
    );
  }

  // ── ssh ───────────────────────────────────────────────────────────────────
  if (exe === 'ssh') {
    let i = 0;
    let host = null;
    while (i < args.length) {
      const a = args[i];
      if (a === '-o' || a === '-i' || a === '-p' || a === '-l' || a === '-F') { i += 2; continue; }
      if (a.startsWith('-')) { i += 1; continue; }
      host = a; i += 1; break;
    }
    if (!host) return { applies: false };
    // B1: an unexpanded host cannot be proven not to be the remote host. The
    // strict equality check below would silently return applies:false for
    // `ssh "$REMOTE_HOST" ...` or `TARGET=orwell; ssh $TARGET ...`.
    if (containsShellExpansion(host)) {
      return {
        applies: true,
        mutating: true,
        key: 'ssh:unexpanded-host',
        evidence: `ssh host argument '${host}' contains the unexpanded construct ` +
          `'${describeShellExpansion(host)}' — the gate cannot prove the target is not ${REMOTE_HOST} (fail closed)`,
        raw,
      };
    }
    const hostName = host.includes('@') ? host.split('@').pop() : host;
    if (hostName.toLowerCase() !== REMOTE_HOST) return { applies: false };
    const payload = args.slice(i).join(' ');
    if (!payload.trim()) {
      return { applies: true, mutating: true, key: 'ssh:interactive', evidence: 'interactive shell on the remote host — effect unprovable', raw };
    }
    const verdict = classifyPowerShellPayload(payload);
    if (verdict.readOnly) {
      // S0: the read-only-verb heuristic inspects VERBS. It does not reject a
      // payload that appends a redirect, opens a subshell, or pipes into
      // something that writes. A Get-* cmdlet whose output is redirected onto
      // the remote filesystem is a write, and the verb list cannot see that.
      // Authorization review 20260805T174845Z flagged this branch specifically.
      const why = describeNonInert(payload);
      if (why) {
        return {
          applies: true,
          mutating: true,
          key: 'ssh:mutate',
          evidence: `read-only payload exemption WITHDRAWN: ${why}. The read-only-verb heuristic classifies verbs, not redirection — a read cmdlet whose output is redirected is a write (S0).`,
          raw,
        };
      }
    }
    return {
      applies: true,
      mutating: !verdict.readOnly,
      key: verdict.readOnly ? 'ssh:read' : 'ssh:mutate',
      evidence: verdict.readOnly ? `${verdict.evidence}; payload syntactically inert` : verdict.evidence,
      raw,
    };
  }

  // ── scp ───────────────────────────────────────────────────────────────────
  if (exe === 'scp') {
    const positional = args.filter((a) => !a.startsWith('-'));
    if (positional.length < 2) return { applies: false };
    const dest = positional[positional.length - 1];
    const sources = positional.slice(0, -1);
    const isRemote = (t) => new RegExp('(^|@)' + REMOTE_HOST + ':', 'i').test(t);
    // B1: an unexpanded destination cannot be proven local.
    if (containsShellExpansion(dest)) {
      return {
        applies: true,
        mutating: true,
        key: 'scp:unexpanded-dest',
        evidence: `scp destination '${dest}' contains the unexpanded construct ` +
          `'${describeShellExpansion(dest)}' — the gate cannot prove it is not ${REMOTE_HOST} (fail closed)`,
        raw,
      };
    }
    if (isRemote(dest)) {
      return { applies: true, mutating: true, key: 'scp:push', evidence: `direct scp to ${dest}`, raw };
    }
    if (sources.some(isRemote)) {
      // S0: direction alone is not sufficient — a pull that redirects into the
      // remote surface, or carries a substitution, is not read-only.
      return guardReadOnlyVerdict(
        { applies: true, mutating: false, key: 'scp:pull', evidence: 'scp from the remote host (read-only), segment syntactically inert', raw },
        raw,
        'scp:pull'
      );
    }
    // Ambiguity-inversion (convene 20260811T1950Z): an unexpanded SOURCE with a
    // proven-literal local destination is at worst a pull from the remote host —
    // scp only writes its destination, and the destination is proven local
    // (the unexpanded-dest branch above already denied the other direction).
    // A positive read-only verdict keeps this lane out of the inverted
    // zero-applicable denial. The S0 guard is applied for redirection and
    // argument-borne execution only — the source expansion itself is the very
    // construct this branch has already reasoned about, so the full
    // describeNonInert() check (which flags any expansion) would withdraw the
    // verdict it exists to grant.
    if (sources.some(containsShellExpansion)) {
      return withdrawUnlessRedirectFree(
        { applies: true, mutating: false, key: 'scp:pull', evidence: 'unexpanded source with a proven-local destination — worst case a read-only pull from the remote host', raw },
        raw
      );
    }
    return { applies: false };
  }

  // ── rsync ─────────────────────────────────────────────────────────────────
  // TT-R4-001a: rsync had no classifier at all — an unrecognized exe fell
  // through to `applies: false` and the gate never saw it. Same push/pull
  // shape as scp: destination-is-orwell mutates, source-is-orwell is read-only.
  if (exe === 'rsync') {
    const positional = args.filter((a) => !a.startsWith('-'));
    if (positional.length < 2) return { applies: false };
    const dest = positional[positional.length - 1];
    const sources = positional.slice(0, -1);
    const isRemote = (t) =>
      new RegExp('(^|@)' + REMOTE_HOST + ':', 'i').test(t) ||
      new RegExp('^rsync://' + REMOTE_HOST + '(/|$)', 'i').test(t);
    // B1: an unexpanded destination cannot be proven local.
    if (containsShellExpansion(dest)) {
      return {
        applies: true,
        mutating: true,
        key: 'rsync:unexpanded-dest',
        evidence: `rsync destination '${dest}' contains the unexpanded construct ` +
          `'${describeShellExpansion(dest)}' — the gate cannot prove it is not ${REMOTE_HOST} (fail closed)`,
        raw,
      };
    }
    if (isRemote(dest)) {
      return { applies: true, mutating: true, key: 'rsync:push', evidence: `direct rsync to ${dest}`, raw };
    }
    if (sources.some(isRemote)) {
      // S0: same reasoning as scp:pull.
      return guardReadOnlyVerdict(
        { applies: true, mutating: false, key: 'rsync:pull', evidence: 'rsync from the remote host (read-only), segment syntactically inert', raw },
        raw,
        'rsync:pull'
      );
    }
    // Ambiguity-inversion (convene 20260811T1950Z): same reasoning as the
    // scp unexpanded-source lane — destination proven local, so worst case is
    // a read-only pull. Positive verdict, not applies:false; redirect-only S0
    // guard for the same reason.
    if (sources.some(containsShellExpansion)) {
      return withdrawUnlessRedirectFree(
        { applies: true, mutating: false, key: 'rsync:pull', evidence: 'unexpanded source with a proven-local destination — worst case a read-only pull from the remote host', raw },
        raw
      );
    }
    return { applies: false };
  }

  // ── Catch-all + wrapper detection (TT-R4-001b/c) ────────────────────────────
  // Anything not on the recognized-executable list is fail-closed, not
  // gate-does-not-apply:
  //  (b) the segment (or the whole command line) names the orwell host or a
  //      known remote path prefix directly -> MUTATING immediately, no matter
  //      what the unrecognized executable is.
  //  (c) the segment invokes what looks like a repo script (.sh/.ps1) that
  //      isn't on the read-only allowlist -> read the script body and decide
  //      on remote-mutation indicators found inside it; unresolvable -> deny.
  if (!RECOGNIZED_EXES.has(exe)) {
    const haystack = `${raw} ${ctx.wholeCommand || ''}`.toLowerCase();
    // Codex re-review (2026-08-17, round 2): a THIRD raw-text REMOTE_HOST
    // match site, unpatched by both the tokenize() and scanScriptBody() fixes
    // -- an unrecognized command/wrapper carrying a shell-lexically-escaped
    // hostname (e.g. 'unknown-wrapper ssh orw\ell "..."') evaded this
    // fail-closed catch-all entirely, reaching applies:false instead of the
    // deny this block exists to guarantee for anything mentioning the remote
    // host. Same backslash-stripped-projection fix as scanScriptBody(),
    // applied ONLY to the REMOTE_HOST substring check -- NOT to the
    // D:\HyperV regex, whose backslash is real path content, not a shell
    // escape; stripping it would make that arm permanently unmatchable on
    // the stripped text (round-3 self-correction before dispatch).
    const strippedHaystack = haystack.replace(/\\(.)/g, '$1');
    const referencesRemote =
      haystack.includes(REMOTE_HOST) || /d:[\\/]hyperv/i.test(haystack)
      || strippedHaystack.includes(REMOTE_HOST);
    if (referencesRemote) {
      return {
        applies: true,
        mutating: true,
        key: `unknown:${exe || 'command'}`,
        evidence: `references the ${REMOTE_HOST} remote surface via an unrecognized command (fail closed)`,
        raw,
      };
    }
    // B1: any other remote-capable executable (sftp, plink, pscp, psexec, ...)
    // carrying an unexpanded argument fails closed for the same reason ssh does.
    if (REMOTE_CAPABLE_EXES.has(exe)) {
      const hit = args.find((a) => containsShellExpansion(a));
      if (hit) {
        return {
          applies: true,
          mutating: true,
          key: `${exe}:unexpanded-target`,
          evidence: `${exe} argument '${hit}' contains the unexpanded construct ` +
            `'${describeShellExpansion(hit)}' — target unprovable (fail closed)`,
          raw,
        };
      }
    }

    // B2 (gemini): interpreter-wrapper blindness. `node mutate.js` names neither
    // the remote host nor a .sh/.ps1 path, so the wrapper scan below never saw
    // it and the segment fell through to applies:false. Resolve the interpreter's
    // script argument (or its inline -e/-c code) and scan it the same way.
    if (INTERPRETER_EXES.has(exe)) {
      const target = interpreterTarget(args);
      if (target && target.kind === 'inline') {
        const verdict = scanScriptBody(target.text, { origin: `inline ${exe} code` });
        if (verdict.mutating) {
          return { applies: true, mutating: true, key: `interpreter:${exe}:inline`, evidence: verdict.evidence, raw };
        }
        return { applies: false };
      }
      if (target && target.kind === 'script') {
        const looksLikeScript = SCRIPT_EXT_RE.test(target.token);
        const verdict = scanUnknownScript(target.token, ctx);
        // An unresolvable token with no script extension (e.g. `python3 -m` style
        // module names that slipped through, or a subcommand word) is not treated
        // as a denied script — only a named script file is held to fail-closed
        // resolution. Documented over-block boundary, not an accident.
        if (!verdict.resolved && !looksLikeScript) return { applies: false };
        return {
          applies: true,
          mutating: verdict.mutating,
          key: `wrapper:${base(target.token)}`,
          evidence: verdict.evidence,
          raw,
        };
      }
      return { applies: false };
    }

    if (SCRIPT_EXT_RE.test(exe) && !READ_ONLY_SCRIPTS.has(exe)) {
      const verdict = scanUnknownScript(tokens[0], ctx);
      return {
        applies: true,
        mutating: verdict.mutating,
        key: `wrapper:${exe}`,
        evidence: verdict.evidence,
        raw,
      };
    }
  }

  return { applies: false };
}

/** Classify a whole command. */
function classifyCommand(command, ctx) {
  const wholeCommand = String(command || '');
  const segments = splitSegments(wholeCommand);
  const results = segments.map((seg) => classifySegment(seg, { ...ctx, wholeCommand }));
  const applicable = results.filter((r) => r && r.applies);
  const mutating = applicable.filter((r) => r.mutating);
  return {
    wholeCommand,
    touchesRemote: touchesRemoteSurface(wholeCommand) || applicable.length > 0,
    applicable,
    mutating,
    mutatingKeys: [...new Set(mutating.map((r) => r.key))],
  };
}

// ── Stamps ───────────────────────────────────────────────────────────────────

function stampDir(projectDir) {
  return pathMod.join(projectDir, STATE_SUBDIR);
}

/**
 * Load every sidecar and validate it. Returns
 * { valid: [{stamp, reason}], invalid: [{file, reason}] }.
 */
function loadStamps(projectDir, fs, nowMs) {
  const dir = stampDir(projectDir);
  const valid = [];
  const invalid = [];
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch (_) {
    return { valid, invalid, dirMissing: true };
  }
  for (const name of names) {
    const file = pathMod.join(dir, name);
    let stamp;
    try {
      stamp = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      invalid.push({ file: name, reason: 'unparseable JSON' });
      continue;
    }
    const reason = stampInvalidReason(stamp, { projectDir, fs, nowMs });
    if (reason) invalid.push({ file: name, stamp_id: stamp && stamp.stamp_id, reason });
    else valid.push(stamp);
  }
  return { valid, invalid };
}

function stampInvalidReason(stamp, { projectDir, fs, nowMs }) {
  if (!stamp || typeof stamp !== 'object') return 'not an object';
  if (stamp.schema !== STAMP_SCHEMA) return `schema is not ${STAMP_SCHEMA}`;
  if (!stamp.stamp_id || typeof stamp.stamp_id !== 'string') return 'missing stamp_id';
  if (!stamp.granted_at || Number.isNaN(Date.parse(stamp.granted_at))) return 'missing/unparseable granted_at';
  if (typeof stamp.operator_authorization !== 'string' || !stamp.operator_authorization.trim()) {
    return 'missing explicit operator authorization line';
  }
  if (!Array.isArray(stamp.scope) || !stamp.scope.length) return 'empty scope';
  const tooBroad = stampScopeTooBroad(stamp);
  if (tooBroad) return `scope too broad: ${tooBroad}`;
  if (!Array.isArray(stamp.conditions) || !stamp.conditions.length) return 'no conditions named';
  if (stamp.voided === true) return 'voided';
  if (stamp.superseded_by) return `superseded by ${stamp.superseded_by}`;
  if (stamp.expires_at) {
    const exp = Date.parse(stamp.expires_at);
    if (Number.isNaN(exp)) return 'unparseable expires_at';
    if (exp <= nowMs) return `expired at ${stamp.expires_at}`;
  }
  if (!stamp.source_doc || typeof stamp.source_doc !== 'string') return 'missing source_doc';
  const docName = pathMod.basename(stamp.source_doc);
  if (!/^g-remote-mutation-(packet|prestamp)__.*\.md$/.test(docName)) {
    return 'source_doc is not a g-remote-mutation packet/prestamp artifact';
  }
  const docPath = pathMod.isAbsolute(stamp.source_doc)
    ? stamp.source_doc
    : pathMod.join(projectDir, stamp.source_doc);
  try {
    if (!fs.existsSync(docPath)) return `source_doc missing on disk: ${stamp.source_doc}`;
  } catch (_) {
    return 'source_doc unreadable';
  }
  void STAMP_DOC_DIR;
  // Codex PR#20 F1 (kernel-triad convene 20260817T184138Z): every other check
  // above only inspects agent-writable content. A stamp is not actually
  // authorized until it carries a MAC that verifies against the Keychain-
  // backed operator secret -- the same secret ConveneReceipt/1.0 uses,
  // resolvable only from the Keychain (never from an agent's own process
  // env). No secret resolvable => fail closed => every stamp reads invalid.
  const secret = resolveStampSecret();
  if (!secret) return 'no operator secret available to verify the stamp MAC (fail-closed)';
  const macVerdict = verifyStampMac(secret, stamp);
  if (!macVerdict.ok) return `stamp MAC invalid: ${macVerdict.reason}`;
  return null;
}

function scopeCovers(stamp, key, rawSegment) {
  for (const entry of stamp.scope) {
    const e = String(entry || '').trim();
    if (!e) continue;
    if (e.startsWith('re:')) {
      try {
        if (new RegExp(e.slice(3), 'i').test(rawSegment || '')) return true;
      } catch (_) { /* a broken pattern never grants */ }
      continue;
    }
    if (e.toLowerCase() === String(key).toLowerCase()) return true;
  }
  return false;
}

// ── Audit ────────────────────────────────────────────────────────────────────

function appendAudit(projectDir, fs, entry) {
  try {
    const dir = stampDir(projectDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(pathMod.join(dir, 'audit.jsonl'), JSON.stringify(entry) + '\n');
  } catch (_) { /* best effort; an audit failure never changes the verdict */ }
}

// ── Messages ─────────────────────────────────────────────────────────────────

function denyMessage({ blocked, reasons, stampsSummary, projectDir }) {
  const lines = [];
  lines.push('BLOCKED by G-REMOTE-MUTATION (mechanical gate, fail-closed).');
  lines.push('');
  lines.push('WHAT WAS BLOCKED:');
  for (const b of blocked) lines.push(`  - ${b.key} — ${b.evidence}`);
  lines.push('');
  lines.push('WHY:');
  for (const r of reasons) lines.push(`  - ${r}`);
  lines.push('');
  lines.push('STAMP SCOPES CURRENTLY AVAILABLE:');
  if (!stampsSummary.length) {
    lines.push('  (none — no valid stamp sidecar exists)');
  } else {
    for (const s of stampsSummary) {
      lines.push(`  - ${s.stamp_id} [${s.state}] scope: ${s.scope.join(', ')}`);
    }
  }
  lines.push('');
  lines.push('HOW THE OPERATOR GRANTS ONE:');
  lines.push(`  1. Write the authorization artifact: ${STAMP_DOC_DIR}/g-remote-mutation-prestamp__<slug>__<UTC>.md`);
  lines.push('     containing the verbatim operator authorization line and the binding conditions.');
  lines.push('  2. Mint the SIGNED stamp (codex PR#20 F1: hand-authored stamp JSON is no longer');
  lines.push('     accepted -- a stamp is authority because its MAC recomputes, not because it parses):');
  lines.push('     node tools/kernel/hooks/mint-remote-mutation-stamp.cjs \\');
  lines.push('       --item "Mythos Convene Approval" --stamp-id <slug>__<UTC> \\');
  lines.push('       --scope <entry> [--scope <entry> ...] --conditions <text> [--conditions <text> ...] \\');
  lines.push('       --source-doc <path to the .md above> [--expires-hours <n>]');
  lines.push('  3. Re-run the command. The gate matches each mutating action key against scope.');
  lines.push('');
  lines.push(`Audit: ${STATE_SUBDIR}/audit.jsonl`);
  void projectDir;
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(options, _injected) {
  const injected = _injected || {};
  const fs = injected.fs || fsMod;
  const projectDir = injected.projectDir || resolveProjectDir();
  let command = '';
  try {
    let payload = {};
    if (options && options.payload && typeof options.payload === 'object') {
      payload = options.payload;
    } else {
      const raw = fs.readFileSync(0, 'utf8');
      if (raw && raw.trim()) payload = JSON.parse(raw);
    }
    const toolToken =
      String((options && options.tool) || payload.tool_name || payload.tool || '').toLowerCase();
    if (toolToken !== 'bash') return { status: 0, reason: 'not-bash' };
    const toolInput = (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input : {};
    command = String(toolInput.command || toolInput.cmd || '');
    return evaluate(command, {
      projectDir,
      fs,
      nowMs: injected.nowMs || Date.now(),
      sessionId: payload.session_id || null,
    });
  } catch (err) {
    // FAIL CLOSED on the remote surface only.
    if (touchesRemoteSurface(command)) {
      const message =
        'BLOCKED by G-REMOTE-MUTATION: the gate itself failed while evaluating a command that ' +
        'touches the orwell remote surface (' + (err && err.message) + '). A gate that cannot run ' +
        'is not a gate that waves work through. Repair the gate before re-running.';
      appendAudit(projectDir, fs, {
        ts: new Date().toISOString(), gate: 'remote-mutation', decision: 'deny',
        reason: 'gate-exception', error: String(err && err.message), stamp_id: null,
        keys: [], command: command.slice(0, 300),
      });
      return { status: 2, reason: 'gate-exception', message };
    }
    return { status: 0, reason: 'fail-open-non-remote' };
  }
}

function evaluate(command, { projectDir, fs, nowMs, sessionId }) {
  const cls = classifyCommand(command, { projectDir, fs });
  const now = new Date(nowMs).toISOString();

  if (!cls.touchesRemote) return { status: 0, reason: 'not-remote' };

  const logBase = {
    ts: now, gate: 'remote-mutation', session_id: sessionId || null,
    command: String(command).slice(0, 300),
  };

  if (!cls.mutating.length) {
    // AMBIGUITY-DEFAULT INVERSION (convene 20260811T1950Z, ratified). A command
    // that touches the remote surface but where NO segment rule resolved at all
    // (applicable.length === 0) is genuinely unresolved — `timeout 30 bash
    // psrunfile.sh teardown-vm.ps1` and the whole class of unenumerated
    // wrappers land here. By this gate's own "ambiguity refuses" law, that
    // DENIES. The invariant is deliberately `applicable.length === 0`, NOT
    // `mutating.length === 0`: a positively-proven read-only verdict
    // (applicable > 0, mutating 0 — scp:pull, rsync:pull, pull-results.sh,
    // ssh:read, allowlisted scripts) is not ambiguity, and denying it would be
    // a regression two independent reviews (codex, codewhale) both flagged.
    if (!cls.applicable.length) {
      const message =
        'BLOCKED by G-REMOTE-MUTATION (ambiguity refuses): this command touches the ' +
        REMOTE_HOST + ' remote surface but no classifier rule resolved any of its segments, ' +
        'so its remote effect cannot be proven read-only (fail closed). Re-issue the command ' +
        'without wrappers or indirection the gate cannot see through, or obtain an operator ' +
        'stamp for the mutating lane.';
      appendAudit(projectDir, fs, {
        ...logBase, decision: 'deny', reason: 'unresolvable-remote-adjacent', stamp_id: null,
        keys: [], evidence: ['touchesRemoteSurface=true with zero applicable segment verdicts'],
      });
      return { status: 2, reason: 'unresolvable-remote-adjacent', message, keys: [] };
    }
    appendAudit(projectDir, fs, {
      ...logBase, decision: 'allow', reason: 'read-only-lane', stamp_id: null,
      keys: cls.applicable.map((a) => a.key),
      evidence: cls.applicable.map((a) => a.evidence),
    });
    return { status: 0, reason: 'read-only-lane', keys: cls.applicable.map((a) => a.key) };
  }

  const { valid, invalid } = loadStamps(projectDir, fs, nowMs);
  const stampsSummary = [
    ...valid.map((s) => ({ stamp_id: s.stamp_id, state: 'valid', scope: s.scope })),
    ...invalid.map((s) => ({ stamp_id: s.stamp_id || s.file, state: `invalid: ${s.reason}`, scope: [] })),
  ];

  const uncovered = [];
  const used = [];
  for (const m of cls.mutating) {
    const hit = valid.find((s) => scopeCovers(s, m.key, m.raw));
    if (hit) used.push({ key: m.key, stamp_id: hit.stamp_id });
    else uncovered.push(m);
  }

  if (uncovered.length) {
    const reasons = [];
    if (!valid.length && !invalid.length) reasons.push('no stamp sidecar exists at all');
    for (const u of uncovered) reasons.push(`no valid stamp scopes '${u.key}'`);
    for (const iv of invalid) reasons.push(`stamp ${iv.stamp_id || iv.file} rejected: ${iv.reason}`);
    const message = denyMessage({ blocked: uncovered, reasons, stampsSummary, projectDir });
    appendAudit(projectDir, fs, {
      ...logBase, decision: 'deny', reason: 'no-covering-stamp', stamp_id: null,
      keys: uncovered.map((u) => u.key), rejected_stamps: invalid,
    });
    return { status: 2, reason: 'no-covering-stamp', message, keys: uncovered.map((u) => u.key) };
  }

  appendAudit(projectDir, fs, {
    ...logBase, decision: 'allow', reason: 'stamped',
    stamp_id: [...new Set(used.map((u) => u.stamp_id))].join(','),
    keys: used.map((u) => u.key),
  });
  return {
    status: 0, reason: 'stamped', keys: used.map((u) => u.key),
    stamp_id: [...new Set(used.map((u) => u.stamp_id))].join(','),
  };
}

module.exports = {
  classifyCommand,
  classifyPowerShellPayload,
  classifyScript,
  classifySegment,
  containsShellExpansion,
  describeNonInert,
  segmentIsSyntacticallyInert,
  guardReadOnlyVerdict,
  evaluate,
  HARD_MUTATION_TOKENS,
  interpreterTarget,
  INTERPRETER_EXES,
  loadStamps,
  main,
  READ_ONLY_SCRIPTS,
  REMOTE_CAPABLE_EXES,
  scanScriptBody,
  scopeCovers,
  splitSegments,
  STAMP_SCHEMA,
  stampInvalidReason,
  tokenize,
  // B3: THE authoritative remote-surface predicate. Any other file that needs
  // to ask "is this command on the remote surface" must import this one —
  // re-implementing it is exactly the drift codex found in the dispatcher's
  // load-failure fallback regex.
  touchesRemoteSurface,
};

if (require.main === module) {
  const result = main();
  if (result && result.status === 2) {
    process.stderr.write((result.message || 'BLOCKED by G-REMOTE-MUTATION') + '\n');
    process.exit(2);
  }
  process.exit(0);
}
