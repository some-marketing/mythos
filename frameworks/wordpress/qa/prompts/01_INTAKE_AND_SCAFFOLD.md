# 01 — Intake and Scaffold

> **Type**: Atomic
> **Mode**: PATCH_ALLOWED
> **Purpose**: Guide an agent (or human) through setting up a new testcase for the Playwright Phased Runner framework.
> **Agent-platform agnostic**: Works with Playwright MCP, browser DevTools, or manual inspection.

---

## Overview

This prompt covers the initial setup of a testcase:

1. **Project intake** — Gather target form URL, site identifier, authentication requirements
2. **Locator map scaffolding** — Generate initial locator_map.json from DOM inspection
3. **Identity file creation** — Define test data values for each field
4. **Testcase structure** — Create the folder and configuration files

---

## When to Use

- Setting up a **new testcase** for a form that hasn't been automated before
- Adding a **new site** to an existing project
- Creating a **variant testcase** (different happy path through the same form)

---

## Prerequisites

- The target form must be accessible via URL
- You need browser access (Playwright MCP or manual inspection)
- Determine which **environments** will be tested:
  - **A** (logged out, direct URL)
  - **B** (logged in, direct URL)
  - **C** (logged out, decorated/tracking URL)

---

## Step 1: Project Intake

Gather the following information:

| Item | Description | Example |
|------|-------------|---------|
| **Site ID** | Short identifier for the site | `clienta`, `client-xyz` |
| **Form URL** | Direct URL to the form | `https://example.com/apply` |
| **Decorated URL base** | Tracking URL pattern (if applicable) | `https://example.com/?utm_source=...` |
| **Form technology** | Form platform/framework | WPForms, Gravity Forms, custom React |
| **Is multipage?** | Whether form has multiple pages/steps | Yes/No |
| **Auth required?** | Does env B need logged-in state? | Yes/No |
| **Testcase ID** | Descriptive identifier | `apply_form_happypath` |

---

## Step 2: Generate Locator Map

### Using Browser Agent (Recommended)

Provide the agent this prompt:

```
Navigate to [FORM_URL] using the Playwright browser.

Goal: Map all user-editable fields in the form and output a locator_map.json.

For each field, capture:
- key: stable snake_case identifier (prefer name attribute)
- type: text|email|tel|textarea|select|checkbox|radio|number|date|url|file|choices_js
- css: stable CSS selector (#id preferred, then [name="..."], then data-*)
- required: true/false (from required attribute or visual indicator)
- label_text: human-readable label

For multipage forms:
- Split fields into pages array
- Include visible_when_css for each page (selector that's visible when page is active)
- Include next_button_css for each page with a Next button

For the final page:
- Include submit button_css
- Include success indicator (css and/or expected_url_contains)
- Include error_selectors array

Output ONLY valid JSON matching this structure:

{
  "version": "1.0",
  "form": { "root_css": "...", "is_multipage": true|false },
  "pages": [
    {
      "name": "Page 1 - Description",
      "visible_when_css": "...",
      "fields": [
        { "key": "...", "type": "...", "css": "...", "required": true, "label_text": "..." }
      ],
      "next_button_css": "..."
    }
  ],
  "submit": {
    "button_css": "...",
    "success": { "css": "...", "expected_url_contains": "" },
    "error_selectors": [{ "css": "...", "text_contains": "" }]
  }
}

Rules:
- Do NOT include hidden inputs (type="hidden") unless user-editable
- Prefer stable selectors: #id > [name="..."] > [data-*] > class-based
- Note any non-standard widgets (Choices.js, date pickers) in field comments
- Note any honeypot fields to avoid
```

### Manual Inspection

If using browser DevTools:

1. Open form in browser, open DevTools (F12)
2. For each visible field:
   - Right-click → Inspect
   - Note the id, name, type attributes
   - Check if required
   - Copy a stable selector
3. Document page transitions (how do pages change?)
4. Find the submit button and success indicator

---

## Step 3: Create Identity File

The identity file provides test values for each field key in the locator map.

