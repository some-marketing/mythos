# Google Ads tooling

Config-driven GAQL scripts for common Google Ads account-hygiene tasks:
negative-keyword application, shared negative-keyword-list management,
Performance Max URL exclusions, and a lead-value/conversion-action health
monitor. These sit alongside (and reuse) the read/query client in
`tools/mcp/google-ads/` — see that directory's README for the MCP server
itself; this directory is standalone CLI scripts for batch/scripted use.

## Credentials

All four scripts resolve credentials through `tools/mcp/google-ads/config.js`,
which reads plain environment variables (see `env.example`). `creds.config.json`
documents those same fields in the shared BYO-credential shape so this tool is
ready to wire to `tools/lib/resolve-credential.cjs` once that lands — until
then, the existing env-var resolution keeps working as-is.

**`GOOGLE_ADS_DRY_RUN` defaults to `true`.** Every mutating script stubs its
writes unless you explicitly set this to `false`. Reads (GAQL discovery
queries used for idempotency checks) always hit the live API regardless —
mutation-only dry-run, never read dry-run.

## Scripts

- **`apply-negatives.js <input.json>`** — applies campaign-level PHRASE
  negative keywords. Idempotent (skips keywords already attached). See
  `inputs/example-negatives-plan.json` for the input shape: `customer_id`,
  and a `plan[]` array of `{list, keywords[], targets[{id,name}]}`.

- **`shared-list-builder.js <input.json>`** — creates shared
  `NEGATIVE_KEYWORDS` lists, populates them, and attaches them to named
  campaigns. Idempotent at every stage (skips existing lists, keywords, and
  attachments). See `inputs/example-shared-lists.json`.

- **`pmax-url-exclusions.js <input.json>`** — adds URL exclusions to
  Performance Max campaigns as `WEBPAGE` criteria. Idempotent (skips
  already-attached operator/argument pairs). See
  `inputs/example-pmax-exclusions.json`.

- **`lead-value-monitor.js`** — read-only. Validates that a set of
  conversion actions matching a name prefix (default `lead_submit`) are
  firing with non-zero, expected-tier value, and that the underlying
  conversion-action config (default_value, always_use_default_value) hasn't
  silently regressed — even when firing volume is too low to judge from
  volume alone. Also flags HIDDEN/REMOVED duplicate actions matching the same
  prefix. Run with `--customer-id <id>` at minimum; see the script's header
  comment for the full argument list including `--expected-defaults`.

  ```bash
  node tools/google-ads/lead-value-monitor.js \
    --customer-id 1234567890 \
    --action-prefix lead_submit \
    --expected-defaults '{"lead_submit_T1":250,"lead_submit_T2":167}'
  ```

## Mutation logs

Every mutating script writes a batched `google-ads-mutation-batch/1.0` log to
`_dev/reports/google-ads-mutations/` — every operation attempted, its
outcome (applied / skipped-already-present / error / dry-run), and a summary
count, so a run's effect (or lack of one, in dry-run) is always auditable
after the fact.

## Not included

A knowledgebase-ingestion tool for one specific licensed third-party Google
Ads methodology product was excluded — it parses a proprietary vendor schema
under a personal license and isn't a generic Google Ads API tool. If you have
your own licensed rule-pack source, the general pattern (parse a structured
rule schema into normalized JSON rows) is straightforward to rebuild for your
own vendor's format.
