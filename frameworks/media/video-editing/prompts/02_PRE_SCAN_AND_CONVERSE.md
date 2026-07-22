# 02: Pre-Scan and Converse

## Objective
Pre-scan the packed transcript for verbal issues, then converse with the operator to gather editorial direction shaped by the actual material. Do not use a fixed checklist — the right questions are different for every video.

## Mode
FINDINGS_ONLY

## Inputs
- `<edit_dir>/takes_packed.md` from Prompt 01
- Source inventory from Prompt 01

## Steps

1. [AUTO] Pre-scan takes_packed.md for problems:
   - Verbal slips and mis-speaks (note source + timestamp)
   - Obvious phrasings to avoid
   - Audio events as editorial signals: `(laughter)`, `(sigh)`, `(applause)` mark beats worth preserving
   - Silence gaps >= 400ms as cut candidates
   - Speaker handoff moments (note timing for air between utterances)
   - Plain list — feed into the editorial brief

2. [AUTO] Describe what you see in plain English. Cover:
   - How many takes/sources, total runtime, speaker count
   - Delivery style observed (scripted, conversational, interview, multi-camera)
   - Notable characteristics: portrait/landscape, lighting consistency, background
   - Any obvious audio issues (background noise, level variation)

3. [AUTO] Ask questions shaped by the material. Do not use a fixed checklist. The right questions depend on what's actually in the footage. Common areas to probe:
   - **Content type**: What kind of video is this? (launch, tutorial, interview, montage, travel, etc.)
   - **Target**: Desired length, aspect ratio, platform destination
   - **Aesthetic**: Brand palette, visual tone, reference videos
   - **Pacing**: Fast/energetic vs. deliberate/cinematic
   - **Must-preserve**: Sacred cow moments — what CANNOT be cut
   - **Must-cut**: Known sections to remove
   - **Animation**: Overlays needed? Style preferences?
   - **Grade**: Color direction (warm cinematic, neutral, custom)
   - **Subtitles**: Style preference (bold-overlay 2-word UPPERCASE, natural-sentence, or custom)

4. [AUTO] Collect and summarize operator responses. Record in chat — this feeds Prompt 03.

## Outputs
- Pre-scan problem list (verbal slips, mis-speaks, phrasings to avoid)
- Editorial brief in chat (content type, target length, aesthetic, pacing, must-preserve, must-cut, animation preferences, grade direction, subtitle style)
- No file writes at this stage (findings only)

## Success Criteria
- [ ] takes_packed.md read and pre-scanned
- [ ] Problem list compiled with source + timestamp citations
- [ ] Material description provided in plain English
- [ ] Editorial questions asked and answers collected
- [ ] Enough direction gathered to propose a strategy in Prompt 03

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: FINDINGS_ONLY — no file writes, no cut decisions
- Do not assume content type — observe, then ask
- Do not use a fixed questionnaire — questions must be material-shaped