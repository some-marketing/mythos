# WordPress Content Editing Workflow

Project: `{{PROJECT_NAME}}`
Framework: `wordpress/content-editing`

## Required Inputs

- `site-config.json`
- `edit-request.json`
- `success-criteria.md`

## Standard Flow

1. Intake and scope the exact target plus allowed edits.
2. Capture pre-edit state from WordPress admin plus live-page visual baselines when visuals can change.
3. Apply bounded content edits.
4. Verify editor-state and frontend-state.
5. Run a visual acceptance review for any layout-affecting changes using matched before/after section captures.
6. Publish only if explicitly allowed and verification plus visual review passed.
7. Write handoff artifacts and rollback notes.

## Supported Target Types

- Pages
- Posts
- Custom post types

## Supported Editor Types

- Gutenberg
- Classic Editor
- Known page builders via explicit selector hints

## Default Publish Policy

Draft-first. Publish requires explicit approval in `edit-request.json`.

## Visual Review Rule

If the requested edits can affect layout, spacing, media placement, styling, or section composition, visual review is a blocking gate. A technically correct edit that still looks wrong on the live page is not a successful run.
