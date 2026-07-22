# Known Issues — wordpress/design-research

Lessons from production runs. Each entry: rule, why, how-to-apply.

## KI-1 — Nano Banana cannot honor color constraints reliably

**Rule:** `gemini-2.5-flash-image` (nano-banana) draws what it wants. Explicit hex codes + named colors + negative-prompt clauses are necessary but not sufficient. Expect 30-50% drift rate on first-pass renders and budget for a 2nd seed + a conditional 3rd drift-correction invocation.

**Why:** confirmed across two production runs — first run drifted off-palette entirely; second run with explicit hex + named negative prompts still required visual verification per render.

**How to apply:** when prompt 03 produces nano-banana variants, the planning slice MUST include a verify-local drift detection step + conditional re-run branch. Do not assume single-pass renders satisfy palette gates.

## KI-2 — Nano Banana invents performer likeness even with ref photos

**Rule:** even when a ref photo is attached, nano-banana frequently composites an AI-imagined version of the subject rather than preserving the actual likeness. Suitable for stylized mood / palette demonstration, NOT suitable for "this is the client" mockup deliverables.

**Why:** confirmed in production — ref-attached renders showed client-adjacent figures but with synthesized faces and proportions.

**How to apply:** for production-mockup-grade deliverables that require client likeness fidelity, route to the **Gemini 2.5 Pro SDK HTML mockup pattern** (see `docs/gemini-html-mockup-pattern.md`) instead of nano-banana. Use nano-banana only for palette/mood/composition exploration where likeness fidelity isn't required.

## KI-3 — Source brand photography may have visible venue branding

**Rule:** client-provided photography often contains visible sponsor logos, venue names, watermarks, audience members, or third-party branding — common when working performers / event-services clients shoot at venues, not in studios.

**Why:** confirmed in production on a performer-client shoot with multiple visible sponsor and venue marks.

**How to apply:** at Stage-0 inventory, audit each photo for visible third-party branding. Document in `assets/brand-photography/README.md` (per-photo) what's croppable via CSS `object-position`, what needs retouch removal, and what should be replaced before production. For first-pass mockups, aggressive `object-position` crops mitigate; for production builds, coordinate with the client for cleaner-background versions or schedule a hero shoot.

## KI-4 — Generated content fabricates testimonials and attributions

**Rule:** LLMs will insert fabricated testimonials with named-source attributions (invented publications, invented reviewer titles) when authoring placeholder copy.

**Why:** trained behavior — the models default to plausibility-shaped placeholder rather than visibly-empty placeholder. Caught only on human audit.

**How to apply:** ALL placeholder content in this framework's outputs MUST use either (a) lorem ipsum body + attribution-free format, OR (b) explicit `[testimonial pending — client to provide]` placeholders. Never invent attributions. Validation pattern: regex search for quote-followed-by-attribution-line in generated artifacts before delivery to client.

## KI-5 — Bash 3.2 (macOS default) silently fails on `declare -A`

**Rule:** macOS ships bash 3.2 which does not support associative arrays. Inline Bash tool invocations that use `declare -A` continue execution after the silent failure, with subsequent `${ARRAY[$key]}` lookups returning empty/wrong values.

**Why:** confirmed in production — a per-variation ref-image map collapsed to a single shared ref, and all variations regenerated with the same photo. Salvageable in that case but a class of bug that produces silently wrong artifacts.

**How to apply:** in render scripts under this framework, use one of:
- `#!/usr/bin/env bash` shebang + `[ ${BASH_VERSION%%.*} -ge 4 ] || exit 1` guard at top
- an explicit modern-bash path (e.g. Homebrew bash) when associative arrays are needed
- Paired arrays or case-statement fallback for key-value lookups when bash version cannot be guaranteed

## KI-6 — Follow-on planning misses framework Stage-0 contracts

**Rule:** follow-on planning slices on a project already running this framework do NOT automatically inherit the framework's Stage-0 inventory contract (brand-photography existence, prior-iteration output dirs, palette-tokens authority).

**Why:** general task planning treats follow-on slices as fresh tasks and expands context through general search rather than framework-specific inventory checks. Multiple confirmed misses in production before this checklist existed.

**How to apply:** any planning pass for a project running this framework MUST cite `docs/follow-on-inventory-checklist.md` and run the 5 mandatory enumerations before drafting the plan.
