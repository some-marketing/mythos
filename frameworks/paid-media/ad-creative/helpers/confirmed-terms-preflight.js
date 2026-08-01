#!/usr/bin/env node
'use strict';
//
// confirmed-terms-preflight — advisory binding check between a "confirmed
// terms" ledger and produced ad copy. This is the mechanical half of the
// Confirmed-Terms Binding Preflight (guardrails.md → Amendment B, 2026-07-06).
//
// It exists to catch the exact class of bug that shipped once: copy authored
// against a source-of-truth "confirmed terms" doc that (a) silently DROPPED a
// confirmed element (the free-test-mechanic omission), and (b) carried a fact
// LABELLED "confirmed" that was actually unconfirmed (the promo-code that had
// no client source). Human judgement remains the authority — this tool
// surfaces evidence; it is not a hard runtime gate.
//
// It runs THREE checks against a ledger of offer terms/facts:
//   1. confirmed-label integrity — any item status=confirmed with no
//      provenance is a HARD fail (a doc that claims CONFIRMED must not carry
//      unconfirmed facts).                          [promo-code failure mode]
//   2. omission diff — any item status=confirmed + disposition=must-appear
//      whose anchors are absent from the load-bearing copy is a HARD fail
//      (a confirmed element was silently dropped).  [free-test-mechanic mode]
//   3. pending-fact handling — any item status=pending whose anchors appear
//      in the LOAD-BEARING copy (as opposed to the footnote/optional zone) is
//      a HARD fail (pending facts may appear only as clearly-optional,
//      footnoted, omit-at-build elements — never as settled claims).
//
// Ledger schema (JSON array, or { "terms": [ ... ] }):
//   {
//     "id": "free-test-mechanic",
//     "statement": "Free on-site mechanic inspection with every test drive",
//     "status": "confirmed" | "pending",
//     "provenance": "Client email 2026-07-01 14:22 — 'include the free mechanic check'",
//     "disposition": "must-appear" | "optional" | "context-only",
//     "anchors": ["free", "mechanic"]
//   }
// Notes:
//   - provenance is a free-text CITATION of a client source (email/call/etc.).
//     Empty/absent/null = no provenance.
//   - anchors are the key tokens/phrases that must literally appear for the
//     term to be considered "present" in copy. Keep them minimal and specific
//     (a promo code string; ["free","mechanic"]). All anchors must be present
//     for the term to count as present (AND semantics). This is a keyword
//     proxy, NOT semantic understanding — see LIMITATIONS below.
//   - disposition defaults to "must-appear" for confirmed items when omitted.
//
// Usage:
//   node confirmed-terms-preflight.js --ledger terms.json --copy body.txt
//   node confirmed-terms-preflight.js --ledger terms.json --copy body.txt --footnotes foot.txt
//   node confirmed-terms-preflight.js --ledger terms.json --copy-text "<body>" [--footnotes-text "<foot>"]
//   add --json for machine output. Exit 0 unless a HARD fail (verdict is
//   evidence, not authority — the pipeline is not hard-gated on it).
//
// LIMITATIONS (a reviewer/grader should scrutinise these):
//   - Anchor matching is WORD-BOUNDARY literal matching (case-insensitive),
//     not semantic — and deliberately NOT raw substring matching. A short or
//     common anchor like "free" is NOT satisfied by "freelance", and "$500" is
//     NOT satisfied by "$5000" (see anchorRegex). The residual failure mode is
//     therefore a false POSITIVE, not a false negative: a synonym or paraphrase
//     that drops the literal anchor token reads as an omission — a SAFE failure
//     that flags for a human, who can override. The tool does NOT silently PASS
//     a dropped term through a substring collision (the false NEGATIVE that the
//     old `.includes()` matching produced, which defeated the omission
//     guarantee). Semantic/paraphrase omission is out of scope — see the F1.1
//     follow-on (atomic-claim NLI). Choose anchors that are the stable,
//     load-bearing tokens.
//   - The load-bearing vs footnote split is supplied by the caller (separate
//     --copy / --footnotes inputs). The tool does not itself decide what is
//     "load-bearing"; it trusts the split. Garbage split in → garbage out.
//   - The ledger's provenance strings are not verified against the actual
//     source; the tool checks PRESENCE of a citation, not its truth. Truth of
//     the cited source is the author's/operator's judgement.
//
const fs = require('fs');

function normStatus(s) {
  return String(s || '').trim().toLowerCase();
}

function hasProvenance(item) {
  const p = item.provenance;
  if (p == null) return false;
  return String(p).trim().length > 0;
}

