#!/usr/bin/env node
'use strict';

/**
 * reference-proof.cjs — shadow-tree-removal S2 (v5 full-layer, operative/prose split).
 *
 * Closed-world resolved-target reference scan over the full shadow layer.
 * Given the census's shadow-candidate dirs (default) or an explicit
 * --target-dirs list, enumerates every tracked file in the repo plus an
 * explicit external/runtime surface list, extracts path-shaped references
 * from each, resolves every reference FROM ITS DECLARING FILE's location,
 * and classifies each resolved reference that points into the shadow layer
 * (target dirs + carve-out dirs) into exactly one of five buckets:
 *
 *   shadow-internal      declaring file itself is in the delete-target set
 *                         (the reference disappears along with its file)
 *   live-external        declaring file survives, is an OPERATIVE surface
 *                         (see below), and the resolved target is a TRACKED
 *                         file inside the actual delete-candidate set ->
 *                         needs a repoint fix.
 *   non-target            same as live-external except the resolved target
 *                         does NOT correspond to any tracked file in the
 *                         delete-candidate set (e.g. a framework id like
 *                         'wordpress/qa' that merely looks path-shaped) --
 *                         recorded for the closed-world/zero-unclassified
 *                         requirement, not a deletion blocker.
 *   live-excluded-target  reference points into a carve-out dir (hooks/ or
 *                         one of the 6 unclear dirs) -- those dirs are NOT
 *                         being deleted by this plan, so this is not a
 *                         delete-time blocker, but it is recorded because
 *                         it is part of the shadow-layer question.
 *   docs-historical       declaring file is a PROSE surface (see below) --
 *                         citation, non-blocking, recorded for completeness.
 *
 * v4 -> v5 change (this file): v4 scanned every path-shaped token in every
 * tracked text file, which conflated prose citations (a framework id like
 * "wordpress/qa" in a markdown table, a generic dir mention in a report)
 * with real runtime dependencies, producing thousands of false
 * "live-external" hits. v5 draws an OPERATIVE vs PROSE line BEFORE
 * classification:
 *
 *   OPERATIVE surfaces (references here can be live-external):
 *     (i)   .js/.cjs/.mjs/.sh files (plus .githooks/* regardless of
 *           extension) -- but only require/import/require.resolve
 *           specifiers and fs/child_process/spawn-family call arguments in
 *           .js/.cjs/.mjs; the ENTIRE body (minus '#'-comment lines) in
 *           .sh/.githooks files, since a shell script's body IS commands.
 *     (ii)  JSON/YAML config VALUES (never keys) in a fixed, named list of
 *           executable config surfaces: .claude/settings.json,
 *           .claude/settings.local.json (hook commands, including
 *           ${CLAUDE_PROJECT_DIR} resolution), package.json ("scripts"
 *           values only), launchd/*.plist (<string> values), and live
 *           (non-/closed/) signals under _dev/reports/signals/.
 *     (iii) tracked symlink targets.
 *   One exception carved back IN from PROSE: AGENTS.md is a markdown file
 *   (prose by default) but doubles as a managed-command registry -- lines
 *   containing a backtick-quoted span with a recognized script extension
 *   are treated as operative; everything else in AGENTS.md stays prose.
 *
 *   PROSE surfaces (by construction, always docs-historical unless
 *   shadow-internal): every .md file (with the AGENTS.md line-level
 *   exception above) and every JSON/YAML file not on the named operative
 *   list -- i.e. "JSON description/prose fields".
 *
 * SELF-EXCLUSION: tools/scoped/shadow-tree-removal/** (this proof
 * machinery's own source, tests, and fixtures) is skipped entirely from
 * the tracked-file sweep -- see SELF_EXCLUDE_PREFIX.
 *
 * SET MEMBERSHIP: a live-external classification additionally requires the
 * resolved target to be a TRACKED file in the actual delete-candidate set
 * (files with deletable === true in the S1 inventory,
 * _dev/reports/analysis/shadow-tree-removal__inventory-full.json .files[]
 * by default, overridable with --inventory). A resolved target that is not
 * in that set is classified 'non-target' instead of silently dropped or
 * silently accepted, per the closed-world / zero-unclassified requirement.
 *
 * FALSIFIER: the planted-reference arm (tools/scoped/shadow-tree-removal/
 * __tests__/__fixtures__/falsifier/planted-launch-surface.txt, simulated as
 * an unforeseen operative shell-like surface) runs as part of every full
 * run; its {planted, detected} outcome is recorded on the output as
 * `falsifier`, not only asserted in tests.
 *
 * Requirement: ZERO unclassified references among everything the scan
 * finds that resolves into the shadow layer. See
 * _dev/reports/analysis/task-plans/shadow-tree-removal__plan.json, step S2.
 *
 * Resolution rules (v4/v5, generalizing the v2 5-dir run's method notes):
 *   - `${VARNAME}/...` (e.g. ${CLAUDE_PROJECT_DIR}/...) -> template stripped,
 *     remainder is repo-root-relative directly (the var literally IS the
 *     repo root in every surface this repo uses it in).
 *   - absolute path starting with the real repo root -> repo root stripped,
 *     remainder is repo-root-relative. Absolute paths outside the repo root
 *     are not repo references and are dropped.
 *   - `./x` or `../x` (one or more) -> resolved relative to the declaring
 *     file's own directory (standard module/file resolution).
 *   - bare token (no leading `.`, `..`, `/`, or `${...}`) -> treated as
 *     repo-root-relative directly. This matches how this repo's shell
 *     commands, npm scripts, launchd ProgramArguments, and hook commands are
 *     invoked (CWD = repo root), and how prose/docs cite paths.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const CARVE_OUT_DIR_NAMES_FALLBACK = ['hooks', 'boot', 'commands', 'launchd', 'macos-tcc', 'notify', 'custody'];

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.gz', '.tgz', '.woff', '.woff2', '.ttf', '.otf',
  '.mp4', '.mp3', '.mov', '.wav', '.pyc', '.so', '.dylib', '.dll', '.exe', '.class', '.jar', '.app',
  '.psd', '.ai', '.sketch', '.db', '.sqlite', '.sqlite3', '.keychain',
]);

const MAX_FILE_BYTES = 4 * 1024 * 1024; // skip anything absurdly large (unlikely to be source/docs)

// The proof machinery's own tree -- never a declaring-file surface. Recorded
// in scan_roots.self_excluded for provenance, not silently skipped.
const SELF_EXCLUDE_PREFIX = 'tools/scoped/shadow-tree-removal/';

const DEFAULT_INVENTORY_PATH = '_dev/reports/analysis/shadow-tree-removal__inventory-full.json';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function git(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, maxBuffer: 1024 * 1024 * 256 }).toString();
}

function gitOrNull(repoRoot, args) {
  try {
    return git(repoRoot, args);
  } catch (e) {
    return null;
  }
}

function isBinaryBuffer(buf) {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Dir-set helpers
// ---------------------------------------------------------------------------
function dirsFromCensus(censusPath, repoRoot) {
  const raw = fs.readFileSync(path.resolve(repoRoot, censusPath), 'utf8');
  const data = JSON.parse(raw);
  const targetDirs = (data.shadow_candidates || []).map((d) => d.dir);
  const carveOutDirs = [
    ...Object.keys(data.special_rows || {}),
    ...(data.unclear || []).map((d) => d.dir),
  ];
  return { targetDirs, carveOutDirs };
}

// Delete-candidate set: files the S1 inventory marked deletable === true.
// This is the closed-world set a live-external classification must resolve
// into; membership is checked with the exact repo-relative `path` field.
function loadDeleteCandidateSet(inventoryPath, repoRoot) {
  const raw = fs.readFileSync(path.resolve(repoRoot, inventoryPath), 'utf8');
  const data = JSON.parse(raw);
  const files = Array.isArray(data.files) ? data.files : [];
  const set = new Set();
  for (const f of files) {
    if (f && f.deletable === true && typeof f.path === 'string') set.add(f.path);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Token extraction + resolution
// ---------------------------------------------------------------------------

// Contiguous runs of path-plausible characters. Deliberately broad (over-
// inclusive) -- the cheap pre-filter (ALT_TEST) and the dirName-segment check
// below narrow it down; nothing that doesn't resolve into the shadow layer
// survives into the output.
const TOKEN_REGEX = /[A-Za-z0-9_.${}/-]+/g;

function buildAltTest(dirNames) {
  const alt = dirNames.map(escapeRegExp).join('|');
  return new RegExp(`\\b(?:${alt})\\/`);
}

function stripTemplatePrefix(token) {
  const m = token.match(/^\$\{[A-Za-z0-9_]+\}\/(.*)$/);
  if (m) return { stripped: m[1], hadTemplate: true };
  return { stripped: token, hadTemplate: false };
}

// Resolve a raw token found in `declaringRelPath` to a repo-relative path.
// Returns null if the token is not a repo-relative reference at all (e.g. an
// absolute path outside the repo, or empty after stripping).
function resolveToken(token, declaringRelPath, repoRoot) {
  if (!token) return null;

  const { stripped, hadTemplate } = stripTemplatePrefix(token);
  if (hadTemplate) {
    const norm = path.posix.normalize(stripped);
    if (!norm || norm === '.') return null;
    return { resolved: norm.replace(/^\.\//, ''), method: 'template-var-stripped' };
  }

  if (stripped.startsWith('/')) {
    const repoRootPosix = repoRoot.split(path.sep).join('/');
    if (stripped === repoRootPosix || stripped.startsWith(`${repoRootPosix}/`)) {
      const rel = stripped.slice(repoRootPosix.length).replace(/^\//, '');
      if (!rel) return null;
      return { resolved: rel, method: 'absolute-repo-root-stripped' };
    }
    return null; // absolute path outside the repo -- not a repo reference
  }

  if (stripped.startsWith('./') || stripped.startsWith('../')) {
    const declaringDir = path.posix.dirname(declaringRelPath);
    let joined = path.posix.normalize(path.posix.join(declaringDir, stripped));
    // Clamp any residual leading ../ (can't escape above repo root in a
    // meaningful way for this classification) but keep the rest intact.
    joined = joined.replace(/^(\.\.\/)+/, '');
    joined = joined.replace(/^\.\//, '');
    joined = joined.replace(/\/$/, '');
    if (!joined || joined === '.') return null;
    return { resolved: joined, method: 'declaring-file-relative' };
  }

  // Bare token: repo-root-relative by this repo's own convention (see file
  // header). Strip a leading ./  if somehow present (defensive).
  const bare = stripped.replace(/^\.\//, '');
  if (!bare) return null;
  return { resolved: bare, method: 'bare-repo-root-relative' };
}

// Build a fast index-to-line-number function for `content`, shared by every
// extraction path below so line numbers are computed one way.
function buildLineIndex(content) {
  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineStarts.push(i + 1);
  }
  return function lineOf(idx) {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

// Extract every candidate token from `content` that contains one of the
// known shadow-layer dir names as a `/`-delimited path segment, resolve each
// one against `declaringRelPath`, and return the raw list (pre-classification).
// This is the BROAD/PROSE extractor -- used directly for prose surfaces, and
// as a building block (post comment-stripping) for shell-like code surfaces.
function extractReferences(content, declaringRelPath, dirNameAltTest, repoRoot) {
  const out = [];
  if (!dirNameAltTest.test(content)) return out;

  const lineOf = buildLineIndex(content);

  TOKEN_REGEX.lastIndex = 0;
  let m;
  while ((m = TOKEN_REGEX.exec(content)) !== null) {
    const token = m[0];
    if (!token.includes('/')) continue;
    const resolution = resolveToken(token, declaringRelPath, repoRoot);
    if (!resolution) continue;
    out.push({
      raw_string: token,
      resolved_target: resolution.resolved,
      resolution_method: resolution.method,
      line: lineOf(m.index),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// OPERATIVE surface classification + narrow extractors (v5)
// ---------------------------------------------------------------------------

const CODE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.sh']);

// Whitelisted call-site identifiers whose FIRST string-literal argument is a
// real filesystem/module reference: require/import specifiers, and
// fs/child_process/spawn-family path arguments.
const OPERATIVE_CALL_REGEX = new RegExp(
  '\\b(?:require(?:\\.resolve)?|import|readFileSync|writeFileSync|existsSync|readdirSync|statSync|' +
  'lstatSync|mkdirSync|unlinkSync|rmSync|rmdirSync|copyFileSync|renameSync|appendFileSync|' +
  'createReadStream|createWriteStream|symlinkSync|readlinkSync|openSync|exec|execSync|execFile|' +
  'execFileSync|spawn|spawnSync|fork)\\s*\\(\\s*([\'"`])((?:\\\\.|(?!\\1)[^\\\\\\n])*)\\1',
  'g'
);

// `import x from '...'` / `export ... from '...'` -- no parens, so it needs
// its own pattern.
const OPERATIVE_FROM_REGEX = /\bfrom\s+(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

function classifySurfaceKind(relPath) {
  if (relPath.startsWith('.githooks/')) return 'code';
  const ext = path.extname(relPath).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (relPath === '.claude/settings.json' || relPath === '.claude/settings.local.json') return 'config-values';
  if (relPath === 'package.json') return 'config-scripts';
  if (ext === '.plist') return 'config-plist';
  if (relPath === 'AGENTS.md') return 'md-registry';
  if (ext === '.json' && isLiveSignal(relPath)) return 'config-values';
  return 'prose';
}

function isOperativeSurface(relPath) {
  return classifySurfaceKind(relPath) !== 'prose';
}

// .js/.cjs/.mjs: narrow, call-site-only extraction. .sh/.githooks: the whole
// body (minus '#'-comment lines) is code, so reuse the broad extractor over
// a comment-stripped copy.
function extractCodeReferences(content, declaringRelPath, dirNameAltTest, repoRoot) {
  if (!dirNameAltTest.test(content)) return [];

  const ext = path.extname(declaringRelPath).toLowerCase();
  const isShellLike = ext === '.sh' || declaringRelPath.startsWith('.githooks/') || ext === '';
  if (isShellLike) {
    const filtered = content
      .split('\n')
      .map((line) => (/^\s*#/.test(line) ? '' : line))
      .join('\n');
    return extractReferences(filtered, declaringRelPath, dirNameAltTest, repoRoot).map((r) => ({ ...r, operative: true }));
  }

  const out = [];
  const lineOf = buildLineIndex(content);

  OPERATIVE_CALL_REGEX.lastIndex = 0;
  let m;
  while ((m = OPERATIVE_CALL_REGEX.exec(content)) !== null) {
    const raw = m[2];
    if (!raw || !raw.includes('/')) continue;
    const resolution = resolveToken(raw, declaringRelPath, repoRoot);
    if (!resolution) continue;
    out.push({
      raw_string: raw,
      resolved_target: resolution.resolved,
      resolution_method: resolution.method,
      line: lineOf(m.index),
      operative: true,
    });
  }

  OPERATIVE_FROM_REGEX.lastIndex = 0;
  while ((m = OPERATIVE_FROM_REGEX.exec(content)) !== null) {
    const raw = m[2];
    if (!raw || !raw.includes('/')) continue;
    const resolution = resolveToken(raw, declaringRelPath, repoRoot);
    if (!resolution) continue;
    out.push({
      raw_string: raw,
      resolved_target: resolution.resolved,
      resolution_method: resolution.method,
      line: lineOf(m.index),
      operative: true,
    });
  }

  return out;
}

// Recursively collect every string LEAF VALUE (never a key) from a parsed
// JSON structure.
function collectJSONStringValues(node, out) {
  if (typeof node === 'string') { out.push(node); return; }
  if (Array.isArray(node)) { for (const v of node) collectJSONStringValues(v, out); return; }
  if (node && typeof node === 'object') { for (const k of Object.keys(node)) collectJSONStringValues(node[k], out); }
}

function approximateIndexOf(content, val) {
  const escaped = JSON.stringify(val).slice(1, -1);
  let idx = content.indexOf(escaped);
  if (idx === -1) idx = content.indexOf(val);
  return idx;
}

// JSON config-value extraction, shared by .claude/settings*.json (all
// values), live signals (all values), and package.json (values under
// "scripts" only, when scriptsOnly is set).
function extractConfigValueReferences(content, declaringRelPath, dirNameAltTest, repoRoot, { scriptsOnly = false } = {}) {
  if (!dirNameAltTest.test(content)) return [];
  let parsed;
  try { parsed = JSON.parse(content); } catch (e) { return []; }

  const values = [];
  collectJSONStringValues(scriptsOnly ? parsed && parsed.scripts : parsed, values);

  const lineOf = buildLineIndex(content);
  const out = [];
  for (const val of values) {
    if (typeof val !== 'string' || !val.includes('/') || !dirNameAltTest.test(val)) continue;
    TOKEN_REGEX.lastIndex = 0;
    let tm;
    while ((tm = TOKEN_REGEX.exec(val)) !== null) {
      const token = tm[0];
      if (!token.includes('/')) continue;
      const resolution = resolveToken(token, declaringRelPath, repoRoot);
      if (!resolution) continue;
      const idx = approximateIndexOf(content, val);
      out.push({
        raw_string: token,
        resolved_target: resolution.resolved,
        resolution_method: resolution.method,
        line: idx === -1 ? 0 : lineOf(idx),
        operative: true,
      });
    }
  }
  return out;
}

// launchd/*.plist: only <string>...</string> element values are operative.
function extractPlistValueReferences(content, declaringRelPath, dirNameAltTest, repoRoot) {
  if (!dirNameAltTest.test(content)) return [];
  const lineOf = buildLineIndex(content);
  const out = [];
  const STRING_TAG_REGEX = /<string>([^<]*)<\/string>/g;
  let m;
  while ((m = STRING_TAG_REGEX.exec(content)) !== null) {
    const val = m[1];
    if (!val || !val.includes('/')) continue;
    TOKEN_REGEX.lastIndex = 0;
    let tm;
    while ((tm = TOKEN_REGEX.exec(val)) !== null) {
      const token = tm[0];
      if (!token.includes('/')) continue;
      const resolution = resolveToken(token, declaringRelPath, repoRoot);
      if (!resolution) continue;
      out.push({
        raw_string: token,
        resolved_target: resolution.resolved,
        resolution_method: resolution.method,
        line: lineOf(m.index),
        operative: true,
      });
    }
  }
  return out;
}

// AGENTS.md: markdown (prose by default), but doubles as a managed-command
// registry. Broad-scan every line (same token extractor as prose), and tag
// each reference `operative: true` only when its OWN line carries a
// backtick-quoted span with a recognized script extension -- everything else
// on the page (framework-id tables, alias lists, doctrine prose) stays
// prose/docs-historical.
const AGENTS_COMMAND_LINE_TEST = /`[^`]*\.(?:cjs|mjs|js|sh|py|json|ya?ml|plist)[^`]*`/;

function extractMarkdownCommandReferences(content, declaringRelPath, dirNameAltTest, repoRoot) {
  if (!dirNameAltTest.test(content)) return [];
  const out = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!dirNameAltTest.test(line)) continue;
    const isCommandLine = AGENTS_COMMAND_LINE_TEST.test(line);
    TOKEN_REGEX.lastIndex = 0;
    let tm;
    while ((tm = TOKEN_REGEX.exec(line)) !== null) {
      const token = tm[0];
      if (!token.includes('/')) continue;
      const resolution = resolveToken(token, declaringRelPath, repoRoot);
      if (!resolution) continue;
      out.push({
        raw_string: token,
        resolved_target: resolution.resolved,
        resolution_method: resolution.method,
        line: i + 1,
        operative: isCommandLine,
      });
    }
  }
  return out;
}

// Dispatcher used by the tracked-file sweep: routes each declaring file to
// the extractor matching its surface kind. Prose files fall through to the
// broad extractor unchanged (references are still recorded, just always
// classified docs-historical unless shadow-internal).
function extractByKind(content, declaringRelPath, dirNameAltTest, repoRoot) {
  const kind = classifySurfaceKind(declaringRelPath);
  switch (kind) {
    case 'code': return extractCodeReferences(content, declaringRelPath, dirNameAltTest, repoRoot);
    case 'config-values': return extractConfigValueReferences(content, declaringRelPath, dirNameAltTest, repoRoot);
    case 'config-scripts': return extractConfigValueReferences(content, declaringRelPath, dirNameAltTest, repoRoot, { scriptsOnly: true });
    case 'config-plist': return extractPlistValueReferences(content, declaringRelPath, dirNameAltTest, repoRoot);
    case 'md-registry': return extractMarkdownCommandReferences(content, declaringRelPath, dirNameAltTest, repoRoot);
    default: return extractReferences(content, declaringRelPath, dirNameAltTest, repoRoot);
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------
function topSegment(relPath) {
  const idx = relPath.indexOf('/');
  return idx === -1 ? relPath : relPath.slice(0, idx);
}

function isUnderDir(relPath, dirName) {
  return relPath === dirName || relPath.startsWith(`${dirName}/`);
}

function isLiveSignal(declaringRelPath) {
  return declaringRelPath.startsWith('_dev/reports/signals/') && !declaringRelPath.includes('/closed/');
}

// Retained for back-compat/export -- v5 classification no longer keys off
// this alone (see classifySurfaceKind / isOperativeSurface), but it is still
// how isLiveSignal-based config-value routing decides the live-signal case,
// and some callers may still find the _dev/-tree notion useful.
function isDocsHistoricalDeclaringFile(declaringRelPath) {
  return declaringRelPath.startsWith('_dev/') && !isLiveSignal(declaringRelPath);
}

function classifyReference(ref, declaringRelPath, targetDirSet, carveOutDirSet, options = {}) {
  const { deleteCandidateSet = null } = options;
  const declaringTop = topSegment(declaringRelPath);
  const targetTop = topSegment(ref.resolved_target);

  const pointsIntoTarget = targetDirSet.has(targetTop);
  const pointsIntoCarveOut = carveOutDirSet.has(targetTop);
  if (!pointsIntoTarget && !pointsIntoCarveOut) return null; // not a shadow-layer reference

  if (targetDirSet.has(declaringTop)) {
    return { classification: 'shadow-internal' };
  }

  const operative = typeof ref.operative === 'boolean' ? ref.operative : isOperativeSurface(declaringRelPath);
  if (!operative) {
    return { classification: 'docs-historical' };
  }

  if (pointsIntoCarveOut) {
    return { classification: 'live-excluded-target' };
  }

  // pointsIntoTarget, operative declaring surface, not a prose citation.
  const target = ref.resolved_target.replace(/\/$/, '');
  if (deleteCandidateSet) {
    const inSet = deleteCandidateSet.has(target);
    if (!inSet) {
      return { classification: 'non-target', target_exists: false };
    }
  }

  return {
    classification: 'live-external',
    fix: `repoint reference in ${declaringRelPath} from '${ref.resolved_target}' to 'tools/${ref.resolved_target}' before deleting root ${targetTop}/`,
    target_exists: deleteCandidateSet ? true : undefined,
  };
}

// ---------------------------------------------------------------------------
// External/runtime surface enumeration (beyond the tracked-file sweep)
// ---------------------------------------------------------------------------
function externalSurfaceFiles(repoRoot) {
  const surfaces = [];

  // .git/hooks/* (not tracked by git; the real hook dir unless core.hooksPath
  // points elsewhere, which this repo has set to .githooks -- already tracked
  // and covered by the git ls-files sweep).
  const gitHooksDir = path.join(repoRoot, '.git', 'hooks');
  let gitHooksFiles = [];
  try {
    gitHooksFiles = fs.readdirSync(gitHooksDir)
      .filter((f) => !f.endsWith('.sample'))
      .map((f) => ({ absPath: path.join(gitHooksDir, f), declaringRelPath: `.git/hooks/${f}` }));
  } catch (e) {
    gitHooksFiles = [];
  }
  surfaces.push({
    surface: '.git/hooks/* (non-.sample)',
    provenance: `readdir ${path.relative(repoRoot, gitHooksDir)}; .sample defaults excluded`,
    files: gitHooksFiles,
    kind: 'code',
  });

  // core.hooksPath, if it points somewhere other than the repo-relative
  // .githooks dir already covered by the tracked-file sweep.
  const hooksPathRaw = (gitOrNull(repoRoot, ['config', 'core.hooksPath']) || '').trim();
  let hooksPathFiles = [];
  let hooksPathNote = 'not set';
  if (hooksPathRaw) {
    const abs = path.isAbsolute(hooksPathRaw) ? hooksPathRaw : path.resolve(repoRoot, hooksPathRaw);
    const rel = path.relative(repoRoot, abs);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      hooksPathNote = `core.hooksPath=${hooksPathRaw} resolves under the repo (${rel}/) -- already covered by the tracked-file sweep`;
    } else {
      hooksPathNote = `core.hooksPath=${hooksPathRaw} resolves OUTSIDE the repo`;
      try {
        hooksPathFiles = fs.readdirSync(abs)
          .filter((f) => !f.endsWith('.sample'))
          .map((f) => ({ absPath: path.join(abs, f), declaringRelPath: `<external-hooks-path>/${f}` }));
      } catch (e) {
        hooksPathFiles = [];
      }
    }
  }
  surfaces.push({ surface: 'core.hooksPath', provenance: hooksPathNote, files: hooksPathFiles, kind: 'code' });

  // ~/Library/LaunchAgents/*.plist that mention this repo (macOS scheduled
  // jobs live outside the tracked tree entirely; the tracked launchd/ dir is
  // a carve-out and already covered by the sweep).
  let launchAgentFiles = [];
  let launchAgentsNote = 'not scanned';
  try {
    const laDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const entries = fs.readdirSync(laDir).filter((f) => f.endsWith('.plist'));
    const repoBase = path.basename(repoRoot);
    for (const f of entries) {
      const abs = path.join(laDir, f);
      let content = '';
      try { content = fs.readFileSync(abs, 'utf8'); } catch (e) { continue; }
      if (content.includes(repoRoot) || content.includes(repoBase)) {
        launchAgentFiles.push({ absPath: abs, declaringRelPath: `<external-launchagents>/${f}` });
      }
    }
    launchAgentsNote = `readdir ${laDir}; ${entries.length} plists scanned, ${launchAgentFiles.length} mention this repo`;
  } catch (e) {
    launchAgentsNote = `unreadable/absent: ${String(e.message || e)}`;
  }
  surfaces.push({ surface: '~/Library/LaunchAgents/*.plist (repo-referencing)', provenance: launchAgentsNote, files: launchAgentFiles, kind: 'config-plist' });

  return surfaces;
}

// ---------------------------------------------------------------------------
// Falsifier arm
// ---------------------------------------------------------------------------
// Plants a reference in a fixture representing a launch surface NOT in the
// tool's named external-surface enumeration (a hypothetical CI runner
// script), and proves the extraction+classification pipeline still detects
// it end-to-end -- including the ${VAR}/ template-prefix lesson a plain
// path-literal regex would miss. Runs as part of every full run; the result
// is recorded on the output, not only asserted in tests.
function runFalsifierArm({ repoRoot, targetDirSet, carveOutDirSet, deleteCandidateSet, dirNameAltTest }) {
  const fixturePath = path.join(__dirname, '__tests__', '__fixtures__', 'falsifier', 'planted-launch-surface.txt');
  const simulatedDeclaringPath = 'ci/unforeseen-runner-config.sh';
  const plantedTarget = 'lib/canonical-root.cjs';

  let content;
  try {
    content = fs.readFileSync(fixturePath, 'utf8');
  } catch (e) {
    return {
      planted: { fixture: path.relative(repoRoot, fixturePath), resolved_target: plantedTarget },
      detected: false,
      classification: null,
      error: `fixture unreadable: ${String(e.message || e)}`,
    };
  }

  const refs = extractCodeReferences(content, simulatedDeclaringPath, dirNameAltTest, repoRoot);
  const planted = refs.find((r) => r.resolved_target === plantedTarget);
  if (!planted) {
    return {
      planted: { fixture: path.relative(repoRoot, fixturePath), resolved_target: plantedTarget, simulated_declaring_path: simulatedDeclaringPath },
      detected: false,
      classification: null,
    };
  }

  const cls = classifyReference(planted, simulatedDeclaringPath, targetDirSet, carveOutDirSet, { deleteCandidateSet });
  return {
    planted: {
      fixture: path.relative(repoRoot, fixturePath),
      resolved_target: plantedTarget,
      simulated_declaring_path: simulatedDeclaringPath,
      raw_string: planted.raw_string,
      resolution_method: planted.resolution_method,
    },
    detected: !!cls && cls.classification === 'live-external',
    classification: cls ? cls.classification : null,
  };
}

// ---------------------------------------------------------------------------
// Full run
// ---------------------------------------------------------------------------
function runReferenceProof({ repoRoot, targetDirs, carveOutDirs, deleteCandidateSet = null, onProgress }) {
  const generatedAt = new Date().toISOString();
  const targetDirSet = new Set(targetDirs);
  const carveOutDirSet = new Set(carveOutDirs);
  const allDirNames = [...targetDirSet, ...carveOutDirSet];
  const altTest = buildAltTest(allDirNames);

  const references = [];
  const unclassified = [];
  const surfaces = [];

  // --- Surface 1: full tracked-file sweep (git ls-files, entire tree) ---
  const lsOut = git(repoRoot, ['ls-files']);
  const tracked = lsOut.split('\n').filter(Boolean);
  const lsStageOut = git(repoRoot, ['ls-files', '-s']);
  const symlinkPaths = new Set();
  for (const line of lsStageOut.split('\n')) {
    if (!line) continue;
    const mode = line.slice(0, 6);
    if (mode === '120000') {
      const tabIdx = line.indexOf('\t');
      if (tabIdx !== -1) symlinkPaths.add(line.slice(tabIdx + 1));
    }
  }

  let scannedCount = 0;
  let skippedBinary = 0;
  let selfExcludedCount = 0;
  for (const relPath of tracked) {
    if (relPath.startsWith(SELF_EXCLUDE_PREFIX)) { selfExcludedCount++; continue; }

    const ext = path.extname(relPath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) { skippedBinary++; continue; }
    const absPath = path.join(repoRoot, relPath);

    if (symlinkPaths.has(relPath)) {
      let target;
      try { target = fs.readlinkSync(absPath); } catch (e) { continue; }
      const refs = extractReferences(target, relPath, altTest, repoRoot).map((r) => ({ ...r, operative: true }));
      for (const r of refs) {
        r.source_file = relPath;
        r.via = 'symlink-target';
        references.push(r);
      }
      scannedCount++;
      continue;
    }

    let stat;
    try { stat = fs.lstatSync(absPath); } catch (e) { continue; }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) { continue; }

    let buf;
    try { buf = fs.readFileSync(absPath); } catch (e) { continue; }
    if (isBinaryBuffer(buf)) { skippedBinary++; continue; }
    const content = buf.toString('utf8');

    const refs = extractByKind(content, relPath, altTest, repoRoot);
    for (const r of refs) {
      r.source_file = relPath;
      r.via = 'tracked-file-sweep';
      references.push(r);
    }
    scannedCount++;
    if (onProgress && scannedCount % 5000 === 0) onProgress({ scannedCount, total: tracked.length });
  }
  surfaces.push({
    surface: 'tracked-file sweep (git ls-files, full tree)',
    provenance: `git ls-files (${tracked.length} tracked paths); ${scannedCount} scanned as text, ${skippedBinary} skipped as binary/extension-excluded, ${selfExcludedCount} skipped as self-excluded (see scan_roots.self_excluded)`,
    files_scanned: scannedCount,
  });

  // Explicit named surfaces (all already covered by the tracked-file sweep
  // above -- recorded here for provenance per the S2 spec, not re-scanned).
  const namedTrackedSurfaces = [
    { surface: '.claude/settings.json hook commands', path: '.claude/settings.json' },
    { surface: '.claude/settings.local.json hook commands', path: '.claude/settings.local.json' },
    { surface: 'core.hooksPath tracked dir (.githooks)', path: '.githooks' },
    { surface: 'package.json scripts', path: 'package.json' },
    { surface: 'AGENTS.md managed-command surfaces', path: 'AGENTS.md' },
    { surface: '.github workflows', path: '.github' },
    { surface: 'launchd/*.plist (tracked, carve-out dir)', path: 'launchd' },
    { surface: '_dev/reports/signals/*.json live signals (not /closed/)', path: '_dev/reports/signals' },
  ];
  for (const s of namedTrackedSurfaces) {
    const exists = fs.existsSync(path.join(repoRoot, s.path));
    surfaces.push({
      surface: s.surface,
      provenance: exists
        ? `${s.path} is git-tracked; covered by the tracked-file sweep above (not double-scanned)`
        : `${s.path} not found at repo root`,
    });
  }

  // --- Surface 2: external, non-tracked surfaces ---
  const external = externalSurfaceFiles(repoRoot);
  for (const surf of external) {
    let scanned = 0;
    for (const f of surf.files) {
      let content;
      try { content = fs.readFileSync(f.absPath, 'utf8'); } catch (e) { continue; }
      const refs = surf.kind === 'config-plist'
        ? extractPlistValueReferences(content, f.declaringRelPath, altTest, repoRoot)
        : extractCodeReferences(content, f.declaringRelPath, altTest, repoRoot);
      for (const r of refs) {
        r.source_file = f.declaringRelPath;
        r.via = `external-surface:${surf.surface}`;
        references.push(r);
      }
      scanned++;
    }
    surfaces.push({ surface: surf.surface, provenance: surf.provenance, files_scanned: scanned });
  }

  // --- Classify every extracted reference ---
  for (const ref of references) {
    const cls = classifyReference(ref, ref.source_file, targetDirSet, carveOutDirSet, { deleteCandidateSet });
    if (!cls) { ref.classification = null; continue; } // not a shadow-layer reference at all -- drop below
    ref.classification = cls.classification;
    if (cls.fix) ref.fix = cls.fix;
    if (typeof cls.target_exists === 'boolean') ref.target_exists = cls.target_exists;
  }

  const shadowReferences = references.filter((r) => r.classification !== null);
  const stillUnclassified = shadowReferences.filter((r) => !r.classification);
  for (const r of stillUnclassified) unclassified.push(r);

  const countsByClassification = {};
  for (const r of shadowReferences) {
    countsByClassification[r.classification] = (countsByClassification[r.classification] || 0) + 1;
  }

  const liveExternalBlockers = shadowReferences.filter((r) => r.classification === 'live-external');
  const nonTargetReferences = shadowReferences.filter((r) => r.classification === 'non-target');
  const liveExcludedTarget = shadowReferences.filter((r) => r.classification === 'live-excluded-target');

  const falsifier = runFalsifierArm({ repoRoot, targetDirSet, carveOutDirSet, deleteCandidateSet, dirNameAltTest: altTest });

  return {
    schema: 'ShadowTreeReferenceProof/1.0',
    run_scope: 'full-layer',
    generated_at: generatedAt,
    scan_roots: {
      target_dirs: targetDirs,
      target_dir_count: targetDirs.length,
      carve_out_dirs: carveOutDirs,
      self_excluded: { prefix: SELF_EXCLUDE_PREFIX, files_skipped: selfExcludedCount, reason: 'the proof machinery\'s own source/tests/fixtures are never a declaring-file surface' },
      delete_candidate_set_size: deleteCandidateSet ? deleteCandidateSet.size : null,
      note: 'target_dirs is the delete-candidate set (census shadow_candidates); carve_out_dirs (hooks/ + 6 unclear dirs) are live and excluded from deletion, but references into them are still recorded as live-excluded-target. A live-external classification additionally requires the resolved target to be a tracked file in delete_candidate_set (see loadDeleteCandidateSet) -- otherwise it is recorded as non-target.',
    },
    surfaces,
    counts_by_classification: countsByClassification,
    unclassified_count: unclassified.length,
    unclassified: unclassified,
    live_external_blockers: liveExternalBlockers,
    live_external_note: 'live-external requires: (1) an OPERATIVE declaring surface (require/import/fs/spawn call in .js/.cjs/.mjs/.sh code, a config VALUE in a named executable config surface, or an AGENTS.md managed-command line) -- never a .md prose citation or a JSON description/prose field; and (2) the resolved target must be a tracked file with deletable=true in the S1 inventory. Anything operative that resolves outside that delete-candidate set is recorded as non_target_references instead.',
    non_target_references: nonTargetReferences,
    live_excluded_target: liveExcludedTarget,
    falsifier,
    references: shadowReferences,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target-dirs') out.targetDirs = argv[++i];
    else if (a === '--census') out.census = argv[++i];
    else if (a === '--inventory') out.inventory = argv[++i];
    else if (a === '--json') out.json = argv[++i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();

  let targetDirs, carveOutDirs;
  const censusPath = args.census || '_dev/reports/analysis/shadow-tree-removal__full-layer-census.json';
  if (args.targetDirs) {
    targetDirs = args.targetDirs.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      ({ carveOutDirs } = dirsFromCensus(censusPath, repoRoot));
    } catch (e) {
      carveOutDirs = CARVE_OUT_DIR_NAMES_FALLBACK;
    }
  } else {
    ({ targetDirs, carveOutDirs } = dirsFromCensus(censusPath, repoRoot));
  }

  const inventoryPath = args.inventory || DEFAULT_INVENTORY_PATH;
  let deleteCandidateSet = null;
  try {
    deleteCandidateSet = loadDeleteCandidateSet(inventoryPath, repoRoot);
  } catch (e) {
    process.stderr.write(`[reference-proof] WARNING: could not load delete-candidate set from ${inventoryPath} (${String(e.message || e)}); live-external set-membership check is DISABLED for this run.\n`);
  }

  const result = runReferenceProof({
    repoRoot,
    targetDirs,
    carveOutDirs,
    deleteCandidateSet,
    onProgress: ({ scannedCount, total }) => {
      process.stderr.write(`[reference-proof] scanned ${scannedCount}/${total}\n`);
    },
  });

  const jsonOut = JSON.stringify(result, null, 2);
  if (args.json) {
    fs.writeFileSync(path.resolve(repoRoot, args.json), jsonOut);
    process.stderr.write(`[reference-proof] wrote ${args.json}\n`);
    process.stderr.write(`[reference-proof] counts_by_classification: ${JSON.stringify(result.counts_by_classification)}\n`);
    process.stderr.write(`[reference-proof] unclassified_count: ${result.unclassified_count}\n`);
    process.stderr.write(`[reference-proof] falsifier: ${JSON.stringify(result.falsifier)}\n`);
  } else {
    process.stdout.write(jsonOut + '\n');
  }
}

module.exports = {
  resolveToken,
  extractReferences,
  extractCodeReferences,
  extractConfigValueReferences,
  extractPlistValueReferences,
  extractMarkdownCommandReferences,
  extractByKind,
  classifyReference,
  classifySurfaceKind,
  isOperativeSurface,
  runReferenceProof,
  runFalsifierArm,
  dirsFromCensus,
  loadDeleteCandidateSet,
  topSegment,
  isUnderDir,
  isLiveSignal,
  isDocsHistoricalDeclaringFile,
  buildAltTest,
  buildLineIndex,
  SELF_EXCLUDE_PREFIX,
  CARVE_OUT_DIR_NAMES_FALLBACK,
};

if (require.main === module) {
  main();
}
