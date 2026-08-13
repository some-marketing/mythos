#!/usr/bin/env node
'use strict';

/**
 * scratch-leak-check.cjs — catches durable load-bearing artifacts that cite
 * a scratch/throwaway path (a reviewer-lane tmpdir, /tmp, a scratchpad
 * segment) where a durable path belongs.
 *
 * Capability tier (harness-runtime-contract terms): L2 module —
 * ADVISORY-when-called; nothing runs this automatically until L3 wires it;
 * not BLOCKING anywhere. Calling this module proves nothing about whether
 * anything actually calls it.
 *
 * AT ITS FINAL PATH since 2026-08-12: originally staged at
 * tools/scoped/reflexive-artifact-durability/ because tools/verify/ is
 * governance-gated (see tools/verify/substrate-fidelity-verifier.cjs lines
 * 9-13 for the same precedent); migrated here under an operator-minted
 * ConveneReceipt. REPO_ROOT
 * below is derived by walking up from __dirname looking for package.json,
 * not by counting relative `../` segments, so the eventual move is a
 * location-only change — the require target resolves the same regardless of
 * how deep this file lives under the repo root.
 *
 * Selection is by DIRECT SCAN of the durable roots (_dev/state/**,
 * _dev/reports/**), never from a write-ledger (a ledger cannot see
 * Bash-created files and would silently miss the majority of durable
 * writes). A durable artifact is selected by known schema or location — see
 * SELECTOR below — never by guessing at file extension alone.
 *
 * Path-candidate extraction: any JSON string value or markdown line
 * containing an absolute (/...) or repo-relative (_dev/..., tools/...,
 * clients/...) path-shaped token is a candidate; each candidate is
 * classified with isScratch() from tools/lib/durable-artifact.cjs, the ONE
 * classifier — this module never reimplements that rule.
 *
 * Escape hatch: a JSON artifact with a top-level "scratch_allowed": true
 * field is exempt from flagging entirely (still counted as scanned). This
 * is the deliberate over-block release valve for artifacts that
 * intentionally cite a transient path.
 *
 * Write-ledger corroboration: _dev/state/active-sessions/*\/write_log.json is
 * read, when present, purely as an informational cross-check — how many
 * flagged paths also show up in a ledger. It never changes `ok` or `leaks`.
 * Real shape (per tools/kernel/hooks/posttool-write-ledger.cjs): a top-level
 * object `{"paths": [...]}`, where each entry is a string or a
 * {path,at,tool} object. A bare top-level array, or a top-level
 * `{"entries": [...]}`, are also accepted as legacy/compat fallbacks.
 *
 * Scan bounds: real _dev is ~9.7GB / 18k files. Directories named tmp,
 * scratch, archive, or node_modules are never descended into; files over 2MB
 * are skipped. Both scanned and skipped file counts are always reported so
 * truncation is never silent.
 *
 * Library use:
 *   const { runScratchLeakCheck } = require('<root>/tools/verify/scratch-leak-check.cjs');
 *   const result = runScratchLeakCheck({ root: '/path/to/repo-or-fixture-root' });
 *   // => { ok, leaks: [{artifact, field_or_line, offending_path}], scanned, skipped, ledger_corroboration }
 *
 * CLI:
 *   node scratch-leak-check.cjs [--root <dir>] [--json]
 *   Exit code: 0 when clean, 1 when leaks are found.
 */

const fs = require('fs');
const path = require('path');

/** Walk up from `startDir` looking for a directory containing package.json. */
function findRepoRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      // Fell off the filesystem root without finding package.json; fall back
      // to the starting directory rather than throwing.
      return startDir;
    }
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot(__dirname);

const { isScratch } = require(path.join(REPO_ROOT, 'tools/lib/durable-artifact.cjs'));

// ─── Selector table (future schemas/locations are one-line additions) ─────

const SELECTOR = {
  schemaPrefixes: ['TaskPlan', 'TickTockReviewDecision', 'GenerationManifest'],
  pathPatterns: [
    /task-plan-reviews\//,
    /next-session-handoff/,
    /-lanes\.json$/,
    /review-artifact/,
  ],
};

const DURABLE_SUBROOTS = ['_dev/state', '_dev/reports'];
const SKIP_DIR_NAMES = new Set(['tmp', 'scratch', 'archive', 'node_modules']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PATH_CANDIDATE_RE = /(\/[\w.\-]+(?:\/[\w.\-]+)+|(?:_dev|tools|clients)\/[\w.\-]+(?:\/[\w.\-]+)*)/g;

// ─── Scan ───────────────────────────────────────────────────────────────

/**
 * Recursively collect .json/.md files under `dir`, honoring the skip-dir
 * and max-size bounds. Mutates `scanned`/`skipped` counters as it goes.
 */
function walk(dir, counters) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) {
        counters.skipped += 1;
        continue;
      }
      out.push(...walk(full, counters));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(json|md)$/i.test(entry.name)) continue;
    let size;
    try {
      size = fs.statSync(full).size;
    } catch {
      counters.skipped += 1;
      continue;
    }
    if (size > MAX_FILE_BYTES) {
      counters.skipped += 1;
      continue;
    }
    out.push(full);
  }
  return out;
}

