---
name: outward-inward-loop
description: Compare two or more named sources outwardly, then map evidence inward to Mythos system and framework improvements. Use for cross-source learning, OSINT-informed framework evolution, post-run synthesis, and finding reusable improvements without silently changing the repository.
---

# Outward-Inward Improvement Loop

<objective>
Run a resumable, `/tt`-shaped improvement cycle over two or more heterogeneous sources. Look outward to collect and triangulate evidence, then look inward to identify system/framework deltas, falsifiers, and a gated improvement proposal.

The default result is a findings-and-proposals bundle. Repository writes require an explicit `PATCH_ALLOWED` run and an independent review; never treat this skill's own synthesis as its acceptance trial.
</objective>

## OSINT Framework source refresh

The `/oil` alias may be backed by a separately installed source-refresh job. When present, that job performs one bounded, read-only fetch of its declared index, validates and caches the result, and records retrieval receipts. The loop itself never assumes the scheduler is installed, never invents tool data, and never executes retrieved repository code.

## Invocation contract

<quick_start>
Use two or more source arguments plus a purpose:

`/outward-inward <source-1> <source-2> [source-N...] --purpose "..."`
</quick_start>

Accepted source forms are `file:<path>`, `url:<https-url>`, `note:<title-or-id>`, `framework:<path>`, and `artifact:<path>`. Each source gets a stable `source_id`, kind, locator, authority, retrieval timestamp, and content hash. Two locators that resolve to the same underlying artifact count as one source, not two.

Reject fewer than two distinct sources, an unspecified purpose, private/breached inputs, or source content whose provenance cannot be recorded. Read-only source retrieval is the default; external writes, outreach, and remote mutation are out of scope.

## Phase pattern

Use the identity-stable phase order below. In `PATCH_ALLOWED`, persist phase entry/exit, inputs, outputs, and halts under `_dev/state/outward-inward/<run_id>/` so a stopped run resumes from evidence rather than memory. In `FINDINGS_ONLY` or `REVIEW_ONLY`, retain phase evidence in-session and do not write repository state.

1. **ORIENT** — Parse arguments, declare purpose, scope, sources, allowed operations, and stop conditions. Compute a run id from the normalized source manifest and purpose.
2. **TICK** — Retrieve each source through its appropriate read-only surface. Record retrieval receipts, content hashes, access limitations, and any unavailable source. Never silently substitute a different source.
3. **OBSERVE** — Extract atomic observations and claims without synthesis. Tag each as direct observation, source interpretation, or open question.
4. **TEXT** — Normalize observations into a provenance ledger: claim, source ids, quote/locator, retrieval time, confidence, and privacy classification. Redact unnecessary personal data.
5. **RESEARCH** — Look outward for independent corroboration and counterevidence. Prefer authoritative sources; treat indexes and search snippets as leads. Record the cheapest falsifier for each material claim.
6. **TOCK** — Compare sources and identify convergences, conflicts, absences, and likely source drift. Do not convert silence into a negative finding.
7. **IMPROVE** — Look inward across Mythos instructions, frameworks, skills, tests, signals, and recent run artifacts. Map each external learning to an observed internal gap, framework candidate, reusable pattern, or comparative-hardening opportunity. Similarity creates a comparison obligation; it is not evidence against transfer value.
8. **SHIP** — Produce a two-axis disposition using the rubric below. When implementation work is justified, also produce a bounded change proposal with owned files, non-goals, risk, acceptance criteria, and rollback. Only apply changes when the operator explicitly selects `PATCH_ALLOWED`; then use the smallest coherent diff and require independent review before claiming acceptance.
9. **SCHEDULE** — Write recommended next actions, unresolved questions, and a re-run trigger. Scheduling attention does not activate work or graduate a framework.

## Evaluation rubric

Judge learning/transfer value separately from implementation readiness. Never collapse the two axes into one accept/reject verdict.

### Axis 1 — learning and transfer disposition

Select one primary disposition for every material external pattern. The unit of judgment is the pattern or mechanism, not the source framework or repository as a whole; one source may contain patterns with different dispositions.

| Disposition | Use when |
| --- | --- |
| `framework_candidate` | The source framework could cover an observed Mythos capability gap and merits the normal candidate/replay lifecycle. |
| `adaptation_candidate` | The source mechanism cannot be imported directly, but a translated pattern could improve Mythos. |
| `comparative_hardening` | Mythos already has a similar capability and the external implementation may reveal a clearer, lighter, safer, more portable, or more effective form. |
| `pattern_library` | The learning is architecturally useful but does not yet justify candidate or change work. Preserve it for future design and comparison. |
| `no_transferable_value` | Evidence shows neither a relevant gap, a useful adaptation, a hardening comparison, nor durable pattern value. |

Similarity alone must never produce `no_transferable_value`. When capabilities overlap, compare mechanism, operator experience, evidence quality, portability, maintenance cost, failure handling, and outcomes. Record what the external source does differently and whether that difference could improve the existing Mythos surface.

