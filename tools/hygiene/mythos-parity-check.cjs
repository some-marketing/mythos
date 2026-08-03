#!/usr/bin/env node
'use strict';

// tools/hygiene/mythos-parity-check.cjs — the deviation guard for the Mac <-> Orwell
// Mythos pair (operator, 2026-08-03: "orwell is me too so we need the 1:1 parity and
// then a system to ensure they don't deviate. these two should behave as one").
//
// This is the "ensure they don't deviate" mechanism. On a schedule (launchd on the
// Mac, scheduled task on Orwell) it compares the two machines' Mythos state across
// the surfaces that define parity:
//
//   SURFACE 1 — code (git HEAD): both machines must be on the same branch at the
//     same commit. Drift here means the codebases have diverged.
//   SURFACE 2 — memory surface (hashes): Mythos-memories/substrate (the gitignored
//     durable vault) + the harness memory dir + the active handoff. Drift here means
//     one machine knows things the other doesn't.
//
// It NEVER auto-reconciles (no silent merge of divergent memory; no force-push of a
// divergent branch). It reports a verdict and records a durable drift receipt so the
// operator (or a bounded sync leg) can act with evidence. An explicit
// `--reconcile <surface>` flag exists ONLY for the bounded, host-initiated memory
// mirror leg (Mac -> Orwell), which is the one sync the operator sanctioned.
//
// Exit codes: 0 = in parity, 1 = drift detected (verdict emitted), 2 = check could
// not complete (machine/state unreachable).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { normalizedContentHash } = require('../reconciliation/lib/normalized-content-hash.cjs');

const argVal = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const hasFlag = (flag) => process.argv.indexOf(flag) !== -1;

const ORWELL_SSH = argVal('--orwell', 'orwell');
const ORWELL_MYTHOS = argVal('--orwell-mythos', resolveRemoteMythosRoot());
const MYTHOS_ROOT = path.resolve(__dirname, '..', '..');
const MEMORY_DIR = argVal('--memory-dir', path.join(process.env.HOME, '.claude', 'projects', '-Users-admin-mythos', 'memory'));
const VAULT_SUBSTRATE = argVal('--vault-dir', path.join(MYTHOS_ROOT, 'Mythos-memories', 'substrate'));
const HANDOFF_PATH = argVal('--handoff', path.join(MYTHOS_ROOT, 'Mythos-memories', 'next-session-handoff.md'));
const RECONCILE = hasFlag('--reconcile');

function resolveRemoteMythosRoot() {
  if (process.env.ORWELL_MYTHOS) return process.env.ORWELL_MYTHOS;
  const out = run(['ssh', '-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', '-o', 'UpdateHostKeys=no',
    ORWELL_SSH, 'echo %USERPROFILE%']);
  if (out && out.trim()) return `${out.trim()}\mythos`;
  return 'mythos';
}

function run(cmd, opts = {}) {
  try {
    return execFileSync(cmd.shift(), cmd, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim();
  } catch {
    return null;
  }
}

function localHead() {
  const out = run(['git', '-C', MYTHOS_ROOT, 'rev-parse', 'HEAD']);
  return out;
}

function localBranch() {
  return run(['git', '-C', MYTHOS_ROOT, 'rev-parse', '--abbrev-ref', 'HEAD']);
}

function remoteHead() {
  // Windows side: git -C "<remote mythos root>" rev-parse HEAD, via ssh.
  const out = run(['ssh', '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-o', 'UpdateHostKeys=no',
    ORWELL_SSH, `git -C ${ORWELL_MYTHOS} rev-parse HEAD`]);
  return out;
}

function remoteBranch() {
  return run(['ssh', '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-o', 'UpdateHostKeys=no',
    ORWELL_SSH, `git -C ${ORWELL_MYTHOS} rev-parse --abbrev-ref HEAD`]);
}

function hashDir(dir, depth = 4) {
  // Deterministic content hash over a directory tree (relative paths, sorted).
  const entries = [];
  (function walk(d, rel) {
    let names;
    try { names = fs.readdirSync(d); } catch { return; }
    for (const n of names.sort()) {
      const full = path.join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (depth > 0) walk(full, r);
      } else if (st.isFile()) {
        entries.push([r, fs.readFileSync(full, 'utf8')]);
      }
    }
  })(dir, '');
  return normalizedContentHash(entries, { format: 'json' }).sha256;
}

