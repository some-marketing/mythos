# OMEGA / gemini response

- slot_id: omega
- actor: gemini
- pinned_model: none
- status: success
- duration_ms: 74063
- exit_code: 0
- error: none

---

We find that the proposed concurrent growth SOP is highly feasible because eighty percent of the required non-collision machinery is already active on disk—yet to prevent systemic friction, we must transition the "isolation trigger" from ad-hoc human judgment to an enforceable rule of "Mode-Surface Intersection."

### Audit-and-Name vs. New Mechanism

The audit-and-name framing is directionally correct, but it is missing the systemic integration required for safe scaling. Our codebase already has excellent, highly specific islands of defense:
- **Session Registry:** `tools/sessions/lib/active-session-registry.js` (line 654) tracks active session branches, heartbeats, and claimed boundaries.
- **Boundary Markers:** `tools/sessions/lib/boundary-markers.cjs` (line 10) prevents scope-clobbering by writing atomic per-scope markers under `_dev/state/session-boundary/pending/`.
- **Custody Enforcement:** `tools/kernel/hooks/pretool-git-custody-gate.cjs` acts as a physical backstop at commit time, matching writes against session write logs (`_dev/state/active-sessions/<session_id>/write_log.json`).

The gap is not *more* machinery, but *integrated awareness* (the connective tissue). Sessions currently do not know they are colliding until they reach the final custody gate, which is too late in the execution feedback loop.

### Sharpening the 5 SOP Questions

#### 1. The Isolation Trigger (The Overlap Rule)
We must replace human judgment with a deterministic trigger based on working surfaces and modes:
$$\text{Write Mode (PATCH\_ALLOWED or COORDINATOR)} \cap \text{Shared Surface Overlap} \implies \text{Mandatory Isolation}$$
If a session is in `FINDINGS_ONLY`, `REVIEW_ONLY`, or `RUN_ONLY` (non-modifying modes), a shared working directory is perfectly safe regardless of tree size. This preserves developer experience (DX) and keeps the workspace context-efficient.

#### 2. Single Source of Truth for Liveness
The directory `_dev/state/active-sessions/` is the physical source of truth. The SOP must require that `/new-session` (governed by `instructions/canonical/commands/new-session.yaml`) performs a pre-flight "look-around" check against active sessions. If another active session's registered `working_surface` intersects with the current target, the launcher must emit an explicit high-visibility warning at session boot.

#### 3. Collision-Detection Contract for Artifacts
For persistent growth artifacts (such as plans, charters, and concepts), name-collision handling (like `/aside`'s kebab-case date-suffix) is insufficient. We need a "Working Surface Reservation" contract. Before a planning tool writes a new task plan under `_dev/reports/analysis/task-plans/`, it must verify that no other session listed in the active registry has claimed an intersecting `working_surface` path.

#### 4. The Escalation Path (Warn vs. Hard Block)
We propose a tiered progression:
- **Read/Review Phase:** Silent background tracking with soft warnings.
- **Write/Execution Phase:** A hard block on file writes to the same subdirectory, accompanied by an *automated escape path*. If a session hits a write conflict, the system should print the exact Git command (e.g., `git worktree add ...`) to let the agent cleanly pivot to safety rather than simply failing.

#### 5. SOP Residence
The SOP should reside as a policy document at `instructions/canonical/governance/concurrent-growth-sop.md`. To keep it from becoming passive documentation, its rules must be parsed mechanically by pre-flight check hooks within `tools/sessions/` and the orchestrator loop.

### Collision Risks in the SOP-Drafting Process

Drafting this SOP itself represents a meta-collision risk. If we edit canonical instructions or register new commands directly in a shared working tree, we risk polluting the active context or dirtying the trees of concurrent sessions. 

To model our own rule, any session assigned to write the actual SOP must declare a strict, scoped custody claim over the governance subfolders, or utilize branch isolation, ensuring that no other active world-mind has its workspace corrupted by the drafting of the non-collision rule.

