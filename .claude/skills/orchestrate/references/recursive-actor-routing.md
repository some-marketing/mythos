# Recursive actor routing

`RecursiveActorWorkOrder/1.0` is the routing contract for bounded child recursion. Use it when the current task may spawn a narrower child actor, a branch-local follow-up, or a generated command that needs its own validation path.

The user task is offloaded to a routed mind. That routed mind may recursively offload narrower questions, then aggregate answers back up into the parent work order. Diffusion continues until each branch is small enough to express as a clear three-step execution plan.

This is a two-way chain:

- downward: scopes demote into narrower child work orders
- upward: evidence, blockers, promotion requests, and next-state candidates return to the parent
- upward returns are reports or requests, not self-created higher-scope authority

The operator-facing experience should feel like ordinary chat with the system getting the work sorted internally. Ask the human operator only when something has returned all the way up to the orchestrator as a true impasse: destructive action, credentials, unresolved ambiguity, authority expansion, or judgment that cannot be resolved from evidence.

This is also the learning path. Leaf actors return evidence upward; parent actors aggregate repeated patterns; the orchestrator routes stable, trustworthy repetition into skills, schemas, router rules, framework manifests, or code. Operator corrections should become control-plane data instead of recurring chat instructions.

Learning should iterate through distinct connected attempts, not one linear retry. Different routes, models, frameworks, evidence slices, or interpretations may attempt the narrowed problem; the parent compares overlap, conflict, and transferability before promoting a reusable pattern.

## Use it when

- the child scope is strictly narrower than the parent
- the child can own a bounded surface with independent verification
- the work needs to carry routing policy on disk, not in chat
- the invocation must be branch-aware and the target branch is known

Do not use it for one-shot direct execution, broad re-planning, or any child that would inherit the same authority and surface as the parent.

## Required fields

- `work_order_id`
- `parent_work_order_id`
- `scope_tier`
- `target_branch`
- `branch_reference_set`
- `owned_surfaces`
- `allowed_lanes`
- `stop_condition`
- `output_paths`
- `next_state`

## Layer rules

### Contract / schema
The schema validates the work order and must enforce:

- child scope is narrower than parent scope
- upward promotion or escalation is represented as a return/handoff request unless an upstream actor grants explicit authority
- `target_branch` is explicit when branch-local execution is intended
- `branch_reference_set` names the branch-local ruleset to load
- `allowed_lanes` is reduced, not expanded, unless a human operator has explicitly widened it

### Skill / framework
The skill owns the routing policy:

- recurse only while the next child is narrower
- stop when the branch has a clear three-step execution plan
- preserve stronger/global model routing at high scope because those actors must hold more of the project shape, cross-workstream context, custody, and risk
- as scope narrows and determinism rises, route to free, low-cost, or lower-intelligence models where they are sufficient
- at leaf scope, prefer the least intense sufficient local model class, including RasPi-class/local-tiny lanes when available and policy permits
- keep routine fan-out/fan-in internal; surface questions to the human operator only when the orchestrator cannot resolve the impasse without human judgment or authority
- treat repeated upward evidence and operator corrections as learning candidates, but promote them only through the system's explicit concept/plan/review/promotion path
- use distinct connected attempts when ambiguity remains: compare multiple bounded attempts and learn from their overlaps or conflicts rather than retrying the same lane unchanged
- prefer local or logged-in lanes before remote lanes when they can honestly satisfy the child scope
- after a human instruction names the actual `target_branch`, branch-local rules take precedence for that branch
- repo-default rules apply only when the branch-local set is silent

### Invocation / command
The command stays compact and generated.

- it names the next action
- it names the `work_order_id`
- it names the `target_branch` when branch-aware execution is in play
- it does not restate doctrine, policy, or rationale

## Scope-tier rules

1. Child scope must be strictly narrower than parent scope.
2. Each child should reduce at least one of: surface, authority, blast radius, ambiguity, context load, or verification burden.
3. Same-tier recursion is not a child delegation path; split same-tier work must be modeled as sibling work orders under the shared parent or returned upward for rescoping.
4. If the honest best lane is local or logged-in, use it first.
5. If the branch has boiled down to a three-step plan, stop recursion and execute.
6. If the child would repeat the parent, stop recursion and execute directly or escalate.
7. Each child returns evidence, blockers, and next-state data; if another child is needed, emit a new narrower work order.
8. Low-scope actors may return upward or request promotion, but may not create, claim, or execute higher-scope work on their own authority.
9. Model choice follows router logic, not ad hoc preference.

## Compact command principle

Keep the LLM-facing command short. Put doctrine in schema, routing, and validators. The command should be generated from the work order, not expanded into policy text.
