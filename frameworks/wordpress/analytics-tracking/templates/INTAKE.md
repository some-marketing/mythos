# Analytics Tracking — Intake

> Fill this in before running the framework prompt chain. These inputs feed
> `prompts/01_INTAKE_AND_ASSESSMENT.md`. Required values also belong in the
> project's `project.json`.

## Required

- **site_url:** <primary site URL, e.g. https://www.example.com>
- **site_type:** <lead-gen | ecommerce | content | booking | other>
- **tracking_goals:** <what success looks like — e.g. capture lead-source attribution end-to-end, fix CRM attribution loss, validate conversion firing>

## Optional

- **existing_tracking_tools:** <GA4, GTM, Meta Pixel, Mixpanel, etc.>
- **privacy_requirements:** <GDPR | CCPA | none | other>
- **ecommerce_platform:** <WooCommerce, Shopify, EDD, n/a>
- **crm_provider:** <Dynamics, Generic REST endpoint, etc. — for attribution-loss work>
- **measurement_ids:** <GA4 measurement ID, GTM container ID if known>

## Notes / Context

<Any prior diagnostics, known issues, or scope boundaries (e.g. RUN_ONLY /
FINDINGS_ONLY; do not modify live options, plugins, CRM records, forms, or leads).>