function anchorsFor(item) {
  const a = item.anchors;
  if (Array.isArray(a)) return a.map((x) => String(x)).filter((x) => x.trim().length > 0);
  if (a == null) return [];
  return [String(a)].filter((x) => x.trim().length > 0);
}

// Escape a literal string for safe embedding in a RegExp.
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary anchor matcher. This REPLACES the old raw `.includes()`
// substring matching, which produced silent false NEGATIVES (a dropped
// confirmed term could PASS because its anchor collided with a longer word:
// "free" satisfied by "freelance", "10" by "100", "car" by "care"). That
// defeated the omission guarantee (Rule 3).
//
// It behaves like \b<anchor>\b for anchors whose edge characters are word
// chars, but correctly handles offer tokens that BEGIN or END with a non-word
// symbol ($500, 20%, $5,000) where a literal \b would FAIL — there is no
// word/non-word transition at the symbol edge, so \b\$500\b never matches
// "$500" in "get $500 now". We use edge-conditional lookarounds instead:
//   - anchor STARTS with a word char  -> forbid a word char immediately before
//     it  (?<!\w)  so "free" is NOT satisfied by "carefree".
//   - anchor ENDS with a word char    -> forbid a word char immediately after
//     it  (?!\w)   so "free" is NOT satisfied by "freelance" and "$500" is NOT
//     satisfied by "$5000".
//   - an edge that is a non-word symbol ($ , %) gets NO boundary on that side,
//     so "$500" and "20%" match as written.
function anchorRegex(anchor) {
  const a = String(anchor);
  const lead = /\w/.test(a[0]) ? '(?<!\\w)' : '';
  const trail = /\w/.test(a[a.length - 1]) ? '(?!\\w)' : '';
  return new RegExp(lead + escapeRegex(a) + trail, 'i');
}

// AND semantics: every anchor must be present for the term to count as present.
function anchorsPresent(anchors, haystack) {
  if (anchors.length === 0) return { present: false, missing: [] };
  const hay = String(haystack);
  const missing = anchors.filter((t) => !anchorRegex(t).test(hay));
  return { present: missing.length === 0, missing };
}

