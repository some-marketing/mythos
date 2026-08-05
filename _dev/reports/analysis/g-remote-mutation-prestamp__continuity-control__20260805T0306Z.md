# G-REMOTE-MUTATION pre-stamp — Orwell continuity control

> Operator: "tell me how to stamp it or consider it stamped" — 2026-08-05T03:05Z
> Recorded by the /go orchestrator as a CONDITIONAL pre-authorization.

## What is authorized

Deployment and execution on orwell of the **short-turn continuity control** exactly as
ratified via convene synthesis `20260805T014353Z-ant-world-next-round-input`:

1. Payload rebuild containing exactly two reviewed slices: the checkpoint loader
   (G-CHECKPOINT-REVIEW cleared, committed) and the mind-network repair (once its S3
   codex trial clears and it commits — not before).
2. Deploy via the existing hardened path only: build-export → inbound-push →
   load-courier `-ExpectedSha256` → refresh-seed → first-boot `-ExpectedSha256`.
3. Run 2–3 turns of ~150 ticks each via run-job `-Mode turn`, each subsequent turn
   passing `-ResumeFrom` the prior turn's generation id. **No goal packet.** No
   console decision packets.
4. Harvest each turn; sanitized projections only; optional dashboard/Unreal import.

## Conditions that bind the stamp (deviation = stamp VOID, return to operator)

- The mind-repair slice has cleared its codex trial with all MAJORs resolved.
- The payload hash used in every `-ExpectedSha256` matches the freshly built export.
- No VM/seed/golden/courier contract changes beyond the already-reviewed user-data
  runner (job.env forwarding).
- Any resume refusal (`resume-failed-halt:*`) HALTS the program — no retry-with-
  fresh-start improvisation; evidence comes back to the operator.
- Membrane checks unchanged: zero-NIC verified pre-boot each turn; weights and RNG
  state never harvested.
- watch-turn-health runs alongside every turn; a stall verdict stops the sequence.

## Not covered (still requires a fresh operator decision)

Any goal-directed round; any turn-count or tick-length outside 2–3 × ~100–250; any
courier-surface or contract change; the r6/r7-era checkpoint disposition beyond
"refuse by design."
