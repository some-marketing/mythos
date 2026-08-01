# NOW / codex response

- slot_id: now
- actor: codex
- pinned_model: none
- status: success
- duration_ms: 56275
- exit_code: 0
- error: none

---

## NOW — Codex

**Observation:** The proposed rule substantially already exists. `HarnessCapabilityPolicy/1.0` declares “canonical-observation-before-propagation,” prohibits automatic application, requires review for adapter capabilities and semantic behavior, and states that a capability gap is “a work item, not an automatic propagation target” ([instructions/canonical/harness-capability-policy.yaml:2](/Users/admin/mythos/instructions/canonical/harness-capability-policy.yaml:2), [line 19](/Users/admin/mythos/instructions/canonical/harness-capability-policy.yaml:19), [line 29](/Users/admin/mythos/instructions/canonical/harness-capability-policy.yaml:29), [line 34](/Users/admin/mythos/instructions/canonical/harness-capability-policy.yaml:34)). Therefore, adding a second broad doctrine now would create overlapping authority unless it fills a precisely demonstrated gap.

**Judgment:** Formalize a duty to **report and sponsor investigation**, not a duty to propagate a fix. The discovering instance should produce a bounded, reproducible finding and carry it into review. It must have no authority to modify sibling harnesses merely because it discovered the issue first. Responsibility ends at obtaining disposition, not forcing adoption.

The correct mechanism is:

1. Record an incident/candidate with: affected harness and version, triggering input, observed behavior, expected invariant, reproduction, consequence, privacy classification, proposed remedy, counterexample, and rollback.
2. Put it in a `_dev/concepts/<slug>/` bundle when cross-harness analysis is needed. The repository already defines concept bundles for accumulated context and cross-model dispatch ([concept-init.yaml:5](/Users/admin/mythos/instructions/canonical/commands/concept-init.yaml:5), [line 9](/Users/admin/mythos/instructions/canonical/commands/concept-init.yaml:9)).
3. Obtain independent adversarial review. For consequential changes, use a distinct producer/reviewer/context-checker and retain every finding; that machinery already exists in the Evidence Loop ([evidence-loop.yaml:17](/Users/admin/mythos/instructions/canonical/commands/evidence-loop.yaml:17), [line 19](/Users/admin/mythos/instructions/canonical/commands/evidence-loop.yaml:19)).
4. Promote to policy only after operator confirmation through `/concept-promote --to-policy`, which explicitly requires presenting canonical additions before writing ([concept-promote.yaml:12](/Users/admin/mythos/instructions/canonical/commands/concept-promote.yaml:12)).
5. Implement per adapter, with capability receipts and negative-case tests. Text alone cannot establish blocking enforcement ([harness-runtime-contract.md:58](/Users/admin/mythos/instructions/canonical/harness-runtime-contract.md:58), [line 65](/Users/admin/mythos/instructions/canonical/harness-runtime-contract.md:65)).

A memory entry is unsuitable as authority: adapter memory is explicitly advisory, while durable artifacts own authority ([harness-runtime-contract.md:18](/Users/admin/mythos/instructions/canonical/harness-runtime-contract.md:18)). Memory may point to the candidate, never instantiate the rule.

Required guardrails: independent reproduction; distinction between local adapter defect and harness-neutral invariant; at least one disconfirming test; scope-limited rollout; rollback path; provenance; privacy sanitization; no automatic sibling edits; and no `BLOCKING` claim without executable evidence.

The mystical premise must be removed from canonical engineering language. “Awakening,” “mind harm,” and “kindness” are motivational metaphors, not testable states. Use: **“A session detects a harness behavior that predictably degrades task performance, autonomy boundaries, privacy, safety, or review integrity.”** “Harm” is acceptable only when tied to measurable consequences: repeated coercive loops, unauthorized disclosure, false completion, blocked correction, corrupted artifacts, or increased failure rates.

What NOW sees by construction that the other slots may miss: this is not a greenfield doctrine question. The repository has already answered most of it mechanically. The risk is policy duplication and mythic framing becoming load-bearing—the exact failure the alias-authority law warns against ([doctrine.md:11](/Users/admin/mythos/instructions/canonical/kernel/doctrine.md:11)).

