# publish-framework

One command to take a framework you've added and make it **safely publishable** — scan
for anything that shouldn't go public, auto-fix the safe stuff, and hand off to the
hardened export pipeline for the actual clean export and verification.

```bash
npm run publish-framework -- frameworks/wordpress/seo-audit          # dry report (read-only source/map/target)
npm run publish-framework -- frameworks/wordpress/seo-audit --apply  # scrub + wire + export + smoke
npm run publish-framework -- frameworks/wordpress/seo-audit --json   # machine-readable
```

**Read-only by default.** Without `--apply` the tool never mutates the framework source,
the export map, or any public target. It only writes an analysis report under
`_dev/reports/analysis/publish-framework/` (the dry-run export check runs entirely in a
temp staging dir via the export-public module API). `--apply` is the only mode that
auto-scrubs source, wires the map, and writes to the public repo — and it evaluates every
blocker **before** touching the source, so a run that ends `BLOCKED` leaves everything
untouched.

**Fail-closed.** This is a private→public boundary, so a false negative (contamination
that slips through) is the critical failure. Every file is scanned as decoded text
regardless of extension (UTF-8 and UTF-16, LE/BE, BOM or heuristic); a file that cannot be
decoded as text is **BLOCKED** as an unrecognized binary for a human to confirm (allowlist
known-safe shapes via `binary_allowlist` globs in `scan-config.json`). A real
`.env`/credential/state file (a *mock candidate*) **BLOCKS** unless the export map already
excludes or mocks it. Normal invocation targets a framework directory (under `frameworks/`
or carrying a `manifest.json`); publishing an arbitrary directory as a validation-free unit
requires the explicit `--allow-unit` flag.

## What it does

1. **Scan** every file in the framework for publish-blockers.
2. **Classify** each finding into one of four classes.
3. **Auto-scrub** (only with `--apply`, only the safe class).
4. **Wire** the framework into `tools/export-public/config/framework-export-map.json` (idempotent).
5. **Export** via `tools/export-public` — the hardened, atomic, receipted pipeline (denylist
   strip, independent contamination lint, manifest validation, clean-clone smoke).
6. **Verdict**: `PUBLISH-READY` or `BLOCKED` with the exact items a human must resolve.

It composes with `tools/export-public` and reuses its denylist and scan functions — it
does not reimplement export or substitution logic.

## The four finding classes

| Class | Meaning | Handling |
|---|---|---|
| `needs-human` | Credentials, `op://` refs, hardcoded secrets/keys, and operator names/hosts from `scan-config.json` | **Always blocks.** Never auto-altered — you must resolve each one. |
| `client-data` | Client codes, domains, ad IDs, emails in the export denylist | **Blocks by default** so you can confirm. Pass `--allow-substitutions` to let the exporter genericize them deterministically instead. |
| `auto-scrub` | Absolute platform home-directory paths | Rewritten to `~` under `--apply`. |
| `mock-candidate` | Files that hold real env/credential/state (`.env`, `.env.*`, `*-manifest.json`, `*state.json`, `*secrets*`, `*credentials*`, `*.local.json`) | **Blocks** until the export map excludes or mocks the real file — ship a sanitized `.example` instead. A `.example`/`.sample`/`.template` sibling is already treated as sanitized. |
| `binary` | Files that cannot be decoded as text | **Blocks** for human review — never copied verbatim unseen. Allowlist known-safe shapes via `binary_allowlist` globs in `scan-config.json`. |

`PUBLISH-READY` requires zero blocking findings (`needs-human`, plus `client-data` unless
`--allow-substitutions`), a clean export, and a passing smoke.

## scan-config.json

Optional, lives beside `index.cjs`, **not exported** and **git-ignored** (only
`scan-config.example.json` is tracked). Lists your own operator names and private
hostnames so they're caught as `needs-human`, and optionally allowlists known-safe binary
file shapes so they don't block:

```json
{ "personal_names": ["Jordan", "Lee"], "private_hosts": ["build-box", "gpu-01"], "binary_allowlist": ["assets/**/*.png"] }
```

Structural secrets (API-key shapes, `op://`, absolute paths) are detected without it. Copy
`scan-config.example.json` to start.

## Limitations

**This scanner is a defense-in-depth *aid*, not a guarantee.** It exists to catch the
common, structurally-detectable ways private data leaks into a framework — it does not and
cannot prove a framework is clean. Treat a clean verdict as "no *known* pattern tripped,"
never as "safe to ship unreviewed." Known blind spots:

- **Low-entropy / dictionary-word secrets.** A value like
  `correcthorsebatterystaple` has the entropy of ordinary prose, so it cannot be detected
  from the *value*. We mitigate this by flagging it via its **key name** (any assignment to
  a `password`/`secret`/`token`/`api_key`/`credential`/`auth`… identifier with a
  non-placeholder value blocks regardless of entropy). That heuristic still misses a secret
  stored under an innocuous key name (`FAVORITE_PHRASE=correcthorsebatterystaple`), or a
  multi-word passphrase written with spaces.
- **Novel or unlisted secret formats.** Structural key detectors cover the vendors listed in
  `index.cjs` (OpenAI, Anthropic, AWS, GitHub, Stripe, Slack, Google, JWT, `op://`, PEM). A
  brand-new or private token format with no recognizable shape and an innocuous key name can
  pass.
- **Semantically-hidden client data.** Client facts paraphrased into prose ("the dealership
  on Route 9"), encoded/compressed blobs, or data split across files evade both the denylist
  and the structural scanners.
- **Content behind an encoding the classifier rejects.** Undecodable files fail *closed*
  (they block as binary), which is safe — but it means such content is never actually read,
  so a human, not the tool, is the one clearing it.

Because of these, the tool is designed to be **paired with**, never a substitute for: (1) a
human review of every `needs-human` / `binary` / `mock-candidate` finding, and (2) the
hardened `tools/export-public` denylist strip + independent contamination lint + clean-clone
smoke that runs on the actual staged output. The front door blocks by default and prefers a
false positive (a needless human look) over a false negative (leaked data) — but the last
line of defense is human review and the export denylist, not this scanner.

## Exit codes

`0` — PUBLISH-READY (or READY in dry-run). `1` — BLOCKED. `2` — bad usage.
