# 05 — Client Review

## Objective
Get the client to review the design direction before the build goes deeper, with an email that
explains the why, names what is placeholder, and asks for exactly what is still needed.

## Mode
PATCH_ALLOWED (create a Gmail *draft* in the operator's account). Sending is the operator's action.

## Inputs
- The live demo URL (noindexed; password if gated)
- Open gates from Stages 2–4 (hero photo, owner photo, extra photos, unconfirmed facts)
- The operator's writing style (see memory `operator-client-email-style`)

## Steps
1. Draft under `outputs/email-to-client__design-direction-review.md`, then create it as a Gmail
   draft addressed to the client contact from `client.json`. Never send.
2. Structure (short; the client is busy):
   - Two-sentence opener: first draft is up, please look before we go further, it's a demo.
   - The link, then "check it on your phone too" with the one-line reason.
   - **Why it looks the way it does** — 5–7 one-line bullets, each tied to something the client
     said or gave us (call, card, logo, inspiration site). Explain trade-offs in plain terms with
     a short aside in parentheses (e.g. why the logo font isn't the heading font).
   - **What's placeholder** — 3–4 bullets: copy is a first pass; photos are theirs; the hero shape
     holds the logo until a hero photo exists; the form is a placeholder box.
   - **What I need from you** — a numbered list of three: does the feel match, any wording to
     change, the specific photos we want (van with signage, someone at work, finished install
     close-up, one wide bright shot for the top), plus the owner-photo yes/no.
   - One-line close: reply or call; once happy we finish copy, add the form, go live on your domain.
   - First-name sign-off; the signature carries the company.
3. Register: casual, contractions, "vibe" is fine, invite input at the end of a bullet, avoid
   over-precision (no exact URLs beyond the demo link, no ids, no numbers the client doesn't need).
4. Hand the draft to the operator. After they edit and send, diff their version against the draft
   and record what changed as a style observation.

## Outputs
- `outputs/email-to-client__design-direction-review.md` (pre-edit draft, for provenance)
- Gmail draft id / thread id recorded in the capture

## Success Criteria
- Under ~350 words. Every design bullet names its source. Every ask is concrete.
- The operator sends with light edits, not a rewrite.

## Guardrails
- Never send on the operator's behalf. Never include the demo password in a file that could be
  committed.
