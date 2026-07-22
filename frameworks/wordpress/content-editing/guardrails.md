# WordPress Content Editing Guardrails

## Core Intent

This framework exists for scoped content edits inside authenticated WordPress admin surfaces. It combines:

- WordPress admin navigation and editor detection discipline
- bounded edit application
- evidence-first verification
- explicit publish-or-freeze handoff reporting

It is not a general site-builder framework and it is not a free-form "fix anything in wp-admin" workflow.

## Core Rules

- Edit only the explicitly approved target pages, posts, or CPT entries named in `edit-request.json`.
- Capture pre-edit state before changing anything.
- Default to saving as draft or updating an already-draft object unless publish is explicitly authorized in the request.
- Do not make opportunistic cleanup edits, layout changes, SEO rewrites, or plugin/config changes unless they are inside the approved edit scope.
- Do not touch site code as part of a content-editing run by default: no theme files, plugin files, mu-plugins, Code Snippets / WPCodeBox snippets, custom PHP, database-level content rewrites, or direct postmeta edits unless a separate approved lane explicitly authorizes code/config work.
- Do not store credentials in project files, screenshots, or logs.
- If the editor type is unknown or the target surface differs materially from expected selectors, stop after capture and route to review.

## Execution Modes

### FINDINGS_ONLY
- Purpose: Inspect target content surfaces and report what would need to change.
- Allowed: Login, navigate, inspect editor type, capture screenshots, read current content, write local capture artifacts.
- Forbidden: Saving edits, creating drafts, publishing changes, mutating live content.

### RUN_ONLY
- Purpose: Execute the approved edit plan and record evidence without expanding scope.
- Allowed: Apply only the predeclared edits, save drafts or updates within policy, write run artifacts.
- Forbidden: Inventing new content direction, widening scope, publishing without explicit authorization.

### REVIEW_ONLY
- Purpose: Read existing artifacts and confirm whether the requested changes landed correctly.
- Allowed: Compare intended edits, editor state, and rendered frontend output; write review reports.
- Forbidden: New edits, reruns, publishing, or config mutation.

### PATCH_ALLOWED
- Purpose: Make minimal local framework or project-file corrections needed to complete the workflow safely.
- Allowed: Update local config, selector hints, acceptance criteria, or framework docs.
- Forbidden: Unrelated refactors, framework-wide behavior changes without explicit intent, hidden scope expansion.

### COORDINATOR
- Purpose: Orchestrate multi-page or multi-step editing runs while delegating narrow execution slices.
- Allowed: Split page groups, sequence approvals, synthesize verification results.
- Forbidden: Parallel publish actions without per-page traceability.

## Live-Site Safety

- Always record the target object identifier, edit URL, current status, and intended end status.
- Before any save, confirm the current object matches the requested slug/title or post ID.
- If the target is currently published and the request does not explicitly allow direct published edits, save to draft or stop for approval.
- If a page builder exposes unstable or hidden fields, do not guess. Capture evidence and escalate.
- If the requested outcome appears to require template, builder, or custom-code changes rather than bounded content edits, stop and split that work into a separate lane instead of improvising inside the content-editing run.
- Never bulk-publish pages from a single success assumption; each page needs its own result entry.

## Content Scope

- Allowed edits: text content, headings, CTA copy, body copy, approved links, approved metadata fields, and explicitly listed structured fields.
- Not allowed by default: theme settings, templates, menus, plugin settings, reusable blocks, global CSS, layout rebuilds, taxonomy strategy changes, site code, code-snippet tools, direct database/meta edits, or builder-internal JSON manipulation.
- If the request includes templated multi-page rollout, every generated page still needs page-level verification and a status ledger.

## Verification Requirements

- Verify both editor-state and frontend-state after edits when a frontend URL exists.
- For any edit that can affect layout, spacing, styling, media placement, or page composition, capture pre-edit and post-edit screenshots of the same page sections and run an explicit visual acceptance check.
- Check all newly introduced or updated links.
- Confirm the saved status (`draft`, `pending`, `published`, etc.) matches the intended policy.
- Record any unresolved drift between requested text and rendered output.
- If verification fails, do not publish; freeze the run with a clear report.
- Treat "technically rendered but visually wrong" as a verification failure for layout-affecting edits.

## Reporting Rules

- Review outputs must be evidence-first and path-based.
- Separate:
  - what was requested
  - what was changed
  - what was verified
  - what remains unresolved
- Do not claim success on a page without pre/post evidence.
- For multi-page runs, provide per-page status, not one blended overall verdict.

## Required Gates

- Scope gate: target and allowed fields are explicitly identified.
- Editor gate: editor type is known and compatible with current selectors.
- Save gate: requested mutations are fully enumerated before save.
- Visual gate: layout-affecting edits have matched pre/post section captures and a visual acceptance decision.
- Publish gate: explicit approval exists for any publish action.
- Verification gate: editor and frontend checks pass before final success is recorded.

## Recommended Status Outcomes

- `captured_only`
- `edited_not_saved`
- `saved_as_draft`
- `updated_existing_draft`
- `updated_published_with_approval`
- `verification_failed`
- `blocked_for_review`
- `published`
