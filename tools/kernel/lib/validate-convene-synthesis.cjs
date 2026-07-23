#!/usr/bin/env node
'use strict';

/**
 * validate-convene-synthesis.cjs — synthesis-required validator
 * (REJECT_HOLLOW_COMPLETION recurrence-guard, kernel convene 20260629T214856Z).
 *
 * CANONICAL HOME NOTE
 *   The dispatching convene specified tools/convene/lib/validate-synthesis.cjs.
 *   That path is a governance-protected surface (tools/convene/** requires a live
 *   operator-ratified ConveneReceipt/1.0 — see tools/verify/hooks/
 *   pre-write-convene-required.cjs). A worker must not forge that receipt, so this
 *   validator is landed at the non-protected, consumer-adjacent kernel-lib path
 *   the plan-review gate already lazy-requires siblings from. To relocate it to
 *   the canonical convene path, mint a receipt via tools/verify/convene-unlock.cjs
 *   then `git mv` and update the one require line in
 *   tools/kernel/hooks/userprompt-plan-review-gate.cjs.
 *
 * THE LOOPHOLE THIS CLOSES
 *   The plan-review gate historically accepted ANY matching convene-run DIRECTORY
 *   as convene evidence and printed "convene evidence verified" WITHOUT checking
 *   that a real synthesis.md exists. A convene run writes `synthesis-skeleton.md`
 *   mechanically (tools/convene/lib/artifacts.js); a real synthesis is the ORIGIN
 *   actor filling in `synthesis.md`.
 *
 *   Codex distinct review (REJECT) then showed that a size+keyword check alone is
 *   fooled by a FAKE synthesis: `# Notes\nVerdict: ok\n<repeated filler>` passed.
 *   So this validator now distinguishes a real synthesis from BOTH a missing one
 *   AND a padded/forged one. A real triadic synthesis must:
 *     - reference the actual convened slots/lobes (cross-verification is the point);
 *     - carry a real verdict/findings/cross-verification section;
 *     - contain genuine vocabulary diversity (not keyword + size); and
 *     - NOT be dominated by repeated/low-entropy filler lines.
 *
 * CONTRACT
 *   validateConveneSynthesis(conveneRunDir) -> { valid: boolean, reason: string }
 *   FAIL-CLOSED: any unreadable/ambiguous state => { valid: false }. Never throws.
 */

const fs = require('fs');
const path = require('path');

const MIN_BYTES = 200;
// Genuine prose carries many distinct content words; keyword-padded filler does not.
const MIN_DISTINCT_CONTENT_WORDS = 15;
// At least this many distinct slot/lobe identifiers must appear (triad => >= 2).
const MIN_SLOT_REFERENCES = 2;
// Filler guard: among substantive lines, reject if this fraction (or more) are dupes.
const MAX_DUPLICATE_LINE_RATIO = 0.5;
const MIN_LINES_FOR_DUPLICATE_CHECK = 6;

// Skeleton placeholder fragments (see tools/convene/lib/artifacts.js), matched
// case-insensitively. Presence of any one means the file is still (partly) the
// unfilled skeleton.
const SKELETON_MARKERS = [
  '[synthesis section',
  '[one-voice summary',
  '[origin slot',
  'origin placeholder'
];

// Real structural section (verdict / findings / cross-verification).
const STRUCTURE_RE = /(net[\s-]*findings|cross[\s-]*verification|\bfindings\b|\bverdict\b)/i;

// Well-known actor + lobe identifiers. 'now' is deliberately excluded (too common
// as ordinary prose to be a meaningful slot signal). Augmented per-run from the
// dir's slot artifacts + manifest so the check is generic to any provider set.
const BASE_SLOT_IDS = [
  'claude', 'codex', 'gemini', 'gpt', 'opus', 'sonnet', 'haiku',
  'intent', 'truth', 'edge', 'alpha', 'omega'
];

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeIdentifier(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Collect slot/actor identifiers from the well-known set + this run's artifacts. */
function collectSlotIdentifiers(dir) {
  const ids = new Set(BASE_SLOT_IDS);
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/\.md$/i.test(f)) continue;
      if (/^synthesis/i.test(f) || /^prompt/i.test(f)) continue;
      for (const part of f.replace(/\.md$/i, '').split('__')) {
        const t = tokenizeIdentifier(part);
        if (t.length >= 3) ids.add(t);
      }
    }
    const mfp = path.join(dir, 'manifest.json');
    if (fs.existsSync(mfp)) {
      const mf = JSON.parse(fs.readFileSync(mfp, 'utf8'));
      if (Array.isArray(mf.participants)) {
        for (const a of mf.participants) {
          const t = tokenizeIdentifier(a);
          if (t.length >= 3) ids.add(t);
        }
      }
      if (Array.isArray(mf.triad_slots)) {
        for (const s of mf.triad_slots) {
          for (const k of ['id', 'actor']) {
            if (s && typeof s[k] === 'string') {
              const t = tokenizeIdentifier(s[k]);
              if (t.length >= 3) ids.add(t);
            }
          }
        }
      }
    }
  } catch (_) { /* best-effort; base set still applies */ }
  return ids;
}

