# Claude Prompt Pack: Cost-Controlled Slice Execution

Use this prompt pack when the goal is to keep model spend down by defaulting to:

- one bounded Claude execution slice
- scoped local verification
- durable artifact refresh
- mandatory debrief closeout
- escalation to a second reviewer only when the slice is risky or internally inconsistent

This is the default low-cost operating loop for Mythos task-plan work.

Companion quick view:

- [claude-cost-controlled-slice-execution-flowchart.md](./claude-cost-controlled-slice-execution-flowchart.md)

## Default Operating Rule

Use Claude alone for the full slice when all of the following are true:

- the scope is one bounded step or one bounded repair pass
- the tests are repo-local and targeted
- the claims can be proven by files and commands on disk
- there is no unresolved signal, bridge, or git-history contradiction

Escalate to a second reviewer only when one of these is true:

- tests and artifacts disagree
- bridge or signal state is unclear
- git history or branch state is risky
- the next command is ambiguous
- the slice is high-risk enough that independent review is still required by plan or trust tier

## Standard Sequence

1. Run the plan selector:

```text
/run-plan <task-or-plan-id>
```

2. Then use the bounded-slice execution prompt below.
3. After the slice closes, require `/debrief-run latest`.
4. Only ask a second model to review when the escalation triggers above are present.

## Prompt 1: Bounded Slice Execution

Paste this to Claude after `/run-plan ...` resolves the target:

```text
Execute only the next bounded slice.

Requirements:
- keep scope tight
- run the relevant tests
- write or refresh the required durable artifacts
- if review is required by plan or actual execution risk, use the truthful review lane
- after implementation closeout, run /debrief-run latest
- stop only when:
  - the slice is implemented
  - tests or verification are complete
  - required artifacts exist on disk
  - debrief artifacts exist on disk
- then report:
  - changed files
  - tests run
  - artifact paths
  - exact next command

Do not continue to the next slice automatically.

END PROMPT
```

## Prompt 2: Debrief-Only Closeout

Use this when the slice implementation is already done and the missing piece is debrief evidence:

```text
/debrief-run latest
```

If Claude asks for scope, paste:

```text
Debrief the just-completed execution slice.

Use the completed slice artifacts as the source of truth and write the required debrief outputs:
- run-debrief markdown
- improve-plan JSON
- replicate-plan JSON

Do not reopen implementation unless the debrief finds a real closeout gap.
After the debrief artifacts are written, report their exact paths and the exact next command.

END PROMPT
```

## Prompt 3: Cheap Truth Check

Use this when you want Claude to self-check a closed slice before asking any second reviewer:

```text
Review only the completed slice closeout.

Check only:
- whether the artifact paths on disk support the completion claim
- whether the reported tests match the durable verification artifacts
- whether the exact next command is truthful

Output:
- findings only
- exact next command

Do not reopen implementation unless a real contradiction is found.

END PROMPT
```

## Prompt 4: Second-Reviewer Escalation

Use this only when the cheap loop found a contradiction, a bridge-state problem, a risky git situation, or a plan-required independent review.

Provide only the narrowest possible scope:

```text
Review only this completed slice.

Scope:
- <path>
- <path>
- <path>

Claims:
- <claim>
- <claim>

Check:
- do the artifacts support the claim?
- is the next command truthful?

Output:
- findings only
- exact next step

END PROMPT
```

## What Not To Send A Second Reviewer

Avoid these unless they are strictly necessary:

- full session transcripts
- whole worktree review requests
- broad "review everything" asks
- multiple slices mixed into one review

Prefer:

- exact scope
- exact claim
- exact artifact paths
- exact question

## Operator Heuristic

Use this by default:

- Claude implements the bounded slice
- local tests and durable artifacts verify the slice
- `/debrief-run latest` closes the learning loop
- a second reviewer is only for exceptions

If the slice is mechanically clean after those steps, continue to the next bounded slice without paying for another model pass.
