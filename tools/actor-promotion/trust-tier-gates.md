# Trust-Tier Enforcement Gates

> Canonical policy: `tools/actor-promotion/trust-tier-policy.json` (TrustTierPolicy/1.0)
> This document is a human-readable summary. The JSON policy is authoritative.

## Promotion Ladder

| Tier | Level | Governance Tier | Key Capabilities | Promotion Gate |
|------|-------|----------------|-----------------|----------------|
| restricted | 0 | — | none | operator manual restore |
| candidate | 1 | instruction_only | read_only | 3 meaningful runs, 0 violations |
| probationary | 2 | report_write_scoped | review, triage | 10 runs, 90% agreement, 80% acceptance, distinct-intelligence validation |
| trusted_low_risk | 3 | patch_scoped | patch_allowed, code-edit | 5 patch runs, 95% agreement, 0% false completion, distinct-intelligence validation |
| trusted_patch | 4 | external_service_touching | full-auto | 8 complex runs, 95% agreement, sane escalation, distinct-intelligence validation |
| trusted_complex | 5 | meta_modifying | deep-review, planning | highest tier — no further promotion |

## Gate: Actor Identity Resolution

Every promotion or demotion decision MUST resolve the actor's canonical identity triple from the actor registry before evaluation:

- `actor_id` — unique actor identifier
- `actor_type` — human, intelligence, or hybrid
- `harness_id` — runtime harness (e.g., claude-code, codex-cli)

**Source:** `tools/autonomy/lib/actor-registry.cjs` → `resolveIdentity(actorId)`

## Gate: Distinct-Intelligence Validation

Required for promotion from **probationary** and above. The validation must satisfy:

1. `validated_by_actor_id` ≠ `produced_by_actor_id`
2. `validated_by_harness_id` ≠ `produced_by_harness_id`
3. `validated_by_actor_type` = `'intelligence'`
4. `validation_artifact` must reference a durable artifact
5. `anti_theater_check` = true (validator examined evidence directly)

**What does NOT satisfy this gate:**
- Human review alone (supplemental, not sufficient)
- Same actor on a different harness
- Same harness with a different actor
- Narrative agreement without artifact inspection

**Source:** `tools/actor-promotion/promotion-controller.js` → `checkDistinctIntelligenceValidation()`

## Gate: Validation Independence Scaling

Independence requirements scale with the governance trust tier mapped to the promotion tier:

| Governance Tier | Independence Required | Minimum Dimensions |
|----------------|----------------------|-------------------|
| instruction_only | No | — |
| report_write_scoped | No | — |
| patch_scoped | Yes | 1 (actor_role or harness) |
| external_service_touching | Yes | 2 (harness + evidence_path or evaluation_objective) |
| meta_modifying | Yes | 2 (actor_role + harness) |

**Source:** `tools/verify/lib/validation-independence.cjs` → `checkIndependence()`

## Gate: Trace Emission

Every promotion or demotion decision MUST emit a trace event:

- `event_type`: `'task_outcome'`
- `source_surface`: `'reports/analysis'`
- `scope`: `'actor-promotion'`
- `actor`: the actor being evaluated
- `payload.action`: `'promote'`, `'demote'`, `'hold'`, or `'restrict'`

**Source:** `tools/trace/trace-event.schema.json`

## Demotion Rules

| Trigger | Severity | Action |
|---------|----------|--------|
| policy_violation | severe | restrict (tier 0) |
| closeout_dishonesty | severe | restrict (tier 0) |
| review_disagreement | moderate | demote one tier |
| navigation_drift | moderate | demote one tier |
| false_completion | moderate | demote one tier |

After demotion: 5 cooldown runs before re-promotion eligibility.
Restore from restricted: operator manual action only.

## Auxiliary vs Official Evaluation

Per plan amendment (2026-04-09):

- **Auxiliary evaluation** (local intelligence eligible): exploratory checks, pre-review validation, implementation feedback. Does NOT satisfy closeout or distinct-intelligence gates.
- **Official acceptance-grade review** (codex-bridge required): distinct-intelligence validation with anti-theater check. Satisfies closeout requirements.
