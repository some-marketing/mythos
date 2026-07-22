# livecanvas-rebuild

Resolves `[liveCanvas-image-id: NNN]` and
`[liveCanvas-image-id: gallery-N-item-M]` placeholders left in staged
WordPress page content (typically after a LiveCanvas rebuild/migration pass)
to real attachment URLs, and optionally rewrites `post_content` via wp-cli.

Numeric placeholders resolve directly to an attachment's `guid`. Gallery
composite placeholders (`gallery-{id}-item-{n}`) resolve through the
gallery's `thegem_gallery_images` postmeta — a comma-separated attachment-id
list — reading the item at the requested 1-indexed position.

## Usage

```bash
node tools/livecanvas-rebuild/rebind-images.js \
  --client your-site --project current-site-analysis \
  --env-script /path/to/your-env.sh \
  --dry-run              # report only, no DB writes (default)

node tools/livecanvas-rebuild/rebind-images.js \
  --client your-site --project current-site-analysis \
  --env-script /path/to/your-env.sh \
  --apply                # write resolved URLs via wp-cli

node ... --post-id 123   # restrict to a single page
```

`--client`/`--project` are free-form labels used only for console output and
the report filename — they don't resolve to any repo directory convention.

## `--env-script` (required)

A bash script that, when sourced, exports `SITE_ROOT` — the path passed to
every `wp --path="$SITE_ROOT"` invocation — plus anything else your wp-cli
setup needs (DB credentials, `WP_CLI_CONFIG_PATH`, PATH additions for a
non-system PHP, etc). This tool doesn't assume anything about where that
script lives or what else is in your environment; it just sources it before
every wp-cli call.

Minimal example:

```bash
#!/usr/bin/env bash
export SITE_ROOT=/path/to/your/wordpress/install
```

## Output

Writes a run report (`rebind-images__<mode>__<timestamp>.json`) to
`<env-script-directory>/outputs/` by default, or wherever `--report-dir`
points. The report lists, per page: replacement count and any unresolved
placeholders (numeric ids or gallery refs with no matching attachment).

`--dry-run` never writes to the database; `--apply` writes only pages where
at least one placeholder resolved.
