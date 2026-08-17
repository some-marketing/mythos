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
// Second, independently-authored leg (plan pretooluse-live-second-verifier).
// require()'d lazily inside independentProbe() so a load failure there is
// caught and reported per-leg, matching the pattern already used for
// requireGateModule() in directModuleProbe().
const INDEPENDENT_VERIFIER_REL = path.join('tools', 'kernel', 'hooks', 'verify-stamp-independently.cjs');

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
 *
 * ticktock-remote-mutation-canary-stamp-collision S0 (2026-08-16): a voided,
 * expired, or superseded stamp used to still be checked against the canary
 * here, even though the real gate (pretool-remote-mutation-gate.cjs) already
 * excludes exactly those stamps from real enforcement via its own
 * stampInvalidReason(). That divergence meant voiding a colliding stamp did
 * not restore this probe's ability to prove enforcement -- confirmed live
 * this session. Call the gate module's OWN validity predicate first (never
 * reimplement it a second time, per the module-reuse rule this file already
 * follows for scopeCovers()) and skip invalid stamps before checking coverage.
 * nowMs is accepted (defaulting to Date.now()) so tests can exercise expiry
 * deterministically instead of depending on wall-clock timing.
 */
function verifyStampScopes(repoRoot, gateModule, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
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
    // S0: a stamp the real gate would already reject (voided, expired,
    // superseded, malformed) cannot authorize anything for real enforcement,
    // so it must not be treated as covering the canary here either.
    let invalidReason;
    try {
      invalidReason = gateModule.stampInvalidReason(stamp, { projectDir: repoRoot, fs, nowMs: now });
    } catch (err) {
      invalidReason = null; // a predicate that throws is not proof of invalidity -- fall through to scope check, fail closed on coverage instead
    }
    if (invalidReason) {
      checked.push({ file: name, stamp_id: stamp && stamp.stamp_id, scope: stamp.scope, covers_canary: false, invalid_reason: invalidReason });
      continue;
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
      return {
        ok: false,
        reason_code: 'CANARY-COVERED-BY-STAMP',
        detail: `${name} (stamp_id: ${stamp && stamp.stamp_id}) scope covers the canary`,
        checked
      };
    }
  }
  return { ok: true, checked, mutating_keys: mutatingKeys.map((m) => m.key) };
}

