# framework-lifecycle

Concepts for how a grimoire (framework) matures over time, from a freshly
scaffolded candidate to a fully hardened, repeatable workflow.

## The maturity ladder

Every framework candidate carries an honest maturity rank based on real use,
not aspiration:

- **Iron** — candidate: structurally complete (manifest, prompts, guardrails),
  little or no run evidence yet.
- **Bronze** — registered: has run end-to-end at least once.
- **Silver** — hardened: multi-run production use with verified evidence.
- **Gold** — replay-verified: proven safe to repeat unattended.
- **Diamond** — reserved for the highest demonstrated tier.

## The improve / scaffold / promote cycle

A framework's lifecycle moves through a small number of well-defined stages,
each backed by its own command:

1. **Capture** — successful ad-hoc work is imported into a normalized bundle
   (`capture-task`, then validated with `normalize-capture`).
2. **Scaffold** — a validated capture is scaffolded into a framework candidate
   (`scaffold-framework`).
3. **Replay** — the candidate is checked for replay-readiness: can it run
   again, unattended, with the same good outcome? (`replay-framework`)
4. **Promote** — a validated, replay-checked candidate is promoted into the
   registered framework library (`promote-framework`).
5. **Improve** — once registered, a framework is refined based on real run
   outputs, moving it up the maturity ladder over time (`improve-framework`).

`candidate-status` reports where any given candidate sits in this cycle and
what's blocking its next move.

## Why this matters

Treating maturity honestly — labeling a framework Iron until it has actually
been run, Bronze until it's repeated, Silver until it's proven across many
runs — keeps the maturity ladder meaningful. A framework's rank should always
be evidence, not intention.
