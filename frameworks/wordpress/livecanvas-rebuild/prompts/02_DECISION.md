# Stage 2 — Decision

**Mode:** FINDINGS_ONLY · **Output dir:** `clients/{CODE}/projects/{slug}/outputs/`

## Purpose

Turn the Stage 1 evidence into a migration-readiness brief: keep / replace / drop per plugin, scope of layout work, and the open questions that gate Stage 3.

## Inputs

- All Stage 1 outputs.
- Operator goal from `intake.json`.

## Steps

1. **Commerce engine decision.** If the site runs WooCommerce + any combination of (Product Add-ons, multi-currency, Canada Post / regional shipping with label print, ShipStation, third-party reviews, affiliate program), the default answer is "keep WooCommerce." Document why in `outputs/{commerce-engine-decision}.md`. The {CLIENT_CODE} reference is `outputs/fluentcart-vs-woocommerce.md`.
2. **Plugin disposition.** For each active plugin from Stage 1's inventory, classify as:
   - **Keep** — load-bearing
   - **Drop / replace lighter** — replaceable with a leaner equivalent or LiveCanvas-native pattern
   - **Drop / no replacement** — redundant or dead
   - **Probe required** — can't tell without backend evidence
3. **Probe the "probe required" set** with parallel Haiku subagents. Each probe writes `captures/probe-{plugin}-findings.md`. Common probes:
   - WPML / Polylang — are there real translations?
   - Toolset Types / ACF / Pods — are there real registered CPTs / fields?
   - Indeed Affiliate Pro / AffiliateWP / SliceWP — are there real affiliates / payouts?
   - Mailchimp / Brevo / Klaviyo — are sync flows configured and firing?
4. **Cross-verification.** Dispatch the migration-readiness brief to a distinct intelligence (Codex bridge default) for review. Apply findings before publishing the brief.
5. **Open decisions** that only the operator can resolve — list them at the end of the brief with a one-line context each. Don't escalate trivia; the brief should converge on at most 1–3 questions.

## Acceptance

Stage 2 is complete when:

- `outputs/migration-readiness.md` exists with: headline numbers, four-question summary (builders / dormant plugins / commerce-coupled features / backend-only data), batched migration plan, and open operator decisions.
- A Codex (or other distinct-intelligence) review has been run and any MAJOR findings folded back in.
- All probe-required plugins from step 2 have probe findings, and their dispositions in `captures/plugins-inventory.md` match the probe verdicts.

## Anti-patterns observed in the {CLIENT_CODE} reference run

- **Don't promise "all 18 PAO products have all fields required" without checking the JSONL.** Distinguish total-field-groups from required-field-groups in the brief.
- **Don't double-count widget-runtime-loaded vs widget-instance-rendered.** The brief should say "Popup Maker runtime loads on 104 pages; 3 pages actually render a popup container."
- **Don't say "Critical, keep as-is" and "deprecation candidate" for the same plugin in different sections.** Pick one, cite the evidence, move on.
