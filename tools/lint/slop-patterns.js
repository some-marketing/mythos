'use strict';
//
// tools/lint/slop-patterns.js — shared, WARN-tier advisory anti-slop pattern bank.
//
// Distilled (read-only) from stop-slop (https://github.com/hardikpandya/stop-slop,
// commit 8da1f03, MIT — Copyright (c) 2025 Hardik Pandya).
//
// DOCTRINE: every rule here is `severity: 'warn'` — advisory only, NEVER hard-fail.
// A hard style lint over-blocks legitimate writing and pushes authors into bland
// minimalism; keeping this bank advisory-only avoids that failure mode.
//
// SURFACE: prose / long-form authored content (briefs, essays, system-agent output,
// owner decks). Short ad copy has its own, separate style constraints and is out
// of scope for this bank.
//
// ─── COVERAGE LEDGER ───
// This module implements a curated subset by design — high-signal, low-false-positive
// families first. Families are labeled IMPLEMENTED or DEFERRED below so coverage is
// explicit, not silent.
//
//   IMPLEMENTED (rule id):
//     - Throat-clearing openers ........ throat-clearing-heres, throat-clearing-truth
//     - Emphasis crutches .............. emphasis-crutch
//     - Business jargon (prose) ........ business-jargon
//     - Filler adverbs / hedges ........ filler-adverb
//     - Filler phrases ................. filler-phrase
//     - Meta-commentary ................ meta-commentary
//     - Vague declaratives ............. vague-declarative
//     - Binary-contrast structures ..... binary-contrast
//     - Rhetorical setups .............. rhetorical-setup
//     - False agency / passive voice ... false-agency, passive-no-actor
//     - Lazy extremes .................. lazy-extreme
//
//   DEFERRED (rationale):
//     - Negative listing ("Not a X... Not a Y... A Z.") — DEFERRED: multi-clause cross-
//       sentence structure; a single regex over-matches legitimate enumerated negation
//       (e.g. requirements lists). Needs a sentence-window matcher, not a token regex.
//     - Dramatic fragmentation ("That's it. That's the [thing].", "This unlocks
//       something. [Word].") — DEFERRED: depends on sentence-fragment segmentation; the
//       "unlock" token itself is already a copy-voice-lint HARD fail (see (a) above), so
//       partial coverage exists at the ad-copy surface. Prose-fragment detection deferred.
//     - Narrator-from-a-distance ("Nobody designed this.", "People tend to...") — DEFERRED:
//       "nobody" is partially covered by lazy-extreme; the broader narrator stance needs
//       discourse-level analysis a line regex cannot do without high false-positive cost.
//     - Wh- / "Look," / "So" sentence starters — DEFERRED: pure rhythm tells with very high
//       false-positive rate on legitimate prose; advisory value too low to justify the
//       noise at WARN tier. Left to the system-agent <writing_guidance> prose-quality note.
//
// Rationale for the curation: the implemented families are lexically anchored (fixed
// opener/jargon/adverb tokens) and survive a single-line regex with low false positives.
// The deferred families require cross-sentence or discourse-level structure; shipping them
// as naive regexes would generate noise that undermines the advisory tier. They remain
// candidates for a future structural pass, not a silent omission.
//
// Each pattern: { id, label, regex, severity: 'warn', category, note }

