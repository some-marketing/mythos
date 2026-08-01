#!/usr/bin/env node
'use strict';
/**
 * export-public — genericization pipeline: Mythos (private) -> learning-language-models (public).
 *
 * The public repo is never hand-edited: every exported file is the output of this
 * deterministic, receipted pipeline. Six stages per framework:
 *   1. select        — allowlist file classes from config/framework-export-map.json
 *                      (export | exclude | mock). Absence from the map = never exported.
 *   2. strip         — denylist-driven substitution (config/denylist.json) on export-class
 *                      text files. Client codes are case-sensitive word-boundary; domains,
 *                      identifiers substring; regex patterns for emails etc.
 *   3. parameterize  — mock-class files are swapped from mocks/<framework>/; compliance
 *                      posture parameterization beyond substitutions is authorial and
 *                      belongs in the mock files, not in regex.
 *   4. lint          — independent contamination scan of the STAGED OUTPUT (does not trust
 *                      stage 2): required hit count is ZERO. Case-insensitive matching of
 *                      short month/hour-shaped client codes is deliberately NOT used
 *                      (date-placeholder false positives); codes match case-sensitive
 *                      word-boundary, with per-entry adjacency-negation regex overrides.
 *   5. validate      — staged manifest carries required keys and prompt_count matches the
 *                      actual staged prompt files.
 *   6. preflight     — with --apply: batch-level gate BEFORE any target write. Validates
 *                      every selected unit staged clean, the target repo (exists, git,
 *                      expected remote/branch when declared in the map), target dirty-tree
 *                      state (abort unless --allow-dirty), and collisions (existing target
 *                      dirs require an explicit --force). Prints the complete target set.
 *   7. write+receipt — atomic per-target replacement with whole-batch rollback: every
 *                      staged unit is copied beside its target, swapped in by rename, and
 *                      if ANY swap fails all completed swaps are rolled back to their
 *                      prior state. Emits a PublicExport/1.0 receipt in BOTH repos and a
 *                      lane-health receipt. Receipts never carry absolute private paths.
 *
 * Dry-run by default (stages 1-5 into a temp staging dir + report). --apply performs
 * stages 6-7. Kill-switch: see KILL_SWITCH below for the flag-file path. Non-interactive safe:
 * overwrite consent is the --force flag, never a prompt. --force is WHOLE-INVOCATION
 * consent: it authorizes overwriting every existing target in the selected batch, and
 * preflight prints exactly which targets that consent covers before any write. To
 * scope consent to selected units, repeat --framework <id> with --force.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_DIR = path.join(__dirname, 'config');
const MOCKS_DIR = path.join(__dirname, 'mocks');
const KILL_SWITCH = path.join(REPO_ROOT, '_dev', 'state', 'export-public', 'disabled');
const RECEIPT_DIR_A = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'public-export');

let appendReceipt = null;
try { ({ appendReceipt } = require('../maintenance/lib/hygiene-lane-health.cjs')); } catch { /* lane-health optional */ }

// R3-1: .ps1 added — place-root-docs.cjs used to read root_files unconditionally
// as text regardless of extension, so quickstart.ps1 was always substituted
// correctly by accident. Routing that lane through the shared isTextFile-based
// inspectFile() exposed the gap: .ps1 was never classified as text, which would
// have silently skipped substitution/scanning on it going forward.
const TEXT_EXTENSIONS = new Set(['.md', '.json', '.yaml', '.yml', '.js', '.cjs', '.mjs', '.txt', '.html', '.css', '.sh', '.ps1', '.py', '.env', '.example', '.command', '.jsx', '.plist', '.swift', '.ts', '.tsx']);

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function optionValues(args, option) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === option && args[i + 1] && !args[i + 1].startsWith('--')) values.push(args[i + 1]);
  }
  return values;
}

// R4 regression: a small, deliberately minimal allowlist of well-known
// EXTENSIONLESS text files. Before the R3-1 shared-primitive refactor, the
// root-files lane (place-root-docs.cjs) read every root_files entry as text
// unconditionally, regardless of extension — so LICENSE (extensionless) was
// substituted correctly "by accident." Routing that lane through the shared
// isTextFile-based inspectFile() exposed the real gap: an extensionless file
// falls through TEXT_EXTENSIONS and isn't ".env"-prefixed, so it was silently
// reclassified as binary (byte-scanned for forbidden[] only, never substituted).
// Keep this list minimal and name every addition here — it is NOT a general
// "assume extensionless is text" rule, only these specific, universally-known
// conventional filenames.
const EXTENSIONLESS_TEXT_BASENAMES = new Set(['LICENSE', 'NOTICE', 'COPYING']);

function isTextFile(p) {
  const ext = path.extname(p).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const base = path.basename(p);
  if (base.startsWith('.env')) return true;
  return EXTENSIONLESS_TEXT_BASENAMES.has(base);
}

// ---- R3-1: shared byte/encoding-aware inspection primitive ------------------------------
//
// Extension-based "text file" classification is a transformation decision, not a
// security boundary (R3 review lesson). Every lane that reads a file to scan or
// substitute — per-unit export, mock, root-file, staged output, and the composed
// tree — must go through inspectFile() below, so an encoding or binary bypass can
// never be fixed in one lane while the others still assume plain UTF-8.

const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf]);
const BOM_UTF16LE = Buffer.from([0xff, 0xfe]);
const BOM_UTF16BE = Buffer.from([0xfe, 0xff]);

function detectBom(buf) {
  if (buf.length >= 3 && buf.subarray(0, 3).equals(BOM_UTF8)) return { encoding: 'utf8', bomLength: 3 };
  if (buf.length >= 2 && buf.subarray(0, 2).equals(BOM_UTF16LE)) return { encoding: 'utf16le', bomLength: 2 };
  if (buf.length >= 2 && buf.subarray(0, 2).equals(BOM_UTF16BE)) return { encoding: 'utf16be', bomLength: 2 };
  return { encoding: null, bomLength: 0 };
}

function swapUtf16Endianness(buf) {
  const out = Buffer.alloc(buf.length - (buf.length % 2));
  for (let i = 0; i + 1 < buf.length; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  return out;
}

/**
 * Decode a buffer declared as "text" into a string. Detects and strips a UTF-8,
 * UTF-16LE, or UTF-16BE BOM and decodes accordingly. With no BOM, the content is
 * validated as UTF-8 by a round-trip check (Node's default `toString('utf8')`
 * silently replaces invalid sequences with U+FFFD instead of throwing, so
 * validity must be checked explicitly, not assumed). Returns `{ text, encoding }`
 * on success or `{ error }` on failure — callers MUST treat an error as a hard,
 * blocking finding, never a silent skip: content this tool cannot reliably read
 * is content it cannot vouch for being clean.
 */
function decodeTextBuffer(buf) {
  const { encoding, bomLength } = detectBom(buf);
  if (encoding === 'utf8') return { text: buf.subarray(bomLength).toString('utf8'), encoding: 'utf8-bom' };
  if (encoding === 'utf16le') return { text: buf.subarray(bomLength).toString('utf16le'), encoding: 'utf16le' };
  if (encoding === 'utf16be') return { text: swapUtf16Endianness(buf.subarray(bomLength)).toString('utf16le'), encoding: 'utf16be' };
  const text = buf.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buf)) {
    return { error: 'content declared as text is not valid UTF-8 and carries no BOM — refusing to silently decode or skip it' };
  }
  return { text, encoding: 'utf8' };
}

