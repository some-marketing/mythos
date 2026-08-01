---
name: evidence-loop
description: Run an explicit high-rigor Mythos workflow profile for plans, implementations, audits, deliverables, or operational work that needs distinct-family adversarial review, a third-family context check, research disposition for every finding, Perplexity research for public claims, evidence-resolved operator escalation, and repeated re-entry through orchestrate-loop. Use when the operator invokes /evidence-loop or requests the full review-context-research-answer-repeat protocol beyond planning.
---

# Evidence Loop

Treat `instructions/canonical/commands/evidence-loop.yaml` as authority. This skill supplies the harness procedure; it does not own lifecycle state.

## Run the profile

1. Resolve the target and current state through `/orchestrate-loop`.
2. Exit to ordinary `/orchestrate-loop` when the target is exempt or a single safe deterministic step.
3. Collect deterministic evidence and route candidate work through the worker/native command selected by `/orchestrate-loop`.
4. Dispatch an adversarial reviewer from a family distinct from the producer.
5. Dispatch a third family for context and omission checking. Do not count Perplexity as a family.
6. Record every finding in a JSON ledger matching `tools/evidence-loop/finding-ledger.schema.json`.
7. Validate before research:

   `node tools/evidence-loop/validate-finding-ledger.cjs <ledger.json>`

8. Resolve each finding by disposition:

   - `internal_evidence`: local source/tests only; zero web calls.
   - `public_web`: Perplexity Pro browser, then secret-safe API fallback; attach cited output.
   - `private_prohibited`: fail closed before query construction.
   - `operator_only`: attach all answerable evidence, then bubble up.
   - `superseded`: preserve links and remove from active risk accounting.
   - `blocked`: preserve the blocker and gate owner.

9. Synthesize without treating research as a vote, then return the evidence to `/orchestrate-loop` for the next native route.
10. Inherit `/orchestrate-loop` ceilings and states exactly. Close meaningful work with `/debrief-run` and truthful signal state.

## Actor contract

- Disclose every dispatched mind/model at dispatch time.
- Producer cannot validate its own acceptance-grade result.
- Reviewer must be family-distinct from producer.
- Context checker must be distinct from both when required.
- Research substrate supplies sources only; it cannot approve or close findings.
- Human operator receives only protected decisions or unresolved same-rank conflict.

## Boundaries

- Do not create another loop counter, termination state, or closeout path.
- Do not mutate `/orchestrate-loop` behavior from this profile.
- Do not send credentials, PII, client data, or private code to public research.
- Do not force three-family/research ceremony onto exempt or deterministic work.
