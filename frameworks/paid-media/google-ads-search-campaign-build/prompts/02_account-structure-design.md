# 02 — Account Structure Design

- Step ID: 02
- Name: account-structure-design
- Execution mode: FINDINGS_ONLY

## Goal
Propose the campaign and ad-group topology for the build. This is the architectural step — get it wrong and every later step inherits the damage.

## Inputs expected
- Step 01 output (intake-and-evidence).
- Offer/intent inventory from step 01.
- Operator preferences on geo split, brand vs. non-brand separation, budget concentration.

## Process
1. Cluster offers/intents from step 01 into coherent campaign buckets. Clustering rule: shared bid strategy, shared geo, shared budget pacing, shared measurement story.
2. Draft the campaign list. For each: name (naming-convention compliant), theme, geo scope, budget intent, intended bid strategy (finalized in step 03), conversion goal.
3. Within each campaign, draft ad groups grouped by intent tightness (one intent cluster per ad group). Err toward fewer, tighter groups than many sprawling ones.
4. Separate brand from non-brand into distinct campaigns. Separate high-intent money-page terms from research-stage terms.
5. Apply the naming convention from `KnowledgeBase/2_Structure_Hygiene/naming_conventions.xml` (read during execution; summarize the rule in the artifact).
6. Explicitly enumerate what is NOT in v1: no PMax, Shopping, YouTube, or Scripts surface.
7. For each campaign, declare the success signal (what would make the structure gate close positively in 30 days).
8. Produce a topology diagram (markdown list/tree) in the artifact.

## Output artifact
`outputs/google-ads-search-campaign-build/02_account-structure-design.md` with sections: Clustering Rationale, Campaign List, Ad-Group Topology, Naming Convention Applied, Exclusions (v1 non-goals), Success Signals. JSON sidecar listing campaigns and ad groups in preview-bundle-compatible form.

## Gates before advancing
Structure gate: topology is justified against step 01 evidence, naming convention applied, brand/non-brand split explicit, v1 exclusions stated.

## Distilled principles

**One intent per ad group.** Ad groups are intent containers, not keyword dumping grounds. Mixing intents inside a single ad group forces RSAs to compromise relevance across all of them and degrades Quality Score.
- Evidence basis: Ed Leake, Planning/Account Structure Dogma and Building/Account Structure Q&A — the "tight themes" heuristic at account scale. (ratified 2026-06-08 — see `frameworks/_shared/reference/google-ads-account-review-2025-2026.md`)
- Failure conditions: very low-volume ad groups (<5 clicks/week) may need merging for learning signal; tight-theming then becomes a bet against statistical power.

**Separate brand from non-brand at the campaign level.** Brand traffic behaves differently (higher CTR, lower CPC, often incremental-debate territory). Sharing a campaign with non-brand distorts bid strategy learning and budget allocation.
- Evidence basis: Ed Leake, Planning/Account Structure Dogma. (ratified 2026-06-08 — see `frameworks/_shared/reference/google-ads-account-review-2025-2026.md`)
- Failure conditions: micro-accounts where separation starves either campaign of conversion volume below the bid strategy learning threshold.
