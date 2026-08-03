# SM_OS Harness Runtime Contract

Status: first-slice contract.

This file defines the harness-neutral authority surface for SM_OS runtime behavior. It does not claim that every adapter can enforce every behavior. It defines how an adapter must state what it can prove.

## Authority

SM_OS owns policy authority for reusable runtime behavior:

- task intake and Actor Continuity payloads
- lifecycle event vocabulary
- dispatch receipts and model/mind disclosure
- permission and command gates
- capability evidence
- review and closeout routing

Claude, Codex, Codewhale, Gemini, OpenCode, Goose, Aider, Continue, Kilo, Pi, Hermes, and future harnesses are adapters. An adapter may provide native enforcement, advisory context, or no support for a behavior. Adapter memory surfaces are advisory. Durable artifacts remain the authority surface unless the human operator explicitly resolves a conflict.

## Lifecycle Events

The first-slice lifecycle vocabulary is:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `SubagentStop`
- `SessionEnd`

Adapters may expose different native event names. The adapter contract is to map native events to this vocabulary where possible and to mark unsupported events as capability gaps rather than text parity.

## Actor Invocation Payload

Every SM_OS actor invocation must carry:

- Current State
- Question / Work
- Desired State
- actor identity
- harness identity
- model or mind disclosure when known
- work altitude or risk tier when applicable
- durable context artifact paths

Every actor return must include:

- resulting state
- changed files or written artifacts
- commands, tests, smokes, or review artifacts when applicable
- blockers and gate owner
- parent impact for delegated child work

Same-model subagents are parallel contexts. They do not satisfy distinct-provider review by themselves.

## Capability Tiers

Adapter capabilities must be classified as one of:

- `BLOCKING`: execution can be stopped by a hook, runner policy, validator, or native invocation surface. Evidence must include the enforcing file and a passing negative-case test or smoke.
- `ADVISORY`: the behavior can be injected, reminded, reported, or reviewed, but the adapter cannot stop execution at the relevant boundary.
- `ABSENT`: the adapter has no current support for the behavior.
- `UNKNOWN`: evidence has not been reviewed. `UNKNOWN` cannot be promoted as support.

Generated instruction text is never enough to mark a capability `BLOCKING`.

## Evidence Receipts

Each claimed capability should carry:

- adapter id
- capability id
- tier
- evidence artifact path
- evidence type: `hook`, `runner-policy`, `validator`, `native-smoke`, `unit-test`, `source-review`, `instruction`
- reviewed_at
- known limits

Source-review evidence is reference material. It can justify a design candidate, but it cannot prove runtime enforcement in SM_OS until SM_OS invokes or tests the behavior.

## First-Slice Adapter Rules

- Codex compatibility paths must remain stable while neutral `tools/smos-runtime/` surfaces are introduced.
- Existing `codex:*` package scripts must remain available.
- Pi and Hermes must not be registered as dispatch targets without separate invocation-proof review.
- OS sandboxing parity must not be claimed unless the actual sandbox mechanism is invoked and evidenced.
- Dispatch model/mind disclosure validation must land before broader multi-agent fanout is promoted.

## Validation

Validators must fail loud when:

- a `BLOCKING` claim has no enforcing evidence
- a text-only claim is presented as runtime enforcement
- an adapter is registered as executable without invocation proof
- capability output collapses `BLOCKING`, `ADVISORY`, `ABSENT`, and `UNKNOWN`
- dispatch receipts omit model/mind disclosure for delegated work

The goal is honest capability reporting first, broader runtime automation second.
