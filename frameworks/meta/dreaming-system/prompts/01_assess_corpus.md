# 01 — Assess Corpus & Configure Ingest Surfaces

**Stage:** assess
**Mode:** FINDINGS_ONLY
**Risk:** low

## Objective

Survey the target knowledge corpus to identify ingest surfaces, measure corpus size, and configure the dreaming engine's input boundaries before building the associative engine.

## Process

1. Identify ingest surfaces — what directories or files form the knowledge corpus?
   - Memory entries (individual markdown or JSON files)
   - Concept documents (design docs, architecture decisions)
   - Session transcripts or conversation archives
   - Any other structured text that could yield latent connections

2. Measure the corpus: count files, estimate total tokens/words, identify document types and their proportions.

3. Apply the privacy floor: exclude any surface that may contain PII, credentials, client data, or operator-private philosophy. The engine must only ingest sanitized, non-sensitive text.

4. Configure ingest boundaries in the build script:
   - `INGEST_SURFACES`: array of directory paths
   - `FORBIDDEN_PATHS`: paths to exclude (privacy floor)
   - `STOPWORDS`: domain-specific terms to ignore

5. Document what you're ingesting and why in a `corpus-assessment.md` artifact.

## Expected Output

- `reports/dreaming-system/dreaming-corpus-assessment.md` — ingest surface map with counts, privacy boundary justification, and any exclusions with rationale.

## Gates

- Privacy floor enforced: no PII surfaces in ingest list
- At least 2 distinct ingest surfaces identified
- Corpus size documented (file count, approximate token count)
