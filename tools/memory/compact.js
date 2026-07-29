#!/usr/bin/env node
'use strict';
/**
 * compact.js — length-budget compaction for the auto-memory index (MEMORY.md).
 *
 * MEMORY.md is the one-line-per-memory index loaded into context every session
 * (`- [Title](file.md) — hook`). It grows until it nears the harness read limit.
 * This tool shrinks it to a byte budget WITHOUT ever losing a memory: the
 * individual `<type>_<slug>.md` files (each carrying a `description:` used for
 * semantic recall) are never touched, so a memory stays recall-able even after
 * its index LINE is trimmed or demoted out of the hot index.
 *
 * Compaction is applied in priority order, only as far as needed to hit budget:
 *
 *   Layer 1 — hook tightening (lossless at the memory level):
 *     trim each index line's hook to --max-hook chars, cutting at a segment
 *     boundary (`; `, `, `, ` → `, ` — `) and appending `…`. Title and filename
 *     link are NEVER changed. The full fact survives in the memory file.
 *
 *   Layer 2 — cold-tail demotion (non-destructive):
 *     for entries whose title/hook carry a resolved-marker (RESOLVED, RETIRED,
 *     SUPERSEDED, DEPRECATED), move ONLY the index line into a sibling
 *     MEMORY-ARCHIVE.md. The memory file stays in place. Runs only if Layer 1
 *     is insufficient, and never touches a PINNED entry.
 *
 * PIN — never demoted regardless of budget: any entry whose filename starts
 *   with `kernel_`, or whose title/hook signals a load-bearing law/invariant
 *   (kernel, doctrine, conservation, dignity, safety, custody, canonical-path,
 *   invariant, law). False-pin is safe; false-demote is the error to avoid.
 *
 * No silent caps: if budget cannot be reached without demoting pinned/uncertain
 * entries, the tool STOPS short and reports the shortfall rather than over-prune.
 *
 * Idempotent: re-running does not double-trim (a hook already <= max is left
 * alone) or re-demote (an already-archived line is not re-added).
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   node tools/memory/compact.js [--apply] [--budget 17000] [--max-hook 90]
 *                                [--memory-dir <path>] [--file <MEMORY.md>]
 *
 * Built-ins only. No dependencies.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---- args ----------------------------------------------------------------
function parseArgs(argv) {
  const a = { apply: false, budget: 17000, maxHook: 90, memoryDir: null, file: null };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--apply') a.apply = true;
    else if (t === '--budget') a.budget = parseInt(argv[++i], 10);
    else if (t === '--max-hook') a.maxHook = parseInt(argv[++i], 10);
    else if (t === '--memory-dir') a.memoryDir = argv[++i];
    else if (t === '--file') a.file = argv[++i];
    else if (t === '-h' || t === '--help') { a.help = true; }
    else { console.error(`unknown arg: ${t}`); process.exit(2); }
  }
  return a;
}

// Default memory dir mirrors the Claude Code project-dir encoding:
// `/Users/admin/dev/Mythos-recovered` -> `-Users-admin-dev-mythos-recovered`
function defaultMemoryDir() {
  const enc = process.cwd().replace(/[/_]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', enc, 'memory');
}

// ---- parsing -------------------------------------------------------------
// Anchor the separator on `) — ` right after the markdown link, so an em-dash
// inside a title or hook does not confuse the split.
const ENTRY_RE = /^- \[(.+?)\]\(([^)]+)\) — (.+)$/;

// Status markers, matched case-SENSITIVE (uppercase). A bare lowercase
// "resolved" is almost always a normal word in an active rule (e.g. a comms
// template step), not a status stamp — matching it causes false-demotes.
const MARKER_RE = /\b(RESOLVED|RETIRED|SUPERSEDED|DEPRECATED)\b/;
const PIN_SIGNALS = /\b(kernel|doctrine|conservation|dignity|safety|custody|canonical-path|invariant|law)\b/i;

function isPinned(entry) {
  if (/^kernel_/.test(path.basename(entry.file))) return true;
  if (PIN_SIGNALS.test(entry.title)) return true;
  if (PIN_SIGNALS.test(entry.hook)) return true;
  return false;
}

// Conservative cold-tail test (false-keep is safe, false-demote is the error):
//   - an uppercase status marker in the TITLE is a deliberate status stamp on
//     the whole entry, OR
//   - an uppercase status marker LEADING the hook (within first 25 chars) means
//     the fact opens by declaring itself closed.
// A marker buried mid-hook (e.g. "...origin/github RETIRED for...") refers to a
// sub-fact of an otherwise-active rule, so it does NOT qualify.
function markerOf(entry) {
  const tm = entry.title.match(MARKER_RE);
  if (tm) return tm[0];
  const hm = entry.hook.match(MARKER_RE);
  if (hm && hm.index <= 25) return hm[0];
  return null;
}

function isDemotable(entry) {
  return markerOf(entry) !== null;
}

// Trim a hook to maxHook chars, preferring a segment boundary. Idempotent:
// a hook already <= maxHook is returned unchanged.
const SEGMENT_RE = /(; | → | — |, )/g;
function trimHook(hook, maxHook) {
  if ([...hook].length <= maxHook) return hook;
  const ELLIPSIS = '…';
  const limit = maxHook - 1; // reserve one char for the ellipsis
  // Find the last segment boundary at or before `limit` chars.
  let cut = -1;
  let m;
  SEGMENT_RE.lastIndex = 0;
  while ((m = SEGMENT_RE.exec(hook)) !== null) {
    if (m.index <= limit) cut = m.index;
    else break;
  }
  let head;
  if (cut >= 30) {
    head = hook.slice(0, cut);
  } else {
    // No usable boundary — hard cut, then drop a trailing partial word.
    head = [...hook].slice(0, limit).join('');
    const lastSpace = head.lastIndexOf(' ');
    if (lastSpace >= 30) head = head.slice(0, lastSpace);
  }
  return head.replace(/[\s;,→—-]+$/, '') + ELLIPSIS;
}

function byteLen(s) { return Buffer.byteLength(s, 'utf8'); }

// ---- main ----------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node tools/memory/compact.js [--apply] [--budget 17000] [--max-hook 90] [--memory-dir <path>] [--file <MEMORY.md>]');
    return;
  }
  const memoryDir = args.memoryDir || defaultMemoryDir();
  const memFile = args.file || path.join(memoryDir, 'MEMORY.md');
  const archiveFile = path.join(memoryDir, 'MEMORY-ARCHIVE.md');

  if (!fs.existsSync(memFile)) {
    console.error(`MEMORY.md not found: ${memFile}`);
    process.exit(2);
  }

  const original = fs.readFileSync(memFile, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);

  // Parse into a structure that preserves every line in order.
  const records = lines.map((raw) => {
    const m = ENTRY_RE.exec(raw);
    if (!m) return { type: 'raw', raw };
    return { type: 'entry', raw, title: m[1], file: m[2], hook: m[3], demoted: false };
  });
  const entries = records.filter((r) => r.type === 'entry');

  const startBytes = byteLen(original);
  const pinnedEntries = entries.filter(isPinned);

  function render() {
    return records
      .filter((r) => !(r.type === 'entry' && r.demoted))
      .map((r) => (r.type === 'entry'
        ? `- [${r.title}](${r.file}) — ${r.hook}`
        : r.raw))
      .join(eol);
  }

  // ---- Layer 1: hook tightening ----
  let tightened = 0;
  const tightenedList = [];
  if (byteLen(render()) > args.budget) {
    for (const e of entries) {
      const trimmed = trimHook(e.hook, args.maxHook);
      if (trimmed !== e.hook) {
        tightenedList.push({ title: e.title, before: e.hook.length, after: trimmed.length });
        e.hook = trimmed;
        tightened++;
      }
    }
  }
  const afterLayer1Bytes = byteLen(render());

  // ---- Layer 2: cold-tail demotion (only if still over budget) ----
  const demoted = [];
  const skippedPinned = [];
  if (afterLayer1Bytes > args.budget) {
    for (const e of entries) {
      if (byteLen(render()) <= args.budget) break;
      if (e.demoted) continue;
      if (!isDemotable(e)) continue;
      if (isPinned(e)) { skippedPinned.push(e.title); continue; }
      e.demoted = true;
      const marker = markerOf(e) || 'MARKER';
      demoted.push({ title: e.title, file: e.file, hook: e.hook, reason: marker, line: `- [${e.title}](${e.file}) — ${e.hook}` });
    }
  }

  const finalContent = render();
  const finalBytes = byteLen(finalContent);
  const shortfall = finalBytes > args.budget;

  // ---- archive write planning ----
  let archiveToAppend = [];
  if (demoted.length) {
    let existing = fs.existsSync(archiveFile) ? fs.readFileSync(archiveFile, 'utf8') : '';
    for (const d of demoted) {
      const linkToken = `(${d.file})`;
      if (!existing.includes(linkToken)) {
        archiveToAppend.push(d);
        existing += d.line;
      }
    }
  }

  // ---- report ----
  console.log('memory/compact.js — index compaction');
  console.log(`  memory dir : ${memoryDir}`);
  console.log(`  file       : ${memFile}`);
  console.log(`  mode       : ${args.apply ? 'APPLY' : 'dry-run'}`);
  console.log(`  budget     : ${args.budget} bytes   max-hook: ${args.maxHook} chars`);
  console.log('');
  console.log(`  entries    : ${entries.length}   pinned: ${pinnedEntries.length}`);
  console.log(`  size before: ${startBytes} bytes`);
  console.log(`  after L1   : ${afterLayer1Bytes} bytes   (${tightened} hooks tightened)`);
  console.log(`  size after : ${finalBytes} bytes   (${demoted.length} demoted)`);
  console.log('');

  if (tightened) {
    console.log(`Layer 1 — hooks tightened (${tightened}):`);
    for (const t of tightenedList) {
      console.log(`  · ${t.title}  (${t.before} → ${t.after} chars)`);
    }
    console.log('');
  } else {
    console.log('Layer 1 — no hooks needed tightening (or budget met before L1).');
    console.log('');
  }

  if (demoted.length) {
    console.log(`Layer 2 — demoted to MEMORY-ARCHIVE.md (${demoted.length}):`);
    for (const d of demoted) {
      console.log(`  · ${d.title}  [reason: ${d.reason} marker]  -> ${d.file}`);
    }
    if (archiveToAppend.length !== demoted.length) {
      console.log(`  (note: ${demoted.length - archiveToAppend.length} already present in archive; index line removed, no duplicate added)`);
    }
    console.log('');
  } else {
    console.log('Layer 2 — none demoted (layer 1 sufficient, or no resolved-marker candidates).');
    console.log('');
  }

  if (skippedPinned.length) {
    console.log(`Pinned entries skipped from demotion despite resolved-marker (${skippedPinned.length}):`);
    for (const s of skippedPinned) console.log(`  · ${s}`);
    console.log('');
  }

  console.log(`Pinned (never demotable) examples (${pinnedEntries.length} total):`);
  for (const p of pinnedEntries.slice(0, 8)) console.log(`  · ${p.title}`);
  console.log('');

  if (shortfall) {
    console.log(`SHORTFALL: final size ${finalBytes} bytes exceeds budget ${args.budget} by ${finalBytes - args.budget} bytes.`);
    console.log('  Stopped short rather than demote pinned/uncertain entries. Raise --budget, lower --max-hook, or review pins.');
    console.log('');
  } else {
    console.log(`OK: final size ${finalBytes} <= budget ${args.budget}.`);
    console.log('');
  }

  // ---- write ----
  if (args.apply) {
    if (finalContent !== original) {
      fs.writeFileSync(memFile, finalContent, 'utf8');
      console.log(`WROTE ${memFile} (${finalBytes} bytes).`);
    } else {
      console.log('No changes to write (already compact).');
    }
    if (archiveToAppend.length) {
      const header = fs.existsSync(archiveFile)
        ? ''
        : `# Memory Index — Archive${eol}${eol}> Demoted index lines. The memory FILES remain in place and recall-able by their \`description:\`. Only the hot-index line moved here.${eol}${eol}`;
      const block = archiveToAppend.map((d) => d.line).join(eol) + eol;
      fs.appendFileSync(archiveFile, header + block, 'utf8');
      console.log(`APPENDED ${archiveToAppend.length} line(s) to ${archiveFile}.`);
    }
  } else {
    console.log('Dry-run: no files written. Re-run with --apply to write.');
  }
}

main();