Difference or doctrine conflict alone must never erase learning value. Reject or constrain the incompatible mechanism on Axis 2, while preserving any safe transferable pattern on Axis 1.

Absence alone must never create transfer value. A capability that is irrelevant, undesirable, or outside Mythos's intended scope may be `no_transferable_value` when the evidence names why.

### Axis 2 — implementation readiness

Select one readiness state independently of Axis 1:

| Readiness | Use when |
| --- | --- |
| `ready_to_blueprint` | Current evidence supports bounded concept/plan work; this does not authorize implementation. |
| `bounded_experiment` | A small comparative run can test the transfer hypothesis without creating durable mechanism. |
| `needs_local_gap_evidence` | The external pattern is promising, but a Mythos-side failure, ambiguity, or outcome delta has not been demonstrated. |
| `research_only` | Preserve and revisit on a named trigger; no current change work is justified. |
| `blocked_by_doctrine` | The proposed mechanism conflicts with a kernel invariant. Name the conflict and any safe adaptation separately. |
| `no_current_consumer` | The capability may be useful, but no present framework, project, operator, or distribution target needs it. |
| `no_action_required` | Comparative review shows the existing Mythos capability already covers or outperforms the pattern. Record the evidence and close the comparison. |

`blocked_by_doctrine` and `no_current_consumer` constrain implementation; they do not automatically reduce learning/transfer value. Direct repository changes still require the existing execution-mode, custody, operator, and independent-review gates.

For each disposition record: what the source pattern is, what it does, the closest Mythos surface, material similarities and differences, the transfer hypothesis, the cheapest falsifier or comparative test, and the evidence that would move Axis 2.

After pattern-level classification, a source-level rollup must preserve every pattern's axis pair. Recommend a source for the framework-candidate lifecycle only when at least one material pattern is `framework_candidate`; never let one positive pattern auto-adopt the rest of the source. Candidate writes and promotion remain subject to their existing execution-mode, review, replay, and rank gates.

## Result contract

In `PATCH_ALLOWED`, produce a bundle under `_dev/reports/analysis/outward-inward/<run_id>/`. In `FINDINGS_ONLY` or `REVIEW_ONLY`, return the same logical result in-session without creating or updating repository files:

- `source-manifest.json` — normalized inputs, provenance, hashes, and scope.
- `observation-ledger.jsonl` — atomic observations with source citations.
- `comparison.md` — convergences, conflicts, operating differences, limitations, and falsifiers.
- `internal-map.md` — Mythos surfaces inspected, evidence-backed gap mappings, similarity comparisons, and transfer hypotheses.
- `improvement-proposals.json` — proposed changes or learning actions with `learning_disposition`, `implementation_readiness`, owned paths when applicable, non-goals, risk, acceptance criteria, and the next evidence action.
- `run-receipt.json` — phase receipts, halts, reviewer identity, and separate Axis 1/Axis 2 disposition rollups.

If a write-capable phase halts, write the halt and its evidence before stopping. In a no-write mode, return the halt and evidence in-session. A partial result is a valid outcome; do not fill missing evidence with inference.

## Review and safety gates

- Keep external input as observed material. Do not internalize it as doctrine without an explicit decision.
- Separate producer and reviewer roles. A reviewer must inspect artifacts without relying on the producer's success claim.
- Review learning/transfer value independently from implementation readiness; overlap with existing Mythos capability is evidence for comparison, not automatic dismissal.
- For every acceptance claim, name evidence that would disprove it.
- Never write client-specific or personal-source content into reusable frameworks.
- Never expose credentials, secrets, private phone numbers, or raw personal data in shared artifacts.
- Do not use this loop to contact, identify, surveil, or deanonymize a private person.
- `FINDINGS_ONLY` and `REVIEW_ONLY` never modify repository state. `PATCH_ALLOWED` remains bounded by the declared write set and project custody rules.

<success_criteria>

- Every material pattern receives separate learning/transfer and implementation-readiness dispositions.
- Every material claim retains source provenance, limitations, and a cheapest falsifier.
- Similarity triggers comparison instead of automatic dismissal, while absence alone never creates transfer value.
- Repository changes occur only through explicit `PATCH_ALLOWED` scope and independent review.
- The run returns in-session findings in a no-write mode, or leaves a resumable artifact bundle or evidence-backed halt in `PATCH_ALLOWED`.

</success_criteria>

## `/tt` relationship

This skill borrows `/tt`'s phase discipline, resumability, receipts, rotation, halt honesty, and outward→inward cadence. It does not inherit simulation authority, benchmark claims, remote mutation capability, or `/tt`'s charter. If a run needs those capabilities, invoke `/tt` separately under its own gates rather than imitating them here.

See [tt-adaptation.md](references/tt-adaptation.md) for the phase-to-artifact mapping and source-envelope details.