/**
 * Scan raw bytes of a BINARY-classified file for forbidden[] terms. Matches both
 * plain ASCII byte sequences and UTF-16-interleaved sequences (each character
 * optionally followed by a NUL byte) with a single case-insensitive pattern per
 * term, via a lossless latin1 (1 byte -> 1 code unit) re-encoding of the buffer.
 * Only term-based forbidden[] entries are supported (an arbitrary `regex` entry
 * is not generally translatable to a byte-pattern search and is skipped here —
 * every forbidden[] entry actually in use is term-based).
 */
function scanBinaryForForbidden(buf, denylist, relPath) {
  const hits = [];
  const raw = buf.toString('latin1');
  for (const f of denylist.forbidden || []) {
    if (!f.term) continue;
    const escaped = f.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const interleaved = escaped.split('').join('\\x00?');
    if (new RegExp(interleaved, 'i').test(raw)) {
      hits.push({ file: relPath, kind: 'forbidden', term: f.description || f.term, excerpt: '(binary content byte-pattern match)' });
    }
  }
  return hits;
}

/**
 * THE shared inspection primitive. Reads a file's raw bytes once and returns:
 *   - for a binary-classified path (isTextFile === false): { text: null, hits,
 *     blocked: false } — hits are raw-byte forbidden matches (R3-1's ".bin" probe).
 *   - for a text-classified path that decodes successfully: { text, encoding,
 *     hits: [], blocked: false } — callers scan/substitute `text` as before.
 *   - for a text-classified path that CANNOT be safely decoded (no BOM, invalid
 *     UTF-8): { text: null, hits: [one undecodable finding], blocked: true } —
 *     callers must treat this as a hard block, exactly like a forbidden hit.
 */
function inspectFile(filePath, relPath, denylist) {
  const buf = fs.readFileSync(filePath);
  if (!isTextFile(filePath)) {
    return { text: null, encoding: null, hits: scanBinaryForForbidden(buf, denylist, relPath), blocked: false };
  }
  const decoded = decodeTextBuffer(buf);
  if (decoded.error) {
    return { text: null, encoding: null, blocked: true, hits: [{ file: relPath, kind: 'undecodable', term: decoded.error, excerpt: '' }] };
  }
  return { text: decoded.text, encoding: decoded.encoding, hits: [], blocked: false };
}

// Symlinks are rejected outright (EP-S2-002): a link inside a broad "**" allowlist
// can point anywhere on disk and exfiltrate private content into public staging.
// Refusal (not silent skip) keeps the failure loud and the unit BLOCKED.
//
// Directory-level pruning (EP-S2-011): a directory whose ENTIRE subtree is
// guaranteed excluded by a caller-supplied glob (e.g. "runner/node_modules/**")
// is never entered — readdirSync is never even called on it — so a symlink
// anywhere inside it, however deep, is unreachable and cannot trip the refusal
// above. This is strictly safer than walking it and throwing: excluded content
// never ships regardless of whether walk() visits it. It does NOT weaken the
// refusal for anything else — a symlink in any path NOT covered by a whole-subtree
// exclude glob still throws exactly as before. The prune test only fires for
// globs whose reach provably covers the whole subtree from this directory down
// (tested as `matchesAny(rel + '/', excludeGlobs)` — a partial/single-level glob
// like "docs/*.md" can never match a bare trailing-slash probe, so it never
// prunes a directory that still has other content needing individual
// export/exclude/mock evaluation). A directory is exempted from pruning when a
// mock target lives under it (mockKeys), since mock-class files are discovered
// by walking the PRIVATE source tree even though their exclude glob would
// otherwise cover them (e.g. tools/export-public's own config/** exclude, which
// mock-shadows config/denylist.json etc — pruning "config" wholesale would make
// those mock targets invisible to exportFramework's mock-vs-exclude check).
// excludeGlobs/mockKeys default to null so every existing call site (digestResults,
// tests, other tools) is byte-identical to the pre-pruning behavior.
function walk(dir, base = dir, excludeGlobs = null, mockKeys = null) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const rel = path.relative(base, full);
      const mockedUnder = mockKeys && mockKeys.some((k) => k === rel || k.startsWith(rel + '/'));
      if (excludeGlobs && !mockedUnder && matchesAny(rel + '/', excludeGlobs)) continue;
      out.push(...walk(full, base, excludeGlobs, mockKeys));
      continue;
    }
    if (entry.isSymbolicLink()) throw new Error('symlink not permitted in export tree: ' + full);
    if (entry.isFile()) out.push(path.relative(base, full));
    else throw new Error('unsupported file type in export tree: ' + full);
  }
  return out;
}

// Resolved-path containment (EP-S2-002): configured roots may themselves be links
// or contain ".."; the realpath must stay under the declared root.
function assertContained(childPath, rootDir, label) {
  const real = fs.realpathSync(childPath);
  const rootReal = fs.realpathSync(rootDir);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw new Error(`${label} escapes ${rootReal}: ${childPath} -> ${real}`);
  }
}

// Write-side containment (EP-S2-002 round 2): the WRITE target is an independently
// configured trust boundary — securing source reads does not secure it. A map (or
// direct caller) supplying "../escape" or an absolute path must be refused at
// preflight AND at write time, including escape via a symlinked ancestor.
function resolveTargetPath(repoReal, targetPath) {
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error('invalid targetPath: ' + JSON.stringify(targetPath));
  }
  if (path.isAbsolute(targetPath)) {
    throw new Error('absolute targetPath not permitted: ' + targetPath);
  }
  const resolved = path.resolve(repoReal, targetPath);
  if (resolved !== repoReal && !resolved.startsWith(repoReal + path.sep)) {
    throw new Error('targetPath escapes the target repo: ' + targetPath);
  }
  if (resolved === repoReal) {
    throw new Error('targetPath resolves to the repo root itself: ' + targetPath);
  }
  // Deepest existing ancestor must ALSO be contained after symlink resolution.
  let probe = resolved;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const probeReal = fs.realpathSync(probe);
  if (probeReal !== repoReal && !probeReal.startsWith(repoReal + path.sep)) {
    throw new Error('targetPath resolves outside the target repo via symlink: ' + targetPath + ' -> ' + probeReal);
  }
  // Canonical destination (EP-S2-009 round 4): containment is not identity — an
  // in-repo symlinked ancestor makes two lexical targets converge on one real
  // destination, so collision checks and plan bindings must compare the real
  // ancestor's path plus the unresolved suffix, not the lexical resolution.
  const canonical = probeReal + resolved.slice(probe.length);
  if (canonical === repoReal) {
    throw new Error('targetPath canonicalizes to the repo root itself: ' + targetPath);
  }
  return canonical;
}

