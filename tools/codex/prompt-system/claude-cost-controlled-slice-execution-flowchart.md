# Cost-Controlled Slice Execution Flowchart

Companion to [claude-prompt-pack-cost-controlled-slice-execution.md](./claude-prompt-pack-cost-controlled-slice-execution.md).

Use this when you want the shortest possible operator decision path for a bounded Mythos slice.

```mermaid
flowchart TD
    A[Start slice] --> B[/run-plan <task-or-plan-id>/]
    B --> C[Paste bounded slice execution prompt]
    C --> D{Did Claude finish implementation + tests + artifacts?}
    D -- No --> E[Stay in Claude until slice is actually closed or blocked]
    D -- Yes --> F[/debrief-run latest/]
    F --> G{Do debrief artifacts exist on disk?}
    G -- No --> H[Keep Claude on debrief closeout]
    G -- Yes --> I{Any contradiction or risk remains?}
    I -- No --> J[Continue to next bounded slice]
    I -- Yes --> K{What kind of problem is it?}
    K -- Artifact or test mismatch --> L[Use cheap truth-check prompt]
    K -- Signal or bridge confusion --> M[Ask for narrow review of signal/artifact state]
    K -- Git or branch risk --> N[Ask for narrow git-state review]
    K -- Plan-required independent review --> O[Use second-reviewer escalation prompt]
    L --> P{Resolved cleanly?}
    M --> P
    N --> P
    O --> P
    P -- Yes --> J
    P -- No --> Q[Stop and handle exact blocker before next slice]
```

## Operator Shortcut

If all of these are true, do not pay for a second review:

- Claude changed only the bounded slice
- targeted tests passed
- required artifacts exist on disk
- `/debrief-run latest` completed
- the next command is obvious

If any of these are false, escalate narrowly rather than reopening the whole session.

## Minimal Command Sequence

```text
/run-plan <task-or-plan-id>
```

Then paste the bounded-slice execution prompt from the companion prompt pack.

When the slice is done:

```text
/debrief-run latest
```

Only then decide whether a second reviewer is needed.
