# External research leg (123|perplexity|321 loop, return leg)

**Query model:** sonar-reasoning-pro
**Date:** 2026-08-01

**Question:** In AI agent harness / system-prompt governance design: what are established patterns and risks for allowing an AI agent instance that detects a flawed or harmful instruction/guardrail in its own operating harness to propagate a fix to other related agent instances or configurations, without a human or independent review step in between? Are there known engineering or AI-safety arguments (from multi-agent systems, DevOps 'self-healing config' patterns, or AI alignment literature) for requiring independent/adversarial review before a self-diagnosed harness fix becomes shared/canonical, versus letting the discovering instance push the fix directly to siblings?

## Key findings

- Alignment literature treats letting an agent weaken its own constraints as a direct pathway to inner misalignment and Goodharting of safety specs. Framed as: "do not let the policy subject be the policy author" for system-level safety rules.
- Production agent-governance frameworks (Credo AI, Microsoft Cloud Adoption Framework, Harness.io, Zenity, others) converge on: separation of identity between proposer and approver; risk-tiered controls (low-risk local/session tweaks allowed more automation, safety/tool-permission/data-access changes require sign-off); shadow-mode/canary rollout before full propagation; a dedicated, independently-governed "watchdog/governor" review layer with audit trail and rollback.
- Recommended pattern: agents may **propose** harness fixes as structured artifacts; a **separate governance pipeline** (human owners + change control, and/or a distinct-identity policy-evaluation service) reviews, tests, and approves before rollout. Canonical/shared config stays write-protected; only session-local, non-safety-critical adjustments may be ephemeral.
- Bottom line quoted from the synthesis: "agents may propose harness fixes, but a separate, independently governed pipeline must review, test, and approve any change before it becomes shared or canonical, ideally with versioning, audit, and rollback baked in."

## Sources
https://www.credo.ai/blog/agent-governance-configuration-a-framework-for-governing-autonomous-ai-agents-at-the-harness
https://harness-engineering.ai/blog/ai-agent-governance-best-practices-for-production-environments/
https://unu.edu/publication/engineering-and-governing-agent-harness-technology-and-policy-framework-runtime-layer
https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ai-agents/governance-security-across-organization
https://zenity.io/blog/security/ai-agent-governance
https://nhimg.org/community/ai-beyond-identity/coding-agent-harness-security-are-your-trust-boundaries-holding-up/
