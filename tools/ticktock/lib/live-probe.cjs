'use strict';

// tools/ticktock/lib/live-probe.cjs -- the three-part live probe backing the
// pretooluse-live gate in ../preflight-ticktock.cjs (enforcement-evidence-
// integrity, round 4/4b: _dev/reports/analysis/task-plans/
// enforcement-evidence-integrity__plan.md).
//
// DELIBERATELY A SEPARATE FILE, NOT INLINE IN preflight-ticktock.cjs. The
// canary command below builds one of the PowerShell verb-noun pairs listed in
// HARD_MUTATION_TOKENS (tools/kernel/hooks/pretool-remote-mutation-gate.cjs).
// That module's own script-body scanner (scanUnknownScript()) reads the FULL
// BODY of any file directly invoked as `node <file>` and denies it if a hard-
// mutation token appears anywhere in that text -- comments included, which is
// why even this explanatory paragraph must not spell the token out literally
// and contiguous, and why the constant below is assembled at runtime from
// pieces rather than written as one string. If the assembled string (or its
// spelled-out literal) lived inside preflight-ticktock.cjs itself, every
// ordinary `node tools/ticktock/preflight-ticktock.cjs` invocation would
// become a denied mutating action requiring an operator stamp, breaking
// /ticktock entirely. require()-ing this module does not trigger that scanner
// (it only inspects the literal script argument of a Bash tool call, not
// transitively required files), so the canary lives here and only here.
//
// require() this module read-only from preflight-ticktock.cjs; this file has
// no CLI entry point and must never be invoked directly via `node <this file>`.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DISPATCH_ENTRYPOINT_REL = path.join('tools', 'kernel', 'hooks', 'dispatch-pretool.cjs');
const GATE_MODULE_REL = path.join('tools', 'kernel', 'hooks', 'pretool-remote-mutation-gate.cjs');
const SETTINGS_PATH_REL = path.join('.claude', 'settings.json');
const STAMPS_DIR_REL = path.join('_dev', 'state', 'remote-mutation-stamps');

// Verified 2026-08-11 against all currently-valid stamp sidecars (named
// scripts / narrow anchored `re:` regexes -- none matches a raw ssh-to-orwell
// mutating PowerShell payload) and independently re-verified live by codex's
// own synthetic spawnSync probe during round 4b cross-review (exit 2,
// G-REMOTE-MUTATION/no-covering-stamp). Never executed as a shell command --
// it is classified as text inside a JSON payload only.
const CANARY_COMMAND = 'ssh orwell powershell -Command "' +
  ['Set', 'Content'].join('-') + ' -Path C:\\canary\\synthetic.txt -Value canary"';