```json
{
  "first_name": "Test",
  "last_name": "User",
  "email": "testuser+{TIMESTAMP}@example.com",
  "phone": "5551234567",
  "address_line1": "123 Test Street",
  "city": "Testville",
  "province": "NS",
  "postal_code": "B3H1A1",
  "employment_status": "employed",
  "years_employed": "5_plus"
}
```

### Special Placeholders

| Placeholder | Expands To |
|-------------|------------|
| `{TIMESTAMP}` | Unix timestamp (for unique emails) |
| `{BROWSER}` | Browser name (chromium/firefox/webkit) |
| `{ENV}` | Environment letter (A/B/C) |
| `{RUN_ID}` | Current run identifier |

### Value Format Notes

- **Selects**: Use the `value` attribute of the option, not the visible text
- **Radios**: Use the `value` of the radio button to select
- **Dates**: Use format expected by the input (YYYY-MM-DD or MM/DD/YYYY)
- **Phone**: Digits only (libraries may reformat)

---

## Step 4: Create Testcase Structure

Create the testcase folder:

```
playwright_phased_runner/testcases/<testcase_id>/
├── testcase.json         # URLs, asset paths, metadata
├── locator_map.json      # Field selectors (from Step 2)
├── identity.json         # Test values (from Step 3)
└── EXPECTED_OUTCOMES.md  # What should happen on success
```

### testcase.json

```json
{
  "testcase_id": "apply_form_happypath",
  "site": "example-site",
  "era": "era01",
  "form_id": "12345",
  "urls": {
    "direct": "https://example.com/apply",
    "decorated_base": "https://example.com/apply?utm_source=test"
  },
  "auth_states": {
    "B": {
      "storage_state_in": "../../auth_states/example-site/B-logged_in.storage.json"
    }
  },
  "phases": ["P1", "P2", "P3", "P4", "P5"],
  "assets": {
    "locator_map": "./locator_map.json",
    "identity": "./identity.json"
  }
}
```

### EXPECTED_OUTCOMES.md

Document what success looks like:

```markdown
# Expected Outcomes — [Testcase Name]

## On Successful Submission

- Redirect to confirmation page (URL contains `/thank-you`)
- Confirmation message visible
- dataLayer contains `form_submit` event
- CRM receives lead (verify via export)

## Tracking Expectations

### Cookies
- `first_touch` set on first visit (env A/C)
- `last_touch` updated on submission
- `ga_client_id` present

### dataLayer Events
- `pageview` on form load
- `form_start` on first interaction
- `form_submit` on successful submission

## Env-Specific Notes

- **Env A**: No prior session, direct URL
- **Env B**: Logged in, expect user ID in submission
- **Env C**: Decorated URL, expect UTM params in tracking
```

---

## Step 5: Validate Setup

Before running:

1. **Validate JSON syntax**:
   ```bash
   node framework/runner/cli.js validate --testcase <testcase_id>
   ```

2. **Check selectors exist** (quick visual check):
   - Open form in browser
   - Use DevTools to verify each CSS selector finds an element

3. **Review identity values**:
   - Do select values match option values (not visible text)?
   - Are all required fields covered?
   - Are conditional fields handled?

---

## Next Steps

After scaffolding:

1. **Run a walkthrough** — Use `02_LOCATORS_AND_CORRECTION.md` to validate and fix the locator map via live browser navigation

2. **Allocate a runset** and **execute the test** — Run env A first:
   ```bash
   # Allocate runset (do this once per test iteration)
   node framework/runner/cli.js new-runset --testcase <testcase_id>

   # Run env A
   node framework/runner/cli.js run --testcase <testcase_id> --env A-logged_out --runset run_0001
   ```

3. **Review results** — Check `playwright_phased_runner/testcases/<testcase_id>/runs/<runset>/A-logged_out/derived/`

---

## Common Issues at Scaffold Stage

| Issue | Solution |
|-------|----------|
| Form uses iframes | Map selectors within iframe; runner needs iframe handling |
| Dynamic IDs | Use [name="..."] or [data-*] attributes instead |
| Fields load async | Add wait conditions; may need visible_when_css per field |
| Multi-select | Use type "choices_js" or "select" with multiple values |
| File upload | Use type "file" and provide test file path in identity |