// Plan authenticity (EP-S2-006 round 2): a frozen object is immutable, not
// authentic — any caller can forge the same structure. Plans are authentic only
// if THIS module issued them (identity, not shape), and they are bound to the
// exact repo realpath and a content digest of the staged results they authorize.
const ISSUED_PLANS = new WeakSet();

function digestResults(results) {
  const h = crypto.createHash('sha256');
  for (const r of results) {
    if (r.error || !r.ok) continue;
    h.update(r.framework + '\0' + r.targetPath + '\0');
    for (const rel of walk(r.staging).sort()) {
      h.update(rel + '\0');
      h.update(fs.readFileSync(path.join(r.staging, rel)));
      h.update('\0');
    }
  }
  return h.digest('hex');
}

// Minimal glob: * within a segment, ** across segments. Enough for the export map;
// deliberately not a custom regex transpiler over arbitrary syntax (F7 lesson).
function globToRegex(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '[^/]*')
    .replace(//g, '.*');
  return new RegExp('^' + esc + '$');
}
function matchesAny(rel, globs) { return (globs || []).some((g) => globToRegex(g).test(rel)); }

// ---- stage 2: substitutions ----------------------------------------------------------

function buildSubstitutions(denylist) {
  const subs = [];
  for (const c of denylist.client_codes || []) {
    // R2-6: client_codes are case-INSENSITIVE by default — a lowercase or
    // mixed-case occurrence of a client code slug (e.g. inside a filename or a
    // URL slug) is just as much a leak as the exact-case form, and an
    // adversarial sweep confirmed a lowercase slug variant slipped past the old
    // case-sensitive-by-default compilation. Entries with an explicit `regex`
    // override (HH/MM's date-placeholder adjacency guards, {DEVELOPER_NAME}'s underscore/
    // hyphen-joined id boundary) keep their author-written flags exactly as
    // given — those overrides exist FOR a specific reason (rejecting date
    // placeholders, matching id-joining punctuation) and must not be silently
    // widened or narrowed by a blanket default.
    const regex = c.regex ? new RegExp(c.regex, 'g') : new RegExp('\\b' + c.term + '\\b', 'gi');
    subs.push({ kind: 'code', regex, term: c.term, replacement: c.replacement });
  }
  for (const d of denylist.domains || []) {
    subs.push({ kind: 'domain', regex: new RegExp(d.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), term: d.term, replacement: d.replacement });
  }
  for (const i of denylist.identifiers || []) {
    subs.push({ kind: 'identifier', regex: new RegExp(i.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), term: i.term, replacement: i.replacement });
  }
  for (const p of denylist.patterns || []) {
    subs.push({ kind: 'pattern', regex: new RegExp(p.regex, p.flags || 'g'), term: p.description || p.regex, replacement: p.replacement });
  }
  return subs;
}

function applySubstitutions(text, subs) {
  const applied = [];
  let out = text;
  for (const s of subs) {
    const before = out;
    out = out.replace(s.regex, s.replacement);
    if (out !== before) {
      const count = (before.match(s.regex) || []).length;
      applied.push({ kind: s.kind, term: s.term, replacement: s.replacement, count });
    }
  }
  return { text: out, applied };
}

// ---- stage 4: independent contamination scan ------------------------------------------

// forbidden[] (hard-block, backward-compatible): unlike the classes below, these
// never have a replacement — a match is a scan hit like any other (surfaced as
// CONTAMINATED, blocking apply the same way), but the term itself must never be
// silently substituted away in stage 2, since a forbidden term appearing at all
// means the run must be inspected, not auto-cleaned. Shared between scanForDenylist
// (post-substitution, full-denylist scan) and scanForbidden (raw pre-substitution,
// forbidden-only scan — see EP-S2-012 below) so the two never drift out of sync.
// R2-3: forbidden[] is ALWAYS case-insensitive — this is the explicit, single
// policy (not a per-entry option) for this class, because a forbidden term exists
// to catch private-canon content regardless of how it's capitalized; enumerating
// a separate all-caps/all-lowercase entry per term (the pre-R2-3 workaround) is
// weaker than one entry with a real case-insensitive regex — an adversarial probe
// confirmed a fully upper-cased variant of a forbidden term slipped past the old
// case-sensitive term compilation. Explicit-regex entries get 'i' folded in even
// if the author's flags omitted it, for the same reason. Documented in
// denylist-mythos.json's forbidden[] entries. (Note for maintainers: never quote
// an actual forbidden term literally in a comment in this file or its siblings —
// this file itself ships as part of the tools/export-public unit, and the
// composed-tree/per-unit forbidden scans correctly treat a literal quoted
// instance as a real hit, exactly as they should.)
function buildForbiddenChecks(denylist) {
  return (denylist.forbidden || []).map((f) => {
    if (f.regex) {
      const flags = (f.flags || '').replace(/[gi]/g, '') + 'i';
      return { kind: 'forbidden', term: f.description || f.term || f.regex, regex: new RegExp(f.regex, flags) };
    }
    const escaped = f.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { kind: 'forbidden', term: f.description || f.term, regex: new RegExp('\\b' + escaped + '\\b', 'i') };
  });
}

function runChecks(text, checks, relPath) {
  const hits = [];
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    for (const chk of checks) {
      if (chk.regex.test(line)) hits.push({ file: relPath, line: idx + 1, kind: chk.kind, term: chk.term, excerpt: line.trim().slice(0, 120) });
    }
  });
  return hits;
}

