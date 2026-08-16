#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/unreal-export/watch-imports.js -- UnrealImport/1.0
// consumption-only watch loop for the unreal-world-projection plan, step S3
// (_dev/reports/analysis/task-plans/unreal-world-projection__plan.json).
//
// Watches a pulled-harvests root (default _dev/state/) for NEW, complete,
// manifest-verified harvest directories -- a directory carrying
// PULL-MANIFEST.txt and a run subdirectory with RESULT-MANIFEST.txt,
// world-state.json and turn-projection.json -- and invokes import-turn.js
// (as a child process, one invocation per harvest dir) exactly once per
// turn_id. "Once per turn_id" is enforced by import-turn.js's own journal
// (<out-dir>/import-index.jsonl) plus a fast pre-check here so an
// already-journaled turn is skipped without spawning a subprocess.
//
// Optional --deploy pushes the resulting unreal-import__<turn_id>.json to
// the orwell host's Imports\ directory (scp, same DEST_SCP convention as
// ue/deploy.sh) and triggers a headless rebuild via
// _dev/sim-runs/vm/orwell/psrun.sh invoking Tools\BuildLevel.ps1
// -ProjectRoot <root> -Import <remote-path>. Without --deploy, imports are
// local-only.
//
// Deploy success is tracked separately from import success, in a sidecar
// (<out-dir>/deploy-state.jsonl: one line per turn_id that fully deployed --
// scp AND remote rebuild both succeeded). The import journal alone is NOT
// sufficient to gate deploys: a turn_id that is already journaled (import
// succeeded) but never made it into deploy-state.jsonl (deploy failed, or
// hasn't been attempted with --deploy yet) is retried on every subsequent
// --deploy pass. Only a fully successful deploy writes the sidecar line.
//
// This script NEVER invokes run-job, harvest, or CANCEL surfaces -- it only
// reads directories that have already crossed the courier boundary and
// carry a verified manifest chain, and it only ever appends to state that
// import-turn.js itself owns (the journal), state this script itself owns
// (deploy-state.jsonl), or writes to the orwell Imports\ directory when
// explicitly asked to deploy. Turn/harvest/cancellation
// orchestration and the short-turn timelapse cadence remain owned by
// ant-world-orwell-live-dashboard.
//
// Usage:
//   node watch-imports.js [--root <dir>] [--out-dir <dir>]
//                          [--interval <seconds>] [--once]
//                          [--deploy] [--host <ssh-host>]
//                          [--remote-dir <win-path>]
//                          [--build-script <win-path>]
//                          [--psrun <path-to-psrun.sh>]
//                          [--shuffles <n>]

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const IMPORT_TURN_JS = path.join(__dirname, 'import-turn.js');
const DEFAULT_ROOT = path.join(REPO_ROOT, '_dev', 'state');
const DEFAULT_OUT_DIR = __dirname;
const DEFAULT_INTERVAL_S = 30;
const DEFAULT_HOST = 'orwell';
// AntSimV2 is the live projection target as of 2026-08-06. AntWorldProjection is
// a PRESERVED BASELINE -- nothing may write to it again, and the standing
// G-REMOTE-MUTATION stamp antsimv2-projection-lane__20260806T1400Z carries a
// negative lookahead that mechanically refuses any invocation naming it.
const DEFAULT_PROJECT_NAME = 'AntSimV2';
const DEFAULT_PROJECT_ROOT = `D:\\UnrealProjects\\${DEFAULT_PROJECT_NAME}`;
const DEFAULT_REMOTE_DIR = `${DEFAULT_PROJECT_ROOT}\\Imports`;
const DEFAULT_BUILD_SCRIPT = `${DEFAULT_PROJECT_ROOT}\\Tools\\BuildLevel.ps1`;
const PRESERVED_BASELINE_PROJECT = 'AntWorldProjection';
const DEFAULT_PSRUN = path.join(REPO_ROOT, '_dev', 'sim-runs', 'vm', 'orwell', 'psrun.sh');