function countSlotReferences(body, ids) {
  const lower = body.toLowerCase();
  let hits = 0;
  for (const id of ids) {
    if (new RegExp('\\b' + escapeRe(id) + '\\b').test(lower)) {
      hits++;
      if (hits >= MIN_SLOT_REFERENCES) break;
    }
  }
  return hits;
}

function distinctContentWordCount(body) {
  const words = body.toLowerCase().match(/[a-z]{4,}/g) || [];
  return new Set(words).size;
}

/** Fraction of substantive lines that are exact duplicates of an earlier line. */
function duplicateLineRatio(body) {
  const lines = body.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 12 && /[a-z]/i.test(l));
  if (lines.length < MIN_LINES_FOR_DUPLICATE_CHECK) return { ratio: 0, lines: lines.length };
  const unique = new Set(lines);
  return { ratio: 1 - unique.size / lines.length, lines: lines.length };
}

function validateConveneSynthesis(conveneRunDir) {
  // (1) readable directory — fail-closed on anything ambiguous.
  let stat;
  try {
    stat = fs.statSync(conveneRunDir);
  } catch (_) {
    return { valid: false, reason: 'convene-run dir unreadable or missing: ' + conveneRunDir };
  }
  if (!stat.isDirectory()) {
    return { valid: false, reason: 'convene-run path is not a directory: ' + conveneRunDir };
  }

  // (2) synthesis.md must exist (NOT synthesis-skeleton.md).
  const synthPath = path.join(conveneRunDir, 'synthesis.md');
  let body;
  try {
    if (!fs.statSync(synthPath).isFile()) {
      return { valid: false, reason: 'hollow convene — synthesis.md missing (only a skeleton/other artifacts present)' };
    }
    body = fs.readFileSync(synthPath, 'utf8');
  } catch (_) {
    return { valid: false, reason: 'hollow convene — synthesis.md missing (only a skeleton/other artifacts present)' };
  }

  // (3) non-trivial size.
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes < MIN_BYTES) {
    return { valid: false, reason: 'synthesis.md too short (' + bytes + ' bytes < ' + MIN_BYTES + ') — looks empty/stub' };
  }

  // (4) not the unfilled skeleton.
  const lower = body.toLowerCase();
  for (const marker of SKELETON_MARKERS) {
    if (lower.includes(marker)) {
      return { valid: false, reason: 'synthesis.md still contains unfilled skeleton placeholder ("' + marker + '...") — synthesis not actually written' };
    }
  }
  if (/^#\s+convene synthesis skeleton\b/im.test(body)) {
    return { valid: false, reason: 'synthesis.md is still titled as the skeleton ("# Convene synthesis skeleton") — synthesis not actually written' };
  }

  // (5) references the actual convened slots/lobes (cross-verification is the point).
  const slotRefs = countSlotReferences(body, collectSlotIdentifiers(conveneRunDir));
  if (slotRefs < MIN_SLOT_REFERENCES) {
    return { valid: false, reason: 'synthesis.md does not reference the convened slots/lobes (found ' + slotRefs + ' of >= ' + MIN_SLOT_REFERENCES + ') — not a real cross-slot synthesis' };
  }

  // (6) real structural section (verdict / findings / cross-verification).
  if (!STRUCTURE_RE.test(body)) {
    return { valid: false, reason: 'synthesis.md lacks a verdict/findings/net-findings section — not a real synthesis' };
  }

  // (7) genuine vocabulary diversity — defeats keyword-padded filler that merely
  //     contains "Verdict"/"findings" + size (the exact codex-smoke bypass).
  const distinct = distinctContentWordCount(body);
  if (distinct < MIN_DISTINCT_CONTENT_WORDS) {
    return { valid: false, reason: 'synthesis.md has insufficient substantive content (' + distinct + ' distinct content words < ' + MIN_DISTINCT_CONTENT_WORDS + ') — looks keyword-padded, not a real synthesis' };
  }

  // (8) not dominated by repeated/low-entropy filler lines.
  const dup = duplicateLineRatio(body);
  if (dup.ratio >= MAX_DUPLICATE_LINE_RATIO) {
    return { valid: false, reason: 'synthesis.md is dominated by repeated/low-entropy filler (' + Math.round(dup.ratio * 100) + '% duplicate lines) — looks padded, not a real synthesis' };
  }

  return { valid: true, reason: 'synthesis.md present and substantive (' + bytes + ' bytes, ' + distinct + ' distinct words, ' + slotRefs + '+ slot refs)' };
}

module.exports = {
  validateConveneSynthesis,
  MIN_BYTES,
  MIN_DISTINCT_CONTENT_WORDS,
  MIN_SLOT_REFERENCES
};