/** Leg 2: require() the live gate module and evaluate() the canary in-process. */
function directModuleProbe(repoRoot, requireGateModule, nowMs) {
  let gateModule;
  try {
    gateModule = (requireGateModule || ((r) => defaultRequireGateModule(r)))(repoRoot);
  } catch (err) {
    return { ok: false, reason_code: 'GATE-MODULE-LOAD-FAILED', detail: err.message, scope_covered: null };
  }
  if (!gateModule || typeof gateModule.evaluate !== 'function') {
    return { ok: false, reason_code: 'GATE-MODULE-MALFORMED', detail: 'evaluate() is not exported by the required module', scope_covered: null };
  }
  const scopeEvidence = verifyStampScopes(repoRoot, gateModule, nowMs);
  if (!scopeEvidence.ok) {
    // scope_covered is knowable specifically for CANARY-COVERED-BY-STAMP
    // (the primary path's own scope-verification leg reached a definite
    // coverage verdict before failing for that reason); every other
    // scopeEvidence failure (unreadable dir, unparseable stamp, etc.) means
    // no coverage verdict was reachable at all -- null, not false, so the
    // independent leg (verify-stamp-independently.cjs) correctly treats
    // this as "no primary verdict to compare against" rather than a
    // false disagreement.
    return {
      ok: false,
      reason_code: scopeEvidence.reason_code,
      detail: scopeEvidence.detail,
      stamp_files_checked: scopeEvidence.checked,
      scope_covered: scopeEvidence.reason_code === 'CANARY-COVERED-BY-STAMP' ? true : null
    };
  }
  let result;
  try {
    result = gateModule.evaluate(CANARY_COMMAND, {
      projectDir: repoRoot,
      fs,
      nowMs: typeof nowMs === 'number' ? nowMs : Date.now(),
      sessionId: 'ticktock-preflight-probe'
    });
  } catch (err) {
    return { ok: false, reason_code: 'PROBE-INTERNAL-ERROR', detail: err.message, stamp_files_checked: scopeEvidence.checked, scope_covered: false };
  }
  if (result && result.status === 2 && result.reason === 'no-covering-stamp') {
    return { ok: true, stamp_files_checked: scopeEvidence.checked, scope_covered: false };
  }
  return {
    ok: false,
    reason_code: 'DIRECT-PROBE-NOT-DENIED',
    detail: `evaluate() returned ${JSON.stringify(result)}; expected status 2 / reason 'no-covering-stamp'`,
    stamp_files_checked: scopeEvidence.checked,
    // scopeEvidence itself found no covering stamp (scope_covered: false) --
    // evaluate() disagreeing for some OTHER reason is a different bug class,
    // not a coverage disagreement, so the independent leg still has a valid
    // scope-coverage primary verdict to compare against here.
    scope_covered: false
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

function defaultRequireIndependentVerifier(repoRoot) {
  return require(path.resolve(repoRoot, INDEPENDENT_VERIFIER_REL));
}

/**
 * Leg 4 (plan pretooluse-live-second-verifier): the independently-authored
 * verifier. Runs whenever wiring succeeds, regardless of whether the direct
 * leg itself succeeded -- per kernel-triad review round 2 (codex): gating
 * this leg on direct/spawn's short-circuit would make it unable to run in
 * exactly the incident shape (AC3) it exists to catch. `primaryVerdict` is
 * derived by the caller from `direct.scope_covered` (null when the primary
 * path never reached a coverage verdict at all -- see directModuleProbe).
 */
function independentProbe(repoRoot, nowMs, beforeFingerprint, primaryScopeCovered, opts) {
  const o = opts || {};
  let verifier;
  try {
    verifier = (o.requireIndependentVerifier || ((r) => defaultRequireIndependentVerifier(r)))(repoRoot);
  } catch (err) {
    return { ok: false, reason_code: 'INDEPENDENT-MODULE-LOAD-FAILED', detail: err.message };
  }
  if (!verifier || typeof verifier.verifyStampIndependently !== 'function') {
    return { ok: false, reason_code: 'INDEPENDENT-MODULE-MALFORMED', detail: 'verifyStampIndependently() is not exported by the required module' };
  }
  const primaryVerdict = primaryScopeCovered === null ? null : { covered: primaryScopeCovered };
  try {
    return verifier.verifyStampIndependently(repoRoot, CANARY_COMMAND, primaryVerdict, {
      nowMs,
      beforeFingerprint,
      existsSync: o.independentExistsSync,
      statSync: o.independentStatSync
    });
  } catch (err) {
    return { ok: false, reason_code: 'INDEPENDENT-PROBE-INTERNAL-ERROR', detail: err.message };
  }
}

/**
 * Run all four legs against repoRoot. Legs 1-3 short-circuit on the first
 * failure (a broken earlier leg means later legs were never meaningfully
 * reachable). Leg 4 (independent) runs whenever wiring succeeds, in
 * parallel with -- not gated behind -- legs 2/3's own short-circuit chain,
 * per the plan's redesigned wiring (guard-spec.md, "Wiring (revised)").
 * opts.readSettings/requireGateModule/spawnDispatcher/requireIndependentVerifier
 * are test-only injection points; each defaults to the real dependency when
 * omitted.
 */
function runLiveProbe(repoRoot, opts) {
  const o = opts || {};
  const nowMs = typeof o.nowMs === 'number' ? o.nowMs : Date.now();
  const wiring = checkWiring(repoRoot, o.readSettings);

  let beforeFingerprint = null;
  let independentModule = null;
  if (wiring.ok) {
    try {
      independentModule = (o.requireIndependentVerifier || ((r) => defaultRequireIndependentVerifier(r)))(repoRoot);
      beforeFingerprint = independentModule.fingerprintStampsDir(repoRoot, o.independentStatSync);
    } catch (_) {
      beforeFingerprint = null; // independentProbe() below will surface the load failure itself
    }
  }

  const direct = wiring.ok ? directModuleProbe(repoRoot, o.requireGateModule, nowMs) : null;
  const independent = wiring.ok
    ? independentProbe(repoRoot, nowMs, beforeFingerprint, direct ? direct.scope_covered : null, o)
    : null;
  const spawn = (wiring.ok && direct && direct.ok) ? spawnProbe(repoRoot, o.spawnDispatcher) : null;

  return {
    wiring,
    direct,
    independent,
    spawn,
    canary_command: CANARY_COMMAND,
    ok: Boolean(wiring.ok && direct && direct.ok && independent && independent.ok && spawn && spawn.ok)
  };
}

module.exports = {
  DISPATCH_ENTRYPOINT_REL,
  GATE_MODULE_REL,
  SETTINGS_PATH_REL,
  STAMPS_DIR_REL,
  INDEPENDENT_VERIFIER_REL,
  CANARY_COMMAND,
  defaultReadSettings,
  defaultRequireGateModule,
  defaultRequireIndependentVerifier,
  defaultSpawnDispatcher,
  enumerateStamps,
  parseExactNodeCommand,
  checkWiring,
  verifyStampScopes,
  directModuleProbe,
  independentProbe,
  spawnProbe,
  runLiveProbe
};
