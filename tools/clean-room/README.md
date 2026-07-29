# Clean-Room Re-Expression Gate

`tools/clean-room/clean-room.cjs` — the mechanism for extracting intellectual
value from **license-unclear external sources** (e.g. `ui-ux-pro-max`, `remotion`)
without ever shipping their copyrighted text into redistributed Mythos frameworks.

Built to let a maintainer extract intellectual value from a license-unclear
source without shipping its copyrighted text.

## What it is — and is NOT

This is the **mechanism for safe distillation once the operator has decided to
proceed knowledge-only.** It does **not** make the license decision for you. The
decision to harvest from a license-unclear source is a scope/legal judgment that
**bubbles to the human operator**. Run this gate only after that decision is made.

It aligns with `scaffold-framework`'s `distilled_from` provenance discipline: the
receipt is the durable proof that a distillation was clean-room.

## When to use it

Use it whenever you want to lift a *concept* (a design heuristic, an animation
pattern, a checklist) from a source whose license is unclear or incompatible with
redistribution — and you must guarantee the Mythos output is your own re-expression,
not a copy.

Do **not** use it for MIT/permissive sources you can cite directly, and it is not a
substitute for the operator's license call.

## The 3-step lifecycle

```
quarantine  →  (re-express, out of band)  →  verify  →  release
```

1. **quarantine** — copy/fetch the raw external text into
   `reports/clean-room/quarantine/<slug>/` with a manifest (source,
   `retrieved_at`, `sha256` of the raw text). This dir is the **only** place the
   raw text lives.

   ```sh
   node tools/clean-room/clean-room.cjs quarantine ./external/ui-ux-pro-max/heuristics.md --id ui-ux-heuristics
   # or a URL:
   node tools/clean-room/clean-room.cjs quarantine https://example.com/skill.md --id remotion-overlays
   ```

2. **Re-express (out of band)** — in an isolated pass, re-express the concept in
   Mythos's own words into a destination file (e.g. a `design-research` reference).
   Read the quarantined raw text, write a fresh distillation. Do not paste.

3. **verify** — compute the overlap between the quarantined raw text and your
   re-expression. **FAILs (exit 1)** if overlap exceeds the threshold (the
   verbatim-copy guard); **PASSes (exit 0)** if sufficiently re-expressed.

   ```sh
   node tools/clean-room/clean-room.cjs verify ui-ux-heuristics ./frameworks/wordpress/design-research/reference/heuristics.md
   ```

4. **release** — on a passing verify, **delete the quarantine dir** (raw text
   gone) and write a `CleanRoom/1.0` receipt to
   `reports/clean-room/receipts/<slug>.json` — the durable proof.

   ```sh
   node tools/clean-room/clean-room.cjs release ui-ux-heuristics ./frameworks/wordpress/design-research/reference/heuristics.md
   ```

## The overlap metric

**Normalized 4-gram (word-shingle) Jaccard overlap.** Both texts are lowercased,
stripped of punctuation, and split into word tokens; the set of contiguous 4-word
shingles is built for each, and the score is `|A ∩ B| / |A ∪ B|` (0 = no shared
phrasing, 1 = identical).

- **Default threshold: `0.30`.** Genuinely re-expressed prose about the same
  concept typically shares well under 0.15 of its 4-word shingles with the source;
  verbatim or lightly-paraphrased text shares far more. 0.30 leaves clear daylight
  — it fails near-verbatim copies and passes real re-expression while tolerating
  unavoidable shared domain terms.
- Override per run with `--threshold <0..1>`.

This is a heuristic verbatim-copy guard, not a semantic-plagiarism detector. It
catches the failure mode that matters here — shipping the source's *words* — not
conceptual similarity (which is the whole point of distillation).

## Flags

| Flag | Applies to | Effect |
|------|-----------|--------|
| `--id <slug>` | quarantine | quarantine identifier (sanitized to `[a-z0-9._-]`) |
| `--threshold <0..1>` | verify, release | override the default `0.30` overlap threshold |
| `--json` | all | machine-readable output |
| `--signal <path>` | all | also emit a `VerificationSignal/1.0` via `tools/verify/lib/signal.cjs` |

## Receipt schema (`CleanRoom/1.0`)

Written to `reports/clean-room/receipts/<slug>.json` on release:

```json
{
  "schema": "CleanRoom/1.0",
  "id": "ui-ux-heuristics",
  "source": "./external/ui-ux-pro-max/heuristics.md",
  "source_type": "path",
  "source_sha256": "<sha256 of the quarantined raw text>",
  "retrieved_at": "2026-06-23T...Z",
  "verified_at": "2026-06-24T...Z",
  "output_path": "frameworks/.../heuristics.md",
  "overlap_score": 0.07,
  "threshold": 0.3,
  "metric": "normalized 4-gram shingle Jaccard overlap",
  "note": "Clean-room re-expression verified non-verbatim; quarantine raw text deleted."
}
```

## Tests

```sh
node --test tools/clean-room/__tests__/clean-room.test.cjs
```
