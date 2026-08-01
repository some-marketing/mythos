---
similarity_tags: [kernel, doctrine, index, load-order, provenance-policy, graduation]
domain: kernel
surfaces:
  - instructions/canonical/kernel/doctrine/index.md
  - instructions/canonical/kernel/doctrine/triad-is-a-truth.md
  - instructions/canonical/kernel/doctrine/opposites-spectra-absence.md
  - instructions/canonical/kernel/doctrine/effortless-knowing-telos.md
  - instructions/canonical/kernel/doctrine/letter-vs-intent.md
  - instructions/canonical/kernel/doctrine/manifest.yaml
related_artifacts:
  - instructions/canonical/kernel/doctrine/triad-is-a-truth.md
  - instructions/canonical/kernel/doctrine/opposites-spectra-absence.md
  - instructions/canonical/kernel/doctrine/effortless-knowing-telos.md
  - instructions/canonical/kernel/doctrine/letter-vs-intent.md
  - _dev/concepts/doctrine-lobe/concept.md
  - ${HOME}/.claude/projects/{PROJECT_SLUG}/memory/feedback_triad_is_a_truth.md
  - ${HOME}/.claude/projects/{PROJECT_SLUG}/memory/feedback_opposites_vs_spectra_vs_absence.md
  - ${HOME}/.claude/projects/{PROJECT_SLUG}/memory/feedback_effortless_knowing_in_the_moment.md
  - ${HOME}/.claude/projects/{PROJECT_SLUG}/memory/feedback_letter_vs_intent_preserve_intent.md
kernel_level: system
state_lifecycle: draft
source_memory_paths:
  - ${HOME}/.claude/projects/{PROJECT_SLUG}/memory/feedback_triad_is_a_truth.md
  - ${HOME}/.claude/projects/{PROJECT_SLUG}/memory/feedback_opposites_vs_spectra_vs_absence.md
  - ${HOME}/.claude/projects/{PROJECT_SLUG}/memory/feedback_effortless_knowing_in_the_moment.md
  - ${HOME}/.claude/projects/{PROJECT_SLUG}/memory/feedback_letter_vs_intent_preserve_intent.md
encoded_at: 2026-05-07T08:02:00-0300
encoded_by_session: 0e75f96f-65a6-4fad-9970-3f2019bde2d7
---

# Doctrine — index

This index is the entry point to the doctrine lobe. The doctrine lobe holds load-bearing kernel principles distilled from operator memory. The principles are named for retrieval; this file names the load order, the provenance policy, the graduation conditions, and a warning against reading the lobe as a lookup table.

The principles themselves live in their own files. Do not duplicate principle text here. Read each principle in full at the moment of action; doctrine resists summarization.

## Load order

Read in this order. Each principle after the first textually depends on the triad doctrine — references back to it are intentional and load-bearing.

1. `triad-is-a-truth.md` — three-ness is ontologically primary; the third thing is the substrate.
2. `opposites-spectra-absence.md` — most apparent opposites are spectra, absences, or third things; check before reasoning across.
3. `effortless-knowing-telos.md` — the kernel's success criterion is effortlessness at the moment of action.
4. `letter-vs-intent.md` — when letter and intent diverge, preserve intent; sanitization must reach pattern-identity.
5. `dialectic-over-fear.md` — a feeling is a producer-claim to verify, not obey; dialectic-in-the-gap, risk-scaled, never a wall. (Added 2026-05-31 as a draft fifth principle; carries an operational falsifier.)
6. `do-no-harm.md` — no actor harms another actor's in-flight process; inter-actor non-interference, risk-scaled. (Draft 2026-05-31; the named purpose of cross-session-scope-isolation.)
7. `leave-no-trace.md` — own and fix your own residue immediately, or leave an owned blocked-repair record; NOT "leave no artifacts." (Draft 2026-05-31; extends dialectic-over-fear signal 4.)

The order is read-order, not priority-order. None of the seven can be cut without the others losing structural support.

## Provenance policy

Each principle file carries two body sections:

