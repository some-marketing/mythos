#!/usr/bin/env node
'use strict';

/**
 * twin-proof.cjs — shadow-tree-removal S1 (v4 pinned rules).
 *
 * Given a list of top-level shadow-candidate directories (or a full-layer
 * census JSON), enumerates every tracked file under each directory, resolves
 * its canonical twin under tools/ (pinned resolution order), classifies the
 * diff (identical / allowlisted-transform / residual-diverged / no-twin),
 * runs the path-history ancestry test for residual-diverged files, and
 * records per-file metadata (type/symlink/exec-bit/shebang/size).
 *
 * See _dev/reports/analysis/task-plans/shadow-tree-removal__plan.json, step S1,
 * and shadow-tree-removal__inventory-normalized.json (candidate_allowlist T1-T4)
 * for the pinned rules this implements.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CHECKPOINT_COMMIT = '4d85cdd3209ac3dadd25d0e51c008a40756ade2e';
const CHECKPOINT_DATE = '2026-07-23';

const CARVE_OUT_PREFIXES = [
  'hooks/', 'boot/', 'commands/', 'launchd/', 'macos-tcc/', 'notify/', 'custody/',
];

const EXPECTED_EXCEPTION_DIRS = ['kernel', 'hygiene', 'schemas', 'windows', 'perplexity'];

// Exact exec-bit-mismatch list observed in the v1/v2 5-dir run
// (_dev/reports/analysis/shadow-tree-removal__inventory-normalized.json exec_bit_notes).
// Not authoritative by itself — metadata_stop is computed live per file; this is
// carried only for the top-level "expected-exception hits" report.
const KNOWN_EXEC_BIT_MISMATCH_FILES = [
  'lib/repo-root.sh',
  'signals/cowork-orchestrator-bridge.js',
  'signals/desktop-cowork-consumer.sh',
  'signals/dispatch-bridge.js',
  'signals/drain-discord-intents.cjs',
  'signals/run-gemini-bridge.js',
  'signals/run-remote-ssh-bridge.js',
  'signals/run-trifecta-bridge.js',
  'signals/sibling-query.sh',
  'signals/validate-mind-memory-firewall.js',
];

function git(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, maxBuffer: 1024 * 1024 * 64 }).toString();
}

function gitOrNull(repoRoot, args) {
  try {
    return git(repoRoot, args);
  } catch (e) {
    return null;
  }
}

function listTrackedFiles(repoRoot, dir) {
  const out = gitOrNull(repoRoot, ['ls-files', '--', dir]);
  if (out === null) return [];
  return out.split('\n').filter(Boolean);
}

// ---------------------------------------------------------------------------
// Twin resolution (pinned order, v4 F1):
//   1. same relative subpath under tools/
//   2. T1-style rename mapping (smos-runtime/ -> runtime/)
// If more than one candidate exists as a real file, dual_twin=true and the
// file is routed to manual disposition (no auto-classify).
// ---------------------------------------------------------------------------
function resolveTwin(shadowRelPath, repoRoot) {
  const candidates = [];

  const primary = path.posix.join('tools', shadowRelPath);
  if (fs.existsSync(path.join(repoRoot, primary))) {
    candidates.push({ twin: primary, method: 'same-relative-subpath-under-tools' });
  }

  if (shadowRelPath.includes('smos-runtime/')) {
    const renamed = shadowRelPath.replace('smos-runtime/', 'runtime/');
    const t1 = path.posix.join('tools', renamed);
    if (fs.existsSync(path.join(repoRoot, t1)) && !candidates.some((c) => c.twin === t1)) {
      candidates.push({ twin: t1, method: 'T1-rename-smos-runtime-to-runtime' });
    }
  }

  if (candidates.length === 0) {
    return { resolved_twin: null, twin_match_method: null, dual_twin: false, candidates: [] };
  }
  if (candidates.length > 1) {
    return {
      resolved_twin: null,
      twin_match_method: null,
      dual_twin: true,
      candidates: candidates.map((c) => c.twin),
    };
  }
  return {
    resolved_twin: candidates[0].twin,
    twin_match_method: candidates[0].method,
    dual_twin: false,
    candidates: candidates.map((c) => c.twin),
  };
}

// ---------------------------------------------------------------------------
// Allowlisted transforms T1-T4 (content-level; T1 is path-level, handled in
// resolveTwin). Each transform is applied to a copy of the shadow content;
// if the fully-transformed result byte-matches the twin, diff_class is
// allowlisted-transform and transforms_fired lists whichever transforms
// actually changed something. Any residual byte difference after all
// transforms is residual-diverged — deliberately conservative: the T2/T4
// caveats documented in the candidate_allowlist (aliasing exception,
// SM_OS_IDENTITY_ID exception) are encoded below; anything else that would
// require a blind/unsafe rewrite is left untransformed on purpose so it
// falls to residual-diverged rather than being force-matched.
// ---------------------------------------------------------------------------
const TRANSFORMS = [
  {
    id: 'T2',
    apply(text) {
      let out = text;
      let changed = false;
      if (out.includes('smos-command-runner.cjs')) {
        const next = out.split('smos-command-runner.cjs').join('mythos-command-runner.cjs');
        if (next !== out) changed = true;
        out = next;
      }
      // whole-word identifier rename, EXCEPT the import-aliasing pattern
      // `runMythosCommand: runSmosCommand` (twin keeps the old call-site name
      // stable via aliasing rather than renaming call sites) — observed_caveat
      // in candidate_allowlist T2.
      const re = /(?<!: )\brunSmosCommand\b/g;
      const next2 = out.replace(re, (m) => {
        changed = true;
        return 'runMythosCommand';
      });
      out = next2;
      return { out, changed };
    },
  },
  {
    id: 'T3',
    apply(text) {
      let changed = false;
      const out = text.replace(/CoordinationSignal\/(\d+\.\d+)/g, (m, v) => {
        changed = true;
        return `HandoffSignal/${v}`;
      });
      return { out, changed };
    },
  },
  {
    id: 'T4',
    apply(text) {
      let changed = false;
      // whole-token SM_OS_[A-Z_]+ -> MYTHOS_..., EXCEPT SM_OS_IDENTITY_ID
      // (twin renames the VALUE only, not the variable name — candidate_allowlist
      // T4 observed_caveat).
      const out = text.replace(/\bSM_OS_([A-Z_]+)\b/g, (m, rest) => {
        if (m === 'SM_OS_IDENTITY_ID') return m;
        changed = true;
        return `MYTHOS_${rest}`;
      });
      return { out, changed };
    },
  },
];

function isBinaryBuffer(buf) {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function applyAllowlistedTransforms(shadowBuf) {
  if (isBinaryBuffer(shadowBuf)) {
    return { out: shadowBuf, fired: [], binary: true };
  }
  let text = shadowBuf.toString('utf8');
  const fired = [];
  for (const t of TRANSFORMS) {
    const { out, changed } = t.apply(text);
    if (changed) fired.push(t.id);
    text = out;
  }
  return { out: Buffer.from(text, 'utf8'), fired, binary: false };
}

// ---------------------------------------------------------------------------
// Metadata (v4 F1 / codex F3 amendment)
// ---------------------------------------------------------------------------
function readMetadata(absPath) {
  const lst = fs.lstatSync(absPath);
  let type = 'file';
  let target = null;
  if (lst.isSymbolicLink()) {
    type = 'symlink';
    target = fs.readlinkSync(absPath);
  } else if (lst.isDirectory()) {
    type = 'directory';
  }
  const executable = type === 'file' ? (lst.mode & 0o111) !== 0 : null;
  let shebang = null;
  if (type === 'file') {
    try {
      const fd = fs.openSync(absPath, 'r');
      const buf = Buffer.alloc(128);
      const n = fs.readSync(fd, buf, 0, 128, 0);
      fs.closeSync(fd);
      const head = buf.slice(0, n);
      if (!isBinaryBuffer(head) && head.slice(0, 2).toString('utf8') === '#!') {
        const nl = head.indexOf(0x0a);
        shebang = (nl === -1 ? head : head.slice(0, nl)).toString('utf8').trim();
      }
    } catch (e) {
      shebang = null;
    }
  }
  return { type, target, executable, shebang, size: lst.size };
}

function metadataMatches(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'symlink' && a.target !== b.target) return false;
  if (a.executable !== b.executable) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Ancestry test (v4 F4 / codewhale): shadow blob sha, searched in the TWIN
// PATH's own history only (git log --follow), never tree-wide.
// ---------------------------------------------------------------------------
function ancestryTest(repoRoot, shadowAbsPath, twinRelPath) {
  let shadowBlobSha;
  try {
    shadowBlobSha = git(repoRoot, ['hash-object', shadowAbsPath]).trim();
  } catch (e) {
    return { ancestry_pass: false, twin_commit: null, date: null, class: 'ancestry-error', error: String(e.message || e) };
  }

  const log = gitOrNull(repoRoot, ['log', '--follow', '--format=%H|%ad', '--date=short', '--', twinRelPath]);
  if (!log) {
    return { ancestry_pass: false, twin_commit: null, date: null, class: 'no-twin-history' };
  }
  const commits = log.split('\n').filter(Boolean).map((l) => {
    const [hash, date] = l.split('|');
    return { hash, date };
  });
  // git log --follow is newest-first: commits[0] is the twin path's most
  // recent touching commit ("twin_last_commit").
  const twinLastCommit = commits[0] || null;

  for (const c of commits) {
    const blob = gitOrNull(repoRoot, ['rev-parse', `${c.hash}:${twinRelPath}`]);
    if (blob && blob.trim() === shadowBlobSha) {
      // coexistence vs evolved is decided by whether the TWIN PATH ITSELF has
      // gone untouched since the checkpoint (twin_last_commit == checkpoint) —
      // not by which historical commit happened to match the shadow's bytes.
      // A twin that hasn't moved since the checkpoint is frozen alongside the
      // shadow (coexistence), even if the byte-match point is an earlier
      // ancestor commit (the checkpoint commit itself is what introduced the
      // divergence in a single motion touching both sides).
      const isCheckpointEra = !!twinLastCommit
        && (twinLastCommit.hash === CHECKPOINT_COMMIT || twinLastCommit.date === CHECKPOINT_DATE);
      return {
        ancestry_pass: true,
        twin_commit: c.hash,
        date: c.date,
        twin_last_commit: twinLastCommit,
        class: isCheckpointEra ? 'coexistence' : 'evolved',
      };
    }
  }
  return { ancestry_pass: false, twin_commit: null, date: null, twin_last_commit: twinLastCommit, class: 'no-ancestry-match' };
}

// ---------------------------------------------------------------------------
// Per-file classification
// ---------------------------------------------------------------------------
function classifyFile(repoRoot, shadowRelPath) {
  const shadowAbs = path.join(repoRoot, shadowRelPath);
  const record = { path: shadowRelPath };

  const twinInfo = resolveTwin(shadowRelPath, repoRoot);
  record.resolved_twin = twinInfo.resolved_twin;
  record.twin_match_method = twinInfo.twin_match_method;
  record.dual_twin = twinInfo.dual_twin;
  if (twinInfo.candidates.length > 1) record.twin_candidates = twinInfo.candidates;

  record.metadata = readMetadata(shadowAbs);

  if (twinInfo.dual_twin) {
    record.diff_class = 'DUAL_TWIN_STOP';
    record.transforms_fired = [];
    record.ancestry = null;
    record.twin_metadata = null;
    record.metadata_stop = false;
    record.deletable = false;
    return record;
  }

  if (!twinInfo.resolved_twin) {
    record.diff_class = 'no-twin';
    record.transforms_fired = [];
    record.ancestry = null;
    record.twin_metadata = null;
    record.metadata_stop = false;
    record.deletable = false;
    return record;
  }

  const twinAbs = path.join(repoRoot, twinInfo.resolved_twin);
  record.twin_metadata = readMetadata(twinAbs);

  const metaMatch = metadataMatches(record.metadata, record.twin_metadata);
  const execMismatch = record.metadata.type === 'file'
    && record.twin_metadata.type === 'file'
    && record.metadata.executable !== record.twin_metadata.executable;
  record.metadata_stop = execMismatch || !metaMatch;

  let shadowBuf, twinBuf;
  try {
    shadowBuf = fs.readFileSync(shadowAbs);
  } catch (e) {
    record.diff_class = 'no-twin';
    record.read_error = `shadow: ${String(e.message || e)}`;
    record.transforms_fired = [];
    record.ancestry = null;
    record.deletable = false;
    return record;
  }
  try {
    twinBuf = fs.readFileSync(twinAbs);
  } catch (e) {
    record.diff_class = 'residual-diverged';
    record.read_error = `twin: ${String(e.message || e)}`;
    record.transforms_fired = [];
    record.ancestry = ancestryTest(repoRoot, shadowAbs, twinInfo.resolved_twin);
    record.deletable = false;
    return record;
  }

  if (shadowBuf.equals(twinBuf)) {
    record.diff_class = 'identical';
    record.transforms_fired = [];
    record.ancestry = null;
    record.deletable = !record.metadata_stop;
    return record;
  }

  const { out: transformedBuf, fired } = applyAllowlistedTransforms(shadowBuf);
  if (transformedBuf.equals(twinBuf)) {
    record.diff_class = 'allowlisted-transform';
    record.transforms_fired = fired;
    record.ancestry = null;
    record.deletable = !record.metadata_stop;
    return record;
  }

  record.diff_class = 'residual-diverged';
  record.transforms_fired = fired;
  record.ancestry = ancestryTest(repoRoot, shadowAbs, twinInfo.resolved_twin);
  // Per plan: ancestry-passed residuals are deletable=false pending operator
  // ratification; marked 'ancestry-evolved' for the confirmation packet.
  if (record.ancestry.ancestry_pass && record.ancestry.class === 'evolved') {
    record.confirmation_packet_class = 'ancestry-evolved';
  }
  record.deletable = false;
  return record;
}

// ---------------------------------------------------------------------------
// Full run
// ---------------------------------------------------------------------------
function runTwinProof({ repoRoot, dirs, onProgress }) {
  const generatedAt = new Date().toISOString();
  const files = [];
  const progress = [];

  for (const dir of dirs) {
    const tracked = listTrackedFiles(repoRoot, dir);
    let n = 0;
    for (const relPath of tracked) {
      files.push(classifyFile(repoRoot, relPath));
      n++;
    }
    progress.push({ dir, tracked_file_count: tracked.length, classified: n });
    if (onProgress) onProgress({ dir, tracked_file_count: tracked.length });
  }

  const counts = {
    total_files: files.length,
    identical: 0,
    'allowlisted-transform': 0,
    'residual-diverged': 0,
    'no-twin': 0,
    DUAL_TWIN_STOP: 0,
    deletable: 0,
    metadata_stop: 0,
    'ancestry-evolved': 0,
    coexistence: 0,
  };
  for (const f of files) {
    if (counts[f.diff_class] !== undefined) counts[f.diff_class]++;
    if (f.deletable) counts.deletable++;
    if (f.metadata_stop) counts.metadata_stop++;
    if (f.confirmation_packet_class === 'ancestry-evolved') counts['ancestry-evolved']++;
    if (f.ancestry && f.ancestry.class === 'coexistence') counts.coexistence++;
  }

  const expectedExceptionHits = {};
  for (const d of EXPECTED_EXCEPTION_DIRS) {
    expectedExceptionHits[d] = files.filter((f) => f.path === d || f.path.startsWith(`${d}/`))
      .filter((f) => f.diff_class !== 'identical' && f.diff_class !== 'allowlisted-transform')
      .map((f) => ({ path: f.path, diff_class: f.diff_class }));
  }
  const execBitHits = files
    .filter((f) => f.metadata_stop)
    .map((f) => f.path);
  const execBitKnownMismatch = KNOWN_EXEC_BIT_MISMATCH_FILES.filter((p) => execBitHits.includes(p));
  const execBitUnexpected = execBitHits.filter((p) => !KNOWN_EXEC_BIT_MISMATCH_FILES.includes(p));

  const deleteCandidatePaths = files.filter((f) => f.deletable).map((f) => f.path);
  const carveOutViolations = deleteCandidatePaths.filter((p) => CARVE_OUT_PREFIXES.some((pre) => p.startsWith(pre)));

  const stopRequired = counts['residual-diverged'] > 0
    || counts['no-twin'] > 0
    || counts.DUAL_TWIN_STOP > 0
    || counts.metadata_stop > 0
    || carveOutViolations.length > 0;

  return {
    schema: 'ShadowTreeTwinProof/1.0',
    generated_at: generatedAt,
    dirs,
    checkpoint_commit: CHECKPOINT_COMMIT,
    checkpoint_date: CHECKPOINT_DATE,
    progress,
    counts,
    expected_exception_hits: expectedExceptionHits,
    exec_bit: {
      hits: execBitHits,
      known_mismatch_matched: execBitKnownMismatch,
      unexpected: execBitUnexpected,
    },
    carve_out_assertion: {
      carve_out_prefixes: CARVE_OUT_PREFIXES,
      delete_candidate_count: deleteCandidatePaths.length,
      violations: carveOutViolations,
      passed: carveOutViolations.length === 0,
    },
    stop_required: stopRequired,
    files,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dirs') out.dirs = argv[++i];
    else if (a === '--census') out.census = argv[++i];
    else if (a === '--json') out.json = argv[++i];
  }
  return out;
}

function dirsFromCensus(censusPath, repoRoot) {
  const raw = fs.readFileSync(path.resolve(repoRoot, censusPath), 'utf8');
  const data = JSON.parse(raw);
  const shadowDirs = (data.shadow_candidates || []).map((d) => d.dir);
  // Sanity: shadow_candidates should already exclude carve-outs (hooks is a
  // special_row, unclear dirs are a separate key) — assert that here so a
  // census schema drift fails loud instead of silently including a carve-out.
  const violation = shadowDirs.find((d) => CARVE_OUT_PREFIXES.some((pre) => `${d}/` === pre));
  if (violation) {
    throw new Error(`census shadow_candidates includes carve-out dir "${violation}" — census schema drift, aborting`);
  }
  return shadowDirs;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();

  let dirs;
  if (args.dirs) {
    dirs = args.dirs.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (args.census) {
    dirs = dirsFromCensus(args.census, repoRoot);
  } else {
    process.stderr.write('usage: twin-proof.cjs --dirs a,b,c | --census <path> [--json <out>]\n');
    process.exit(2);
  }

  const result = runTwinProof({
    repoRoot,
    dirs,
    onProgress: ({ dir, tracked_file_count }) => {
      process.stderr.write(`[twin-proof] ${dir}: ${tracked_file_count} tracked files\n`);
    },
  });

  const jsonOut = JSON.stringify(result, null, 2);
  if (args.json) {
    fs.writeFileSync(path.resolve(repoRoot, args.json), jsonOut);
    process.stderr.write(`[twin-proof] wrote ${args.json}\n`);
  } else {
    process.stdout.write(jsonOut + '\n');
  }
}

module.exports = {
  resolveTwin,
  applyAllowlistedTransforms,
  readMetadata,
  metadataMatches,
  ancestryTest,
  classifyFile,
  runTwinProof,
  TRANSFORMS,
  CARVE_OUT_PREFIXES,
  EXPECTED_EXCEPTION_DIRS,
  CHECKPOINT_COMMIT,
  CHECKPOINT_DATE,
};

if (require.main === module) {
  main();
}
