---
name: chat-holds-have-turn-granularity
description: "A teammate-message HOLD cannot reach a worker mid-turn (minutes, unbounded) — urgent stops need a well-known filesystem halt path checked in-loop, not a message"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 410f8729-6299-4432-9f65-162af689752e
  modified: 2026-08-02T20:17:29.348Z
---

2026-08-02: a HOLD sent one minute after a work order failed to stop the run — the worker's turn ran unbroken for ~11 minutes and messages deliver only between turns. The run-specific kill-switch file couldn't help either: its path didn't exist until the worker chose it at launch, so it was only reachable by someone who already knew what was running.

**Why:** message-based control has turn granularity; file-based switches have loop granularity (seconds) but only if their path is knowable BEFORE the work exists.

**How to apply:** for anything that must be stoppable urgently, establish a WELL-KNOWN global halt path agreed before launch (sims: `_dev/state/kill-switches/ALL-SIMS.off` — every driver checks it alongside its own switch, at startup and per round; touching it while nothing runs is harmless because the next launch refuses at startup). When coordinating workers, treat a sent HOLD as effective only after acknowledgment — until then assume the prior instruction is still executing. Related: [[corrections-do-not-propagate-themselves]] (both are claims outrunning their mechanism).

**Corollary (same day, second incident — the dual-lane collision):** when a worker is blocked and the coordinator routes its work through another lane (operator `!` commands, another worker), TELL THE BLOCKED WORKER FIRST — a cleared blocker means it resumes, and two lanes then operate on the same resources (same VM name, same disk paths, same staging dir) without knowing of each other. A worker that detected the collision read it as a rogue agent. Also: filesystem halt conventions do not cross machines — an armed halt on the laptop says nothing on a remote host unless something explicitly places the marker there (for the orwell courier design, on the courier itself). Create-only provisioning (refuse-if-exists, destroy split into its own script) is what turned this collision into a refusal instead of a clobber — prefer that shape everywhere.
