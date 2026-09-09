# 05 — Client Review

## Objective
Get the client to review the design direction before the build goes deeper, with an email that
explains the why, names what is placeholder, and asks for exactly what is still needed.

## Mode
PATCH_ALLOWED (create a Gmail *draft* in the operator's account). Sending is the operator's action.

## Inputs
- The live demo URL. The demo MUST be noindexed and password-gated before the link goes to the
  client; include the password in the email body only, never in any file under the project.
- Open gates from Stages 2–4 (hero photo, owner photo, extra photos, unconfirmed facts)
- `docs/client-communication-brief.md` (the agency's client-email register; project-scoped, not
  operator-personal memory)

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
3. Register: follow `docs/client-communication-brief.md` (casual, contractions, short asides in
   parentheses, invite input at the end of a bullet, no over-precision, first-name sign-off).
4. Hand the draft to the operator. After they edit and send, read the sent version back, replace
   the demo password (and any other credential) with the fixed placeholder `[DEMO_PASSWORD]`
   **before** comparing, then diff the sanitized sent text against the draft and record only the
   sanitized differences in the project's `outputs/` next to the draft (a dated "operator edits"
   note). Confirm the note contains no credential before saving it. Style observations belong to
   the project record; they are not written into the framework or into operator-personal memory
   by this framework.

## Outputs
- `outputs/email-to-client__design-direction-review.md` (pre-edit draft, for provenance)
- Gmail draft id / thread id recorded in the capture

## Success Criteria
- Under ~350 words. Every design bullet names its source. Every ask is concrete.
- The operator sends with light edits, not a rewrite.

## Guardrails
- Never send on the operator's behalf. Never include the demo password in a file that could be
  committed.
