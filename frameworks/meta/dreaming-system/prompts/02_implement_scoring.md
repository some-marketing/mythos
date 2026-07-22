# 02 — Implement Scoring Function & Build Script

**Stage:** build
**Mode:** PATCH_ALLOWED
**Risk:** low

## Objective

Implement the deterministic scoring function and build script that ingests the corpus, computes associations, and writes the dream report and SQLite database.

## Process

1. Use the `templates/build-script.js.template` as a starting point. The template encodes the proven scoring function:

   ```
   score = 3.0 × shared_rare_terms(idf-weighted)
         + 2.5 × shared_wikilink
         + 2.0 × directional_link
         + 1.5 × shared_tag
   ```

2. Configure from the corpus assessment (01-assess-corpus):
   - Set `INGEST_SURFACES` to the identified paths
   - Set `FORBIDDEN_PATHS` with privacy boundaries
   - Tune `THRESHOLD` (start at 3.0) and `MAX_DREAMS` (start at 25)

3. Implement the build script with these properties:
   - **Deterministic:** Same input → same output every time
   - **Idempotent:** Safe to run repeatedly (scratch rebuild)
   - **Stdlib-only:** No npm install, no external APIs
   - **Explainable:** Every association includes its basis (shared terms, links, tags)
   - **Privacy-floor enforced:** Script validates ingest paths against forbidden list

4. Run a first build and verify:
   - SQLite database created with `memories`, `concepts`, `associations` tables
   - `dream-report.md` written with top associations and non-obvious pairs
   - Report includes basis for every association (shared rare terms, wikilinks, etc.)

## Expected Output

- `tools/memory/build-memory-db.js` — the build script
- `reports/dreaming-system/memory-db/dream-report.md` — first dream report
- `reports/dreaming-system/memory-db/memory.sqlite` — SQLite database

## Gates

- Script exits 0 on success
- Dream report contains both "Top associations" and "Most non-obvious" sections
- Non-obvious pairs are bridged purely by shared vocabulary (no shared tag, wikilink, or directional link)
- Rebuild time < 30 seconds for corpora up to 10K documents
