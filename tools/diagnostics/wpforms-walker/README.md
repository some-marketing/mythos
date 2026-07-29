# wpforms-walker

One-shot generator for `locator_map.json` files conformant to the `wordpress/qa` framework schema. Walks a multi-page WPForms form once via Playwright, snapshots each page's interactive elements + calc-field state, emits a draft locator map and walk log.

Companion to the [`wordpress/qa`](../../../frameworks/wordpress/qa/) framework. The output is a **starting point** — hand-edit before committing as a real testcase locator map.

## Usage

```bash
# Use a named config under configs/<name>.json
node tools/diagnostics/wpforms-walker/cli.js -c {CLIENT_CODE}-apply-form61

# Watch it run
node tools/diagnostics/wpforms-walker/cli.js -c {CLIENT_CODE}-apply-form61 --headed
```

Outputs to `_dev/reports/wpforms-walker/<stamp>__<id>__locator_map.draft.json` and a walk log alongside.

## What it captures per page

- All radio groups: field id, name, every choice's value + label + css selector
- All text/email/tel/textarea/select fields: field id, name, css, required, title
- All hidden calc fields: field id, css, current value
- The page's "next" button selector

## Config

```json
{
  "id": "client-form-slug",
  "url": "https://example.com/form-page",
  "formId": "61",
  "maxPages": 25,
  "choiceFor": { "25": "first" },
  "answers": { "9": "real-test-email@example.com" },
  "answersByPage": { "3": { "139": "T1" } }
}
```

- `choiceFor[field_id]`: how to resolve radio groups — `"first"`, `"last"`, a numeric index, or a string label/value match
- `answers[field_id]`: explicit value for a text/email/tel field anywhere it appears
- `answersByPage[pageIdx][field_id]`: per-page override

## Not the runtime

This tool generates locator maps. **It does not replace the QA framework's runner.** Once you have a clean locator map and testcase.json, run the actual QA testcase via `frameworks/wordpress/qa/runner/run-phased.js` — that's where instrumentation (dataLayer capture, beacon capture, evidence immutability) lives.

## Known limitations

- **Choices.js multi-select widgets** — WPForms wraps `<select multiple>` in a Choices.js widget that intercepts native events. The walker's native `.selected = true` + `dispatchEvent('change')` does not trigger Choices.js's listener. Walker will stall on a page whose advance depends on a Choices.js multi-select. Workaround: supply the answer explicitly via `config.answers["<field_id>"]` and use `page.selectOption` upstream, or extend the walker to detect a `.choices` wrapper and call the Choices.js instance API directly.
- **Conditional pages** — WPForms can hide pages based on prior answers (e.g., page 4 of {CLIENT_CODE} form 61 stays hidden with first-choice answers). The walker reports the visible page-idx sequence; gaps reflect form logic, not walker bugs.
- **Server-side validation** — the walker only sees client-side validation. If the form does AJAX validation that silently rejects on the server, the stall detector trips after one retry. Inspect with `node tools/diagnostics/wpforms-walker/inspect-stall.js <page-idx>`.

## Walk safety

- Form submission is never triggered. The walker stops at the submit page.
- No CRM lead is created.
- Calc fields are observed only — no side-effects on the WPForms backend.
