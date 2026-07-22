#!/usr/bin/env node
'use strict';
/**
 * publish-framework — one command to take a framework a user has added and make it
 * safely publishable: SCAN for publish-blockers, CLASSIFY them, (with --apply)
 * auto-scrub the safe class, wire the unit into the export map, then hand off to the
 * hardened export-public pipeline for the actual denylist-strip + atomic export +
 * clean-clone smoke.
 *
 *   npm run publish-framework -- <framework-path> [--apply] [--json]
 *
 * WITHOUT --apply: a safe dry report (scan + classify + "what would happen"). Never
 * mutates the framework source, the export map, or any public target — it only writes
 * analysis reports under _dev/reports/analysis/publish-framework/. WITH --apply: after
 * a clean scan, applies the mechanical auto-scrubs, wires the map, and runs the real
 * export (which itself is atomic + receipted + smoked).
 *
 * This tool deliberately does NOT reimplement export, denylist substitution, or the
 * atomic write — it composes with tools/export-public (the hardened pipeline). Its
 * added value is the pre-flight human-safety triage for the categories the denylist
 * does not cover (credentials, absolute paths, op:// refs, operator names/hosts,
 * real-env/state mock candidates, and unrecognized binary/encoded files) and turning
 * "add a framework, clean it, ship it" into a single guided command.
 *
 * FAIL-CLOSED POSTURE: this is a private->public boundary. A false negative (letting
 * contamination through) is the critical bug class, so:
 *   - every file is scanned as decoded text regardless of extension (UTF-8/UTF-16);
 *   - a file that cannot be decoded as text is BLOCKED as an unrecognized binary for a
 *     human to confirm, never copied verbatim unseen;
 *   - a real .env/credential/state file (a "mock candidate") BLOCKS unless the operator
 *     has already wired a sanitized mock/exclude for it in the export map;
 *   - blockers are evaluated BEFORE any source mutation, and the export map is only ever
 *     written under --apply.
 *
 * Verdict: PUBLISH-READY (nothing needs a human, export dry/real is CLEAN, smoke
 * passes) or BLOCKED (exact human-resolve items listed). Exit 0 only when ready.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ep = require('../export-public/export-public.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EXPORT_DIR = path.join(REPO_ROOT, 'tools', 'export-public');
const CONFIG_DIR = path.join(EXPORT_DIR, 'config');
const MOCKS_DIR = path.join(EXPORT_DIR, 'mocks');
const MAP_PATH = path.join(CONFIG_DIR, 'framework-export-map.json');
const DENYLIST_PATH = path.join(CONFIG_DIR, 'denylist.json');
const SCAN_CONFIG_PATH = path.join(__dirname, 'scan-config.json');
const REPORT_DIR = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'publish-framework');

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// --- fail-closed file classification (PF-002) ------------------------------------------
// Every exported file is scanned. We decode UTF-8 and UTF-16 (BOM and heuristic, LE/BE)
// to text; anything that cannot be decoded as mostly-printable text is a BINARY file that
// a human must confirm carries no private data — it is never copied verbatim unseen. A
// framework author can allowlist known-safe binary shapes via scan-config binary_allowlist
// globs, but the default is BLOCK.

function countNul(buf) { let n = 0; for (let i = 0; i < buf.length; i++) if (buf[i] === 0) n++; return n; }

// A parity of 0 means NULs land on even byte indices (UTF-16BE ascii text); 1 means odd
// indices (UTF-16LE ascii text). We accept when the vast majority at that parity are NUL.
function looksUtf16(buf, nulParity) {
  let nulAtParity = 0, total = 0;
  const len = buf.length - (buf.length % 2);
  for (let i = 0; i < len; i++) { if (i % 2 === nulParity) { total++; if (buf[i] === 0) nulAtParity++; } }
  return total > 0 && nulAtParity / total > 0.7;
}

// Strict UTF-8 validation (PF-002). Node's Buffer.toString('utf8') is non-fatal: it
// silently replaces malformed sequences with U+FFFD, so invalid bytes read as "text".
// TextDecoder with { fatal: true } throws on any malformed sequence, so a file that is
// not valid UTF-8 is rejected here and (unless it decodes as UTF-16) blocks as binary.
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });
function isValidUtf8(buf) {
  try { STRICT_UTF8.decode(buf); return true; } catch { return false; }
}

// Printability check over DECODED code points (not raw bytes). A file can be valid UTF-8
// yet still be binary-ish (mostly C0 control characters); those block. We do NOT count
// every high byte as printable — that was the PF-002 false-negative. Non-control Unicode
// (letters, marks, punctuation, emoji, CJK, etc.) is printable; NUL and other C0/C1
// control codes other than tab/newline/CR are not.
function isMostlyPrintableText(text) {
  const n = Math.min(text.length, 8192);
  if (n === 0) return true;
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127 && !(c >= 0x80 && c <= 0x9f))) printable++;
  }
  return printable / n > 0.85;
}

// Decode a file to text, reporting the detected encoding. binary:true means "could not be
// read as text — block for human review". Never throws on content; throws only on IO.
function decodeFileText(full) {
  const buf = fs.readFileSync(full);
  if (buf.length === 0) return { text: '', encoding: 'empty', binary: false };
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return { text: buf.slice(2).toString('utf16le'), encoding: 'utf-16le', binary: false };
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    const swapped = Buffer.from(buf.slice(2)); swapped.swap16();
    return { text: swapped.toString('utf16le'), encoding: 'utf-16be', binary: false };
  }
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return { text: buf.slice(3).toString('utf8'), encoding: 'utf-8-bom', binary: false };
  }
  if (countNul(buf) > 0) {
    if (looksUtf16(buf, 1)) return { text: buf.toString('utf16le'), encoding: 'utf-16le-nobom', binary: false };
    if (looksUtf16(buf, 0)) { const s = Buffer.from(buf); s.swap16(); return { text: s.toString('utf16le'), encoding: 'utf-16be-nobom', binary: false }; }
    return { text: null, encoding: 'binary', binary: true }; // NULs but not clean UTF-16
  }
  // No NULs: must be strictly-valid UTF-8 AND mostly printable, or it BLOCKS as binary
  // (PF-002). Invalid UTF-8 bytes above ASCII are no longer silently accepted as "text".
  if (!isValidUtf8(buf)) return { text: null, encoding: 'binary', binary: true };
  const text = buf.toString('utf8');
  if (isMostlyPrintableText(text)) return { text, encoding: 'utf-8', binary: false };
  return { text: null, encoding: 'binary', binary: true };
}

function encodeText(text, encoding) {
  switch (encoding) {
    case 'utf-16le': return Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]);
    case 'utf-16le-nobom': return Buffer.from(text, 'utf16le');
    case 'utf-16be': { const b = Buffer.from(text, 'utf16le'); b.swap16(); return Buffer.concat([Buffer.from([0xFE, 0xFF]), b]); }
    case 'utf-16be-nobom': { const b = Buffer.from(text, 'utf16le'); b.swap16(); return b; }
    case 'utf-8-bom': return Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
    default: return Buffer.from(text, 'utf8');
  }
}

const matchesGlob = (rel, globs) => (globs || []).some((g) => ep.globToRegex(g).test(rel));

// --- extra scan categories the DENYLIST does not cover ---------------------------------
// Structural, operator-agnostic patterns are baked in; operator-specific names/hosts
// come from an optional scan-config.json (NOT shipped to the public tree). Each entry
// declares how a hit should be classified:
//   auto-scrub   — mechanical, safe to rewrite under --apply (absolute home paths)
//   needs-human  — a person must confirm removal (credentials, secrets, op:// refs)

// A value is a placeholder only when the VALUE AS A WHOLE is a placeholder shape — never
// merely because it contains a substring like "example". `secret_example_9f8a...` is a
// real secret that happens to contain "example", so it must NOT be suppressed (PF-003).
function isPlaceholderValue(raw) {
  const v = String(raw).trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!v) return true;
  if (/^x{4,}$/i.test(v)) return true;                       // xxxxxxxx
  if (/^<[^>]+>$/.test(v)) return true;                      // <your-key>
  if (/^\{\{?[^}]+\}?\}$/.test(v)) return true;              // {API_KEY} / {{API_KEY}}
  if (/^\$\{[^}]+\}$/.test(v)) return true;                  // ${API_KEY}
  if (/^(your|my|the|some)[-_ ]/i.test(v)) return true;      // your-key-here
  if (/-(here|goes[-_]here)$/i.test(v)) return true;         // key-here
  if (/^(placeholder|changeme|change[-_]me|example|redacted|todo|tbd|none|null|nil|false|true|xxx+|\.\.\.|fixme)$/i.test(v)) return true;
  if (/^\.\.\.+$/.test(v)) return true;
  return false;
}

// Shannon-entropy gate for unquoted assignments so ordinary config values (paths, words,
// numbers) don't read as secrets, but real high-entropy key material does.
function shannonEntropy(s) {
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  let e = 0;
  for (const k in freq) { const p = freq[k] / s.length; e -= p * Math.log2(p); }
  return e;
}
function looksHighEntropy(v) {
  const s = String(v).replace(/^["'`]+|["'`]+$/g, '');
  if (s.length < 16) return false;
  const classes = (/[a-z]/.test(s) ? 1 : 0) + (/[A-Z]/.test(s) ? 1 : 0) + (/[0-9]/.test(s) ? 1 : 0) + (/[^A-Za-z0-9]/.test(s) ? 1 : 0);
  return shannonEntropy(s) >= 3.0 && (classes >= 2 || /^[A-Fa-f0-9]{20,}$/.test(s));
}

function extraCategories(scanConfig) {
  const cats = [
    { id: 'absolute-home-path', klass: 'auto-scrub', regex: /\/Users\/[A-Za-z0-9._-]+(?=[/\s"'`)]|$)/g,
      scrub: (m) => '~', note: 'absolute macOS home path -> ~' },
    { id: 'op-ref', klass: 'needs-human', regex: /op:\/\/[^\s"'`)]+/g, note: '1Password secret reference' },
    { id: 'private-key-block', klass: 'needs-human', regex: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g, note: 'embedded private key' },
    // Modern OpenAI shapes include project/service prefixes with internal hyphens
    // (sk-proj-..., sk-svcacct-...); allow hyphen/underscore in the body (PF-003).
    { id: 'openai-key', klass: 'needs-human', regex: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,}\b/g, note: 'OpenAI-style API key' },
    { id: 'anthropic-key', klass: 'needs-human', regex: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, note: 'Anthropic API key' },
    { id: 'perplexity-key', klass: 'needs-human', regex: /\bpplx-[A-Za-z0-9]{20,}\b/g, note: 'Perplexity API key' },
    { id: 'github-token', klass: 'needs-human', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, note: 'GitHub token' },
    { id: 'aws-key', klass: 'needs-human', regex: /\bAKIA[0-9A-Z]{16}\b/g, note: 'AWS access key id' },
    { id: 'slack-token', klass: 'needs-human', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, note: 'Slack token' },
    { id: 'google-key', klass: 'needs-human', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, note: 'Google API key' },
    { id: 'stripe-key', klass: 'needs-human', regex: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, note: 'Stripe API key' },
    { id: 'jwt', klass: 'needs-human', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, note: 'JWT' },
    // Quoted assignment: capture the quoted value and judge THE VALUE, not the whole match.
    { id: 'assigned-secret', klass: 'needs-human',
      regex: /\b(?:api[_-]?key|secret|token|password|passwd|access[_-]?key|private[_-]?key|client[_-]?secret|bearer|auth[_-]?token)\b["']?\s*[:=]\s*["'`]([^"'`\n]{12,})["'`]/gi,
      guard: (m) => !isPlaceholderValue(m[1]), note: 'hardcoded secret assignment (quoted)' },
    // Unquoted assignment: value must be high-entropy and not a whole-placeholder (PF-003).
    { id: 'assigned-secret-unquoted', klass: 'needs-human',
      regex: /\b(?:api[_-]?key|secret|token|password|passwd|access[_-]?key|private[_-]?key|client[_-]?secret|bearer|auth[_-]?token)\b\s*[:=]\s*([^\s"'`]{16,})/gi,
      guard: (m) => !isPlaceholderValue(m[1]) && looksHighEntropy(m[1]), note: 'hardcoded secret assignment (unquoted, high-entropy)' },
    // Secret-shaped token with a leading secret word and a high-entropy hex/alnum tail,
    // e.g. secret_example_9f8a7b6c5d4e3f2a1b0c — caught even without an assignment (PF-003).
    { id: 'secretish-token', klass: 'needs-human',
      regex: /\b(?:secret|token|apikey|api[_-]key|access[_-]?key|auth|passwd|password)[_-][A-Za-z0-9_-]*[A-Fa-f0-9]{12,}\b/gi,
      guard: (m) => !isPlaceholderValue(m[0]), note: 'secret-shaped high-entropy token' },
    // KEY-NAME detector (PF-003): entropy cannot distinguish a low-entropy dictionary-word
    // secret (DATABASE_PASSWORD=correcthorsebatterystaple) from ordinary prose by its VALUE.
    // Catch it by its KEY instead: any assignment whose identifier CONTAINS a secret-bearing
    // word (prefixed or suffixed — DATABASE_PASSWORD, SERVICE_AUTH_TOKEN, MY_CLIENT_SECRET)
    // with a non-empty, non-placeholder value BLOCKS regardless of the value's entropy. To
    // avoid flagging ordinary prose ("the auth token: see docs"), an unquoted value must be
    // a single whitespace-free token of >=6 chars; a quoted value is taken at face value.
    { id: 'secret-named-assignment', klass: 'needs-human',
      regex: /(?:^|[^A-Za-z0-9])([A-Za-z0-9]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|auth)[A-Za-z0-9]*)\s*[:=]\s*(.+)$/gi,
      guard: (m) => {
        let val = String(m[2]).trim().replace(/\s+(?:#|\/\/).*$/, '').trim(); // drop trailing comment
        const quoted = /^["'`]/.test(val);
        val = val.replace(/^["'`]+|["'`]+$/g, '').trim();
        if (!val || isPlaceholderValue(val)) return false;
        if (!quoted && (/\s/.test(val) || val.length < 6)) return false; // prose / trivial value
        return true;
      },
      note: 'non-placeholder value assigned to a secret-named field (blocks regardless of entropy)' },
  ];
  for (const name of (scanConfig.personal_names || [])) {
    cats.push({ id: 'operator-name', klass: 'needs-human', regex: new RegExp('\\b' + escapeRe(name) + '\\b', 'gi'), note: 'operator/personal name (from scan-config)' });
  }
  for (const host of (scanConfig.private_hosts || [])) {
    cats.push({ id: 'private-host', klass: 'needs-human', regex: new RegExp('\\b' + escapeRe(host) + '\\b', 'gi'), note: 'private host name (from scan-config)' });
  }
  return cats;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Files that should ship as a sanitized .example rather than verbatim (they hold real
// environment/credential/state) — a mock-candidate. These BLOCK publication unless the
// operator has wired a sanitized mock or an explicit exclude for them in the export map
// (PF-001). A real .env-class file must never export.
const MOCK_CANDIDATE = /(^|\/)(\.env|\.env\.[A-Za-z0-9._-]+|.*credentials.*|.*secrets?.*|.*\.local\.json|.*-manifest\.json|.*state\.json)$/i;
// A mock candidate whose basename ends in .example/.sample/.template is already sanitized.
const SANITIZED_SUFFIX = /\.(example|sample|template|dist)$/i;
const isSanitizedName = (rel) => SANITIZED_SUFFIX.test(path.basename(rel));

// --- scan -------------------------------------------------------------------------------

function scanFramework(fwDir, denylist, scanConfig) {
  const cats = extraCategories(scanConfig);
  const files = ep.walk(fwDir); // throws on symlinks — same containment posture as export
  const hits = [];
  const mockCandidates = [];
  const binaryFiles = [];
  const allowBinary = scanConfig.binary_allowlist || [];
  for (const rel of files) {
    if (MOCK_CANDIDATE.test(rel) && !isSanitizedName(rel)) mockCandidates.push(rel);
    const full = path.join(fwDir, rel);
    const decoded = decodeFileText(full);
    if (decoded.binary) {
      if (matchesGlob(rel, allowBinary)) continue; // operator-reviewed binary
      binaryFiles.push({ file: rel, klass: 'needs-human', category: 'binary-file', note: 'unrecognized binary/undecodable file — a human must confirm it carries no private data', encoding: decoded.encoding });
      continue;
    }
    const text = decoded.text;
    const lines = text.split('\n');
    // denylist hits (client codes, domains, ad IDs, emails). The exporter CAN
    // substitute these deterministically, but the front-door verdict BLOCKS on them
    // by default — a framework author shipping real client data deserves a human
    // look, and auto-rewriting a client name inside prose can produce nonsense.
    // Pass --allow-substitutions to opt into the proven auto-substitution path.
    for (const h of ep.scanForDenylist(text, denylist, rel)) {
      hits.push({ file: rel, line: h.line, category: 'denylist:' + h.kind, term: h.term, klass: 'client-data', excerpt: h.excerpt });
    }
    // extra categories
    lines.forEach((line, idx) => {
      for (const cat of cats) {
        cat.regex.lastIndex = 0;
        let m;
        while ((m = cat.regex.exec(line)) !== null) {
          if (cat.guard && !cat.guard(m)) { if (m.index === cat.regex.lastIndex) cat.regex.lastIndex++; continue; }
          hits.push({ file: rel, line: idx + 1, category: cat.id, klass: cat.klass, note: cat.note, match: m[0], excerpt: line.trim().slice(0, 120) });
          if (m.index === cat.regex.lastIndex) cat.regex.lastIndex++;
        }
      }
    });
  }
  return { files, hits, mockCandidates, binaryFiles };
}

// A mock candidate is RESOLVED (non-blocking) only when the operator has wired the export
// map so the real file never ships: either a sanitized mock is mapped for it, or it is
// explicitly excluded (PF-001). Absent an existing entry, every mock candidate blocks.
function unresolvedMockCandidates(mockCandidates, existingEntry) {
  if (!existingEntry) return mockCandidates.slice();
  const excl = existingEntry.files && existingEntry.files.exclude;
  const mock = (existingEntry.files && existingEntry.files.mock) || {};
  return mockCandidates.filter((rel) => !(mock[rel] || matchesGlob(rel, excl)));
}

// PF-001: a mock MAPPING sanitizes client-config SHAPE — it does not license a live secret
// in the mocked-in content. The mock file itself is what actually ships to the public tree
// (export-public copies it into staging), and export-public only denylist-scans staged text,
// not the structural-secret categories. So we independently scan every mapped mock file's
// content with the SAME structural scanner used on the source tree; any needs-human hit
// (or a missing/binary mock) BLOCKS. Returns a list of blocking hits.
function scanMockContents(existingEntry, fwRel, denylist, scanConfig, mocksDir = MOCKS_DIR) {
  const mock = (existingEntry && existingEntry.files && existingEntry.files.mock) || {};
  const rels = Object.keys(mock);
  if (!rels.length) return [];
  const { id } = unitIdFor(fwRel);
  const dir = id.replace(/\//g, '__');
  const cats = extraCategories(scanConfig);
  const out = [];
  for (const rel of rels) {
    const mockRel = mock[rel];
    const mockSrc = path.join(mocksDir, dir, mockRel);
    const label = `${rel} (mock: ${mockRel})`;
    if (!fs.existsSync(mockSrc)) {
      out.push({ file: label, klass: 'needs-human', category: 'mock-missing', note: 'declared mock file is missing — cannot verify it is sanitized' });
      continue;
    }
    const decoded = decodeFileText(mockSrc);
    if (decoded.binary) {
      out.push({ file: label, klass: 'needs-human', category: 'binary-file', note: 'mock file is binary/undecodable — a human must confirm it carries no private data', encoding: decoded.encoding });
      continue;
    }
    const lines = decoded.text.split('\n');
    for (const h of ep.scanForDenylist(decoded.text, denylist, mockRel)) {
      out.push({ file: label, line: h.line, category: 'denylist:' + h.kind, term: h.term, klass: 'client-data', excerpt: h.excerpt });
    }
    lines.forEach((line, idx) => {
      for (const cat of cats) {
        cat.regex.lastIndex = 0;
        let m;
        while ((m = cat.regex.exec(line)) !== null) {
          if (cat.guard && !cat.guard(m)) { if (m.index === cat.regex.lastIndex) cat.regex.lastIndex++; continue; }
          if (cat.klass === 'auto-scrub') { if (m.index === cat.regex.lastIndex) cat.regex.lastIndex++; continue; }
          out.push({ file: label, line: idx + 1, category: cat.id, klass: cat.klass, note: 'in mocked-in content — ' + cat.note, match: m[0], excerpt: line.trim().slice(0, 120) });
          if (m.index === cat.regex.lastIndex) cat.regex.lastIndex++;
        }
      }
    });
  }
  return out;
}

// --- auto-scrub (only under --apply, only the auto-scrub class) -------------------------

function applyAutoScrubs(fwDir, scanConfig) {
  const cats = extraCategories(scanConfig).filter((c) => c.klass === 'auto-scrub' && c.scrub);
  const changed = [];
  for (const rel of ep.walk(fwDir)) {
    const full = path.join(fwDir, rel);
    const decoded = decodeFileText(full);
    if (decoded.binary) continue;
    let text = decoded.text;
    let n = 0;
    for (const cat of cats) {
      cat.regex.lastIndex = 0;
      text = text.replace(cat.regex, (m) => { n++; return cat.scrub(m); });
    }
    if (n > 0) { fs.writeFileSync(full, encodeText(text, decoded.encoding)); changed.push({ file: rel, count: n }); }
  }
  return changed;
}

// --- wire into the export map (idempotent + semantically validated) --------------------

function unitIdFor(fwRel) {
  return fwRel.startsWith('frameworks/') ? { bucket: 'frameworks', id: fwRel.replace(/^frameworks\//, '') } : { bucket: 'units', id: fwRel };
}

// The canonical entry publish-framework would wire for this unit. Mock candidates are
// excluded from export so a real .env-class file can never ship (PF-001); operators can
// later replace an exclude with a proper mock mapping.
function expectedEntryFor(fwRel, bucket, mockCandidates) {
  const entry = { source: fwRel, target: fwRel, files: { export: ['**'], exclude: (mockCandidates || []).slice(), mock: {} } };
  if (bucket === 'units') entry.validate = 'none';
  return entry;
}

// Read an existing map entry (if any) and verify it still points at THIS source/target.
// Returns { entry|null, mismatch|null }. A key that exists but points elsewhere is a
// blocker, not a silent accept (PF-005).
function inspectMapEntry(fwRel, mapPath = MAP_PATH, mockCandidates = []) {
  const { bucket, id } = unitIdFor(fwRel);
  if (!fs.existsSync(mapPath)) return { bucket, id, entry: null, mismatch: null };
  const map = loadJson(mapPath);
  const entry = (map[bucket] || {})[id] || null;
  if (!entry) return { bucket, id, entry: null, mismatch: null };
  const problems = mapEntrySemanticProblems(entry, fwRel, mockCandidates);
  return { bucket, id, entry, mismatch: problems.length ? problems : null };
}

// Security-relevant semantic checks for an existing map entry (PF-005). Source AND target
// must both point at this unit (a mispointed reuse could ship a different tree), and every
// real env/credential/state file (mock candidate) must be covered by an exclude glob or a
// mock mapping — an entry that leaves one exportable would ship a live .env-class file.
function mapEntrySemanticProblems(entry, fwRel, mockCandidates = []) {
  const problems = [];
  if (entry.source !== fwRel) problems.push(`existing map entry source is '${entry.source}', expected '${fwRel}'`);
  // target defaults to source when absent; when present it must match.
  if (entry.target !== undefined && entry.target !== fwRel) problems.push(`existing map entry target is '${entry.target}', expected '${fwRel}'`);
  const excl = (entry.files && entry.files.exclude) || [];
  const mock = (entry.files && entry.files.mock) || {};
  for (const rel of (mockCandidates || [])) {
    if (!(mock[rel] || matchesGlob(rel, excl))) {
      problems.push(`existing map entry does not exclude or mock the real env/credential/state file '${rel}' (it would export)`);
    }
  }
  return problems;
}

// Persist the canonical entry (only under --apply, only after blockers clear). If an
// entry already exists it is left as-is when its source matches (idempotent); a source
// mismatch is refused rather than silently overwritten (PF-005).
function ensureMapEntry(fwRel, mapPath = MAP_PATH, mockCandidates = []) {
  const map = loadJson(mapPath);
  const { bucket, id } = unitIdFor(fwRel);
  map[bucket] = map[bucket] || {};
  const existing = map[bucket][id];
  if (existing) {
    const problems = mapEntrySemanticProblems(existing, fwRel, mockCandidates);
    return { bucket, id, already: true, mismatch: problems.length ? problems : null };
  }
  map[bucket][id] = expectedEntryFor(fwRel, bucket, mockCandidates);
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n');
  return { bucket, id, already: false, mismatch: null };
}

// --- export + smoke (delegated to the hardened pipeline) --------------------------------

// Dry-run export check: build the proposed map entry IN MEMORY and stage via the
// export-public module API. Never writes the real map or any target (PF-004).
function runExportDry(fwRel, denylist, mockCandidates) {
  const { bucket, id } = unitIdFor(fwRel);
  const mem = loadJson(MAP_PATH);
  mem[bucket] = mem[bucket] || {};
  if (!mem[bucket][id]) mem[bucket][id] = expectedEntryFor(fwRel, bucket, mockCandidates);
  let result;
  try {
    result = ep.exportFramework(id, mem, denylist, {});
  } catch (e) {
    return { ok: false, error: e.message, lintHits: [], validationProblems: [] };
  }
  const out = { ok: result.ok, lintHits: result.lintHits, validationProblems: result.validationProblems,
    exported: result.exported.length, excluded: result.excluded.length, mocked: result.mocked.length };
  if (result.staging) fs.rmSync(result.staging, { recursive: true, force: true });
  return out;
}

function runExportApply(id) {
  const args = ['export-public.cjs', '--framework', id, '--json', '--apply', '--force'];
  try {
    const out = execFileSync('node', args, { cwd: EXPORT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, report: JSON.parse(out.slice(out.indexOf('{'))) };
  } catch (e) {
    const stdout = (e.stdout && String(e.stdout)) || '';
    let report = null;
    try { report = JSON.parse(stdout.slice(stdout.indexOf('{'))); } catch { /* leave null */ }
    return { ok: false, report, error: ((e.stderr && String(e.stderr)) || e.message).trim().split('\n').slice(0, 6).join('\n') };
  }
}