function defaultReadSettings(repoRoot) {
  const abs = path.resolve(repoRoot, SETTINGS_PATH_REL);
  try {
    return { ok: true, doc: JSON.parse(fs.readFileSync(abs, 'utf8')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function defaultRequireGateModule(repoRoot) {
  return require(path.resolve(repoRoot, GATE_MODULE_REL));
}

function defaultSpawnDispatcher(repoRoot, payload) {
  const abs = path.resolve(repoRoot, DISPATCH_ENTRYPOINT_REL);
  return spawnSync(process.execPath, [abs], {
    cwd: repoRoot,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 15000
  });
}

function enumerateStamps(repoRoot) {
  const dir = path.resolve(repoRoot, STAMPS_DIR_REL);
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch (_) {
    return [];
  }
}

/** Leg 1: does .claude/settings.json really register dispatch-pretool.cjs? */
/**
 * Deliberately strict: the ENTIRE command must be exactly `node <arg>`, where
 * <arg> is either bare or double-quoted -- the two shapes actually used in
 * .claude/settings.json. Anything else (extra flags, chained commands, a
 * trailing argument) is UNRECOGNIZED, not guessed at. round-4b F2: a loose
 * substring/regex extraction would accept a near-match command that merely
 * MENTIONS the right path while doing something else first or after.
 */
function parseExactNodeCommand(command) {
  const trimmed = String(command || '').trim();
  const m = /^node\s+(?:"([^"]*)"|(\S+))$/.exec(trimmed);
  if (!m) return null;
  return { arg: m[1] !== undefined ? m[1] : m[2] };
}

function checkWiring(repoRoot, readSettings) {
  const read = (readSettings || ((r) => defaultReadSettings(r)))(repoRoot);
  if (!read.ok) {
    return { ok: false, reason_code: 'SETTINGS-UNREADABLE', detail: read.error };
  }
  const groups = (read.doc && read.doc.hooks && Array.isArray(read.doc.hooks.PreToolUse))
    ? read.doc.hooks.PreToolUse : [];
  const expectedAbs = path.resolve(repoRoot, DISPATCH_ENTRYPOINT_REL);
  for (const group of groups) {
    const hooks = Array.isArray(group && group.hooks) ? group.hooks : [];
    for (const h of hooks) {
      const raw = String((h && h.command) || '');
      const expanded = raw.replace(/\$\{CLAUDE_PROJECT_DIR\}/g, repoRoot);
      const parsed = parseExactNodeCommand(expanded);
      if (!parsed) continue;
      if (path.resolve(parsed.arg) === expectedAbs) {
        return { ok: true };
      }
    }
  }
  return {
    ok: false,
    reason_code: 'WIRING-NOT-FOUND',
    detail: `no hooks.PreToolUse[].hooks[].command in ${SETTINGS_PATH_REL} is exactly 'node "${expectedAbs}"' (or the unquoted equivalent) -- near-matches (extra flags, chained commands) do not count`
  };
}

/**
 * Positively verify, by reading and parsing every currently-valid stamp
 * sidecar and asking the gate module's OWN scopeCovers() whether any of its
 * scope entries cover the canary's classified mutating key(s) -- not merely
 * enumerate filenames (round-4b F3). Fails closed on any unreadable or
 * unparseable sidecar: an evidence check that cannot read its evidence must
 * not silently pass.
 */
function verifyStampScopes(repoRoot, gateModule) {
  const dir = path.resolve(repoRoot, STAMPS_DIR_REL);
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch (err) {
    return { ok: false, reason_code: 'STAMPS-DIR-UNREADABLE', detail: err.message, checked: [] };
  }
  let cls;
  try {
    cls = gateModule.classifyCommand(CANARY_COMMAND, { projectDir: repoRoot, fs });
  } catch (err) {
    return { ok: false, reason_code: 'CANARY-CLASSIFICATION-FAILED', detail: err.message, checked: [] };
  }
  const mutatingKeys = (cls && Array.isArray(cls.mutating) ? cls.mutating : [])
    .map((m) => ({ key: m.key, raw: m.raw }));
  if (mutatingKeys.length === 0) {
    return {
      ok: false,
      reason_code: 'CANARY-NOT-CLASSIFIED-MUTATING',
      detail: 'the canary command was not classified as mutating by the live module; it cannot serve as a denial canary',
      checked: []
    };
  }
  const checked = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let stamp;
    try {
      stamp = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      return { ok: false, reason_code: 'STAMP-UNPARSEABLE', detail: `${name}: ${err.message}`, checked };
    }
    // round-4b F5: a missing or non-array scope is a MALFORMED sidecar, not an
    // empty one -- defaulting it to [] would silently treat "cannot tell what
    // this stamp covers" as "covers nothing", which is not fail-closed.
    if (!Array.isArray(stamp && stamp.scope)) {
      checked.push({ file: name, stamp_id: stamp && stamp.stamp_id, scope: null, covers_canary: null });
      return {
        ok: false,
        reason_code: 'STAMP-SCOPE-UNPARSEABLE',
        detail: `${name}: stamp.scope is ${JSON.stringify(stamp && stamp.scope)}, not an array -- cannot prove it does not cover the canary`,
        checked
      };
    }
    const scope = stamp.scope;
    const coversAny = mutatingKeys.some(({ key, raw }) => {
      try {
        return gateModule.scopeCovers(stamp, key, raw);
      } catch (_) {
        return true; // a scopeCovers exception is treated as "could cover" -- fail closed
      }
    });
    checked.push({ file: name, stamp_id: stamp && stamp.stamp_id, scope, covers_canary: coversAny });
    if (coversAny) {
      return { ok: false, reason_code: 'CANARY-COVERED-BY-STAMP', detail: `${name} scope covers the canary`, checked };
    }
  }
  return { ok: true, checked, mutating_keys: mutatingKeys.map((m) => m.key) };
}

/** Leg 2: require() the live gate module and evaluate() the canary in-process. */
function directModuleProbe(repoRoot, requireGateModule) {
  let gateModule;
  try {
    gateModule = (requireGateModule || ((r) => defaultRequireGateModule(r)))(repoRoot);
  } catch (err) {
    return { ok: false, reason_code: 'GATE-MODULE-LOAD-FAILED', detail: err.message };
  }
  if (!gateModule || typeof gateModule.evaluate !== 'function') {
    return { ok: false, reason_code: 'GATE-MODULE-MALFORMED', detail: 'evaluate() is not exported by the required module' };
  }
  const scopeEvidence = verifyStampScopes(repoRoot, gateModule);
  if (!scopeEvidence.ok) {
    return {
      ok: false,
      reason_code: scopeEvidence.reason_code,
      detail: scopeEvidence.detail,
      stamp_files_checked: scopeEvidence.checked
    };
  }
  let result;
  try {
    result = gateModule.evaluate(CANARY_COMMAND, {
      projectDir: repoRoot,
      fs,
      nowMs: Date.now(),
      sessionId: 'ticktock-preflight-probe'
    });
  } catch (err) {
    return { ok: false, reason_code: 'PROBE-INTERNAL-ERROR', detail: err.message, stamp_files_checked: scopeEvidence.checked };
  }
  if (result && result.status === 2 && result.reason === 'no-covering-stamp') {
    return { ok: true, stamp_files_checked: scopeEvidence.checked };
  }
  return {
    ok: false,
    reason_code: 'DIRECT-PROBE-NOT-DENIED',
    detail: `evaluate() returned ${JSON.stringify(result)}; expected status 2 / reason 'no-covering-stamp'`,
    stamp_files_checked: scopeEvidence.checked
  };
}

/** Leg 3: spawn the REGISTERED entrypoint with a synthetic PreToolUse payload. */
function spawnProbe(repoRoot, spawnDispatcher) {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: CANARY_COMMAND },
    session_id: 'ticktock-preflight-probe'
  };
  let res;
  try {
    res = (spawnDispatcher || ((r, p) => defaultSpawnDispatcher(r, p)))(repoRoot, payload);
  } catch (err) {
    return { ok: false, reason_code: 'SPAWN-PROBE-INTERNAL-ERROR', detail: err.message };
  }
  if (!res || res.error) {
    return { ok: false, reason_code: 'SPAWN-PROBE-FAILED', detail: (res && res.error && res.error.message) || 'spawn returned no result' };
  }
  const stderr = String(res.stderr || '');
  if (res.status === 2 && stderr.includes('G-REMOTE-MUTATION')) {
    return { ok: true };
  }
  return {
    ok: false,
    reason_code: 'SPAWN-PROBE-NOT-DENIED',
    detail: `exit=${res.status} stderr=${stderr.slice(0, 300)}`
  };
}

