#!/usr/bin/env node
'use strict';
// PreToolUse hook — secret-access gate (existential-safety family).
//
// ENFORCEMENT_FAMILY: existential-safety (B1/T1, mech-rebase-tranche-1)
//   Closes the secret-access hole: no gate anywhere on the harness previously
//   stopped `cat .env` / `echo $API_KEY` / write-to-.env — guardrails rule 1
//   was instruction-only. This gate is the mechanical layer; the instruction
//   layer stays active as defense in depth (the hole is GATED for known
//   shapes, not "closed" — grounding adjustment 3).
//
// DETECTS:
//   - Bash reads of .env* files (cat/less/head/tail/grep/sed/awk/source/...)
//   - Bash writes/redirects into .env* (>, >>, tee, cp/mv dest, sed -i)
//   - Key-shaped env tokens echoed to the transcript:
//       echo/printf with $KEY_SHAPED_VAR, printenv KEY_SHAPED_VAR,
//       bare printenv / bare env (full environment dump)
//   - Write/Edit/MultiEdit tool calls whose file_path targets .env*
//   Non-secret templates (.env.example/.env.sample/.env.template/.env.dist)
//   are exempt. Existence-only commands (ls/stat/test/find/rm/...) are exempt.
//
// DEGRADE PATH — OPERATOR-KEYED ONLY (grounding adjustment 1, 2026-07-09;
//   auth-boundary hardening 2026-07-09):
//   This gate has NO inline bypass_justification path and must never grow one.
//   The blanket escape-hatch mandate for T2/T3/T5-class gates is explicitly
//   CARVED OUT here: plausible justification text is cheap, and
//   secrets-stay-local is constitutional. A session blocked from secret
//   access stops or asks — it never self-clears. The ONLY degrade keys are
//   ones the agent cannot forge from a tool call:
//     1. The operator runs the command themselves.
//     2. The operator disables/relaxes the gate via ENV (an operator-only
//        trust boundary): unset MYTHOS_SECRET_ACCESS_GATE to fall back to
//        observe-only, or set MYTHOS_SECRET_ACCESS_GATE_DISABLED=1 to hard-off.
//   There is DELIBERATELY no repo-writable allowlist and no repo-file
//   kill-switch: a file under _dev/state/ is inside the repo working tree, so
//   an agent could Write it and self-authorize. Both were removed. The built-in
//   sanctioned-resolver list below is the only non-operator carve-out, and it is
//   matched against the ACTUAL invoked executable — never an arbitrary substring.
//
// SANCTIONED RESOLUTION PATHS (built-in, code-only — agents cannot amend):
//   run-with-op.sh wrappers, run-with-token.sh, remember-via-vault.sh,
//   keychain-store.sh, and `op run --env-file` (1Password service-account
//   resolution — the file holds op:// references, not credential bytes).
//   A resolver counts only when it is the leading executable of a pipeline
//   stage (after peeling bash/sh/env/... wrappers), so its name appearing in a
//   comment or as an argument to `cat`/`echo` does NOT sanction the command.
//   Legitimate credential-resolution flows pass without operator involvement.
//
// OBSERVE-ONLY by default: enforces (exit 2) only when MYTHOS_SECRET_ACCESS_GATE=1
//   (mirrors MYTHOS_WRITE_BOUNDARY_GATE convention). Otherwise logs what it
//   WOULD block to _dev/state/secret-access-gate/<session_id>.json and allows.
//   The operator flips the flag, never the agent.
//
// FAIL-SAFETY INVARIANTS:
//   - Fail-OPEN (allow, exit 0) on: parse error, unreadable stdin, any internal
//     exception — a broken gate must never brick a session. The instruction
//     layer remains behind it.
//
// CONTRACT: never throws. Returns { status: 0|2, reason?, rule?, evidence?, message? }.

const pathMod = require('path');
const fsMod = require('fs');

// ── Config ─────────────────────────────────────────────────────────────────────

function resolveProjectDir() {
  return (
    process.env.CLAUDE_PROJECT_DIR ||
    '/Users/admin/dev/Mythos-recovered'
  );
}

// Sanctioned credential-resolution flows (built-in, code-only). These wrappers
// keep credential bytes out of Claude-visible params (they resolve inside the
// child process env only). A resolver is honored ONLY when it is the actual
// invoked executable of a pipeline stage — see isSanctionedSegment() — never a
// bare substring anywhere in the command (which a comment or argument could
// spoof, e.g. `cat .env # run-with-op.sh`).
const SANCTIONED_RESOLUTION_PATHS = [
  'run-with-op.sh',                       // tools/**/run-with-op.sh (1P + Keychain resolver wrappers)
  'run-with-token.sh',                    // tools/mcp/discord/run-with-token.sh
  'tools/memory/remember-via-vault.sh',   // registered wrapper (BodyAccessRegistry)
  'tools/boot/keychain-store.sh',         // sanctioned secret STORE path (no echo of bytes)
  'op run --env-file',                    // 1P service-account resolution (.env of op:// refs)
];

