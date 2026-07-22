# Verification Scripts

Standardized verification infrastructure for Mythos. All scripts output the `VerificationSignal/1.0` JSON contract defined in `signal-schema.json`.

## Two-Tier Verification Model

| Tier | Runner | Speed | Deterministic | Gate |
|------|--------|-------|---------------|------|
| **1 (Mechanical)** | Node.js scripts (this directory) | <1s | Yes | Hard stop on FAIL |
| **2 (Nuance)** | LLM-based review | 30-60s | No | Advisory WARN only |

**Rule:** Tier 1 runs first. If any critical check FAILs, Tier 2 never runs. This ensures deterministic structural validation always precedes subjective quality review.

- **Tier 1** catches missing files, invalid JSON, broken references, schema violations, and count mismatches.
- **Tier 2** catches quality issues, ambiguous wording, incomplete analysis, and content that is structurally valid but semantically weak.

## Scripts

| Script | Scope | Usage |
|--------|-------|-------|
| `verify-system.cjs` | Mythos system integrity | `node tools/verify/verify-system.cjs [project-root]` |
| `verify-framework.cjs` | Single framework structure | `node tools/verify/verify-framework.cjs <framework-id>` |
| `verify-guardrails.cjs` | Guardrails section presence | `node tools/verify/verify-guardrails.cjs [path-to-guardrails.md]` |
| `verify-skill.cjs` | Single SKILL.md deep validation | `node tools/verify/verify-skill.cjs <path-to-SKILL.md>` |
| `verify-run-evidence.cjs` | Test run environment evidence | `node tools/verify/verify-run-evidence.cjs <env-dir>` |
| `verify-site-audit.cjs` | Competitive analysis evidence | `node tools/verify/verify-site-audit.cjs [base_path]` |
| `verify-report-claims.cjs` | Audit report citations vs disk | `node tools/verify/verify-report-claims.cjs <report> [project-root]` |

All scripts accept `--output=path` to override the default temp output location.

## VerificationSignal/1.0 Output Format

Every script outputs the same JSON shape (see `signal-schema.json` for the full schema):

```json
{
  "schema": "VerificationSignal/1.0",
  "timestamp": "2026-03-25T12:00:00.000Z",
  "source": "verify-framework",
  "scope": "framework:wordpress/qa",
  "tier": "mechanical",
  "verdict": "PASS|FAIL|WARN",
  "summary": {
    "total": 25,
    "passed": 23,
    "failed": 1,
    "warned": 1,
    "skipped": 0
  },
  "checks": [
    {
      "id": "manifest.exists",
      "category": "structure",
      "severity": "critical",
      "status": "PASS",
      "message": "manifest.json exists",
      "evidence": "/path/to/manifest.json",
      "detail": "optional extra context"
    }
  ],
  "failures": [
    {
      "id": "prompt.count",
      "category": "consistency",
      "message": "Prompt count mismatch",
      "fix_hint": "Update manifest prompt_count to 16"
    }
  ],
  "gate_decision": {
    "proceed": false,
    "reason": "1 critical check failed",
    "blocked_by": ["prompt.count"]
  }
}
```

**Agent integration:** Read `gate_decision.proceed`. If `false`, read `failures[]` for actionable `fix_hint` instructions.

### Verdict Rules

- **PASS** -- all critical checks pass, no warnings
- **WARN** -- all critical checks pass, but warnings exist
- **FAIL** -- one or more critical checks failed

### Exit Codes

- `0` -- PASS or WARN (proceed)
- `1` -- FAIL (blocked)
- `2` -- Usage error (missing required argument)

## Signal Lifecycle

```
WRITE (script)  -->  READ (agent)  -->  ACT (fix or proceed)  -->  CLEAN (delete)
```

Signals are ephemeral:
- Written to `/tmp/claude-verify/{script-name}/signal.json`
- On PASS: deleted immediately after agent reads
- On FAIL followed by fix followed by re-PASS: each retry overwrites previous signal
- Never committed to git

## Shared Library

### `lib/signal.cjs`

Signal builder and lifecycle manager. Exports:

| Function | Description |
|----------|-------------|
| `createSignal(source, scope)` | Create a new signal object |
| `addCheck(signal, checkObj)` | Add a check result (runs `test()` if present) |
| `finalize(signal)` | Compute verdict and gate_decision from checks |
| `writeSignal(signal, outputPath)` | Finalize and write signal JSON to disk |
| `readAndClean(signalPath)` | Read signal and delete the file |
| `cleanScratch()` | Remove all scratch/temp signal files |
| `printSummary(signal)` | Print human-readable summary to stdout |
| `getTempPath(scriptName)` | Get the default temp output path for a script |

### `lib/checks.cjs`

Reusable check factories. Each returns a check object with an `id`, `category`, `severity`, `message`, `test()` function, and optional `fix_hint`.

| Function | Description |
|----------|-------------|
| `fileExists(path, opts)` | Check that a file exists |
| `dirExists(path, opts)` | Check that a directory exists |
| `jsonValid(path, opts)` | Check that a file contains valid JSON |
| `jsonHasKeys(path, keys, opts)` | Check that a JSON file has required keys (supports dot-notation) |
| `fileMinSize(path, bytes, opts)` | Check that a file meets a minimum size |
| `yamlHasFrontmatter(path, fields, opts)` | Check that a file has YAML frontmatter with required fields |
| `xmlHasTag(path, tagName, opts)` | Check that a file contains a specific XML tag |
| `xmlNoMarkdownHeadings(path, opts)` | Check that a file body does not use markdown headings |
| `countMatches(actual, expected, label, opts)` | Check that a count matches expected |
| `referenceResolves(from, to, opts)` | Check that a cross-reference target exists |
| `fileContains(path, string, opts)` | Check that a file contains a specific string |

## Usage Examples

Validate a framework:
```bash
node tools/verify/verify-framework.cjs wordpress/qa
```

Validate run evidence for a test environment:
```bash
node tools/verify/verify-run-evidence.cjs testcases/wpforms_88823/runs/run_0009/A-logged_out/
```

Validate competitive analysis completeness:
```bash
node tools/verify/verify-site-audit.cjs path/to/competitive_analysis/
```

Validate an audit report's citations against disk:
```bash
node tools/verify/verify-report-claims.cjs reports/audit-report.md /path/to/project
```

Save output to a specific path:
```bash
node tools/verify/verify-system.cjs --output=./my-signal.json
```

## Adding a New Verification Script

1. Create `tools/verify/verify-{name}.cjs` (must use `.cjs` -- the project may have ESM elsewhere)
2. Import shared libraries:
   ```js
   const { createSignal, addCheck, writeSignal, printSummary, getTempPath } = require('./lib/signal.cjs');
   const checks = require('./lib/checks.cjs');
   ```
3. Parse arguments and create a signal:
   ```js
   const signal = createSignal('verify-{name}', 'scope description');
   ```
4. Add checks using `addCheck(signal, ...)` -- either with `checks.*` factory functions or inline check objects
5. Write and print results:
   ```js
   writeSignal(signal, outputPath);
   printSummary(signal);
   process.exit(signal.gate_decision.proceed ? 0 : 1);
   ```
6. Exit `0` on PASS/WARN, `1` on FAIL, `2` on usage error
7. Update this README's Scripts table

## File Extension

All scripts use `.cjs` to ensure CommonJS `require()` works regardless of the nearest `package.json` `"type"` setting. Using `.js` in an ESM context will fail with "require is not defined in ES module scope".