// --- logging ----------------------------------------------------------------

function log(...parts) {
  process.stdout.write(`[${new Date().toISOString()}] ${parts.join(' ')}\n`);
}

function logErr(...parts) {
  process.stderr.write(`[${new Date().toISOString()}] ${parts.join(' ')}\n`);
}

// --- CLI ----------------------------------------------------------------

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function hasFlag(flag) {
  return process.argv.indexOf(flag) !== -1;
}

function parseArgs() {
  const root = path.resolve(argVal('--root', DEFAULT_ROOT));
  const outDir = path.resolve(argVal('--out-dir', DEFAULT_OUT_DIR));
  const intervalRaw = argVal('--interval', String(DEFAULT_INTERVAL_S));
  const intervalS = Number(intervalRaw);
  if (!Number.isFinite(intervalS) || intervalS <= 0) {
    throw new Error(`--interval must be a positive number of seconds, got "${intervalRaw}"`);
  }
  const shufflesRaw = argVal('--shuffles', null);
  let shuffles = null;
  if (shufflesRaw !== null) {
    if (!/^[0-9]+$/.test(shufflesRaw.trim())) {
      throw new Error(`--shuffles must be a positive integer, got "${shufflesRaw}"`);
    }
    shuffles = parseInt(shufflesRaw, 10);
  }
  const remoteDir = argVal('--remote-dir', DEFAULT_REMOTE_DIR);
  const buildScript = argVal('--build-script', DEFAULT_BUILD_SCRIPT);
  // The baseline is protected by mechanism, not by convention: refuse locally
  // rather than relying on the remote-mutation stamp's negative lookahead to
  // catch it, so a mis-pointed run fails at the earliest possible point.
  for (const [flag, value] of [['--remote-dir', remoteDir], ['--build-script', buildScript]]) {
    if (value.includes(PRESERVED_BASELINE_PROJECT)) {
      throw new Error(
        `${flag} names ${PRESERVED_BASELINE_PROJECT}, which is a preserved baseline and must never be written to again. ` +
        `The live projection target is ${DEFAULT_PROJECT_NAME}.`
      );
    }
  }
  return {
    root,
    outDir,
    intervalMs: intervalS * 1000,
    once: hasFlag('--once'),
    deploy: hasFlag('--deploy'),
    host: argVal('--host', DEFAULT_HOST),
    remoteDir,
    buildScript,
    psrun: path.resolve(argVal('--psrun', DEFAULT_PSRUN)),
    shuffles,
    journalPath: argVal('--journal', null), // advisory override; see readJournalTurnIds()
    deployStatePath: argVal('--deploy-state', null) // advisory override; see readDeployStateTurnIds()
  };
}

// --- harvest-dir inspection (read-only; never mutates anything under root) --

