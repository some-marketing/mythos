---
name: go-is-cascade-down-bubble-up-review
description: "Operator 2026-08-04 — /go is continuous cross-checking; cascade down, bubble up; at each fold the parent does contract check + integration, the trial of acceptance-grade judgment lands on a distinct family, never the parent"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2a3e83da-becd-4845-b2de-1be1dca94142
  modified: 2026-08-04T20:33:35.817Z
---

Operator direction 2026-08-04 while hardening `/go`, final form: "Cascade down. Bubble
up. At each fold: the parent does the contract check and the integration; the trial of
any acceptance-grade judgment lands on a distinct family — not the parent." The goal
of the skill is minds constantly checking and rechecking each other's work as they
progress through the build — never one batched review at the end.

**Why:** A single end-of-run review lets defects compound through dependent scopes
before anyone looks. Per-fold review catches refutations where they are cheapest to
fix. And the parent cannot serve as the trial of judgment it commissioned — its
framing shaped the child's work, so it is a producer too; contract check and
integration are the parent's jobs, the trial is a distinct family's.

**How to apply:** In any `/go` (or similar fan-out) run: decompose downward until
leaves are mechanical; nothing bubbles up or is consumed by a sibling without its
receipt from the fold above. At each fold: parent verifies the dispatch contract
(scope honored, artifacts present, claims backed) and integrates; artifact-verifiable
results get mechanical read-back (script/diff/hash, no LLM); acceptance-grade
judgment gets a distinct-family trial. A refuted result cascades back down as a new
bounded dispatch (check → fix → recheck), then re-bubbles and folds again at the next
altitude. Encoded in `.claude/skills/go/SKILL.md` (objective point 4, step
check-before-fold-up, rule review-at-every-fold-up). See
[[no-mind-is-pigeonholed-to-a-role]].
