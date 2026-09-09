# 01 — Intake and Research

## Objective
Assemble one context bundle the whole build can cite, then run design/market research with the
client's real brand facts pinned so the research cannot re-guess them.

## Mode
RUN_ONLY

(Reports-only writes: this stage creates the context bundle index, the photo table and the
research reports under the project. It applies no fixes to any site.)

## Inputs
- `client.json`, `intake.json`
- Kickoff-call transcript (verbatim, not a paraphrase — find the full one if a summary exists)
- Raw questionnaire answers
- Brand assets: business card front/back, every logo export the client has (tall, horizontal, mark)
- Every client-supplied photo
- The client's current live site (review it directly; copy the real text)

## Steps
1. Create `context-bundle/` with a `README.md` that indexes every file and records provenance.
2. **Photo inventory table**: one row per photo — filename, what it shows, rating
   (`hero-quality` / `supporting texture` / `skip`), and any scope flag (third-party brand marks,
   not-electrical, owner in frame). Be honest: most trades photo sets have 0–2 hero-grade shots.
3. **Brand facts, read live** (not guessed): wordmark font name, fill/outline hex values, palette,
   the services list as printed. Note which logo file is usable at header height (usually none;
   ask for a horizontal lockup).
4. **Identity nuances from the transcript**: heritage dates, prior company names, "no photo of me",
   things the client explicitly does not want. Quote them. Mishearings in transcripts are common —
   confirm proper nouns with the operator before they reach copy.
5. Run research twice:
   - Long-form (13-section) prompt from the intake form, via the research CLI.
   - Short web-UI prompt (Perplexity Deep Research) with the **brand facts pinned** in the prompt
     text and the card + hero photos attached, so the design section builds on what exists.
   File both reports under `outputs/`.
6. Record open operator gates discovered here (font licence, hero photo, owner photo, build target).

## Outputs
- `context-bundle/README.md` with the photo table and brand facts
- `outputs/design-research-report.md` and the web-UI PDF
- Open-gates list for Stage 2

## Success Criteria
- Every brand value in the bundle cites the asset it was read from.
- Every photo has a rating and the ratings agree with a direct look, not the filename.
- Research reports reflect the pinned brand facts (no re-guessed palette/font).

## Guardrails
- No credentials, no client PII in anything that could leave `clients/<CODE>/`.
- Do not attach the transcript to external research tools; summarise the two or three facts it adds.
