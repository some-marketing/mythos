# 04 — Keywords and Match Types

- Step ID: 04
- Name: keywords-and-match-types
- Execution mode: REVIEW_ONLY

## Goal
Produce the keyword plan per ad group with match types assigned and a seed negative-keyword list. Apply a decision matrix, not intuition.

## Inputs expected
- Step 02 ad-group topology.
- Step 01 90d search-term report data.
- Step 03 budget constraints (influences match-type aggressiveness).

## Process
1. For each ad group, produce the keyword list grouped by match type. Target 5-20 keywords per ad group; if it exceeds 20, the ad group is probably two ad groups.
2. Apply match-type methodology:
   - Exact for terms with proven conversion history or clear single-intent phrases.
   - Phrase for controlled expansion around proven cores.
   - Broad only when paired with a smart bid strategy AND a dense negative list AND the operator has volume to absorb noise during learning.
3. Seed the negative-keyword list per campaign. Include competitor brand negatives (unless competitor bidding is an explicit strategy), job-seeker negatives, free/DIY intent negatives, wrong-geography qualifiers, and any operator-provided exclusions.
4. Apply the keyword decision matrix to every proposed keyword: expected intent, expected CPC vs. budget, landing page fit, measurement fit. Drop keywords that fail any cell.
5. From step 01 search-term data, promote high-performing query patterns to exact match and nominate low-performing patterns as negatives.
6. Set the search-term-report review cadence post-launch (weekly minimum during learning).
7. Flag ambiguous keywords (dual-intent, trademark-adjacent, medical-claim-adjacent) for operator review.
8. Record match-type distribution per ad group (count by type) and per campaign.

## Output artifact
`outputs/google-ads-search-campaign-build/04_keywords-and-match-types.md` with sections: Keywords per Ad Group (by match type), Seed Negatives per Campaign, Decision-Matrix Table, Promotions/Demotions from Search Terms, Post-Launch STR Cadence, Ambiguity Flags. JSON sidecar in preview-bundle shape.

## Gates before advancing
Keyword gate: match-type methodology applied per ad group, decision matrix applied, negatives seeded at campaign level, STR cadence declared, ambiguity flags raised.

## Distilled principles

**Match type is a bid on control vs. reach.** Exact trades reach for predictability; broad trades predictability for reach. The correct mix depends on bid strategy, negative density, and budget tolerance for noise.
- Evidence basis: Ed Leake, Building/Keyword Match Type Methodology 2024 + KnowledgeBase/2_Structure_Hygiene/negative_keywords.xml. (ratified 2026-06-08 — see `frameworks/_shared/reference/google-ads-account-review-2025-2026.md`)
- Failure conditions: broad + manual CPC without dense negatives is the known-bad combination; avoid unless explicitly scoped as a short research burst.

**Negatives are part of the keyword plan, not a cleanup task.** Seeding negatives at launch prevents budget from being burned on known-bad queries before the first STR review.
- Evidence basis: Ed Leake, Optimization/Negative Keywords + KnowledgeBase/2_Structure_Hygiene/negative_keywords.xml. (ratified 2026-06-08 — see `frameworks/_shared/reference/google-ads-account-review-2025-2026.md`)
- Failure conditions: accounts with truly unknown query patterns — seed list may be thin, and STR cadence becomes the primary defense.

**Decision-matrix-first keyword selection.** Every keyword is evaluated against intent, CPC fit, landing page fit, and measurement fit before it's added. Intuition-added keywords are the common failure mode.
- Evidence basis: Ed Leake, Optimization/Keyword Decision Matrix + KnowledgeBase/3_Optimization/search_term_mining.xml. (ratified 2026-06-08 — see `frameworks/_shared/reference/google-ads-account-review-2025-2026.md`)
- Failure conditions: none at the level of rule; at the level of practice, operator time constraint is the usual reason the matrix is skipped — document when it's skipped and why.