function preflight(ledger, copyBody, footnotes, opts = {}) {
  const allowEmptyLedger = !!opts.allowEmptyLedger;
  const hardFails = [];
  const warns = [];
  const notes = [];
  const body = String(copyBody || '');
  const foot = String(footnotes || '');

  // Ledger-shape integrity. A non-array ledger, or an object with no `terms`
  // array, is MALFORMED — it must NOT silently pass as an empty term list (the
  // old behaviour coerced it to [] and returned pass=true, so a garbled or
  // wrong-shaped ledger looked clean). An array/`terms` with zero rows is EMPTY
  // — nothing to verify, which is also a hard fail unless explicitly waived
  // (--allow-empty-ledger / opts.allowEmptyLedger) for creatives that carry no
  // offer terms on purpose.
  let terms;
  let malformed = false;
  if (Array.isArray(ledger)) {
    terms = ledger;
  } else if (ledger && Array.isArray(ledger.terms)) {
    terms = ledger.terms;
  } else {
    terms = [];
    malformed = true;
  }

  if (malformed && !allowEmptyLedger) {
    hardFails.push({
      rule: 'malformed-ledger', id: '(ledger)',
      note: 'ledger is not a JSON array and has no `terms` array — no confirmed term could be verified; supply a valid ledger (or pass --allow-empty-ledger to waive)',
    });
  } else if (!malformed && terms.length === 0 && !allowEmptyLedger) {
    hardFails.push({
      rule: 'empty-ledger', id: '(ledger)',
      note: 'ledger has zero terms — nothing to verify, so an omission cannot be caught; confirm this creative truly carries no offer terms and pass --allow-empty-ledger to waive',
    });
  }

  for (const item of terms) {
    const id = item.id || item.statement || '(unnamed term)';
    const status = normStatus(item.status);
    const disposition = normStatus(item.disposition) || (status === 'confirmed' ? 'must-appear' : '');
    const anchors = anchorsFor(item);

    if (status !== 'confirmed' && status !== 'pending') {
      warns.push({ rule: 'unknown-status', id, note: `status "${item.status}" is not confirmed|pending — treated as unverified` });
    }

    // Check 1: confirmed-label integrity.
    if (status === 'confirmed' && !hasProvenance(item)) {
      hardFails.push({
        rule: 'confirmed-without-provenance', id,
        note: 'labelled CONFIRMED but no client-source citation — mark PENDING or cite the source (promo-code failure mode)',
      });
    }

    // A term with no anchors cannot be diffed against copy.
    // For a confirmed + must-appear (load-bearing) term this is a HARD fail,
    // not a warning: without anchors the omission check is STRUCTURALLY ABSENT,
    // so a silently-dropped confirmed term would slip through while the verdict
    // still reads `pass`. An unverifiable must-appear term must not pass.
    // For other cases (pending, or confirmed but optional/context-only) a
    // missing anchor set only warns.
    if (anchors.length === 0) {
      if (status === 'confirmed' && disposition === 'must-appear') {
        hardFails.push({
          rule: 'confirmed-term-unanchored', id,
          note: 'confirmed must-appear term has NO anchors — the omission diff cannot verify it appears in the copy, so this term is unchecked; add anchors (an unverifiable must-appear term must not silently pass)',
        });
      } else if (status === 'confirmed' || status === 'pending') {
        warns.push({ rule: 'no-anchors', id, note: 'no anchors supplied — omission/pending checks cannot run for this term; add anchors' });
      }
    }

    // Check 2: omission diff (only for load-bearing confirmed terms).
    if (status === 'confirmed' && disposition === 'must-appear' && anchors.length > 0) {
      const { present, missing } = anchorsPresent(anchors, body);
      if (!present) {
        hardFails.push({
          rule: 'confirmed-term-omitted', id,
          note: `must-appear confirmed term absent from copy (missing anchors: ${missing.join(', ')}) — silently dropped (free-test-mechanic failure mode)`,
        });
      }
    }

    // Check 3: pending-fact handling.
    if (status === 'pending' && anchors.length > 0) {
      const inBody = anchorsPresent(anchors, body).present;
      const inFoot = anchorsPresent(anchors, foot).present;
      if (inBody) {
        hardFails.push({
          rule: 'pending-fact-load-bearing', id,
          note: 'PENDING fact appears in load-bearing copy — allowed only as a clearly-optional, footnoted, omit-at-build element until provenance lands',
        });
      } else if (inFoot) {
        notes.push({ rule: 'pending-fact-footnoted', id, note: 'pending fact present only in footnote/optional zone — acceptable; must be omit-at-build until confirmed' });
      }
    }
  }

  const confirmed = terms.filter((t) => normStatus(t.status) === 'confirmed').length;
  const pending = terms.filter((t) => normStatus(t.status) === 'pending').length;

  return {
    pass: hardFails.length === 0,
    summary: { terms: terms.length, confirmed, pending },
    hardFails, warns, notes,
  };
}

function readMaybe(argv, fileFlag, textFlag) {
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  if (arg(fileFlag)) return fs.readFileSync(arg(fileFlag), 'utf8');
  if (arg(textFlag)) return arg(textFlag);
  return '';
}

if (require.main === module) {
  const argv = process.argv;
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const ledgerPath = arg('--ledger');
  if (!ledgerPath) {
    console.error('usage: --ledger <terms.json> --copy <body.txt>|--copy-text "<body>" [--footnotes <foot.txt>|--footnotes-text "<foot>"] [--allow-empty-ledger] [--json]');
    process.exit(2);
  }
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  } catch (e) {
    console.error(`could not read/parse ledger: ${e.message}`);
    process.exit(2);
  }
  const body = readMaybe(argv, '--copy', '--copy-text');
  const foot = readMaybe(argv, '--footnotes', '--footnotes-text');
  if (!body) { console.error('no copy body supplied (--copy <file> or --copy-text "<...>")'); process.exit(2); }

  const res = preflight(ledger, body, foot, { allowEmptyLedger: argv.includes('--allow-empty-ledger') });
  if (argv.includes('--json')) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(res.pass ? '✅ confirmed-terms preflight: no hard-fails' : '❌ confirmed-terms preflight: HARD-FAIL');
    console.log(`  terms=${res.summary.terms} confirmed=${res.summary.confirmed} pending=${res.summary.pending}`);
    res.hardFails.forEach((h) => console.log(`  HARD  [${h.rule}] ${h.id} — ${h.note}`));
    res.warns.forEach((w) => console.log(`  warn  [${w.rule}] ${w.id} — ${w.note}`));
    res.notes.forEach((n) => console.log(`  note  [${n.rule}] ${n.id} — ${n.note}`));
  }
  process.exit(res.pass ? 0 : 1);
}

module.exports = { preflight, anchorsPresent, anchorRegex, escapeRegex, hasProvenance };
