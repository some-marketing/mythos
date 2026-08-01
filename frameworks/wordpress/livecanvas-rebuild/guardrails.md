# wordpress/livecanvas-rebuild — Guardrails

## Modes

- **FINDINGS_ONLY** — Stages 1 (audit) and 2 (decision) only. Pure read; no site mutations; no plugin toggles; no DNS work. Default mode for all early runs.
- **PATCH_ALLOWED** — Stage 3 (rebuild) and Stage 4 (cutover). Stage 3 starts on a **local WordPress install** (LocalWP / MAMP / Docker — operator's choice). Only after the local build is confirmed working does work move to a staging URL, and only after staging is confirmed does cutover touch production. Never against the production URL until the cutover step.

## Hard prohibitions in any mode

1. **Never mutate the live production site** without operator confirmation in chat *and* a named cutover-window. No plugin activation/deactivation, no theme switch, no settings change.
2. **Never store credentials in this repo, in chat, in argv, or in tool-call params.** Always retrieve via `op` CLI from the operator's machine. The runner pattern is `LMF_USER=$(op item get …) LMF_PASS=$(op item get … --reveal)` exported to a child process, with `EXIT/INT/TERM/HUP` traps that unset the env on any exit path.
3. **Never crawl as the live admin user during normal hours** without the operator's awareness. Schedule audited crawls during low-traffic windows or behind LightStart's IP whitelist.
4. **Never delete a plugin in production based on probe findings alone.** Probes inform decisions; the operator approves.
5. **Never strip features from the staging build to make the rebuild "look better"** if those features are actually in use. Probe-confirmed dormant ≠ "we don't see how to migrate it".

## Cross-verification

- Stage 1 and Stage 2 outputs MUST be reviewed by a distinct intelligence (Codex bridge or another model) before Stage 3 begins. The {CLIENT_CODE} reference run shows the pattern: dispatch via `tools/signals/dispatch-bridge.js --target codex`.
- Probe agents (Haiku) are workers, not verifiers. They count as substrate-shared with the producing actor and do not satisfy the Cross-Verification Law on their own.

## Forbidden shortcuts

- No "scrape the rendered HTML and call it the rebuild." LiveCanvas's value is hand-authored Bootstrap, not regenerated builder cruft.
- No "skip the staging step" cutover — the rebuild is unverifiable without it.
- No "we'll just disable WPML in production to test" — use a real staging clone.

## Build discipline (shared)

A rebuild is a build. The general WordPress build rules — page design happens in the page-builder editor, local-design-mode plugin discipline, local-as-staging until visual signoff — live at `frameworks/_shared/blocks/wordpress-build-discipline.md` and apply to this framework. Those rules are not duplicated here; they are inherited.

## Rebuild-specific layered concerns

These are rebuild-only, layered on top of the shared build discipline:

- **Migration boundary** — the rebuild starts on a local install, moves to staging only after local visual signoff, and only reaches production via a named cutover-window. Never mutate production based on probe findings or design-iteration outcomes.
- **Backup before migration** — every transition (local → staging, staging → cutover) requires a verifiable post-content + media + DB backup of the destination, captured immediately before the transition.
- **Source-site download** — initial site download is a read-only crawl against the source. No write access to the source site is requested or assumed.
- **Preservation default** — everything load-bearing on the source site is preserved unless probe-confirmed dormant. If operator intent diverges from preservation, the operator must say so explicitly.