function runSmoke() {
  try {
    const out = execFileSync('node', ['smoke-clean-clone.cjs'], { cwd: EXPORT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out: out.trim().split('\n').slice(-3).join('\n') };
  } catch (e) {
    return { ok: false, out: (((e.stdout && String(e.stdout)) || '') + ((e.stderr && String(e.stderr)) || e.message)).trim().split('\n').slice(-6).join('\n') };
  }
}

// --- report -----------------------------------------------------------------------------

function writeReport(fwRel, scan, verdict, extra) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const slug = fwRel.replace(/[/]/g, '-');
  const json = { schema: 'PublishFramework/1.0', framework: fwRel, verdict, counts: extra.counts, hits: scan.hits, mock_candidates: scan.mockCandidates, binary_files: scan.binaryFiles, ...extra.meta };
  const jsonPath = path.join(REPORT_DIR, `publish-framework__${slug}__${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2) + '\n');
  const mdPath = path.join(REPORT_DIR, `publish-framework__${slug}__${stamp}.md`);
  const byClass = groupBy(scan.hits, (h) => h.klass);
  let md = `# Publish-framework report — ${fwRel}\n\n> ${new Date().toISOString()} · verdict: **${verdict}**\n\n`;
  md += `- files scanned: ${scan.files.length}\n- total hits: ${scan.hits.length}\n`;
  for (const k of Object.keys(byClass)) md += `  - ${k}: ${byClass[k].length}\n`;
  md += `- mock-candidate files: ${scan.mockCandidates.length}\n- binary/undecodable files: ${scan.binaryFiles.length}\n\n`;
  for (const k of ['needs-human', 'client-data', 'binary', 'mock-candidate', 'auto-scrub']) {
    let rows;
    if (k === 'mock-candidate') rows = scan.mockCandidates.map((f) => ({ file: f }));
    else if (k === 'binary') rows = scan.binaryFiles;
    else rows = byClass[k] || [];
    if (!rows.length) continue;
    md += `## ${k}\n\n`;
    for (const r of rows) md += r.file && r.line ? `- \`${r.file}:${r.line}\` [${r.category}] ${r.note || ''} — \`${(r.excerpt || '').slice(0, 80)}\`\n` : `- \`${r.file}\`${r.note ? ' — ' + r.note : ''}\n`;
    md += '\n';
  }
  fs.writeFileSync(mdPath, md);
  return { jsonPath, mdPath };
}
const groupBy = (arr, fn) => arr.reduce((a, x) => { const k = fn(x); (a[k] = a[k] || []).push(x); return a; }, {});

// --- main -------------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const json = args.includes('--json');
  const allowSubstitutions = args.includes('--allow-substitutions');
  const allowUnit = args.includes('--allow-unit');
  const fwArg = args.find((a) => !a.startsWith('--'));
  if (!fwArg) { console.error('usage: publish-framework <framework-path> [--apply] [--json] [--allow-substitutions] [--allow-unit]'); process.exit(2); }

  const fwAbs = path.resolve(process.cwd(), fwArg);
  if (!fs.existsSync(fwAbs) || !fs.statSync(fwAbs).isDirectory()) { console.error('not a directory: ' + fwArg); process.exit(2); }
  const fwRel = path.relative(REPO_ROOT, fwAbs);
  if (fwRel.startsWith('..')) { console.error('framework path must be inside the repo: ' + fwArg); process.exit(2); }

  // Scope validation (PF-005): normal invocation targets a framework dir (under
  // frameworks/ or carrying a manifest.json). A generic unit requires the explicit
  // --allow-unit opt-in so the tool's authority is never broader than it discloses.
  const isFrameworkDir = fwRel.startsWith('frameworks/') || fs.existsSync(path.join(fwAbs, 'manifest.json'));
  if (!isFrameworkDir && !allowUnit) {
    console.error(`not a framework directory (no manifest.json and not under frameworks/): ${fwRel}\n` +
      `  refuse to publish an arbitrary directory as a validation-free unit.\n` +
      `  if this is intentional, re-run with --allow-unit.`);
    process.exit(2);
  }

  const denylist = loadJson(DENYLIST_PATH);
  const scanConfig = fs.existsSync(SCAN_CONFIG_PATH) ? loadJson(SCAN_CONFIG_PATH) : { personal_names: [], private_hosts: [] };

  // 1-2: scan + classify (no mutation yet). Mock-mapped files are additionally scanned for
  // structural secrets (PF-001) and folded into the framework's hits so they block and are
  // reported. scanFrameworkFull re-runs cleanly after any auto-scrub re-scan.
  const scanFrameworkFull = (entry) => {
    const s = scanFramework(fwAbs, denylist, scanConfig);
    s.hits.push(...scanMockContents(entry, fwRel, denylist, scanConfig));
    return s;
  };
  let scan = scanFramework(fwAbs, denylist, scanConfig);

  // Inspect any existing map entry (semantic check, PF-005) — now that mock candidates are
  // known, verify source/target and that every mock candidate is excluded or mocked.
  const mapInfo = inspectMapEntry(fwRel, MAP_PATH, scan.mockCandidates);
  scan.hits.push(...scanMockContents(mapInfo.entry, fwRel, denylist, scanConfig));

  // 3: compute blockers BEFORE any source mutation (PF-004). Blockers are:
  //    needs-human (credentials/secrets/op:/operator names), binary/undecodable files,
  //    unresolved mock candidates, client-data (unless --allow-substitutions), and a
  //    semantic map mismatch.
  const buildBlockers = (s) => {
    const needsHuman = s.hits.filter((h) => h.klass === 'needs-human');
    const clientData = s.hits.filter((h) => h.klass === 'client-data');
    const unresolvedMocks = unresolvedMockCandidates(s.mockCandidates, mapInfo.entry);
    const blockers = needsHuman
      .concat(s.binaryFiles)
      .concat(unresolvedMocks.map((f) => ({ file: f, klass: 'mock-candidate', category: 'mock-candidate', note: 'real env/credential/state file — ship a sanitized .example and exclude/mock the real file' })))
      .concat(allowSubstitutions ? [] : clientData);
    return { needsHuman, clientData, unresolvedMocks, blockers };
  };

  let { needsHuman, clientData, unresolvedMocks, blockers } = buildBlockers(scan);
  const mapMismatch = mapInfo.mismatch;

  let scrubbed = [];
  let verdict, mapEntry = null, exportRes = null, smokeRes = null;

  if (mapMismatch || blockers.length > 0) {
    // BLOCKED — never mutate source, never wire the map, never export.
    verdict = 'BLOCKED';
  } else {
    // 4: genericize (auto-scrub class only) — apply mode, now that blockers are clear.
    if (apply) {
      scrubbed = applyAutoScrubs(fwAbs, scanConfig);
      if (scrubbed.length) {
        scan = scanFrameworkFull(mapInfo.entry); // re-scan post-scrub (incl. mock content)
        ({ needsHuman, clientData, unresolvedMocks, blockers } = buildBlockers(scan));
      }
    }
    if (blockers.length > 0) {
      verdict = 'BLOCKED';
    } else if (!apply) {
      // 5 (dry-run): in-memory export check — no map write, no target write (PF-004).
      exportRes = runExportDry(fwRel, denylist, scan.mockCandidates);
      verdict = exportRes.ok ? 'READY (dry-run — re-run with --apply to publish)' : 'BLOCKED';
    } else {
      // 5 (apply): wire the map (semantic), then real export + smoke.
      mapEntry = ensureMapEntry(fwRel, MAP_PATH, scan.mockCandidates);
      if (mapEntry.mismatch) {
        verdict = 'BLOCKED';
      } else {
        exportRes = runExportApply(mapEntry.id);
        const exportClean = exportRes.report && Array.isArray(exportRes.report.results) && exportRes.report.results.every((r) => r.ok);
        if (!exportClean) {
          verdict = 'BLOCKED';
        } else {
          smokeRes = runSmoke();
          verdict = smokeRes.ok ? 'PUBLISH-READY' : 'BLOCKED';
        }
      }
    }
  }

  const counts = {
    total: scan.hits.length,
    needs_human: needsHuman.length,
    client_data: clientData.length,
    auto_scrub: scan.hits.filter((h) => h.klass === 'auto-scrub').length,
    mock_candidates: scan.mockCandidates.length,
    unresolved_mock_candidates: unresolvedMocks.length,
    binary_files: scan.binaryFiles.length,
    auto_scrubbed_files: scrubbed.length,
  };

  const { jsonPath, mdPath } = writeReport(fwRel, scan, verdict, {
    counts,
    meta: { apply, map_entry: mapEntry, map_mismatch: mapMismatch, export_clean: exportRes ? (exportRes.ok !== undefined ? exportRes.ok : (exportRes.report && exportRes.report.results || []).every((r) => r.ok)) : null, smoke: smokeRes && smokeRes.ok },
  });

  if (json) {
    console.log(JSON.stringify({ framework: fwRel, verdict, counts, needs_human: needsHuman, client_data: clientData, mock_candidates: scan.mockCandidates, unresolved_mock_candidates: unresolvedMocks, binary_files: scan.binaryFiles, map_mismatch: mapMismatch, scrubbed, map_entry: mapEntry, export_error: exportRes && exportRes.error, smoke: smokeRes, report: { json: path.relative(REPO_ROOT, jsonPath), md: path.relative(REPO_ROOT, mdPath) } }, null, 2));
  } else {
    console.log(`\npublish-framework: ${fwRel}`);
    console.log(`  scanned ${scan.files.length} file(s) — ${counts.total} hit(s): needs-human=${counts.needs_human} client-data=${counts.client_data} auto-scrub=${counts.auto_scrub} mock-candidates=${counts.mock_candidates} binary=${counts.binary_files}`);
    if (apply && scrubbed.length) console.log(`  auto-scrubbed ${scrubbed.length} file(s) (absolute paths -> ~)`);
    if (mapMismatch) {
      console.log(`\n  export-map mismatch (BLOCKING — refusing to reuse a stale/mispointed entry):`);
      for (const p of mapMismatch) console.log(`    ${p}`);
    }
    if (needsHuman.length) {
      console.log(`\n  ${needsHuman.length} item(s) need a human to resolve (never auto-altered):`);
      for (const h of needsHuman.slice(0, 25)) console.log(`    ${h.file}:${h.line} [${h.category}] ${h.note} — ${h.excerpt}`);
    }
    if (scan.binaryFiles.length) {
      console.log(`\n  ${scan.binaryFiles.length} binary/undecodable file(s) (BLOCKING — a human must confirm no private data, or allowlist in scan-config):`);
      for (const b of scan.binaryFiles) console.log(`    ${b.file} [${b.encoding}]`);
    }
    if (unresolvedMocks.length) {
      console.log(`\n  ${unresolvedMocks.length} mock-candidate(s) BLOCKING (real env/credential/state — ship a sanitized .example and exclude/mock the real file):`);
      for (const f of unresolvedMocks) console.log(`    ${f}`);
    }
    if (clientData.length) {
      console.log(`\n  ${clientData.length} client-data hit(s)${allowSubstitutions ? ' (will be auto-substituted by the exporter)' : ' — BLOCKING; pass --allow-substitutions to let the exporter genericize them'}:`);
      for (const h of clientData.slice(0, 15)) console.log(`    ${h.file}:${h.line} [${h.category}] ${h.term} — ${h.excerpt}`);
    }
    if (mapEntry) console.log(`\n  export map: ${mapEntry.already ? 'already present' : 'added'} as ${mapEntry.bucket}/${mapEntry.id}`);
    if (exportRes && exportRes.error) console.log(`  export: FAILED\n${String(exportRes.error).split('\n').map((l) => '    ' + l).join('\n')}`);
    else if (exportRes) console.log(`  export: ${apply ? 'applied' : 'dry-run'} ${exportRes.ok === false ? 'CONTAMINATED' : 'CLEAN'}`);
    if (smokeRes) console.log(`  smoke: ${smokeRes.ok ? 'CLEAN' : 'FAILED'}\n${smokeRes.out.split('\n').map((l) => '    ' + l).join('\n')}`);
    console.log(`\n  VERDICT: ${verdict}`);
    console.log(`  report: ${path.relative(REPO_ROOT, mdPath)}`);
  }

  process.exit(/^PUBLISH-READY|^READY/.test(verdict) ? 0 : 1);
}

if (require.main === module) main();
module.exports = {
  scanFramework, applyAutoScrubs, ensureMapEntry, inspectMapEntry, expectedEntryFor,
  extraCategories, unitIdFor, unresolvedMockCandidates, decodeFileText, encodeText,
  isPlaceholderValue, looksHighEntropy, runExportDry, isValidUtf8,
  scanMockContents, mapEntrySemanticProblems, MOCKS_DIR,
};