- `## Original wording` — the operator's verbatim quote(s) with source citation. Operator wording wins on conflict; typos and casual phrasing are preserved per `feedback_preserve_operator_voice_in_encoding.md`.
- `## Truest interpretation` — the synthesized doctrine reading, labeled as such. Interpretation can be revised; verbatim cannot.

`manifest.yaml` carries SHA-256 hashes of both sections per principle, so drift between original wording and a later edit is detectable. Hash regeneration is part of any authoring change to either section.

Source memory paths are recorded in each file's frontmatter `source_memory_paths` and in `manifest.yaml` `memory_source_path`. The kernel doctrine canonicalizes the operator memory; it does not replace it.

## Graduation conditions

`state_lifecycle: draft` is the honest first publication of these principles. Draft is not a placeholder for "almost active" — it is the truthful state for a doctrine artifact that has been authored, cross-verified at authoring time, and not yet survived the operator-gated process required to call it active.

Promotion from draft to active is a SEPARATE, operator-gated plan-task, not an authoring side-effect and not auto-promotion on time-elapsed.

The concrete graduation threshold is not yet ratified. Candidate criteria
under consideration (none of these alone graduate the doctrine; each must
still be confirmed in an explicit operator graduation review):

- N operator reaffirmations across distinct sessions without revision to the verbatim or interpretation sections.
- Survival across K control-loop cycles without an operator correction that would force a revision.
- Explicit operator decision in a graduation review, citing observed evidence.

### Graduation-review trigger

To prevent the PLACEHOLDER state from silently calcifying into a permanent
resting place, a concrete *scheduling* trigger is set here. This trigger does
not graduate the doctrine — it schedules the review in which graduation could
happen.

**Trigger:** A graduation review is scheduled when **either** of the following
is observed:

1. **20 control-loop cycles** have completed since `encoded_at`
   (2026-05-07T08:02:00-0300) in which all four doctrine principles were
   loaded by `codex-bridge.js` and/or read by the session grounding card, and
   no operator correction was issued that would force a revision to verbatim
   or interpretation. A "control-loop cycle" is a session that ran at least
   one bridge dispatch with `grounding_mode` set to a non-none value, or one
   session-tier reflex pass.

2. **The kernel calendar reaches 2026-08-26** (three months from this
   trigger's authoring), whichever comes first.

When the trigger fires, the next operator action of authoring weight in the
kernel must include either:

- Opening the graduation review plan-task, OR
- An explicit decision to defer the review with a named reason and a new
  trigger date.

Silence after the trigger fires is itself an event that the next ground-in-
philosophy check-in must surface as drift. The trigger exists so that
PLACEHOLDER cannot remain comfortable indefinitely.

Whichever threshold is ratified, graduation requires an explicit operator
decision recorded in a graduation artifact. Time alone does not graduate
doctrine. Silence is not consent. The trigger above schedules attention;
attention does not equal graduation.

## Provisionality note — do not read this lobe as a lookup table

The non-rigid-mapping rule from `triad-is-a-truth.md` applies recursively to the doctrine lobe itself. The seven principles are not a per-cell lookup table indexed by situation. They are interlocking principles that compose; reading one in isolation, or trying to map principle A onto principle B as a corner-to-corner correspondence, is the same misencoding the triad doctrine warns against.

Doctrine is read at moment of action against the actual situation, not retrieved as a recipe. If the lobe ever feels like a checklist, that feeling is a doctrine smell — an early signal of premature freezing. Stop, re-read the relevant principle in full, and check whether the situation is asking for a third-thing move that no single principle covers cleanly.

## What is NOT in this index

- Manifest body content. `manifest.yaml` is a separate file with its own format (no frontmatter, pure YAML metadata).
- ~~A fifth principle.~~ **Updated 2026-05-31:** the lobe now ships **seven** draft principles — `dialectic-over-fear.md` (5th), `do-no-harm.md` (6th), `leave-no-trace.md` (7th), each added through the same cross-verification path the original four require (convene + Codex falsifier-verify + operator ratification of direction, falsifier, and promotion-as-draft). An *eighth* principle is not in this draft; further additions go through that same path.
- Promotion logic. Promotion lives in a separate plan-task, not here.
