'use strict';
//
// tools/mcp/delesign/lib/leak-patterns.js — shared canonical internal-leak pattern list.
//
// Single source of truth used by:
//   - brief-checklist.js (no-internal-leak rule on brief source markdown)
//   - outbound-lint.js   (designer message pre-send gate)
//   - stakeholder-voice-linter agent
//
// Each pattern: { id, label, regex, level, description }
//   level: 'block' — must prevent send | 'warn' — flag for operator review
//
// OVERRIDE PATH: An `--ack-intentional <id>` flag on the CLI (or ackIds[] in code)
// bypasses a specific blocker by its id, with the acknowledgment logged. This
// enables deliberate exceptions without silently degrading the gate.
// The override MUST be explicit — passing an ackId suppresses only the named pattern.

const PATTERNS = [
  // ── Hard blockers ──────────────────────────────────────────────────────────

  {
    id: 'agency-name',
    label: 'Agency name leak',
    // EXAMPLE ONLY — replace with your own agency name / internal brand tokens.
    regex: /your\s+agency\s+name|youragency\.example|YOUR_INTERNAL_CODE/i,
    level: 'block',
    description: 'Agency name / internal brand must not appear in designer messages'
  },

  {
    id: 'wikilinks',
    label: 'Wiki-style link [[...]]',
    // [[any text]]
    regex: /\[\[[^\]]+\]\]/,
    level: 'block',
    description: 'Double-bracket wikilinks are internal tooling notation; strip before sending'
  },

  {
    id: 'dart-task-id',
    label: 'Dart task ID',
    // Dart IDs are 26-char base62 (alphanum, typically mixed case like mnkG6ukXsrxO)
    // A conservative match: 20-30 char alphanum-only tokens that look like IDs
    regex: /\b[A-Za-z0-9]{20,30}\b/,
    level: 'block',
    description: 'Apparent Dart task ID — internal project management reference; remove'
  },

  {
    id: 'repo-abs-path',
    label: 'Repo / absolute path',
    // Catches /Users/..., tools/mcp/..., clients/..., _dev/...
    regex: /\/Users\/[^\s]+|tools\/mcp\/|clients\/[A-Z]{2,8}\/|_dev\//,
    level: 'block',
    description: 'Absolute or repo-relative file path; internal only — remove before sending'
  },

  {
    id: 'internal-jargon',
    label: 'Internal system jargon',
    // EXAMPLE terms — replace with your own internal-tooling vocabulary
    // (whatever words your team uses for orchestration/harness/etc. that a
    // designer would find meaningless or alarming).
    regex: /\b(convene|orchestrate|kernel|harness)\b/i,
    level: 'block',
    description: 'Internal system vocabulary — replace with plain language'
  },

  {
    id: 'tbd-flag',
    label: '[TBD] / [flag] scaffolding',
    // [TBD], [FLAG], [DECISION NEEDED], [TODO]
    regex: /\[TBD\]|\[flags?\b[^\]]*\]|\[decision\b[^\]]*\]|\[TODO\]/i,
    level: 'block',
    description: 'Scaffolding placeholder not resolved — complete before sending'
  },

  // ── Warnings (operator should review, not hard block) ─────────────────────

  {
    id: 'operator-term',
    label: '"operator" as internal role term',
    // "operator" alone could be legitimate (e.g., "crane operator" in copy) — warn only
    regex: /\boperator\b/i,
    level: 'warn',
    description: '"operator" may be internal-tooling jargon if used in a systems/instruction context; verify it refers to a real-world person/role in context'
  },

  {
    id: 'internal-model-ref',
    label: 'Internal AI model reference',
    // Claude, Sonnet, Opus, Haiku, Gemini, Codex in a message to a designer is odd
    regex: /\b(claude|sonnet|opus|haiku|gemini|codex)\b/i,
    level: 'warn',
    description: 'AI model name in a designer message; verify this is intentional'
  },

  {
    id: 'lufs-backstory',
    label: 'Internal system backstory',
    // EXAMPLE — swap for your own team's internal-only technical jargon that's
    // unlikely to appear legitimately in a designer-facing message.
    regex: /\bLUFS\b/,
    level: 'warn',
    description: 'LUFS is an internal audio/system backstory term; confirm relevance'
  },
];

/**
 * Returns a subset of patterns by level.
 * @param {'block'|'warn'|'all'} [level='all']
 */
function getPatterns(level) {
  if (!level || level === 'all') return PATTERNS;
  return PATTERNS.filter((p) => p.level === level);
}

/**
 * Returns the pattern with the given id, or null.
 */
function getPatternById(id) {
  return PATTERNS.find((p) => p.id === id) || null;
}

module.exports = { PATTERNS, getPatterns, getPatternById };