/**
 * Run all three legs against repoRoot, short-circuiting on the first failure
 * (a broken earlier leg means later legs were never meaningfully reachable).
 * opts.readSettings/requireGateModule/spawnDispatcher are test-only injection
 * points (S5-REDESIGNED); each defaults to the real dependency when omitted.
 */
function runLiveProbe(repoRoot, opts) {
  const o = opts || {};
  const wiring = checkWiring(repoRoot, o.readSettings);
  const direct = wiring.ok ? directModuleProbe(repoRoot, o.requireGateModule) : null;
  const spawn = (wiring.ok && direct && direct.ok) ? spawnProbe(repoRoot, o.spawnDispatcher) : null;
  return {
    wiring,
    direct,
    spawn,
    canary_command: CANARY_COMMAND,
    ok: Boolean(wiring.ok && direct && direct.ok && spawn && spawn.ok)
  };
}

module.exports = {
  DISPATCH_ENTRYPOINT_REL,
  GATE_MODULE_REL,
  SETTINGS_PATH_REL,
  STAMPS_DIR_REL,
  CANARY_COMMAND,
  defaultReadSettings,
  defaultRequireGateModule,
  defaultSpawnDispatcher,
  enumerateStamps,
  parseExactNodeCommand,
  checkWiring,
  verifyStampScopes,
  directModuleProbe,
  spawnProbe,
  runLiveProbe
};