const SLOP_PATTERNS = [
  // ── Throat-clearing openers ────────────────────────────────────────────────
  {
    id: 'throat-clearing-heres',
    label: 'Throat-clearing "here\'s what/this/that/why" opener',
    regex: /\bhere'?s\s+(?:the\s+thing|what|this|that|why|what\s+i\s+(?:mean|find))\b/i,
    severity: 'warn',
    category: 'throat-clearing',
    note: 'Announcement before the point. Cut it and state the point directly.'
  },
  {
    id: 'throat-clearing-truth',
    label: 'Throat-clearing truth/honesty opener',
    regex: /\b(?:the\s+uncomfortable\s+truth\s+is|it\s+turns\s+out|the\s+real\s+\w+\s+is|let\s+me\s+be\s+clear|the\s+truth\s+is,|i'?m\s+going\s+to\s+be\s+honest|can\s+we\s+talk\s+about)\b/i,
    severity: 'warn',
    category: 'throat-clearing',
    note: 'Manufactured-sincerity opener. State the content directly.'
  },

  // ── Emphasis crutches ──────────────────────────────────────────────────────
  {
    id: 'emphasis-crutch',
    label: 'Emphasis crutch',
    regex: /\b(?:full\s+stop\.|let\s+that\s+sink\s+in|this\s+matters\s+because|make\s+no\s+mistake|here'?s\s+why\s+that\s+matters)\b/i,
    severity: 'warn',
    category: 'emphasis-crutch',
    note: 'Adds no meaning. Delete it.'
  },

  // ── Business jargon (prose register; "game-changer" excluded — copy-voice-lint owns it) ──
  {
    id: 'business-jargon',
    label: 'Business jargon',
    regex: /\b(?:navigate\s+(?:challenges?|complexity)|unpack(?:ing)?\b|lean\s+into|the\s+landscape|double\s+down|deep\s+dive|take\s+a\s+step\s+back|moving\s+forward|circle\s+back|on\s+the\s+same\s+page)\b/i,
    severity: 'warn',
    category: 'business-jargon',
    note: 'Replace with plain language.'
  },

  // ── Filler adverbs / hedges ──────────────────────────────────────────────────
  {
    id: 'filler-adverb',
    label: 'Filler adverb / hedge',
    regex: /\b(?:really|just|literally|genuinely|honestly|simply|actually|deeply|truly|fundamentally|inherently|inevitably|interestingly|importantly|crucially)\b/i,
    severity: 'warn',
    category: 'filler-adverb',
    note: 'Empty emphasis. Cut the adverb.'
  },

  // ── Filler phrases ───────────────────────────────────────────────────────────
  {
    id: 'filler-phrase',
    label: 'Filler phrase',
    regex: /\b(?:at\s+its\s+core|in\s+today'?s\s+\w+|it'?s\s+worth\s+noting|at\s+the\s+end\s+of\s+the\s+day|when\s+it\s+comes\s+to|in\s+a\s+world\s+where|the\s+reality\s+is)\b/i,
    severity: 'warn',
    category: 'filler-phrase',
    note: 'Filler. Cut it or name the specific thing.'
  },

  // ── Meta-commentary ──────────────────────────────────────────────────────────
  {
    id: 'meta-commentary',
    label: 'Self-referential meta-commentary',
    regex: /\b(?:hint:|plot\s+twist:|spoiler:|let\s+me\s+walk\s+you\s+through|in\s+this\s+section,?\s+we'?ll|as\s+we'?ll\s+see|i\s+want\s+to\s+explore|the\s+rest\s+of\s+this\s+(?:essay|post)\s+explains)\b/i,
    severity: 'warn',
    category: 'meta-commentary',
    note: 'The piece should move, not announce its own structure.'
  },

  // ── Vague declaratives ─────────────────────────────────────────────────────────
  {
    id: 'vague-declarative',
    label: 'Vague declarative (importance without the specific thing)',
    regex: /\b(?:the\s+reasons?\s+are\s+structural|the\s+implications?\s+are\s+significant|the\s+stakes\s+are\s+high|the\s+consequences?\s+are\s+real|this\s+is\s+the\s+deepest\s+problem)\b/i,
    severity: 'warn',
    category: 'vague-declarative',
    note: 'Announces importance without naming the thing. Name the specific thing.'
  },

  // ── Binary-contrast structures ───────────────────────────────────────────────
  {
    id: 'binary-contrast',
    label: 'Binary-contrast / telegraphed reversal',
    regex: /\b(?:not\s+because\s+.+?[.,]\s*(?:but\s+)?because|isn'?t\s+the\s+problem\.|the\s+answer\s+isn'?t\s+.+?\.\s+it'?s|not\s+just\s+\w+\s+but\s+also|doesn'?t\s+mean\s+.+?,?\s+but\s+actually|the\s+question\s+isn'?t\s+.+?\.\s+it'?s)\b/i,
    severity: 'warn',
    category: 'structure-binary-contrast',
    note: 'Formulaic reframe. State the point directly; drop the negation.'
  },

  // ── Rhetorical setups ────────────────────────────────────────────────────────
  {
    id: 'rhetorical-setup',
    label: 'Rhetorical setup that announces insight',
    regex: /(?:^|[.!?]\s+)(?:what\s+if\s+.+\?|here'?s\s+what\s+i\s+mean:|think\s+about\s+it:|and\s+that'?s\s+okay\.)/im,
    severity: 'warn',
    category: 'structure-rhetorical-setup',
    note: 'Announces insight rather than delivering it. Make the point.'
  },

  // ── False agency / passive voice (no named actor) ──────────────────────────────
  {
    id: 'false-agency',
    label: 'False agency (inanimate subject with human verb)',
    regex: /\b(?:the\s+data\s+tells\s+us|the\s+market\s+rewards|the\s+decision\s+emerges|the\s+culture\s+shifts|the\s+conversation\s+moves\s+toward)\b/i,
    severity: 'warn',
    category: 'false-agency',
    note: 'Name the human actor. People do things; abstractions do not.'
  },
  {
    id: 'passive-no-actor',
    label: 'Actor-hiding passive construction',
    regex: /\b(?:mistakes\s+were\s+made|it\s+is\s+believed\s+that|the\s+decision\s+was\s+reached)\b/i,
    severity: 'warn',
    category: 'passive-voice',
    note: 'Passive hides the actor. Name who did it.'
  },

  // ── Lazy extremes (sweeping false authority) ───────────────────────────────────
  {
    id: 'lazy-extreme',
    label: 'Lazy extreme / sweeping claim',
    regex: /\b(?:everyone|everybody|nobody)\s+(?:knows|does|wants|agrees|thinks)\b/i,
    severity: 'warn',
    category: 'lazy-extreme',
    note: 'False authority. Use specifics instead of sweeping claims.'
  }
];

/**
 * scanSlop — scan text for advisory anti-slop pattern hits.
 * @param {string} text
 * @returns {Array<{ id, label, category, severity, hit, note }>}
 */
function scanSlop(text) {
  const out = [];
  const str = String(text || '');
  for (const p of SLOP_PATTERNS) {
    const m = str.match(p.regex);
    if (m) {
      out.push({
        id: p.id,
        label: p.label,
        category: p.category,
        severity: p.severity,
        hit: m[0].trim(),
        note: p.note
      });
    }
  }
  return out;
}

/**
 * Returns patterns, optionally filtered by category.
 * @param {string} [category]
 */
function getSlopPatterns(category) {
  if (!category) return SLOP_PATTERNS;
  return SLOP_PATTERNS.filter((p) => p.category === category);
}

module.exports = { SLOP_PATTERNS, scanSlop, getSlopPatterns };