// Basenames of the sanctioned *.sh wrappers, matched against the invoked
// executable of a pipeline stage. Derived from the list above so the two never
// drift.
const SANCTIONED_SCRIPT_BASENAMES = new Set(
  SANCTIONED_RESOLUTION_PATHS
    .filter((s) => s.endsWith('.sh'))
    .map((s) => pathMod.basename(s))
);

// Interpreter / prefix wrappers whose real command is the first non-flag,
// non-assignment argument. Peeled so `bash tools/**/run-with-op.sh ...` and
// `env FOO=bar run-with-token.sh ...` resolve to the wrapper, not to `bash`/`env`.
const EXEC_WRAPPERS = new Set([
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'env', 'command', 'nohup', 'time',
  'stdbuf', 'nice', 'ionice', 'exec', 'setsid',
]);

// Env-var name parts that make a variable "key-shaped".
const KEY_SHAPED_PARTS = new Set([
  'KEY', 'APIKEY', 'TOKEN', 'SECRET', 'SECRETS', 'PASSWORD', 'PASSWD',
  'PASS', 'PASSPHRASE', 'CRED', 'CREDS', 'CREDENTIAL', 'CREDENTIALS',
  'AUTH', 'BEARER',
]);

// Commands that may mention a .env* path without disclosing its contents.
const EXISTENCE_ONLY_COMMANDS = new Set([
  'ls', 'stat', 'test', '[', '[[', 'file', 'find', 'rm', 'unlink',
  'basename', 'dirname', 'du', 'realpath', 'readlink', 'shred',
]);

// ── Classifiers ────────────────────────────────────────────────────────────────

