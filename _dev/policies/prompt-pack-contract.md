# Prompt Pack Contract

Minimum orchestration contract for any active prompt pack in this workshop.

This policy exists so reusable prompt packs stay machine-checkable instead of drifting
into prose-only guidance.

## Required Coordination Model

- The main thread (the Guildmaster) stays thin.
- The main thread owns framing, bounded instructions, synthesis, extra checks, go/no-go
  decisions, and final communication to the operator and to any adjudicator.
- Read-only familiars (subagents) gather inventory, research, or verification evidence.
- Write-owning workers must have a disjoint scope.
- The same worker must not both implement and independently validate the same slice.

## Required Flow

- Launch the declared read-only familiars for the pack.
- Synthesize findings in the main thread.
- Choose one bounded slice at a time.
- Validate before moving to the next slice.
- Run a completion-audit closeout before final acceptance.

## Listener Lifecycle

- If automated adjudicator feedback is intended, start the managed listener before
  claiming auto-run active.
- Do not claim a listener is live from a signal and dispatch prompt alone.
- Stop the managed listener before chronicle (debrief)/final closeout unless another
  still-live scope requires it.

## Closeout Bundle

Every active execution pack must end with:

- summary of what was completed
- lessons summary or an explicit note that no new lessons were warranted
- uncodified action items
- validation summary
- clear/readiness decision with exact next command
