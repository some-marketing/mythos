# Notion toggle-doc parser

`parse-ad-frameworks.js` parses a cached Notion "toggle-heading" document —
a color-coded toggle list, e.g. a swipe-file of static ad frameworks — into
a structured JSON registry. Generic for one specific Notion authoring
convention: a top-level `# <Section Title>` heading containing
`## [Name](url)` entries, each with color-coded `### <label> {color="..._bg"}`
toggle subsections underneath.

## Usage

```bash
node tools/notion/parse-ad-frameworks.js [--slug <slug>] [--section "<Section Title>"]
```

- `--slug` (default `ad-frameworks-doc`) — the cache-file basename; reads
  `_dev/cache/notion/<slug>.raw.md`, writes `<slug>.json`.
- `--section` (default matches `Proven Static Frameworks`) — the top-level
  heading text that starts the toggle list you want parsed.

## Refresh flow

The Notion MCP fetch tool runs inside an authenticated AI session, not as a
standalone Node binary, so this is a two-step manual refresh:

1. Ask your AI session to fetch your Notion doc's URL via its Notion MCP tool
   and save the result to `_dev/cache/notion/<slug>.raw.md`.
2. Optionally write `_dev/cache/notion/<slug>.fetch-meta.json` with
   `{"source_url": "...", "fetched_at": "<ISO timestamp>"}` — the parser
   copies both into its output if present, purely for provenance. Neither
   field is required for parsing to succeed.
3. Run the script.

## Adapting to your own doc's toggle-color convention

`SECTION_BG_TO_KEY` at the top of the script maps Notion's toggle background
colors to output field names (`gray_bg` → `what_it_is`, `green_bg` →
`why_it_works`, and so on). Edit that map to match how your own doc uses
color-coding, or leave a color unmapped and it falls back to a slugified
version of the subsection's own label text.