// Locates the single run subdirectory carrying RESULT-MANIFEST.txt, mirroring
// import-turn.js's findRunSubdir() but tolerant: returns null instead of
// throwing when the shape isn't there yet (harvest still mid-pull).
function findRunSubdirSafe(harvestDir) {
  let entries;
  try {
    entries = fs.readdirSync(harvestDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (err) {
    return null;
  }
  const candidates = entries.filter((e) => fs.existsSync(path.join(harvestDir, e.name, 'RESULT-MANIFEST.txt')));
  if (candidates.length !== 1) return null;
  return path.join(harvestDir, candidates[0].name);
}

// Read-only completeness probe. Does NOT verify sha256 against the manifest
// chain -- import-turn.js does that (and fails closed) on the actual import.
// This is only a "is it worth attempting yet" gate so an in-progress pull
// directory is quietly retried next poll instead of spamming errors.
function inspectHarvestDir(harvestDir) {
  const pullManifestPath = path.join(harvestDir, 'PULL-MANIFEST.txt');
  if (!fs.existsSync(pullManifestPath)) {
    return { complete: false, reason: 'no PULL-MANIFEST.txt yet' };
  }
  const runSubdir = findRunSubdirSafe(harvestDir);
  if (!runSubdir) {
    return { complete: false, reason: 'no run subdirectory carrying RESULT-MANIFEST.txt yet' };
  }
  const worldStatePath = path.join(runSubdir, 'world-state.json');
  const turnProjectionPath = path.join(runSubdir, 'turn-projection.json');
  if (!fs.existsSync(worldStatePath) || !fs.existsSync(turnProjectionPath)) {
    return { complete: false, reason: 'run subdirectory missing world-state.json or turn-projection.json' };
  }
  let turnId = null;
  try {
    const turnProjection = JSON.parse(fs.readFileSync(turnProjectionPath, 'utf8'));
    turnId = turnProjection.run_name || null;
  } catch (err) {
    return { complete: false, reason: `turn-projection.json unreadable: ${err.message}` };
  }
  if (!turnId) {
    return { complete: false, reason: 'turn-projection.json missing run_name' };
  }
  return { complete: true, runSubdir, turnId };
}

// --- journal (read-only from this script's side -- import-turn.js owns writes) -

// Tolerant read: reuses import-turn.js's own line-by-line semantics as
// closely as practical, but this script only ever READS the journal to
// decide what to skip -- it never appends to it. A corrupt line is logged
// and the (best-effort) partial set is still used; import-turn.js itself
// will refuse in the same situation, which is the actual enforcement point.
function readJournalTurnIds(outDir, journalPathOverride) {
  const journalPath = journalPathOverride || path.join(outDir, 'import-index.jsonl');
  const seen = new Set();
  if (!fs.existsSync(journalPath)) return seen;
  const text = fs.readFileSync(journalPath, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    try {
      const entry = JSON.parse(line);
      if (entry && entry.turn_id) seen.add(entry.turn_id);
    } catch (err) {
      logErr(`WARN journal line ${i + 1} of ${journalPath} is unreadable (${err.message}); skipping for this pre-check -- import-turn.js will fail closed if this matters`);
    }
  }
  return seen;
}

// --- deploy state (deploy-state.jsonl -- this script's own sidecar, next to
// the journal; import-turn.js never reads or writes it) ---------------------
//
// The journal (import-index.jsonl) records "this turn_id was imported"; it
// says nothing about whether a subsequent --deploy attempt for that turn
// actually landed on orwell. Without a separate ledger, a --deploy that
// fails after a successful import becomes a permanent no-op on every later
// pass, because the journal-skip check alone treats the turn as already
// handled. deploy-state.jsonl closes that gap: a line is appended here ONLY
// after both the scp and the remote rebuild trigger succeed (see
// runDeploySweep()), so a partial/failed deploy leaves no line and is
// retried on the next pass that runs with --deploy.

function resolveDeployStatePath(outDir, override) {
  return override || path.join(outDir, 'deploy-state.jsonl');
}

// Tolerant read, mirroring readJournalTurnIds(): a corrupt line is logged
// and skipped rather than treated as fatal -- this is only a "was this
// turn already deployed" pre-check, and the worst case of misreading it is
// an extra (idempotent, best-effort) redeploy attempt, never data loss.
//
// deploy-state.jsonl is append-only, so a false-OK line can never be
// rewritten -- only corrected by a LATER line naming corrected_turn_id
// (never turn_id, so a correction record itself never re-adds the turn it
// corrects). This is a single order-aware forward pass: a {turn_id} line
// adds to the deployed set, a {corrected_turn_id} line removes from it, and
// because the pass runs in file order, a turn_id line written AFTER its
// correction (a later, actually-verified redeploy) naturally supersedes the
// correction and re-adds the turn.
function readDeployStateTurnIds(outDir, deployStatePathOverride) {
  const deployStatePath = resolveDeployStatePath(outDir, deployStatePathOverride);
  const seen = new Set();
  if (!fs.existsSync(deployStatePath)) return seen;
  const text = fs.readFileSync(deployStatePath, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (err) {
      logErr(
        `WARN deploy-state line ${i + 1} of ${deployStatePath} is unreadable (${err.message}); skipping for this pre-check`
      );
      continue;
    }
    if (!entry) continue;
    if (entry.corrected_turn_id) {
      seen.delete(entry.corrected_turn_id);
    } else if (entry.turn_id) {
      seen.add(entry.turn_id);
    }
  }
  return seen;
}

// Appended ONLY after a deploy attempt fully succeeds (scp AND remote
// rebuild both report success, the latter now meaning the transcript's own
// ANTWORLD_OK + ANTWORLD_HOST_REPORT_PRESENT=True markers, not just trigger
// exit 0) -- see the call site in runDeploySweep(). build_verified:true
// marks lines written under this truthful check, distinguishing them from
// any legacy line written before this fix existed.
function writeDeployStateEntry(outDir, deployStatePathOverride, turnId, target, resultLine) {
  const deployStatePath = resolveDeployStatePath(outDir, deployStatePathOverride);
  fs.mkdirSync(path.dirname(deployStatePath), { recursive: true });
  const entry = { turn_id: turnId, deployed_at: new Date().toISOString(), target, build_verified: true };
  if (resultLine) entry.antworld_result = resultLine;
  fs.appendFileSync(deployStatePath, `${JSON.stringify(entry)}\n`);
}

// Reconstructs the on-disk path import-turn.js writes for a given turn_id
// (see buildDoc()'s outPath convention in import-turn.js) so an already
// -journaled turn from a PRIOR pass can still be located for a deploy retry
// without re-running the importer.
function outPathForTurn(outDir, turnId) {
  return path.join(outDir, `unreal-import__${turnId}.json`);
}

// One deploy sweep: any turn_id that is journaled but not yet recorded in
// deploy-state.jsonl gets a (re)deploy attempt. Covers both turns imported
// earlier in THIS pass and turns imported (and possibly deploy-failed) in
// any earlier pass -- the journal-skip in the import loop above never
// prevents a retry here.
function runDeploySweep(journaledTurnIds, opts, summary) {
  const deployedTurnIds = readDeployStateTurnIds(opts.outDir, opts.deployStatePath);
  const pending = Array.from(journaledTurnIds).filter((turnId) => !deployedTurnIds.has(turnId));
  summary.deployPending = pending.length;
  summary.deployed = 0;
  summary.deployFailed = 0;

  for (const turnId of pending) {
    const outPath = outPathForTurn(opts.outDir, turnId);
    if (!fs.existsSync(outPath)) {
      logErr(`deploy: turn_id=${turnId} is journaled but ${outPath} is missing -- skipping this pass`);
      continue;
    }
    log(`deploy: turn_id=${turnId} not yet in deploy-state -- attempting (re)deploy`);
    const result = deployImport(outPath, opts);
    if (result.deployed && result.rebuilt) {
      writeDeployStateEntry(opts.outDir, opts.deployStatePath, turnId, opts.host, result.resultLine);
      summary.deployed += 1;
      log(`deploy: turn_id=${turnId} OK -- recorded in ${resolveDeployStatePath(opts.outDir, opts.deployStatePath)}`);
    } else {
      summary.deployFailed += 1;
      logErr(`deploy: turn_id=${turnId} FAILED this pass (deployed=${result.deployed} rebuilt=${result.rebuilt} failure_class=${result.failureClass || 'n/a'}) -- no deploy-state line written, will retry next pass`);
    }
  }
}

// --- import-turn.js invocation -----------------------------------------------

function runImportTurn(harvestDir, outDir, shuffles) {
  const args = [IMPORT_TURN_JS, harvestDir, '--out-dir', outDir];
  if (shuffles !== null && shuffles !== undefined) {
    args.push('--shuffles', String(shuffles));
  }
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return result;
}

// Parses import-turn.js's one-line success banner:
//   imported turn_id=<id> absolute_day_start=<n> payload_hash=<hash> -> <outPath> (journal: <journalPath>)
function parseImportBanner(stdout) {
  const m = /imported turn_id=(\S+) absolute_day_start=(\d+) payload_hash=(\S+) -> (\S+) \(journal: (.+)\)/.exec(
    stdout || ''
  );
  if (!m) return null;
  return { turnId: m[1], absoluteDayStart: Number(m[2]), payloadHash: m[3], outPath: m[4], journalPath: m[5] };
}

// --- deploy (scp + psrun.sh BuildLevel.ps1 -Import) --------------------------

function toRemoteScpPath(winPath) {
  // ue/deploy.sh's convention: forward slashes for the scp target, same
  // Windows drive path otherwise (OpenSSH-on-Windows scp accepts this).
  return winPath.replace(/\\/g, '/');
}

// Reads BuildLevel.ps1's OWN evidence markers out of the transcript psrun.sh
// tees back through spawnSync().stdout, instead of trusting the trigger's
// process exit code. This matters because BuildLevel.ps1 has no explicit
// exit-on-crash path outside the -TimeoutSeconds branch: when
// UnrealEditor-Cmd.exe dies mid-run (e.g. the D3D12 headless crash this fix
// exists for), the PowerShell script itself still falls through to a clean
// (exit 0) finish -- so "the trigger exited 0" is NOT evidence the build
// actually succeeded ("bridge exit code is not a verdict").
//
// A build is only real success when the transcript carries BOTH:
//   - ANTWORLD_OK          (build_world.py's own success marker)
//   - ANTWORLD_HOST_REPORT_PRESENT=True (the JSON report file was written)
// and does NOT carry ANTWORLD_FAIL.
function parseBuildOutcome(stdout) {
  const text = stdout || '';
  const antworldOk = /\bANTWORLD_OK\b/.test(text);
  const antworldFail = /\bANTWORLD_FAIL\b/.test(text);
  const reportPresentMatch = /ANTWORLD_HOST_REPORT_PRESENT=(True|False)/.exec(text);
  const reportPresent = reportPresentMatch ? reportPresentMatch[1] === 'True' : false;
  const resultMatch = /^ANTWORLD_RESULT.*$/m.exec(text);
  const resultLine = resultMatch ? resultMatch[0].trim() : null;

  const ok = antworldOk && reportPresent && !antworldFail;

  let failureClass = null;
  if (!ok) {
    if (/ANTWORLD_HOST_EDITOR_GUARD=REFUSED|ANTWORLD_HOST_BASELINE_GUARD=REFUSED/.test(text)) {
      failureClass = 'guard-refused';
    } else if (/Fatal error|RequestExit/.test(text)) {
      failureClass = 'editor-crash';
    } else {
      failureClass = 'no-report';
    }
  }

  return { ok, antworldOk, antworldFail, reportPresent, failureClass, resultLine };
}

function deployImport(outPath, opts) {
  const base = path.basename(outPath);
  const remoteScpTarget = `${opts.host}:${toRemoteScpPath(opts.remoteDir)}/${base}`;
  log(`deploy: scp ${outPath} -> ${remoteScpTarget}`);
  const scpResult = spawnSync('scp', ['-q', outPath, remoteScpTarget], { encoding: 'utf8' });
  if (scpResult.error || scpResult.status !== 0) {
    logErr(
      `deploy: scp FAILED (status=${scpResult.status}, error=${scpResult.error ? scpResult.error.message : 'n/a'}) stderr=${(scpResult.stderr || '').trim()}`
    );
    return { deployed: false, rebuilt: false };
  }
  log(`deploy: scp OK`);

  const remoteImportPath = `${opts.remoteDir}\\${base}`;
  if (!fs.existsSync(opts.psrun)) {
    logErr(`deploy: psrun.sh not found at ${opts.psrun} -- skipping remote rebuild trigger`);
    return { deployed: true, rebuilt: false };
  }
  const tmpScript = path.join(os.tmpdir(), `watch-imports-buildlevel-${process.pid}-${Date.now()}.ps1`);
  // -ProjectRoot is passed EXPLICITLY rather than left to the host script's
  // own default. The AntSimV2 project directory on the host was cloned from
  // the AntWorldProjection baseline, so until ue/deploy.sh has pushed the
  // repointed Tools\BuildLevel.ps1, that host copy still defaults to the
  // baseline -- and an import scp'd correctly into AntSimV2\Imports would be
  // built into the preserved baseline. Naming the root here makes the
  // caller, not whatever copy happens to be on disk, decide the target.
  const projectRoot = path.win32.dirname(path.win32.dirname(opts.buildScript));
  const ps1 = [
    `powershell -NoProfile -File "${opts.buildScript}" -ProjectRoot "${projectRoot}" -Import "${remoteImportPath}" -NullRHI`
  ].join('\n');
  fs.writeFileSync(tmpScript, `${ps1}\n`);
  log(`deploy: triggering headless rebuild via ${opts.psrun} (import=${remoteImportPath})`);
  const buildResult = spawnSync('bash', [opts.psrun, tmpScript], { encoding: 'utf8' });
  try {
    fs.unlinkSync(tmpScript);
  } catch (err) {
    /* best-effort cleanup of the local temp script; not load-bearing */
  }
  if (buildResult.error) {
    logErr(`deploy: rebuild trigger FAILED to spawn (error=${buildResult.error.message})`);
    return { deployed: true, rebuilt: false, failureClass: 'trigger-error', resultLine: null };
  }

  // The trigger's own exit status is NOT the verdict -- BuildLevel.ps1 has
  // no explicit exit-on-crash path outside its -TimeoutSeconds branch, so a
  // headless D3D12 crash mid-build still lets the script (and therefore
  // psrun.sh, and therefore this spawnSync) exit 0. The transcript's own
  // ANTWORLD_OK / ANTWORLD_HOST_REPORT_PRESENT markers are the only truthful
  // signal; parse those instead of trusting buildResult.status.
  const outcome = parseBuildOutcome(buildResult.stdout);

  if (!outcome.ok) {
    logErr(
      `deploy: rebuild FAILED -- ANTWORLD_OK=${outcome.antworldOk} ANTWORLD_FAIL=${outcome.antworldFail} REPORT_PRESENT=${outcome.reportPresent} failure_class=${outcome.failureClass} (trigger exit status=${buildResult.status})`
    );
    if (buildResult.stdout) logErr(`deploy: rebuild stdout tail: ${buildResult.stdout.slice(-2000)}`);
    if (buildResult.stderr) logErr(`deploy: rebuild stderr tail: ${buildResult.stderr.slice(-2000)}`);
    return { deployed: true, rebuilt: false, failureClass: outcome.failureClass, resultLine: outcome.resultLine };
  }
  log(`deploy: rebuild OK -- ANTWORLD_OK + REPORT_PRESENT=True confirmed${outcome.resultLine ? ` (${outcome.resultLine})` : ''}`);
  return { deployed: true, rebuilt: true, failureClass: null, resultLine: outcome.resultLine };
}

// --- one pass over the root ---------------------------------------------------

function runOnce(opts) {
  const summary = { scanned: 0, skippedIncomplete: 0, alreadyJournaled: 0, imported: 0, failed: 0 };

  if (!fs.existsSync(opts.root)) {
    logErr(`root ${opts.root} does not exist -- nothing to scan this pass`);
    return summary;
  }

  const entries = fs
    .readdirSync(opts.root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const journaledTurnIds = readJournalTurnIds(opts.outDir, opts.journalPath);

  for (const name of entries) {
    summary.scanned += 1;
    const harvestDir = path.join(opts.root, name);
    const inspection = inspectHarvestDir(harvestDir);

    if (!inspection.complete) {
      summary.skippedIncomplete += 1;
      log(`SKIP  ${name}: not yet a complete verified harvest (${inspection.reason}); will retry next poll`);
      continue;
    }

    if (journaledTurnIds.has(inspection.turnId)) {
      summary.alreadyJournaled += 1;
      log(`NOOP  ${name}: turn_id=${inspection.turnId} already journaled -- no-op`);
      continue;
    }

    log(`IMPORT ${name}: turn_id=${inspection.turnId} not yet journaled -- invoking import-turn.js`);
    const result = runImportTurn(harvestDir, opts.outDir, opts.shuffles);

    if (result.error || result.status !== 0) {
      summary.failed += 1;
      logErr(
        `IMPORT ${name}: FAILED (status=${result.status}, error=${result.error ? result.error.message : 'n/a'}) stderr=${(result.stderr || '').trim()}`
      );
      continue;
    }

    const banner = parseImportBanner(result.stdout);
    summary.imported += 1;
    if (!banner) {
      log(`IMPORT ${name}: succeeded (exit 0) but banner unparsed -- stdout: ${(result.stdout || '').trim()}`);
      continue;
    }
    log(
      `IMPORT ${name}: OK turn_id=${banner.turnId} absolute_day_start=${banner.absoluteDayStart} payload_hash=${banner.payloadHash} -> ${banner.outPath}`
    );
    // This turn is now journaled -- keep the in-memory set current so a
    // second harvest dir for the same turn_id within this same pass (should
    // not normally happen, but the journal is the actual guard either way)
    // is treated as a no-op rather than a second import attempt.
    journaledTurnIds.add(banner.turnId);

    if (!opts.deploy) {
      log(`IMPORT ${name}: --deploy not passed -- import is local only`);
    }
    // Deploy (or retry of a previously failed deploy) happens in one sweep
    // over journaledTurnIds below, not inline here -- see runDeploySweep().
  }

  if (opts.deploy) {
    runDeploySweep(journaledTurnIds, opts, summary);
  }

  log(
    `pass complete: scanned=${summary.scanned} imported=${summary.imported} already_journaled=${summary.alreadyJournaled} skipped_incomplete=${summary.skippedIncomplete} failed=${summary.failed}` +
      (opts.deploy ? ` deploy_pending=${summary.deployPending} deployed=${summary.deployed} deploy_failed=${summary.deployFailed}` : '')
  );
  return summary;
}

// --- main ----------------------------------------------------------------

function main() {
  let opts;
  try {
    opts = parseArgs();
  } catch (err) {
    process.stderr.write(`watch-imports.js: ${err.message}\n`);
    process.exit(2);
  }

  log(
    `watch-imports.js starting: root=${opts.root} out-dir=${opts.outDir} interval=${opts.intervalMs / 1000}s once=${opts.once} deploy=${opts.deploy}${opts.journalPath ? ` journal-override=${opts.journalPath}` : ''}`
  );

  if (opts.once) {
    runOnce(opts);
    log('watch-imports.js: --once pass complete, exiting');
    return;
  }

  let stopping = false;
  let timer = null;

  const tick = () => {
    if (stopping) return;
    runOnce(opts);
    if (!stopping) {
      timer = setTimeout(tick, opts.intervalMs);
    }
  };

  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    log(`received ${signal} -- shutting down cleanly (no in-flight import is interrupted mid-write; import-turn.js is always run to completion via spawnSync)`);
    if (timer) clearTimeout(timer);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  tick();
}

module.exports = {
  runOnce,
  inspectHarvestDir,
  readJournalTurnIds,
  parseImportBanner,
  toRemoteScpPath,
  readDeployStateTurnIds,
  writeDeployStateEntry,
  resolveDeployStatePath,
  outPathForTurn
};

if (require.main === module) {
  main();
}
