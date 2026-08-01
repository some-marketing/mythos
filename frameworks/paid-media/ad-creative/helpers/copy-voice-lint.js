#!/usr/bin/env node
'use strict';
//
// copy-voice-lint — advisory, severity-tiered anti-AI-tells lint for ad copy.
// Ratified by the ad-creative-human-voice convene (2026-06-19). The council was
// explicit: a HARD style lint over-blocks legitimately punchy retail copy and
// pushes writers into bland minimalism. So:
//   HARD-FAIL  → only objective, non-stylistic items (banned non-spoken
//                connectives; >1 primary offer in one ad).
//   WARN       → stylistic tells (em-dash density, triadic lists, long
//                sentences). A warn needs a human rationale or rewrite, NOT
//                automatic rejection.
//
// Usage:
//   node copy-voice-lint.js --text "<copy>"
//   node copy-voice-lint.js --file path/to/copy.txt
//   add --json for machine output. Default exit: 0 unless a HARD-fail (or
//   --strict, which also fails on warns).
//
const fs = require('fs');

// High-value, low-false-positive: phrases a real person does not say.
const BANNED_CONNECTIVES = [
  /\bmeet the\b/i, /\bdiscover\b/i, /\belevate\b/i, /\bunlock\b/i,
  /\bnestled\b/i, /\bin today'?s fast-paced\b/i, /\bpair it with\b/i,
  /\blook no further\b/i, /\bunleash\b/i, /\bseamless(ly)?\b/i,
  /\bgame-?changer\b/i, /^plus,/im,
];
// Crude single-ad offer-token families; >1 distinct family in one ad = stacking.
const OFFER_FAMILIES = {
  finance_rate: /\b\d+(\.\d+)?\s*%\b|\bfinanc/i,
  payment: /\bbi-?weekly\b|\$\d+\s*(\/|per|every)/i,
  rebate: /\brebate\b|\b\$\d{3,}\s*(back|off)\b/i,
  freebie: /\bfree\b|\bon us\b|\bgift\b/i,
  discount: /\b\$\d[\d,]*\s*off\b|\bsave\b/i,
};

function lintCopy(text) {
  const hardFails = [];
  const warns = [];

  for (const re of BANNED_CONNECTIVES) {
    const m = text.match(re);
    if (m) hardFails.push({ rule: 'banned-connective', hit: m[0], note: 'non-spoken / AI-register phrase' });
  }

  const offers = Object.entries(OFFER_FAMILIES).filter(([, re]) => re.test(text)).map(([k]) => k);
  if (offers.length > 1) {
    hardFails.push({ rule: 'multi-offer', hit: offers.join(' + '), note: 'one ad = one message; split offers (legal boilerplate is exempt)' });
  }

  const emDashes = (text.match(/—/g) || []).length;
  if (emDashes >= 2) warns.push({ rule: 'em-dash-cadence', hit: `${emDashes} em-dashes`, note: 'AI rhythm; vary or cut' });

  // Triadic comma list: "a, b, c" (3+ comma-joined short items) — warn only.
  if (/\b[\w$%.-]+\s*,\s*[\w$%.-]+\s*,\s*(and\s+)?[\w$%.-]+/i.test(text)) {
    warns.push({ rule: 'triadic-list', hit: 'comma-triad', note: 'possible feature-stack; confirm it is real speech, not a spec dump' });
  }

  for (const s of text.split(/(?<=[.!?])\s+/)) {
    const words = s.trim().split(/\s+/).filter(Boolean).length;
    if (words > 15) warns.push({ rule: 'breath-break', hit: `${words}-word sentence`, note: 'over a breath; target grade 5–7' });
  }

  return { pass: hardFails.length === 0, hardFails, warns };
}

if (require.main === module) {
  const argv = process.argv;
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const text = arg('--file') ? fs.readFileSync(arg('--file'), 'utf8') : arg('--text');
  if (!text) { console.error('usage: --text "<copy>" | --file <path> [--json] [--strict]'); process.exit(2); }
  const res = lintCopy(text);
  const strictFail = argv.includes('--strict') && res.warns.length > 0;
  if (argv.includes('--json')) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(res.pass ? '✅ no hard-fails' : '❌ HARD-FAIL');
    res.hardFails.forEach((h) => console.log(`  HARD  [${h.rule}] ${h.hit} — ${h.note}`));
    res.warns.forEach((w) => console.log(`  warn  [${w.rule}] ${w.hit} — ${w.note}`));
  }
  process.exit(res.pass && !strictFail ? 0 : 1);
}

module.exports = { lintCopy, BANNED_CONNECTIVES, OFFER_FAMILIES };
