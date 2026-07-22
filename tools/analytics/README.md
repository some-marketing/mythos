# GA4 chat-widget benchmark puller

`pull-ga4-chat-benchmarks.js` pulls a 12-month GA4 historical baseline for a
site chat-widget launch: total visitors, chat opens, and chat/lead
conversions, segmented by device category.

```bash
npm install @google-analytics/data
node tools/analytics/pull-ga4-chat-benchmarks.js --property-id <GA4_PROPERTY_ID>
```

Requires `GOOGLE_APPLICATION_CREDENTIALS` pointed at a GCP service-account
key with GA4 Data API read access. No property id, client name, or
credential is hardcoded — pass your own `--property-id`.

The event-name filters (`chat_open`, `chat_lead_convert`, `submit_lead_form`)
are placeholders — adjust them in the file to match whatever chat widget
and lead-form event names your own site actually fires.

Outputs land at `_dev/reports/analysis/benchmarks/raw-ga4-<property-id>.json`
(raw rows) and `chat-widget-benchmarks-<property-id>.md` (a synthesized
per-device comparison table).
