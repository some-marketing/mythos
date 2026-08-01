# G4 — Decision gate: build the reservation hook now, or defer?

**Plan:** concurrent-growth-non-collision-sop
**Step:** G4 (REVIEW_ONLY, runs after G6 per corrected sequencing)
**Date:** 2026-08-01

## Operator decision (OD1)

**Defer, with a named trigger.** The reservation mechanism specified in G3 is NOT built now. It will be built — as a fresh, BIG-classified charter with its own kernel-triad convene, since it touches `tools/kernel/hooks/**` (L1 protected surface) — **the first time an actual concurrent-write collision is observed** in this repository.

This satisfies the charter's acceptance criterion that OD1 record a bounded disposition with an explicit trigger, not open-ended deferral: the trigger is a specific, observable event (a detected collision), not a calendar date, but it is a concrete activation condition rather than "defer until an actual collision is observed" phrased as passive inaction — it is an active commitment: when that event occurs, it routes to a new charter immediately, not to further deliberation about whether to act.

**Owner:** whichever session/actor observes or is informed of the collision is responsible for opening the follow-on charter (`/bp-r` or `/charter-quest`) referencing this concept and G3's specification as the starting point — not a designated standing owner, since this is an event-triggered action, not an ongoing responsibility.

## What this means in practice, right now

- G3's specification exists and is reusable the moment it's needed — no rediscovery required.
- G5's manual checklist is the active, load-bearing procedure until then.
- No `tools/kernel/hooks/**` or `instructions/canonical/**` file is created or modified by this plan, consistent with `risk_tier: medium` / `big: false`.