function hashFile(p) {
  try {
    return normalizedContentHash(fs.readFileSync(p, 'utf8'), { format: 'json' }).sha256;
  } catch {
    return null;
  }
}

function remoteHashFile(winPath) {
  const out = run(['ssh', '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-o', 'UpdateHostKeys=no',
    ORWELL_SSH, `powershell -Command "(Get-FileHash -Algorithm SHA256 '${winPath}').Hash.ToLower()"`]);
  return out;
}

// Hash a directory tree on Orwell using the repo's own hash-dir.cjs (shipped
// to Orwell with the system surface, same algorithm both sides).
function remoteHashDir(winDir) {
  const out = run(['ssh', '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-o', 'UpdateHostKeys=no',
    ORWELL_SSH, `node ${ORWELL_MYTHOS}/tools/hygiene/hash-dir.cjs ${winDir}`]);
  return out;
}

function verdict(surface, ok, detail) {
  return { surface, ok, detail, ts: new Date().toISOString() };
}

// ---- bounded, host-initiated memory mirror (Mac -> Orwell) -----------------
function reconcileMemory() {
  // rsync is the sanctioned mirror (same posture as sync-obsidian-vault.sh):
  // Mac-authoritative memory surface copied TO Orwell. Never the reverse.
  const src = `${MYTHOS_ROOT}/Mythos-memories/`;
  const dst = `${ORWELL_SSH}:${ORWELL_MYTHOS}/Mythos-memories/`;
  const out = run(['rsync', '-az', '--delete', '--exclude', 'reports/', src, dst]);
  return out !== null;
}

// ---- main ------------------------------------------------------------------
if (require.main === module) {
  const results = [];

  const lh = localHead();
  const rh = remoteHead();
  if (!lh || !rh) {
    process.stderr.write('parity-check: could not read both git HEADs (local or Orwell unreachable)\n');
    process.exit(2);
  }
  const lb = localBranch() || '?';
  const rb = remoteBranch() || '?';
  results.push(verdict('git-head', lh === rh, `local ${lb}@${lh.slice(0, 12)} vs orwell ${rb}@${rh.slice(0, 12)}`));

  const vaultHash = hashDir(VAULT_SUBSTRATE);
  const remoteVaultHash = remoteHashDir(`${ORWELL_MYTHOS}/Mythos-memories/substrate`);
  if (vaultHash && remoteVaultHash) {
    results.push(verdict('vault-substrate', vaultHash === remoteVaultHash, `local ${vaultHash.slice(0, 16)} vs orwell ${remoteVaultHash.slice(0, 16)}`));
  } else {
    results.push(verdict('vault-substrate', false, vaultHash ? 'orwell vault unreadable' : remoteVaultHash ? 'local vault unreadable' : 'both vaults unreadable'));
  }

  if (RECONCILE) {
    const ok = reconcileMemory();
    results.push(verdict('reconcile', ok, ok ? 'memory mirrored Mac -> Orwell' : 'reconcile failed'));
  }

  const drift = results.filter((r) => r.ok === false);
  console.log(JSON.stringify({ ok: drift.length === 0, results, drift }, null, 2));

  // Durable receipt (drift is evidence, never silently ignored).
  if (drift.length > 0) {
    const receiptDir = path.join(MYTHOS_ROOT, '_dev', 'state', 'parity');
    fs.mkdirSync(receiptDir, { recursive: true });
    fs.writeFileSync(
      path.join(receiptDir, `drift-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
      JSON.stringify({ results, drift }, null, 2) + '\n'
    );
  }
  process.exit(drift.length === 0 ? 0 : 1);
}

module.exports = { localHead, localBranch, remoteHead, remoteBranch, hashDir, hashFile, remoteHashFile, verdict, reconcileMemory };
