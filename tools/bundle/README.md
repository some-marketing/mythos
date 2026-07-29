# Bundle Tooling

Code-driven bundle assembly and validation for developer handoff bundles.

## Overview

These tools replace the manual LLM-driven bundle assembly with a structured pipeline:

1. **LLM writes** `bundle-input.json` (structured intake data)
2. **Generator** assembles the bundle (directories, evidence copies, skeletal JSON/markdown)
3. **LLM fills** analytical content into `<!-- LLM:* -->` skeleton markers
4. **Validator** verifies bundle completeness and consistency
5. Bundle is **not done** until validator exits 0

## Tools

### generate-handoff-bundle.js

Assembles a v3.0 handoff bundle from a `bundle-input.json` manifest.

```bash
# Create a new bundle
node tools/bundle/generate-handoff-bundle.js --input /tmp/bundle-input.json

# Append runs to existing bundle
node tools/bundle/generate-handoff-bundle.js --input /tmp/bundle-input-append.json
```

**Input:** JSON file conforming to `schemas/bundle-input.schema.json`

**Output:**
- Bundle directory with evidence, raw artifacts, skeletal reports
- `content-manifest.json` listing files the LLM needs to fill
- Prints `BUNDLE_DIR=<path>` and `CONTENT_MANIFEST=<path>` to stdout

**Modes:**
- `create` — new bundle from scratch
- `append` — add runs to an existing bundle, merge indexes

### validate-handoff-bundle.js

Validates bundle completeness and consistency across 7 categories.

```bash
# Human-readable output
node tools/bundle/validate-handoff-bundle.js --bundle path/to/DEV_HANDOFF__...

# JSON output for programmatic consumption
node tools/bundle/validate-handoff-bundle.js --bundle path/to/DEV_HANDOFF__... --json

# Treat warnings as non-fatal (exit 0 even with WARNs)
node tools/bundle/validate-handoff-bundle.js --bundle path/to/DEV_HANDOFF__... --warn-only
```

**Validation categories:**
1. `STRUCTURAL` — required files and directories exist
2. `PROMPTS` — llm/prompts/ contains required prompt files
3. `SCHEMA` — JSON files validate against their schemas
4. `CROSS_REF` — paths referenced in INDEX.json and LLM_MANIFEST.json exist on disk
5. `COUNT_CONSISTENCY` — question counts match between QUESTIONS_FOR_DEVELOPER.md and SUMMARY.json
6. `CHANGELOG` — changelog status consistency across manifest and raw/
7. `CONTENT_COMPLETENESS` — no `<!-- LLM:* -->` skeleton markers remain unfilled

**Exit codes:** 0 = PASS, 1 = FAIL

**Backward compatibility:** v2.0 bundles get WARNs (not FAILs) for v3.0-only fields.

## CLI Integration

Via the framework CLI:

```bash
node framework/runner/cli.js handoff generate --input /tmp/bundle-input.json
node framework/runner/cli.js handoff validate --bundle path/to/bundle --json
node framework/runner/cli.js handoff --testcase my_test --runset run_0001  # legacy
```

Via npm scripts (from `playwright_phased_runner/`):

```bash
npm run bundle:generate -- --input /tmp/bundle-input.json
npm run bundle:validate -- --bundle path/to/bundle
npm run bundle:test
```

## Schemas

All schemas use JSON Schema draft-2020-12 and live in `schemas/`:

| Schema | Validates |
|--------|-----------|
| `bundle-input.schema.json` | Input manifest to the generator |
| `llm-manifest.schema.json` | `LLM_MANIFEST.json` in the bundle |
| `summary.schema.json` | `SUMMARY.json` in the bundle |
| `index.schema.json` | `INDEX.json` in the bundle |
| `changelog-checklist.schema.json` | `dev_changelog.checklist.json` |

## Library Modules (`lib/`)

| Module | Purpose |
|--------|---------|
| `bundle-paths.js` | Canonical path/naming conventions |
| `copy-artifacts.js` | Evidence + raw file copier (.DS_Store filter) |
| `copy-prompts.js` | Copy prompt files to llm/prompts/ |
| `generate-harness.js` | AGENTS.md, CLAUDE.md, .cursorrules writer |
| `generate-indexes.js` | INDEX.json + INDEX.md generation |
| `generate-manifest.js` | LLM_MANIFEST.json v3.0 skeleton |
| `generate-summary.js` | SUMMARY.json skeleton |
| `schema-validator.js` | Lightweight JSON Schema validator (no deps) |
| `path-cross-ref.js` | Verify referenced paths exist on disk |
| `question-counter.js` | Extract Q-### counts from markdown |

## Templates (`templates/`)

JS modules that emit markdown/JSON skeletons with `<!-- LLM:* -->` placeholder markers.

## Tests

```bash
node --test tools/bundle/__tests__/*.test.js
```

Tests use `node:test` (built into Node 18+). No additional dependencies required.

## Bundle Version

Code-generated bundles use `bundle_version: "3.0"` in LLM_MANIFEST.json. The validator also works on v2.0 bundles with degraded checks (WARNs instead of FAILs for new fields).