function scanForDenylist(text, denylist, relPath) {
  const checks = [];
  // R2-6: same case-insensitive-by-default policy as buildSubstitutions above —
  // the scan must catch exactly what substitution is supposed to have already
  // fixed; a case-sensitive-only scan here would silently trust that substitution
  // caught everything instead of independently re-checking.
  for (const c of denylist.client_codes || []) checks.push({ kind: 'code', term: c.term, regex: c.regex ? new RegExp(c.regex) : new RegExp('\\b' + c.term + '\\b', 'i') });
  for (const d of denylist.domains || []) checks.push({ kind: 'domain', term: d.term, regex: new RegExp(d.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
  for (const i of denylist.identifiers || []) checks.push({ kind: 'identifier', term: i.term, regex: new RegExp(i.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  for (const p of denylist.patterns || []) checks.push({ kind: 'pattern', term: p.description || p.regex, regex: new RegExp(p.regex, (p.flags || '').replace('g', '')) });
  checks.push(...buildForbiddenChecks(denylist));
  return runChecks(text, checks, relPath);
}

// EP-S2-012: forbidden[] must hard-block on the RAW, pre-substitution source text —
// scanning only after substitution (as scanForDenylist alone would) lets an
// overlapping substitution entry (e.g. a broad client-code or pattern rule that
// happens to also match a forbidden term) rewrite the term away before it is ever
// evaluated, silently laundering exactly the content forbidden[] exists to catch.
// This scan runs BEFORE applySubstitutions and its hits are hard, unconditional —
// they are never suppressed by whatever substitution does afterward. The ordinary
// post-substitution scanForDenylist call still runs as before (unchanged) as a
// second, independent check of the staged/placed output.
function scanForbidden(text, denylist, relPath) {
  return runChecks(text, buildForbiddenChecks(denylist), relPath);
}

// ---- stage 5: manifest validation ------------------------------------------------------

const REQUIRED_MANIFEST_KEYS = ['service_category', 'framework_name', 'version', 'prompt_count', 'execution_modes'];

function validateStagedFramework(stagingDir) {
  const problems = [];
  const manifestPath = path.join(stagingDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return ['manifest.json missing from staged output'];
  let manifest;
  try { manifest = loadJson(manifestPath); } catch (e) { return ['manifest.json unparseable: ' + e.message]; }
  for (const key of REQUIRED_MANIFEST_KEYS) {
    if (manifest[key] === undefined) problems.push(`manifest missing required key: ${key}`);
  }
  const promptsDir = path.join(stagingDir, 'prompts');
  if (fs.existsSync(promptsDir)) {
    const promptFiles = fs.readdirSync(promptsDir).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
    if (typeof manifest.prompt_count === 'number' && manifest.prompt_count !== promptFiles.length) {
      problems.push(`prompt_count=${manifest.prompt_count} but staged prompts/=${promptFiles.length}`);
    }
  }
  return problems;
}

// ---- receipts ---------------------------------------------------------------------------

function sourceCommitSha() {
  try { return execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
}

function writeReceipt(result, targetRepo, apply, mapId) {
  const receipt = {
    schema: 'PublicExport/1.0',
    exported_at: new Date().toISOString(),
    // Never an absolute private path (doc-audit 2026-07-20): receipts are committed
    // to the public repo and must not leak private machine layout.
    source_repo: '<private-source-repo>',
    source_commit: sourceCommitSha(),
    map_id: mapId,
    framework: result.framework,
    source_path: result.sourcePath,
    target_path: result.targetPath,
    mode: apply ? 'apply' : 'dry-run',
    files: { exported: result.exported.length, excluded: result.excluded.length, mocked: result.mocked.length },
    substitutions: result.substitutions,
    lint: { denylist_hits: result.lintHits.length, verdict: result.lintHits.length === 0 ? 'CLEAN' : 'CONTAMINATED' },
    validation: { problems: result.validationProblems, verdict: result.validationProblems.length === 0 ? 'PASS' : 'FAIL' },
  };
  receipt.content_hash = crypto.createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
  fs.mkdirSync(RECEIPT_DIR_A, { recursive: true });
  // F7: the previous `.slice(0, 15)` truncated BEFORE milliseconds ever appeared —
  // "20260721T160848911Z".slice(0,15) === "20260721T160848", discarding "911Z"
  // entirely, so two runs in the same second (never mind the same minute) wrote the
  // same path and silently replaced each other's receipt. Keep the full de-punctuated
  // timestamp (through milliseconds) AND append a random per-write run suffix, so
  // even two writes for the same map/framework in the same millisecond (e.g. a tight
  // test loop) still land on distinct filenames — receipts are evidence, and evidence
  // must never overwrite evidence.
  const stamp = receipt.exported_at.replace(/[:.]/g, '');
  const runSuffix = crypto.randomBytes(4).toString('hex');
  // map_id namespaces the receipt filename so parallel maps (e.g. mythos vs mythos)
  // targeting the same private repo never collide on the same framework id + stamp.
  const nameA = path.join(RECEIPT_DIR_A, `public-export__${mapId}__${result.framework.replace(/\//g, '-')}__${stamp}__${runSuffix}.json`);
  fs.writeFileSync(nameA, JSON.stringify(receipt, null, 2) + '\n');
  if (apply) {
    // Public-side receipt NEVER carries the private substitution terms — republishing
    // a stripped term inside the receipt would undo the strip. Kinds + counts + hashes only.
    const publicReceipt = {
      ...receipt,
      source_repo: undefined,
      // Opaque provenance link: private holder can verify by recomputing; public side
      // learns nothing about private commit history or cadence.
      source_commit: undefined,
      source_ref: crypto.createHash('sha256').update(receipt.source_commit + ':' + result.framework).digest('hex').slice(0, 16),
      substitutions: receipt.substitutions.map((s) => ({
        file: s.file,
        applied: s.applied.map((a) => ({ kind: a.kind, count: a.count })),
      })),
    };
    delete publicReceipt.source_repo;
    delete publicReceipt.source_commit;
    publicReceipt.content_hash = crypto.createHash('sha256').update(JSON.stringify({ ...publicReceipt, content_hash: undefined })).digest('hex');
    const receiptDirB = path.join(targetRepo, '.export-receipts');
    fs.mkdirSync(receiptDirB, { recursive: true });
    fs.writeFileSync(path.join(receiptDirB, path.basename(nameA)), JSON.stringify(publicReceipt, null, 2) + '\n');
  }
  return { receipt, receiptPath: nameA };
}

// ---- pipeline ---------------------------------------------------------------------------

function exportFramework(fwId, exportMap, denylist, opts) {
  const entry = exportMap.frameworks[fwId] || (exportMap.units || {})[fwId];
  if (!entry) throw new Error(`unit not in export map (private-by-default): ${fwId}`);
  const sourceDir = path.join(REPO_ROOT, entry.source);
  if (!fs.existsSync(sourceDir)) throw new Error(`source missing: ${entry.source}`);
  assertContained(sourceDir, REPO_ROOT, `unit ${fwId} source`);
  const subs = buildSubstitutions(denylist);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'export-public-'));

  // MDS-D4 (membrane amendment): a unit whose target lands under _dev/ ships
  // already-authored, already-genericized workshop content — there is nothing
  // legitimate left to substitute. For these units the private-signature
  // classes (client codes, private hostnames, forbidden world-canon terms, and
  // the private dispatch schema family covered by denylist-mythos.json's
  // forbidden[] entries) are a RAW pre-substitution hard-fail, exactly like
  // forbidden[], instead of the ordinary substitute-and-pass mechanism every
  // other lane uses: a contaminated _dev source must never be sanitized into
  // passing. Non-_dev lanes are completely unaffected by this flag. (Maintainer
  // note: never spell the private schema family's literal name out in a
  // comment in this file — see denylist-mythos.json's forbidden[] entries for
  // why it lives as data, not code, here.)
  const isDevLane = entry.target === '_dev' || entry.target.startsWith('_dev/');

  // Directory-level pruning (EP-S2-011): never descend into a subtree the map
  // wholesale-excludes, so a symlink deep inside it (e.g. a checked-in
  // node_modules) can't trip the symlink refusal. Mock targets stay reachable
  // even under an excluded directory (see walk()'s doc comment).
  const allFiles = walk(sourceDir, sourceDir, entry.files.exclude, Object.keys(entry.files.mock || {}));
  const exported = [];
  const excluded = [];
  const mocked = [];
  const substitutions = [];
  // EP-S2-012: raw pre-substitution forbidden[] hits, collected while source text is
  // still in hand — kept separate from the stage-4 scan so a hit here is never
  // conditional on what substitution does to the same text afterward.
  const rawForbiddenHits = [];

  for (const rel of allFiles) {
    // mock is the most specific class — it wins over exclude globs
    const mockSpec = (entry.files.mock || {})[rel];
    const mockRel = typeof mockSpec === 'string' ? mockSpec : mockSpec && mockSpec.source;
    const mockTargetRel = typeof mockSpec === 'object' && mockSpec.target ? mockSpec.target : rel;
    if (!mockRel && matchesAny(rel, entry.files.exclude)) { excluded.push(rel); continue; }
    if (mockRel) {
      const mockSrc = path.join(MOCKS_DIR, fwId.replace(/\//g, '__'), mockRel);
      if (!fs.existsSync(mockSrc)) throw new Error(`declared mock missing: ${mockSrc} (for ${rel})`);
      assertContained(mockSrc, MOCKS_DIR, `unit ${fwId} mock ${mockRel}`);
      // R2-3: a forbidden token can ship as a PATH even when file content is clean
      // (an adversarial probe confirmed a file simply NAMED after a forbidden term
      // slipped past every content-only scan) — check the relative path/filename itself.
      rawForbiddenHits.push(...scanForbidden(rel, denylist, rel));
      // MDS-D4: for a _dev-lane unit, the path/filename itself is also checked
      // against the full private-signature class set (not just forbidden[]),
      // for the same reason as the content check below.
      if (isDevLane) rawForbiddenHits.push(...scanForDenylist(rel, denylist, rel));
      const dest = path.join(staging, mockTargetRel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // R2-6 (mock-bypass mechanic): mocks used to copy verbatim, meaning
      // substitution never ran on them at all — a mock authored against one map
      // (or hand-written without full substitution in mind) could ship an
      // unsubstituted denylist token, caught only by the stage-4 scan AFTER the
      // fact (the sibling had to hand-fix 8 CONTAMINATED units this way). Running
      // the same substitution pipeline on mock content on copy closes this by
      // construction: a mock can still hard-block on a forbidden term (raw-scanned
      // below, same as plain-export files), but an ordinary denylist token is
      // substituted automatically instead of requiring hand-maintenance.
      // R3-1: inspectFile is the shared byte/encoding-aware primitive — it
      // decodes BOM'd UTF-16 text correctly, byte-scans binary content for
      // forbidden terms, and hard-blocks (never silently skips) text that is
      // neither BOM-marked nor valid UTF-8.
      {
        const inspected = inspectFile(mockSrc, rel, denylist);
        rawForbiddenHits.push(...inspected.hits);
        if (inspected.text !== null) {
          if (isDevLane) {
            // MDS-D4: raw pre-substitution hard-fail on the full private-signature
            // class set — a contaminated _dev source must never be sanitized into
            // passing, so it is never handed to applySubstitutions at all.
            rawForbiddenHits.push(...scanForDenylist(inspected.text, denylist, rel));
            fs.writeFileSync(dest, inspected.text);
          } else {
            // EP-S2-012: forbidden[] must be checked on the RAW (pre-substitution)
            // decoded text — inspectFile's own `hits` only cover binary/undecodable
            // cases, so the ordinary raw-forbidden scan still runs here explicitly.
            rawForbiddenHits.push(...scanForbidden(inspected.text, denylist, rel));
            const { text, applied } = applySubstitutions(inspected.text, subs);
            fs.writeFileSync(dest, text);
            if (applied.length) substitutions.push({ file: rel, applied });
          }
        } else {
          fs.copyFileSync(mockSrc, dest);
        }
      }
      fs.chmodSync(dest, fs.statSync(mockSrc).mode & 0o777);
      mocked.push(mockTargetRel);
      continue;
    }
    if (!matchesAny(rel, entry.files.export)) { excluded.push(rel); continue; }
    // R2-3: path/filename scan (see comment above) applies to plain-export files too.
    rawForbiddenHits.push(...scanForbidden(rel, denylist, rel));
    // MDS-D4: see the matching comment in the mock lane above — a _dev-lane
    // path/filename is checked against the full private-signature class set.
    if (isDevLane) rawForbiddenHits.push(...scanForDenylist(rel, denylist, rel));
    const src = path.join(sourceDir, rel);
    const dest = path.join(staging, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    {
      const inspected = inspectFile(src, rel, denylist);
      rawForbiddenHits.push(...inspected.hits);
      if (inspected.text !== null) {
        if (isDevLane) {
          // MDS-D4: raw pre-substitution hard-fail — see the mock-lane comment
          // above. Never handed to applySubstitutions.
          rawForbiddenHits.push(...scanForDenylist(inspected.text, denylist, rel));
          fs.writeFileSync(dest, inspected.text);
        } else {
          // EP-S2-012: same raw-forbidden scan on the decoded text, before substitution.
          rawForbiddenHits.push(...scanForbidden(inspected.text, denylist, rel));
          const { text, applied } = applySubstitutions(inspected.text, subs);
          fs.writeFileSync(dest, text);
          if (applied.length) substitutions.push({ file: rel, applied });
        }
      } else {
        fs.copyFileSync(src, dest);
      }
    }
    fs.chmodSync(dest, fs.statSync(src).mode & 0o777);
    exported.push(rel);
  }

  // stage 4 — independent scan of staged output, PLUS the raw pre-substitution
  // forbidden hits gathered above (EP-S2-012). A raw hit hard-blocks even if the
  // staged/substituted text no longer contains it. R3-1: every staged file goes
  // through inspectFile too — binary-classified staged files are now byte-scanned
  // (previously silently skipped entirely) and an undecodable staged text file
  // blocks rather than vanishing from the scan.
  const lintHits = [...rawForbiddenHits];
  for (const rel of walk(staging)) {
    const p = path.join(staging, rel);
    const inspected = inspectFile(p, rel, denylist);
    lintHits.push(...inspected.hits);
    if (inspected.text !== null) lintHits.push(...scanForDenylist(inspected.text, denylist, rel));
  }

  // stage 5 — manifest validation applies to framework units; tool/doc units opt out
  const validationProblems = entry.validate === 'none' ? [] : validateStagedFramework(staging);

  const result = {
    framework: fwId,
    sourcePath: entry.source,
    targetPath: entry.target,
    staging,
    exported, excluded, mocked, substitutions, lintHits, validationProblems,
    ok: lintHits.length === 0 && validationProblems.length === 0,
  };
  return result;
}

// ---- stage 6: batch preflight (before ANY target write) --------------------------------

// Fail-closed (EP-S2-006): a git error is a result, not a shrug. Callers must
// distinguish "command failed" from "empty output" — a failed status check must
// never read as a clean tree.
function gitInDir(cwd, cmd) {
  try {
    return { ok: true, out: execSync('git ' + cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    return { ok: false, error: ((e.stderr && String(e.stderr)) || e.message).trim().split('\n')[0] };
  }
}

const RESERVED_SUFFIXES = ['.export-incoming', '.export-backup'];

/**
 * Batch-level preflight. Returns a frozen plan { __preflightPlan, ok, problems,
 * targets, overwrites }. Never writes. All staged results must be clean; the target
 * repo must exist, be a git work tree, match the map-declared remote/branch when
 * present, have a clean tree (unless allowDirty; git errors fail closed), have no
 * reserved recovery siblings in the way (EP-S2-004), and existing non-empty target
 * dirs require force. `overwrites` lists exactly which targets --force authorizes
 * for this invocation (EP-S2-007: force is whole-invocation consent, and the
 * consented set is explicit in the plan).
 */
function preflightApply(results, exportMap, targetRepo, opts) {
  const problems = [];
  const targets = results.map((r) => r.targetPath);
  const overwrites = [];
  for (const r of results) {
    if (r.error) problems.push(`unit ${r.framework}: staging error: ${r.error}`);
    else if (!r.ok) problems.push(`unit ${r.framework}: staged output not clean (lint_hits=${r.lintHits.length}, validation=${r.validationProblems.length})`);
  }
  const canonicalTargets = [];
  if (!fs.existsSync(targetRepo)) problems.push('target repo missing: ' + targetRepo);
  else {
    const inside = gitInDir(targetRepo, 'rev-parse --is-inside-work-tree');
    if (!inside.ok || inside.out !== 'true') problems.push('target repo is not a verifiable git work tree (fail-closed): ' + targetRepo + (inside.ok ? '' : ' — ' + inside.error));
    else {
      if (exportMap.target_remote) {
        const url = gitInDir(targetRepo, 'remote get-url origin');
        if (!url.ok) problems.push('target remote check failed (fail-closed): ' + url.error);
        else if (url.out !== exportMap.target_remote) problems.push(`target origin mismatch: expected ${exportMap.target_remote}, found ${url.out}`);
      }
      if (exportMap.target_branch) {
        const branch = gitInDir(targetRepo, 'rev-parse --abbrev-ref HEAD');
        if (!branch.ok) problems.push('target branch check failed (fail-closed): ' + branch.error);
        else if (branch.out !== exportMap.target_branch) problems.push(`target branch mismatch: expected ${exportMap.target_branch}, found ${branch.out}`);
      }
      const dirty = gitInDir(targetRepo, 'status --porcelain');
      if (!dirty.ok) problems.push('target dirty-tree check failed (fail-closed): ' + dirty.error);
      else if (dirty.out && !opts.allowDirty) problems.push('target repo tree is dirty (commit/stash first, or pass --allow-dirty):\n' + dirty.out.split('\n').slice(0, 5).map((l) => '      ' + l).join('\n'));
    }
    const repoReal = fs.realpathSync(targetRepo);
    const resolvedTargets = [];
    for (const r of results) {
      if (r.error || !r.ok) continue;
      // Write-target containment (EP-S2-002 round 2): refuse absolute or
      // traversing targets before ANY other target inspection.
      let targetDir;
      try {
        targetDir = resolveTargetPath(repoReal, r.targetPath);
      } catch (e) {
        problems.push(`unit ${r.framework}: ${e.message}`);
        continue;
      }
      resolvedTargets.push({ framework: r.framework, targetPath: r.targetPath, targetDir });
      canonicalTargets.push(targetDir);
      // Reserved recovery siblings (EP-S2-004): never silently deleted. Owned
      // leftovers mean an interrupted export needs human inspection; unowned
      // paths are somebody else's data and we refuse to touch them. A marker-only
      // orphan is ALSO recovery evidence — overwriting it would erase the record
      // of an interrupted run.
      for (const suffix of RESERVED_SUFFIXES) {
        const reserved = targetDir + suffix;
        const marker = reserved + '.owner';
        if (fs.existsSync(reserved)) {
          if (fs.existsSync(marker)) {
            problems.push(`leftover recovery path from an interrupted export: ${r.targetPath}${suffix} — inspect it, restore/remove manually (with its .owner marker), then re-run`);
          } else {
            problems.push(`unowned reserved path in the way: ${r.targetPath}${suffix} (no .owner marker — not created by export-public; refusing)`);
          }
        } else if (fs.existsSync(marker)) {
          problems.push(`orphan recovery marker in the way: ${r.targetPath}${suffix}.owner (evidence of an interrupted export — inspect and remove manually, then re-run)`);
        }
      }
      if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
        if (!opts.force) problems.push(`target exists: ${r.targetPath} (overwrite requires --force)`);
        else overwrites.push(r.targetPath);
      }
    }
    // Canonical destination collisions (EP-S2-009): two configured target strings
    // that resolve to the same destination — or nest inside one another — must be
    // rejected here, before any plan is issued, not discovered mid-apply by the
    // exclusive marker.
    for (let i = 0; i < resolvedTargets.length; i += 1) {
      for (let j = i + 1; j < resolvedTargets.length; j += 1) {
        const a = resolvedTargets[i];
        const b = resolvedTargets[j];
        if (a.targetDir === b.targetDir) {
          problems.push(`duplicate resolved target: units ${a.framework} and ${b.framework} both resolve to ${a.targetDir} (${a.targetPath} vs ${b.targetPath})`);
        } else if (a.targetDir.startsWith(b.targetDir + path.sep) || b.targetDir.startsWith(a.targetDir + path.sep)) {
          problems.push(`overlapping targets: unit ${a.framework} (${a.targetPath}) and unit ${b.framework} (${b.targetPath}) nest inside one another`);
        }
      }
    }
  }
  const ok = problems.length === 0;
  const plan = Object.freeze({
    __preflightPlan: true,
    ok,
    problems,
    targets: Object.freeze([...targets]),
    overwrites: Object.freeze(overwrites),
    // Binding (EP-S2-006 round 2): the plan authorizes exactly this repo and
    // exactly this staged content — reuse against another repo or after staging
    // changed is refused at apply time.
    repoReal: ok ? fs.realpathSync(targetRepo) : null,
    resultsDigest: ok ? digestResults(results) : null,
    // EP-S2-009: the plan is bound to the canonical resolved destinations it
    // authorized; apply re-derives each target and refuses any not in this set.
    canonicalTargets: Object.freeze([...canonicalTargets]),
  });
  if (ok) ISSUED_PLANS.add(plan);
  return plan;
}

// ---- stage 7: atomic per-target replacement with whole-batch rollback ------------------

function copyTree(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const rel of walk(srcDir)) {
    const dest = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const source = path.join(srcDir, rel);
    fs.copyFileSync(source, dest);
    fs.chmodSync(dest, fs.statSync(source).mode & 0o777);
  }
}

/**
 * Apply every clean staged result to the target repo. Requires the successful
 * preflight plan (EP-S2-006: applyBatch cannot be invoked without preflight
 * evidence, and every applied target must be in the plan's target set).
 *
 * Per-target transaction, recorded in a ledger BEFORE each destructive step
 * (EP-S2-003): copy staging to <target>.export-incoming (owner marker written as a
 * sibling first, EP-S2-004), record backup intent, rename existing target aside to
 * <target>.export-backup, rename incoming into place. If ANY step fails, the ledger
 * is unwound in reverse: swapped targets are restored from their backups (a target
 * whose backup is missing is NEVER deleted — EP-S2-001), aside-phase targets are
 * renamed back, and only paths created by this run are cleaned. Per-target rollback
 * failures are returned explicitly, never swallowed.
 *
 * On success, backup cleanup runs as a SEPARATE post-commit pass that can never
 * enter the rollback path (EP-S2-001): a cleanup failure is a warning on a
 * successful apply, not a trigger for destroying committed replacements.
 *
 * Test-only fault injection: opts.__injectFailAfter (after a completed swap),
 * opts.__injectFailBetweenRenames (inside the aside->in-place window),
 * opts.__injectCleanupFail (during post-commit backup cleanup).
 */
function applyBatch(results, targetRepo, plan, opts = {}) {
  if (!plan || plan.__preflightPlan !== true || plan.ok !== true) {
    throw new Error('applyBatch requires a successful preflight plan (run preflightApply first)');
  }
  // Authenticity by identity, not shape (EP-S2-006 round 2): a structurally
  // identical object forged by a caller was never issued by preflightApply.
  if (!ISSUED_PLANS.has(plan)) {
    throw new Error('preflight plan was not issued by preflightApply (forged or deserialized plan refused)');
  }
  // Repo binding: the plan authorizes writes to exactly the repo it was checked
  // against — never a different directory that happens to share target paths.
  const repoReal = fs.realpathSync(targetRepo);
  if (repoReal !== plan.repoReal) {
    throw new Error('preflight plan repo binding mismatch: plan authorizes ' + plan.repoReal + ', apply requested ' + repoReal);
  }
  const runId = new Date().toISOString() + ' pid=' + process.pid;
  const ledger = []; // { framework, targetDir, incoming, backup|null, phase: init|staged|aside|swapped }
  const rollbackFailures = [];
  try {
    // Result binding: staged content must be byte-identical to what preflight
    // authorized. Digest covers only plan-covered results so an extra target
    // still falls through to the explicit not-in-plan refusal below.
    const covered = results.filter((r) => !r.error && r.ok && plan.targets.includes(r.targetPath));
    if (digestResults(covered) !== plan.resultsDigest) {
      throw new Error('staged results changed since preflight (digest mismatch) — re-run preflightApply');
    }
    for (const r of results) {
      if (r.error || !r.ok) continue;
      if (!plan.targets.includes(r.targetPath)) throw new Error('target not in preflight plan: ' + r.targetPath);
      const targetDir = resolveTargetPath(plan.repoReal, r.targetPath); // containment re-checked at write time
      // EP-S2-009 round 4: the frozen canonical set is an enforcement input, not
      // documentation — a destination that re-resolves differently at apply time
      // (e.g. a symlink created after preflight) was never authorized.
      if (!plan.canonicalTargets.includes(targetDir)) {
        throw new Error('target destination not in preflight plan canonical set: ' + r.targetPath + ' -> ' + targetDir);
      }
      const tx = { framework: r.framework, targetDir, incoming: targetDir + '.export-incoming', backup: null, phase: 'init' };
      ledger.push(tx); // intent recorded before any write
      fs.mkdirSync(path.dirname(targetDir), { recursive: true });
      // Exclusive creation (EP-S2-004 round 2): markers are protected recovery
      // state; if one already exists we must not overwrite that evidence.
      fs.writeFileSync(tx.incoming + '.owner', runId + '\n', { flag: 'wx' });
      copyTree(r.staging, tx.incoming);
      tx.phase = 'staged';
      if (fs.existsSync(targetDir)) {
        const backup = targetDir + '.export-backup';
        fs.writeFileSync(backup + '.owner', runId + '\n', { flag: 'wx' });
        tx.backup = backup; // intent recorded BEFORE the destructive rename
        fs.renameSync(targetDir, backup);
        tx.phase = 'aside';
      }
      if (opts.__injectFailBetweenRenames === r.framework) throw new Error('injected failure between renames for ' + r.framework);
      fs.renameSync(tx.incoming, targetDir);
      tx.phase = 'swapped';
      if (opts.__injectFailAfter === r.framework) throw new Error('injected failure after ' + r.framework);
      r.written = true;
    }
  } catch (e) {
    for (const tx of [...ledger].reverse()) {
      try {
        if (tx.phase === 'swapped') {
          if (tx.backup) {
            if (fs.existsSync(tx.backup)) {
              fs.rmSync(tx.targetDir, { recursive: true, force: true });
              fs.renameSync(tx.backup, tx.targetDir);
            } else {
              // EP-S2-001: without a backup there is nothing to restore FROM —
              // deleting the current target here would destroy the only copy.
              rollbackFailures.push(tx.targetDir + ': backup missing; new content left in place, NOT restored');
            }
          } else {
            fs.rmSync(tx.targetDir, { recursive: true, force: true }); // did not exist before this run
          }
        } else if (tx.phase === 'aside' && tx.backup && fs.existsSync(tx.backup)) {
          fs.renameSync(tx.backup, tx.targetDir); // crash window between renames: put the original back
        }
        fs.rmSync(tx.incoming, { recursive: true, force: true });
        fs.rmSync(tx.incoming + '.owner', { force: true });
        if (tx.backup && !fs.existsSync(tx.backup)) fs.rmSync(tx.backup + '.owner', { force: true });
      } catch (re) {
        rollbackFailures.push(tx.targetDir + ': rollback error: ' + re.message);
      }
    }
    for (const r of results) r.written = false;
    return {
      ok: false, applied: 0, error: e.message,
      rolledBack: ledger.filter((t) => t.phase === 'swapped' || t.phase === 'aside').length,
      rollbackFailures,
    };
  }
  // Post-commit cleanup: separate pass, never enters rollback (EP-S2-001).
  const cleanupWarnings = [];
  for (const tx of ledger) {
    try {
      if (opts.__injectCleanupFail === tx.framework) throw new Error('injected cleanup failure for ' + tx.framework);
      if (tx.backup) { fs.rmSync(tx.backup, { recursive: true, force: true }); fs.rmSync(tx.backup + '.owner', { force: true }); }
      fs.rmSync(tx.incoming + '.owner', { force: true });
    } catch (ce) {
      cleanupWarnings.push(tx.targetDir + ': cleanup warning (apply still succeeded): ' + ce.message);
    }
  }
  return { ok: true, applied: ledger.filter((t) => t.phase === 'swapped').length, cleanupWarnings };
}

function finishUnit(result, targetRepo, applied, mapId) {
  const { receiptPath } = writeReceipt(result, targetRepo, applied && result.ok && result.written === true, mapId);
  result.receiptPath = receiptPath;
  if (appendReceipt) {
    try {
      appendReceipt({
        tool: 'export-public',
        decision: applied ? (result.written ? 'apply' : 'refused') : 'dry-run',
        target: result.framework,
        verification: `lint_hits=${result.lintHits.length} validation_problems=${result.validationProblems.length}`,
        outcome: result.ok ? 'clean' : 'blocked',
      });
    } catch { /* receipts must never break the export */ }
  }
  if (result.staging) { fs.rmSync(result.staging, { recursive: true, force: true }); result.staging = null; }
}

// ---- CLI --------------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const force = args.includes('--force');
  const allowDirty = args.includes('--allow-dirty');
  const json = args.includes('--json');
  const fwArgs = optionValues(args, '--framework');
  const mapArg = args.includes('--map') ? args[args.indexOf('--map') + 1] : null;
  const denylistArg = args.includes('--denylist') ? args[args.indexOf('--denylist') + 1] : null;

  if (fs.existsSync(KILL_SWITCH)) {
    console.log('export-public: kill-switch present (' + KILL_SWITCH + '), exiting.');
    process.exit(0);
  }
  // Paths are resolved relative to CONFIG_DIR unless absolute, so callers can pass
  // either a bare filename (the common case) or a full path. Defaults are the
  // original hardcoded filenames — byte-identical behavior when neither flag is passed.
  const mapPath = path.isAbsolute(mapArg || '') ? mapArg : path.join(CONFIG_DIR, mapArg || 'framework-export-map.json');
  const denylistPath = path.isAbsolute(denylistArg || '') ? denylistArg : path.join(CONFIG_DIR, denylistArg || 'denylist.json');
  const exportMap = loadJson(mapPath);
  const denylist = loadJson(denylistPath);
  // map_id namespaces receipts (e.g. mythos vs mythos exporting from the same
  // private repo): basename of the map file, extension stripped.
  const mapId = path.basename(mapPath).replace(/\.json$/, '');
  const targetRepo = exportMap.target_repo.replace(/^~/, os.homedir());
  const ids = fwArgs.length ? fwArgs : [...Object.keys(exportMap.frameworks), ...Object.keys(exportMap.units || {})];

  // stages 1-5: stage every unit (no target writes)
  const results = [];
  let failed = false;
  for (const id of ids) {
    try {
      results.push(exportFramework(id, exportMap, denylist, {}));
    } catch (e) {
      failed = true;
      results.push({ framework: id, error: e.message, exported: [], excluded: [], mocked: [], substitutions: [], lintHits: [], validationProblems: [], ok: false });
      if (!json) console.error(`[${id}] ERROR ${e.message}`);
    }
  }
  if (results.some((r) => !r.ok)) failed = true;

  // stage 6: preflight gate — apply refuses to touch ANY target unless the whole batch clears
  let applied = false;
  if (apply) {
    const pre = preflightApply(results, exportMap, targetRepo, { force, allowDirty });
    if (!json) {
      console.log('\npreflight target set (' + pre.targets.length + ' unit(s) -> ' + targetRepo + '):');
      // --force is whole-invocation consent (EP-S2-007); the exact overwrite set it
      // authorizes is printed so that consent is never broader than what is visible.
      for (const t of pre.targets) console.log('  - ' + t + (pre.overwrites.includes(t) ? '  [overwrite authorized by --force]' : ''));
    }
    if (!pre.ok) {
      failed = true;
      for (const p of pre.problems) console.error('PREFLIGHT ' + p);
      if (!json) console.error('export-public: preflight failed — no target writes performed.');
    } else {
      // stage 7: atomic batch apply with rollback, bound to the preflight plan
      const batch = applyBatch(results, targetRepo, pre, {});
      if (!batch.ok) {
        failed = true;
        console.error(`APPLY FAILED: ${batch.error} — rolled back ${batch.rolledBack} swap(s).`);
        if (batch.rollbackFailures && batch.rollbackFailures.length) {
          for (const rf of batch.rollbackFailures) console.error('ROLLBACK FAILURE ' + rf);
          console.error('export-public: rollback INCOMPLETE — inspect the paths above before re-running.');
        } else {
          console.error('export-public: all targets restored.');
        }
      } else {
        applied = true;
        for (const w of batch.cleanupWarnings || []) console.error('CLEANUP WARNING ' + w);
      }
    }
  }

  for (const r of results) {
    if (r.error) continue;
    finishUnit(r, targetRepo, applied, mapId);
    if (!json) {
      console.log(`\n[${r.framework}] ${r.ok ? 'CLEAN' : 'BLOCKED'} — exported=${r.exported.length} excluded=${r.excluded.length} mocked=${r.mocked.length} subs=${r.substitutions.length} lint_hits=${r.lintHits.length} validation=${r.validationProblems.length === 0 ? 'PASS' : 'FAIL'}${r.written ? ' -> WRITTEN to ' + r.targetPath : apply ? '' : ' (dry-run)'}`);
      for (const h of r.lintHits.slice(0, 10)) console.log(`    CONTAMINATION ${h.file}:${h.line} [${h.kind}] ${h.term} :: ${h.excerpt}`);
      for (const p of r.validationProblems) console.log(`    VALIDATION ${p}`);
      console.log(`    receipt: ${path.relative(REPO_ROOT, r.receiptPath)}`);
    }
  }
  if (json) console.log(JSON.stringify({ apply, applied, results: results.map(({ staging, ...r }) => r) }, null, 2));
  process.exitCode = failed ? 1 : 0;
}

if (require.main === module) main();
module.exports = {
  buildSubstitutions, applySubstitutions, scanForDenylist, scanForbidden, validateStagedFramework,
  exportFramework, preflightApply, applyBatch, globToRegex, walk, assertContained, resolveTargetPath,
  REQUIRED_MANIFEST_KEYS, isTextFile, decodeTextBuffer, scanBinaryForForbidden, inspectFile,
  EXTENSIONLESS_TEXT_BASENAMES,
  optionValues,
};
