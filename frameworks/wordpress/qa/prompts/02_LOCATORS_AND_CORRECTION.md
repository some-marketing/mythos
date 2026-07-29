# 02 — Locators and Correction

> **Type**: Atomic
> **Mode**: PATCH_ALLOWED
> **Purpose**: Validate and correct a locator map through live browser walkthrough. Catches issues that static DOM inspection misses.
> **Agent-platform agnostic**: Works with Playwright MCP or manual browser DevTools inspection.

---

## Overview

This prompt covers the **walkthrough and correction** stage:

1. **Navigate** — Walk through the form page by page using a browser
2. **Document** — Record actual DOM behavior, transitions, and quirks
3. **Correct** — Fix the locator map based on findings

This stage is critical because static DOM inspection misses:
- Conditional fields (appear only after certain selections)
- Async page transitions
- Non-standard widgets (Choices.js, date pickers)
- Popup interstitials between pages
- Framework quirks (WPForms doesn't update CSS classes on transition)

---

## When to Use

- After **initial scaffold** (01_INTAKE_AND_SCAFFOLD.md)
- When tests are **failing** due to selector drift
- When the **form has changed** and needs remapping
- Periodically for **maintenance** validation

---

## Prerequisites

- Locator map exists (even if incomplete)
- Browser access (Playwright MCP recommended)
- Test identity values ready

---

## Walkthrough Prompt

Provide this to a browser-capable agent:

```
Navigate to [FORM_URL] using the Playwright browser.

OBJECTIVE: Walk through the entire form submission flow, documenting actual DOM behavior to validate and correct the locator map.

For each page:

1. OBSERVE
   - Take a snapshot
   - List all visible fields (type, selector, label, required)
   - Note the page indicator selector (what shows this page is active?)
   - Note any fields that weren't in the locator map

2. INTERACT
   - Fill each field with test data from the identity file
   - Verify the value is accepted (no validation errors)
   - Note any fields with special input requirements (format, length, values)

3. TRANSITION
   - Click the Next button
   - Document HOW the page changes:
     - CSS class changes? (e.g., .active added/removed)
     - Display property changes? (display:none → display:block)
     - URL changes?
     - Animation/delay before next page visible?
   - Note if the documented visible_when_css actually matches

4. CONDITIONAL ELEMENTS
   - Note fields that appear/disappear based on prior selections
   - Note entire pages that may be skipped based on answers
   - Document the conditions (e.g., "Province field appears after Country=Canada")

5. INTERSTITIALS
   - Note any popups, modals, or overlays between pages
   - Document: trigger condition, container selector, dismiss button selector
   - Note timing (appears immediately? after delay?)

6. NON-STANDARD WIDGETS
   - Identify Choices.js, Select2, React Select, date pickers, phone formatters
   - Document interaction pattern (click to open, then click option? type to filter?)
   - Note the actual input element vs the visual wrapper

7. HONEYPOTS
   - Identify hidden fields designed to catch bots
   - These should NOT be in the locator map (or marked skip: true)

Continue through to submission:
- Document the submit button selector
- Document the success indicator (what shows submission worked?)
- Document any error states and their selectors

OUTPUT FORMAT:
Produce a findings document with:
- CRITICAL ISSUES (will cause runner to fail)
- PER-PAGE CORRECTIONS (selector fixes, new fields, removed fields)
- TRANSITION FIXES (visible_when_css corrections)
- NEW CONFIGURATIONS NEEDED (popup_after_next, conditional fields)
- IDENTITY CORRECTIONS (value format issues)

Do NOT modify files directly — output findings only.
```

---

## Common Findings and Fixes

### 1. Page Transition Detection Fails

**Symptom**: Runner waits forever for `visible_when_css` that never matches

**Common Causes**:
- Framework doesn't update CSS classes (WPForms, Gravity Forms)
- Class is applied but with different timing
- Using wrong selector (class vs display state)

**Fix**: Use the page container selector and rely on `{state: "visible"}`:
```json
{
  "visible_when_css": ".wpforms-page-2"
}
```
The runner waits for this element to be visible (display:block), not for a specific class.

### 2. Next Button Click Doesn't Work

**Symptom**: Click happens but page doesn't advance

**Common Causes**:
- jsClick (`page.evaluate(el=>el.click())`) doesn't trigger framework handlers
- Button is disabled until validation passes
- Click is intercepted by overlay

**Fix**: Use native Playwright click and ensure fields are filled first:
```javascript
// Runner uses page.click() not jsClick
await page.click(nextButtonCss);
```

### 3. Conditional Fields Missing

**Symptom**: Runner tries to fill a field that doesn't exist

**Common Causes**:
- Field only appears after prior selection
- Field order in locator map doesn't match fill order

**Fix**: Add `depends_on` to field or reorder fields:
```json
{
  "key": "employer_name",
  "type": "text",
  "css": "#employer-name",
  "depends_on": {
    "field": "employment_status",
    "value": "employed"
  }
}
```

### 4. Popup Blocks Progression

**Symptom**: Runner clicks Next but popup appears and blocks next page

**Common Causes**:
- Credit consent, cookie consent, upsell offers
- Popup appears between specific pages only

**Fix**: Add `popup_after_next` to the page config:
```json
{
  "name": "Page 11",
  "popup_after_next": {
    "container_css": ".popup-overlay",
    "continue_button_css": ".popup-continue-btn",
    "timeout_ms": 5000,
    "active_when": {
      "z_index_gt": 0
    }
  }
}
```

### 5. Select Option Values Wrong

**Symptom**: Select doesn't change or validation error

**Common Causes**:
- Using visible text instead of value attribute
- Value is abbreviated (NS vs "Nova Scotia")
- Value is numeric string ("1" not 1)

**Fix**: Inspect the actual `<option value="...">` and use that in identity:
```json
{
  "province": "NS"
}
```
Not:
```json
{
  "province": "Nova Scotia"
}
```

### 6. Choices.js / Custom Select

**Symptom**: Normal selectOption doesn't work

**Cause**: Visual dropdown is a div, not a real select element

**Fix**: Use type `choices_js` and add `container_css`:
```json
{
  "key": "province",
  "type": "choices_js",
  "css": "select#province",
  "container_css": ".choices__inner",
  "required": true
}
```
Runner will: click container → wait for dropdown → click option by data-value.

### 7. Phone Number Field

**Symptom**: Phone formatted differently than expected, or validation fails

**Cause**: intl-tel-input or similar library reformats input

**Fix**: Usually `page.fill()` works on the visible input. Use digits only:
```json
{
  "phone": "5551234567"
}
```
The library will format as needed.

### 8. Form Submits to Wrong Endpoint (Honeypot)

**Symptom**: Submission appears successful but no lead in CRM

**Cause**: Honeypot field was filled, submission silently rejected

**Fix**: Remove honeypot from locator map or mark skip:
```json
{
  "key": "website",
  "type": "text",
  "css": "#website-honeypot",
  "skip": true,
  "honeypot": true
}
```

---

## Applying Corrections

After walkthrough, update the locator map:

### Selector Corrections
```json
// Before
{ "css": ".wpforms-page-2.wpforms-page-active" }

// After (if framework doesn't use active class)
{ "css": ".wpforms-page-2" }
```

### Add Missing Fields
```json
{
  "fields": [
    // existing fields...
    {
      "key": "discovered_new_field",
      "type": "text",
      "css": "#new-field",
      "required": false,
      "label_text": "New Field Label",
      "_added_via_walkthrough": true
    }
  ]
}
```

### Add Popup Config
```json
{
  "pages": [
    {
      "name": "Page 11",
      "popup_after_next": {
        "container_css": ".bd-popup-88814",
        "continue_button_css": ".bd-popup-88814 .popup-close",
        "timeout_ms": 5000
      }
    }
  ]
}
```

### Fix Identity Values
```json
// Before (using display text)
{ "province": "Nova Scotia" }

// After (using option value)
{ "province": "NS" }
```

---

## Validation Checklist

After applying corrections, verify:

- [ ] All `visible_when_css` selectors work (test in DevTools)
- [ ] All field `css` selectors find exactly one element
- [ ] All `next_button_css` selectors are clickable
- [ ] Identity values match expected formats
- [ ] Conditional fields have `depends_on` or are ordered correctly
- [ ] Popup configs have working selectors
- [ ] Honeypot fields are excluded or marked skip

---

## Re-Running After Corrections

Test env A first:

```bash
# Allocate a new runset
node framework/runner/cli.js new-runset --testcase <testcase_id>

# Run env A
node framework/runner/cli.js run \
  --testcase <testcase_id> \
  --env A-logged_out \
  --runset run_NNNN
```

If A passes, continue with B and C.

---

## When to Re-Walkthrough

- After **major form changes** (new pages, new fields)
- After **3+ consecutive failures** (something changed)
- **Quarterly** for active testcases (maintenance)
- When **framework is updated** (WPForms version change, etc.)

---

## Next Steps

After corrections validated:

1. **Run full test suite** — Execute A, B, C environments
2. **Generate reports** — Use `03_REPORT_AND_DEV_HANDOFF.md` for analysis
3. **Document changes** — Update EXPECTED_OUTCOMES.md if behavior changed
