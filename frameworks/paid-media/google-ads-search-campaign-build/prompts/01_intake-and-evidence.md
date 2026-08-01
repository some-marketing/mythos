# 01 — Intake and Evidence

- Step ID: 01
- Name: intake-and-evidence
- Execution mode: FINDINGS_ONLY

## Goal
Establish the evidence base the rest of the framework will build on. No recommendations yet — just a cited inventory of what is known about the account, the business, and prior Search performance.

## Inputs expected
- Client code and project name (operator input).
- Google Ads customer_id (and MCC id if applicable).
- Any prior plan artifacts in `_dev/reports/analysis/task-plans/` for this account.
- Prior poll outputs (e.g., {CLIENT_CODE} account poll referenced in the parent plan) and any existing Plan A outcome notes.
- Landing page URLs and offer description.

## Process
1. Resolve the client project path and read `project.json`; note domain(s), offer(s), service area(s).
2. Load prior Search performance via the google-ads MCP (GAQL read-only): last 90d campaign/ad-group/keyword/search-term rows. Cache raw rows to the preview bundle.
3. Read any HH-account-poll or Plan A artifacts named in the parent plan. Do not re-derive — cite.
4. Inventory existing conversion actions: names, categories, counts, attribution model, include-in-conversions flag.
5. Inventory geo targets and exclusions already present on the account.
6. Enumerate offers / intents / money pages that Search should cover; mark which have landing pages and which don't.
7. List known constraints: compliance language (medical, legal), brand voice notes, prior disapprovals.
8. Flag evidence gaps with `[evidence-citation-pending]`. Do not invent.

## Output artifact
`outputs/google-ads-search-campaign-build/01_intake-and-evidence.md` with sections: Account Snapshot, 90d Search Performance, Conversion Actions, Geo, Offers and Money Pages, Constraints, Evidence Gaps. Preview-bundle compatible (JSON sidecar with raw GAQL rows).

## Gates before advancing
Observer gate: every non-trivial claim has a citation (GAQL row, file path, or operator statement). Evidence gaps are listed, not hidden. Operator confirms the snapshot matches reality.

## Distilled principle
**Evidence precedes recommendation.** Do not write a plan against an account you have not read. The first pass of any Search build is a read, not a write.
- Evidence basis: repo convention (observational reporting, grounding check #15); parent plan cites prior {CLIENT_CODE} poll as the correct starting posture.
- Failure conditions: accounts with <30d history or zero conversions — in those cases, evidence is thin and the observer gate loosens to "document the thinness," not "fabricate baseline."
- Citation: (ratified 2026-06-08 — see `frameworks/_shared/reference/google-ads-account-review-2025-2026.md`) — no God Tier Ads source for intake; pulled from Mythos repo convention.
