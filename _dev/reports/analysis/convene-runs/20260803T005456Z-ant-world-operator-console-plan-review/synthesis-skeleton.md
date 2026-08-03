# Convene synthesis skeleton

**Scope:** ant-world-operator-console-plan-review
**Timestamp:** 2026-08-03T00:57:27.298Z
**Origin:** claude
**Profile:** code-review (Code review triad)
**Consequence-grade profile:** yes
**Participant slots convened:** truth/codex

## Task

DISTINCT-FAMILY ADVERSARIAL REVIEW of the attached task plan 'ant-world-operator-console' (producer family: claude; you are the distinct reviewer). This is the review leg of /bp-r. Verdict required: APPROVE, APPROVE-WITH-CHANGES, or CHANGES-REQUIRED, with numbered findings. Review against REPO TRUTH — the plan makes specific claims about existing code in tools/ant-hive-world/ and you should verify them rather than trusting them. Check specifically: (1) Are the plan's factual claims about the existing codebase CORRECT? It claims dashboard.js already has a live-tunable config form, that live-config.js is re-read every round by run-live.js without restart, that lore-engine/detect-triggers.js is read-only over audit-log.jsonl and world-state.json per a COSMETIC-ONLY gate and ships DEFAULT_STRUCTURE_MILESTONE_COUNTS = [5,10,25,50], that harness.js emits material-discovered audit events by diffing discovered_types, that world-state.js keeps a geometry_log with build kind and coords, and that run-live.js holds network weights only in process memory so a restart loses them. Verify each; any that is wrong is a blocking finding. (2) Is the OQ4 resolution sound — does writing a new lexicon.json artifact actually respect the lore-engine's COSMETIC-ONLY read-only gate, or does it violate the spirit of that gate? (3) Is the OQ3 threshold resolution sound — is reusing DEFAULT_STRUCTURE_MILESTONE_COUNTS as the lexicon unlock ladder appropriate, or is it a false economy that conflates two unrelated concepts? (4) The plan's central design claim is that counting logged events (what was built, what terms recurred) makes NO claim about mind internals and therefore escapes the interpretability critique that killed an earlier framing. Is that escape genuine, or does the lexicon smuggle representational claims back in through the 'grounded behavioural definition' and the labelled 'our reading' line? (5) S4b was added mid-drafting on operator intervention: the plan now names a problem battery as a PRECONDITION for the research thesis and defers it to its own charter. Is deferring correct, or does deferring it make S3 (console surfaces) premature — i.e. should the console plan be blocked until the battery is chartered, since the console's panels may need to be shaped by what the battery measures? (6) Are the falsifiers real falsifiers — could each actually fail? Specifically the empty-lexicon test (wiki renders empty) and the nonce-term negative control. (7) Anything the plan omits that would bite during execution. Be concrete, cite file:line, and state plainly if the plan should not proceed as written. REVIEW_ONLY — change nothing.

## Triad slots

- INTENT / claude — Clarify requested behavior and integration boundaries. (Claude (fast reasoning, orchestration, in-session execution))
- TRUTH / codex — Check source, tests, contracts, and executable repo facts. (Codex (slow rigor, code-truth verification))
- EDGE / gemini — Look for missed cases, broader implications, and alternate framing. (Gemini (contextual breadth, reframing, big picture))

## INTENT / claude

[ORIGIN SLOT/ACTOR FILLS THIS IN AFTER READING PARTICIPANT RESPONSES]

## TRUTH / codex

See truth__codex.md in this directory. Status: success.

## EDGE / gemini

(not called)

## Cross-verification catches

[SYNTHESIS SECTION: which slot caught which issue, where they agreed, where they disagreed, where any slot was wrong or too narrow]

## Net findings

[ONE-VOICE SUMMARY: speak as the kernel/profile, not as three consultants. Preserve unresolved disagreement explicitly.]
