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
 */

const pathMod = require('path');
const fsMod = require('fs');

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
 * Cheap surface test. Used two ways:
 *  - by the dispatcher, to decide whether a *failure* of this module should
 *    deny (remote surface) or be ignored (everything else);
 *  - internally, to keep the audit log free of unrelated commands.
 */
function touchesRemoteSurface(command) {
  const c = String(command || '').toLowerCase();
  if (!c) return false;
  return (
    c.includes(REMOTE_HOST) ||
    c.includes('psrun.sh') ||
    c.includes('psrunfile.sh') ||
    c.includes('inbound-push.sh') ||
    c.includes('build-export.sh') ||
    c.includes('pull-results.sh') ||
    /\bd:\\hyperv/i.test(c)
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
 */
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
    const lower = body.toLowerCase();
    const hard = containsHardMutation(body);
    if (hard) {
      return { resolved: true, mutating: true, evidence: `script body contains mutating token '${hard}'` };
    }
    const shellsToRemote =
      /\b(ssh|scp|rsync)\b/.test(lower) && lower.includes(REMOTE_HOST);
    if (shellsToRemote) {
      return { resolved: true, mutating: true, evidence: `script body shells to the ${REMOTE_HOST} remote host` };
    }
    return { resolved: true, mutating: false, evidence: 'script body resolvable and clean of remote-mutation indicators' };
  }
  return {
    resolved: false,
    mutating: true,
    evidence: 'unrecognized script — body not resolvable, read-only cannot be proven (fail closed)',
  };
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
    return chained
      ? { applies: true, mutating: true, key: 'build-export.sh', evidence: 'build-export chained into a remote push', raw }
      : { applies: false, key: 'build-export.sh', evidence: 'local build only, no push in the chain', raw };
  }

  // ── pull-results.sh ───────────────────────────────────────────────────────
  if (exe === 'pull-results.sh') {
    return { applies: true, mutating: false, key: 'pull-results.sh', evidence: 'read-only harvest (scp from remote)', raw };
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
    const hostName = host.includes('@') ? host.split('@').pop() : host;
    if (hostName.toLowerCase() !== REMOTE_HOST) return { applies: false };
    const payload = args.slice(i).join(' ');
    if (!payload.trim()) {
      return { applies: true, mutating: true, key: 'ssh:interactive', evidence: 'interactive shell on the remote host — effect unprovable', raw };
    }
    const verdict = classifyPowerShellPayload(payload);
    return {
      applies: true,
      mutating: !verdict.readOnly,
      key: verdict.readOnly ? 'ssh:read' : 'ssh:mutate',
      evidence: verdict.evidence,
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
    if (isRemote(dest)) {
      return { applies: true, mutating: true, key: 'scp:push', evidence: `direct scp to ${dest}`, raw };
    }
    if (sources.some(isRemote)) {
      return { applies: true, mutating: false, key: 'scp:pull', evidence: 'scp from the remote host (read-only)', raw };
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
    if (isRemote(dest)) {
      return { applies: true, mutating: true, key: 'rsync:push', evidence: `direct rsync to ${dest}`, raw };
    }
    if (sources.some(isRemote)) {
      return { applies: true, mutating: false, key: 'rsync:pull', evidence: 'rsync from the remote host (read-only)', raw };
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
    const referencesRemote =
      haystack.includes(REMOTE_HOST) || /d:[\\/]hyperv/i.test(haystack);
    if (referencesRemote) {
      return {
        applies: true,
        mutating: true,
        key: `unknown:${exe || 'command'}`,
        evidence: `references the ${REMOTE_HOST} remote surface via an unrecognized command (fail closed)`,
        raw,
      };
    }
    if (/\.(sh|ps1)$/i.test(exe) && !READ_ONLY_SCRIPTS.has(exe)) {
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
  lines.push(`  2. Write the machine-checkable sidecar: ${STATE_SUBDIR}/<stamp-id>.json`);
  lines.push('     {');
  lines.push(`       "schema": "${STAMP_SCHEMA}",`);
  lines.push('       "stamp_id": "<slug>__<UTC>",');
  lines.push('       "source_doc": "<path to the .md above>",');
  lines.push('       "granted_at": "<ISO-8601>",');
  lines.push('       "operator_authorization": "<verbatim operator line>",');
  lines.push('       "scope": ["load-courier.ps1", "first-boot.ps1", "re:<optional regex>"],');
  lines.push('       "conditions": ["<condition 1>", "..."],');
  lines.push('       "expires_at": null,  "voided": false, "superseded_by": null');
  lines.push('     }');
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
  evaluate,
  HARD_MUTATION_TOKENS,
  loadStamps,
  main,
  READ_ONLY_SCRIPTS,
  scopeCovers,
  splitSegments,
  STAMP_SCHEMA,
  stampInvalidReason,
  tokenize,
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