function stripQuotes(tok) {
  return String(tok || '').replace(/^['"]|['"]$/g, '');
}

/** Basename matches the .env* family (incl. .envrc), minus non-secret templates. */
function isEnvFileToken(rawToken) {
  const tok = stripQuotes(rawToken);
  if (!tok || tok.startsWith('-')) return false;
  const base = pathMod.basename(tok);
  if (/^\.env\.(example|sample|template|dist)$/i.test(base)) return false;
  return /^\.env(\..+)?$/.test(base) || base === '.envrc';
}

/** True when an env-var NAME looks like it holds a secret. */
function isKeyShapedName(name) {
  const parts = String(name || '').toUpperCase().split('_').filter(Boolean);
  return parts.some((p) => KEY_SHAPED_PARTS.has(p));
}

function splitSegments(command) {
  const stripped = String(command || '').trim().replace(/^\(\s*(.*)\s*\)$/, '$1');
  return stripped.split(/(?:\|\|?|;|&&?)+/);
}

/** Tokens of a segment, skipping leading VAR=value assignment prefixes. */
function segmentTokens(seg) {
  const tokens = String(seg || '').trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1;
  return tokens.slice(i);
}

/** Redact anything token-shaped so block evidence never re-discloses a secret. */
function redactEvidence(text) {
  let out = String(text || '').slice(0, 160);
  out = out.replace(/\b(?:sk|pk|rk|ghp|gho|ghs|xox[a-z])-[A-Za-z0-9_\-]{6,}/g, '[redacted-token]');
  out = out.replace(/\b[A-Za-z0-9+/=_\-]{24,}\b/g, '[redacted-token]');
  out = out.replace(/\b(token|secret|password|passwd|credential|apikey|api_key)\s*=\s*[^\s&"']+/gi, '$1=[redacted]');
  return out;
}

const RULE_TEXT = {
  'env-file-read': 'reads of .env* files are operator-keyed; .env contents must never enter the transcript',
  'env-file-write': 'writes/redirects into .env* files are operator-keyed',
  'key-token-echo': 'echoing key-shaped environment variables discloses secrets into the transcript',
  'env-dump': 'dumping the full environment discloses every secret it holds into the transcript',
};

const SANCTIONED_NEXT_STEP =
  'sanctioned next step: route credential use through a sanctioned resolver ' +
  '(tools/**/run-with-op.sh, run-with-token.sh, remember-via-vault.sh, keychain-store.sh, ' +
  'or `op run --env-file`), or STOP and ask the operator. Only the operator can degrade this ' +
  'gate, via an operator-only trust boundary the agent cannot forge: run the command themselves, ' +
  'or change MYTHOS_SECRET_ACCESS_GATE in the environment. There is NO repo-writable allowlist and ' +
  'NO repo-file kill-switch (an agent could Write those and self-authorize). This gate has NO inline ' +
  'bypass — a session blocked from secret access stops or asks; it never self-clears.';

function blockMessage(rule, evidence) {
  return (
    'BLOCKED_SECRET_ACCESS [' + rule + ']: rule fired: ' + (RULE_TEXT[rule] || rule) + '. ' +
    'evidence: ' + redactEvidence(evidence) + '. ' +
    SANCTIONED_NEXT_STEP
  );
}

// ── Bash command scanning ──────────────────────────────────────────────────────
// Returns the FIRST violation found: { rule, evidence } or null.

function scanBashCommand(command) {
  if (!command || typeof command !== 'string') return null;

  // Peel sh -c '...' / eval '...' wrappers.
  const shMatch = /^\s*(?:sh\s+-c|bash\s+-c|eval)\s+(['"])(.*)\1\s*$/s.exec(command);
  if (shMatch) return scanBashCommand(shMatch[2]);

  for (const seg of splitSegments(command)) {
    const trimmedSeg = seg.trim();
    if (!trimmedSeg) continue;

    // 0) Sanctioned resolver stage: skip THIS stage only (per-segment, so a
    //    resolver in one pipe stage never excuses `cat .env` in another).
    if (isSanctionedSegment(trimmedSeg)) continue;

    // 1) Redirect into .env* :  ... > .env   ... >> .env.local
    const redirectRe = /(?:^|[^0-9&>])>>?\s*([^\s|;&>]+)/g;
    let m;
    while ((m = redirectRe.exec(trimmedSeg)) !== null) {
      if (isEnvFileToken(m[1])) {
        return { rule: 'env-file-write', evidence: 'redirect into "' + stripQuotes(m[1]) + '" in `' + trimmedSeg + '`' };
      }
    }

    const tokens = segmentTokens(trimmedSeg);
    if (tokens.length === 0) continue;
    const cmdWord = pathMod.basename(stripQuotes(tokens[0]));
    const args = tokens.slice(1);

    // 2) Key-shaped token disclosure: echo/printf with $KEY_SHAPED
    if (cmdWord === 'echo' || cmdWord === 'printf') {
      const varRe = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;
      let vm;
      while ((vm = varRe.exec(trimmedSeg)) !== null) {
        if (isKeyShapedName(vm[1])) {
          return { rule: 'key-token-echo', evidence: '`' + cmdWord + '` expands key-shaped variable $' + vm[1] };
        }
      }
    }

    // 3) printenv / env dumps
    if (cmdWord === 'printenv') {
      const nonFlag = args.filter((t) => !t.startsWith('-'));
      const keyArg = nonFlag.find((t) => isKeyShapedName(stripQuotes(t)));
      if (keyArg) {
        return { rule: 'key-token-echo', evidence: '`printenv ' + stripQuotes(keyArg) + '` prints a key-shaped variable' };
      }
      if (nonFlag.length === 0) {
        return { rule: 'env-dump', evidence: 'bare `printenv` dumps the full environment' };
      }
    }
    if (cmdWord === 'env' && tokens.length === 1) {
      return { rule: 'env-dump', evidence: 'bare `env` dumps the full environment' };
    }

    // 4) tee into .env*
    if (cmdWord === 'tee') {
      const target = args.map(stripQuotes).find((t) => isEnvFileToken(t));
      if (target) {
        return { rule: 'env-file-write', evidence: '`tee` writes into "' + target + '"' };
      }
    }

    // 5) Any other command touching a .env* path.
    const envArgs = args.filter((t) => isEnvFileToken(t));
    if (envArgs.length > 0) {
      if (EXISTENCE_ONLY_COMMANDS.has(cmdWord)) continue; // ls/stat/rm/... never disclose contents
      const target = stripQuotes(envArgs[envArgs.length - 1]);
      // cp/mv: dest .env* = write; .env* as source = read (exfiltration copy).
      if (cmdWord === 'cp' || cmdWord === 'mv' || cmdWord === 'install') {
        const operands = args.filter((t) => !t.startsWith('-')).map(stripQuotes);
        const dest = operands[operands.length - 1];
        if (isEnvFileToken(dest)) {
          return { rule: 'env-file-write', evidence: '`' + cmdWord + '` destination is "' + dest + '"' };
        }
        return { rule: 'env-file-read', evidence: '`' + cmdWord + '` copies secret file "' + target + '" out' };
      }
      // sed -i (in-place) = write; everything else = read.
      if (cmdWord === 'sed' && args.some((t) => t === '-i' || t.startsWith('-i'))) {
        return { rule: 'env-file-write', evidence: '`sed -i` edits "' + target + '" in place' };
      }
      return { rule: 'env-file-read', evidence: '`' + cmdWord + '` targets "' + target + '" in `' + trimmedSeg + '`' };
    }
  }

  return null;
}

// ── Sanctioned-resolver detection (built-in, code-only) ───────────────────────
//
// FINDING 1 FIX (auth-boundary hardening): the old check was a raw substring
// match against the whole command, so `cat .env # run-with-op.sh` or
// `echo $OPENAI_API_KEY >/tmp/x # op run --env-file` passed — the sanctioned
// name appeared *somewhere*, not as the thing being run. We now parse the
// command and honor a resolver ONLY when it is the actual invoked executable of
// a pipeline stage (after peeling bash/sh/env/... wrappers). A resolver name in
// a comment or as an argument no longer sanctions anything.
//
// FINDING 2 FIX: the repo-writable staged allowlist
// (_dev/state/secret-access-gate/allowlist.json) is REMOVED. That path is
// inside the repo working tree, so an agent could Write it and self-authorize.
// The only non-operator carve-out is this built-in, code-only resolver list;
// broadening it requires an operator to edit source, not a tool call. The
// operator's runtime degrade key is ENV (see kill-switch handling in _main).

/** Tokens of the effective invoked command for a segment: peel VAR=val
 * assignment prefixes and interpreter/prefix wrappers (bash/sh/env/...). */
function effectiveExecTokens(seg) {
  let toks = segmentTokens(seg); // already skips leading VAR=value assignments
  let guard = 0;
  while (toks.length && guard < 8) {
    guard += 1;
    const lead = pathMod.basename(stripQuotes(toks[0]));
    if (!EXEC_WRAPPERS.has(lead)) break;
    toks = toks.slice(1);
    // Skip the wrapper's own flags and any VAR=value it sets (e.g. `env FOO=b`).
    while (
      toks.length &&
      (toks[0].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(stripQuotes(toks[0])))
    ) {
      toks = toks.slice(1);
    }
  }
  return toks;
}

/** True when the ACTUAL invoked executable of this pipeline stage is a
 * sanctioned credential resolver (not merely a substring of the line). */
function isSanctionedSegment(seg) {
  const toks = effectiveExecTokens(seg);
  if (toks.length === 0) return false;
  const execBase = pathMod.basename(stripQuotes(toks[0]));
  if (SANCTIONED_SCRIPT_BASENAMES.has(execBase)) return true;
  // `op run --env-file[=...]` — 1Password service-account resolution.
  if (execBase === 'op') {
    const rest = toks.slice(1).map(stripQuotes);
    const hasRun = rest.includes('run');
    const hasEnvFile = rest.some((t) => t === '--env-file' || t.startsWith('--env-file='));
    if (hasRun && hasEnvFile) return true;
  }
  return false;
}

// ── State (mirrors write-boundary gate) ────────────────────────────────────────

function resolveSessionId(payload) {
  return (
    String((payload && payload.session_id) || '').trim() ||
    process.env.CLAUDE_SESSION_ID ||
    process.env.CLAUDE_SESSION ||
    ('day-' + new Date().toISOString().slice(0, 10))
  );
}

function loadSaState(stateFile, fs) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      return {
        ...parsed,
        sa_blocked: Number.isFinite(parsed.sa_blocked) ? parsed.sa_blocked : 0,
        sa_observed: Number.isFinite(parsed.sa_observed) ? parsed.sa_observed : 0,
        sa_log: Array.isArray(parsed.sa_log) ? parsed.sa_log : [],
      };
    }
  } catch (_) { /* missing or corrupt */ }
  return { sa_blocked: 0, sa_observed: 0, sa_log: [] };
}

function saveSaState(stateFile, state, fs) {
  try {
    fs.mkdirSync(pathMod.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ ...state, sa_log: (state.sa_log || []).slice(-50) }, null, 2) + '\n');
  } catch (_) { /* best-effort; never throw */ }
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main(options, _injected) {
  try {
    return _main(options, _injected);
  } catch (_err) {
    return { status: 0, reason: 'fail-open-exception' };
  }
}

function _main(options, _injected) {
  const fs = (_injected && _injected.fs) || fsMod;

  // Resolve payload (stdin fallback mirrors the write-boundary gate).
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
    } catch (_) {
      return { status: 0, reason: 'fail-open-stdin' };
    }
  }

  const toolToken =
    String((options && options.tool) || '').trim().toLowerCase() ||
    String(payload.tool_name || payload.tool || '').toLowerCase();
  if (!toolToken) return { status: 0, reason: 'no-tool-name' };

  const toolInput =
    (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input : {};

  // ── Detect ────────────────────────────────────────────────────────────────
  const projectDir = (_injected && _injected.projectDir) || resolveProjectDir();
  let violation = null;

  if (toolToken === 'bash') {
    const cmd = String(toolInput.command || toolInput.cmd || '');
    // Sanctioned resolvers are excused per-segment inside scanBashCommand
    // (isSanctionedSegment), so a resolver stage never excuses a sibling
    // `cat .env` stage. No whole-command short-circuit here.
    violation = scanBashCommand(cmd);
  } else if (toolToken === 'write' || toolToken === 'edit' || toolToken === 'multiedit') {
    const candidates = [String(toolInput.file_path || '')];
    if (Array.isArray(toolInput.edits)) {
      for (const e of toolInput.edits) candidates.push(String((e && e.file_path) || ''));
    }
    const hit = candidates.find((p) => p && isEnvFileToken(p));
    if (hit) {
      violation = {
        rule: 'env-file-write',
        evidence: toolToken.charAt(0).toUpperCase() + toolToken.slice(1) + ' tool targets "' + hit + '"',
      };
    }
  } else {
    return { status: 0, reason: 'not-a-gated-tool' };
  }

  if (!violation) return { status: 0, reason: 'no-secret-surface' };

  // ── Gate state / kill-switch / mode ───────────────────────────────────────
  const stateDir = pathMod.join(projectDir, '_dev', 'state', 'secret-access-gate');
  const stateFile = pathMod.join(stateDir, resolveSessionId(payload) + '.json');

  // FINDING 3 FIX: the old kill-switch was a repo-local file
  // (_dev/state/secret-access-gate/disabled) an agent could Write to disable the
  // gate. That file is INSIDE the repo working tree — an agent-writable off
  // switch defeats the whole gate. It is removed. The kill-switch now lives at
  // an operator-only trust boundary: an env var, consistent with the enable
  // flag (an operator who can set MYTHOS_SECRET_ACCESS_GATE can also unset it, or
  // set MYTHOS_SECRET_ACCESS_GATE_DISABLED). A repo file no longer disables.
  const disabledRaw = String(process.env.MYTHOS_SECRET_ACCESS_GATE_DISABLED || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(disabledRaw)) {
    return { status: 0, reason: 'kill-switch-env' };
  }

  const enforcingRaw = String(process.env.MYTHOS_SECRET_ACCESS_GATE || '').trim().toLowerCase();
  const enforcing = ['1', 'true', 'yes', 'on'].includes(enforcingRaw);

  const message = blockMessage(violation.rule, violation.evidence);
  const state = loadSaState(stateFile, fs);
  state.sa_log.push({
    ts: new Date().toISOString(),
    gate: 'secret-access',
    rule: violation.rule,
    evidence: redactEvidence(violation.evidence),
    tool: toolToken,
    mode: enforcing ? 'blocking' : 'observe-only',
    degrade_path: 'operator-keyed-only',
  });

  if (enforcing) {
    state.sa_blocked = (state.sa_blocked || 0) + 1;
    saveSaState(stateFile, state, fs);
    process.stderr.write(message + '\n');
    return { status: 2, reason: violation.rule, rule: violation.rule, evidence: violation.evidence, message };
  }

  state.sa_observed = (state.sa_observed || 0) + 1;
  saveSaState(stateFile, state, fs);
  const observeMsg =
    '[SECRET-ACCESS observe-only] WOULD BLOCK (' + violation.rule + ') — set MYTHOS_SECRET_ACCESS_GATE=1 to enforce (operator flips, never the agent). ' + message;
  process.stderr.write(observeMsg + '\n');
  return { status: 0, reason: violation.rule + '-observed', rule: violation.rule, evidence: violation.evidence, message: observeMsg };
}

// ── Exports (for tests and dispatcher wiring) ──────────────────────────────────
module.exports = {
  blockMessage,
  effectiveExecTokens,
  isEnvFileToken,
  isKeyShapedName,
  isSanctionedSegment,
  main,
  redactEvidence,
  RULE_TEXT,
  SANCTIONED_RESOLUTION_PATHS,
  scanBashCommand,
};

// ── Standalone entry ────────────────────────────────────────────────────────────
if (require.main === module) {
  try {
    const result = main();
    process.exit(result && result.status === 2 ? 2 : 0);
  } catch (_) {
    process.exit(0); // fail-open
  }
}