/** True if `filePath` (absolute) or its parsed JSON schema qualifies for selection. */
function isSelected(filePath, parsedJson) {
  const rel = path.relative(process.cwd(), filePath).split(path.sep).join('/');
  const forwardPath = filePath.split(path.sep).join('/');
  for (const re of SELECTOR.pathPatterns) {
    if (re.test(forwardPath) || re.test(rel)) return true;
  }
  if (parsedJson && typeof parsedJson.schema === 'string') {
    return SELECTOR.schemaPrefixes.some(
      (prefix) => parsedJson.schema === prefix || parsedJson.schema.startsWith(prefix + '/')
    );
  }
  return false;
}

// ─── Candidate extraction ──────────────────────────────────────────────────

function extractFromJson(parsed) {
  // Returns [{ field_or_line, value }]
  const found = [];
  function walkValue(value, keyPath) {
    if (typeof value === 'string') {
      const matches = value.match(PATH_CANDIDATE_RE);
      if (matches) {
        for (const m of matches) found.push({ field_or_line: keyPath, value: m });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walkValue(v, `${keyPath}[${i}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const k of Object.keys(value)) {
        walkValue(value[k], keyPath ? `${keyPath}.${k}` : k);
      }
    }
  }
  walkValue(parsed, '');
  return found;
}

function extractFromMarkdown(text) {
  const found = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const matches = line.match(PATH_CANDIDATE_RE);
    if (matches) {
      for (const m of matches) found.push({ field_or_line: `line:${idx + 1}`, value: m });
    }
  });
  return found;
}

// ─── Write-ledger corroboration (informational only) ───────────────────────

function readLedgerPaths(root) {
  const ledgerPaths = [];
  const activeSessionsDir = path.join(root, '_dev/state/active-sessions');
  let sessionDirs;
  try {
    sessionDirs = fs.readdirSync(activeSessionsDir, { withFileTypes: true });
  } catch {
    return { ledgerPaths, entriesScanned: 0 };
  }
  let entriesScanned = 0;
  for (const sessionDir of sessionDirs) {
    if (!sessionDir.isDirectory()) continue;
    const logPath = path.join(activeSessionsDir, sessionDir.name, 'write_log.json');
    let raw;
    try {
      raw = fs.readFileSync(logPath, 'utf8');
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const entries = Array.isArray(parsed && parsed.paths)
      ? parsed.paths
      : Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed && parsed.entries)
          ? parsed.entries
          : [];
    for (const entry of entries) {
      entriesScanned += 1;
      if (typeof entry === 'string') {
        ledgerPaths.push(entry);
      } else if (entry && typeof entry === 'object' && typeof entry.path === 'string') {
        ledgerPaths.push(entry.path);
      }
    }
  }
  return { ledgerPaths, entriesScanned };
}

// ─── Main entry point ───────────────────────────────────────────────────────

function runScratchLeakCheck({ root = REPO_ROOT } = {}) {
  const resolvedRoot = path.resolve(root);
  const counters = { skipped: 0 };
  let scanned = 0;
  const leaks = [];

  for (const subroot of DURABLE_SUBROOTS) {
    const files = walk(path.join(resolvedRoot, subroot), counters);
    for (const filePath of files) {
      const isJson = /\.json$/i.test(filePath);
      let parsedJson = null;
      let rawText = null;
      if (isJson) {
        try {
          rawText = fs.readFileSync(filePath, 'utf8');
          parsedJson = JSON.parse(rawText);
        } catch {
          parsedJson = null;
        }
      } else {
        try {
          rawText = fs.readFileSync(filePath, 'utf8');
        } catch {
          rawText = null;
        }
      }

      if (!isSelected(filePath, parsedJson)) continue;
      scanned += 1;

      const scratchAllowed = !!(parsedJson && parsedJson.scratch_allowed === true);
      if (scratchAllowed) continue;

      const candidates = isJson && parsedJson
        ? extractFromJson(parsedJson)
        : rawText
          ? extractFromMarkdown(rawText)
          : [];

      const seen = new Set();
      for (const candidate of candidates) {
        if (!isScratch(candidate.value, resolvedRoot)) continue;
        const dedupeKey = `${candidate.field_or_line}::${candidate.value}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        leaks.push({
          artifact: path.relative(resolvedRoot, filePath).split(path.sep).join('/'),
          field_or_line: candidate.field_or_line,
          offending_path: candidate.value,
        });
      }
    }
  }

  const { ledgerPaths, entriesScanned } = readLedgerPaths(resolvedRoot);
  const ledgerSet = new Set(ledgerPaths);
  const corroboratedLeaks = leaks.filter((leak) => ledgerSet.has(leak.offending_path)).length;

  return {
    ok: leaks.length === 0,
    leaks,
    scanned,
    skipped: counters.skipped,
    ledger_corroboration: {
      entries_scanned: entriesScanned,
      corroborated_leaks: corroboratedLeaks,
    },
  };
}

module.exports = { runScratchLeakCheck, REPO_ROOT };

// ─── CLI ────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  let root = REPO_ROOT;
  let asJson = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--root') {
      root = args[i + 1];
      i += 1;
    } else if (args[i] === '--json') {
      asJson = true;
    }
  }

  const result = runScratchLeakCheck({ root });

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (result.ok) {
    console.log(
      `scratch-leak-check: OK — ${result.scanned} durable artifacts scanned, ${result.skipped} skipped, 0 leaks.`
    );
  } else {
    console.log(
      `scratch-leak-check: FAIL — ${result.leaks.length} leak(s) across ${result.scanned} scanned artifact(s), ${result.skipped} skipped.`
    );
    for (const leak of result.leaks) {
      console.log(`  ${leak.artifact} [${leak.field_or_line}] -> ${leak.offending_path}`);
    }
  }

  process.exit(result.ok ? 0 : 1);
}
