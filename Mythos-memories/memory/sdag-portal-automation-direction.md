---
name: sdag-portal-automation-direction
description: "Operator direction 2026-07-31 — manual crank steps in the SDAG portal loop are MVP-acceptable; automate progressively as live cycles accrue, without eroding authorization gates"
metadata: 
  node_type: memory
  type: project
  originSessionId: 80410a59-7221-4409-9dbd-82da51069ccc
  modified: 2026-07-31T13:48:31.715Z
---

The SDAG ads-approval portal's dealer loop (dealer promo intake → Gate-1 approve → compile/enqueue
Delesign brief → deliverables → ad cards → final approve → Meta drain) is live as of 2026-07-31 with
deliberate manual operator steps: compile-delesign-bundle + enqueue-delesign-order + broker submit,
and per-batch DrainAuthorization.

**Operator ruling (2026-07-31, in-session):** "that's likely fine for an MVP but we'll likely want to
automate it as we go and figure things out."

**Why:** the manual steps are labor, not judgment — each is a deterministic CLI with hash-bound
inputs. The authorization gates are judgment and stay human.

**How to apply:** when planning portal follow-ons, propose the automation ladder in this order, each
rung only after the prior has clean live cycles: (1) auto-run compile+enqueue on finalized Gate-1
submissions; (2) broker auto-submit once a VendorOrderAuthorization exists; (3) bounded standing
DrainAuthorizations (month/dealership-scoped, no-budget-mutation) replacing per-batch signing after
several clean supervised drains. Never automate away the authorization artifacts themselves.

**Monthly delivery-folder convention (operator-confirmed 2026-07-31):** each month needs
`<Dealer>/YYYY-MM MonthName` folders under the Drive 'Delesign Delivered Work' root for all three
dealerships (BMFord, SDAS, Yarmaz), plus a `creative/configs/delesign-delivered-YYYY-MM.json`
pinning each folder's Drive URL — the order brief embeds that URL as the designer's save-here link
(hash-covered by VendorOrderAuthorization), and the same folder is the ingest watch source. This
provisioning belongs inside automation rung 1 (fires with the first Gate-1 finalization of a new
month); until then it is a manual start-of-month step. August 2026 done.
First live end-to-end run (supervised, per stage) still pending as of 2026-07-31 — see
[[sdag-host-has-no-ffmpeg]] for the broker-strip posture context.
