# Testcase Execution & Storage Spec

> **Purpose:** Single authoritative document explaining how a runner's journey through a testcase is dictated and how that journey is stored for later reference by people or machines.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Input Files (What Dictates the Journey)](#2-input-files-what-dictates-the-journey)
3. [Execution Flow (How the Journey Runs)](#3-execution-flow-how-the-journey-runs)
4. [Output Files (How the Journey is Stored)](#4-output-files-how-the-journey-is-stored)
5. [Data Dictionary](#5-data-dictionary)
6. [File Manifest](#6-file-manifest)

---

## 1. Overview

A **testcase** is a self-contained test definition that tells the runner:
- Where to go (URLs)
- What to fill (field values)
- How to find elements (selectors)
- What to expect (success criteria)

A **run** is a single execution of a testcase in a specific environment, producing evidence artifacts.

A **runset** is a group of runs (typically A/B/C environments) executed together under one sequential ID.

```
playwright_phased_runner/testcases/<testcase_id>/
├── [INPUT FILES - dictate the journey]
│   ├── testcase.json
│   ├── locator_map.json
│   ├── identity.json
│   └── EXPECTED_OUTCOMES.md
│
└── runs/<runset_id>/<env>-<login_state>/
    └── [OUTPUT FILES - store the journey]
        ├── run.meta.json
        ├── cookies/
        ├── evidence/
        ├── network/
        └── derived/
```

---

## 2. Input Files (What Dictates the Journey)

### 2.1 testcase.json

**Purpose:** Root configuration linking all assets and defining target URLs.

```json
{
  "version": "1.0",
  "testcase_id": "conditional_fields_unhappy_income_lt_1000",
  "site": "example.test",
  "era": "era01",
  "urls": {
    "decorated_url_base": "https://example.test/",
    "direct_url": "https://example.test/",
    "apply_url": "https://example.test/apply"
  },
  "assets": {
    "locator_map": "locator_map.json",
    "identity": "identity.json"
  },
  "auth_states": {
    "B": {
      "storage_state_in": "../../auth_states/<site>/B-logged_in.storage.json",
      "login_url": "https://example.test/login"
    }
  },
  "docs": {
    "expected_outcomes_md": "EXPECTED_OUTCOMES.md"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | Schema version |
| `testcase_id` | string | Unique identifier, matches folder name |
| `site` | string | Target site domain |
| `era` | string | Configuration era (for tracking schema changes) |
| `urls.decorated_url_base` | string | Landing page URL (UTM params appended at runtime) |
| `urls.direct_url` | string | Direct site URL |
| `urls.apply_url` | string | Form/application URL |
| `assets.locator_map` | string | Relative path to locator map |
| `assets.identity` | string | Relative path to identity file |
| `auth_states.B` | object | Logged-in environment auth config |
| `docs.expected_outcomes_md` | string | Relative path to expected outcomes doc |

---

### 2.2 locator_map.json

**Purpose:** Defines form structure, field selectors, page navigation, and popup handling. This is the primary file that dictates the runner's journey.

```json
{
  "version": "1.0",
  "form": {
    "root_css": "#wpforms-form-88652",
    "is_multipage": true
  },
  "pages": [
    {
      "name": "Page 1 - Vehicle Type",
      "visible_when_css": ".wpforms-page-1",
      "conditional": {
        "depends_on": "employment_status_1",
        "value": "Other"
      },
      "fields": [
        {
          "key": "vehicle_type",
          "type": "radio",
          "css": "#wpforms-form-88652 input[name='wpforms[fields][25]'][value='car']",
          "css_candidates": ["#field-v1", "#field-v2"],
          "container_css": ".choices-container",
          "required": true,
          "label_text": "What type of vehicle are you looking for?",
          "name_attr": "wpforms[fields][25]",
          "id_attr": "wpforms-88652-field_25_1",
          "options": [
            { "value": "car", "label": "I want a Car", "id": "wpforms-88652-field_25_1" }
          ],
          "conditional": {
            "depends_on": "prior_field_key",
            "value": "trigger_value",
            "values": ["value1", "value2"],
            "note": "Human-readable note about when this appears"
          }
        }
      ],
      "next_button_css": ".wpforms-page-1 .wpforms-page-next",
      "popup_after_next": {
        "timeout_ms": 5000,
        "active_when": {
          "computed_monthly_income_lt": 1000,
          "z_index_gt": 0
        },
        "container_css": ".bde-popup-88810-100",
        "continue_button_css": ".bde-popup-88810-100 .yes-button",
        "description": "Income verification popup appears when computed monthly income < 1000"
      }
    }
  ],
  "submit": {
    "button_css": "#wpforms-form-88652 button.wpforms-submit",
    "success": {
      "css": ".wpforms-confirmation-container",
      "expected_text_contains": "Thank you",
      "expected_url_contains": "/thank-you",
      "expected_console_log_contains": [
        "test_event trigger succeeded",
        "Credit Popup: Showing credit consent popup"
      ]
    },
    "error_selectors": [
      { "css": ".wpforms-error", "text_contains": "" },
      { "css": "label.wpforms-error", "text_contains": "required" }
    ]
  },
  "metadata": {
    "form_id": "88652",
    "start_url": "https://example.com/apply/",
    "testcase_id": "example_testcase",
    "total_form_pages": 17,
    "happy_path": true,
    "unhappy_path": "Description of unhappy path conditions",
    "pages_skipped": [6],
    "conditional_pages_active": [5, 10],
    "conditional_fields_active": ["field1", "field2"],
    "income_popup_expected": true
  }
}
```

#### Field Types

| Type | Runner Action | Notes |
|------|---------------|-------|
| `text` | `page.fill(css, value)` | Generic text input |
| `email` | `page.fill(css, value)` | Email input |
| `tel` | `page.fill(css, value)` | Phone input (works with intl-tel-input) |
| `number` | `page.fill(css, value)` | Numeric input |
| `textarea` | `page.fill(css, value)` | Multi-line text |
| `select` | `page.selectOption(css, value)` | Native `<select>` dropdown |
| `radio` | `page.click(css)` | CSS targets the specific option to select |
| `checkbox` | `page.check(css)` | Single checkbox |
| `choices_js` | Click container → click option | Requires `container_css` |
| `file` | `page.setInputFiles(css, path)` | File upload |
| `date` | `page.fill(css, value)` | Date input |
| `url` | `page.fill(css, value)` | URL input |

#### Selector Resolution

Fields can specify selectors two ways:
- `css`: Single selector string
- `css_candidates`: Array of selectors; runner uses first that exists

#### Conditional Logic

**Page-level:** A page's `conditional` block determines if the entire page is active:
```json
"conditional": { "depends_on": "employment_status_1", "value": "Other" }
```

**Field-level:** A field's `conditional` block determines if the field is visible:
```json
"conditional": { "depends_on": "employment_duration", "values": ["Less than 3 Months", "3 Months - 1 Year"] }
```

#### Popup Handling

`popup_after_next` defines interstitials that may appear after clicking Next:
- `timeout_ms`: How long to wait for popup
- `active_when`: Conditions for popup to be considered active
- `container_css`: Popup root selector
- `continue_button_css`: Button to dismiss popup

---

### 2.3 identity.json

**Purpose:** Test data values to fill into each field. Keys must match `field.key` in locator_map.json.

```json
{
  "vehicle_type": "car",
  "monthly_budget": "$375 - $499",
  "first_name": "TEST_{ENV}",
  "last_name": "USER_{RUN_ITERATION}",
  "email": "test{ENV}user{RUN_ITERATION}@test.com",
  "phone": "9025550199",
  "gross_pay_amount": "800"
}
```

#### Variable Interpolation

| Variable | Replaced With |
|----------|---------------|
| `{ENV}` | Environment letter (A, B, C) |
| `{RUN_ITERATION}` | Run number within runset |
| `{RUN_ID}` | Full run ID |
| `{RUNSET_ID}` | Runset ID |
| `{TS}` | Timestamp |

---

### 2.4 EXPECTED_OUTCOMES.md

**Purpose:** Human-readable documentation of what the testcase validates and pass/fail criteria. Not machine-parsed, but essential for understanding test intent.

---

### 2.5 CRM Mapping Files (Optional)

**fields_mapped_to_crm.csv:**
```csv
Form Field,Tracking Mapping,Dynamics CRM Mapping
What type of vehicle?,, client_lookingfor
Name (First),First Name,firstname
Email,Email,emailaddress1
```

**system_fields_mapped_to_crm.csv:**
```csv
System Field,Value Source,Tracking Mapping,Dynamics CRM Mapping
UTM Source,URL parameter or cookie,Lead Source,client_utm_source
GCLID,Tracking Hub cookie,,client_gclid
```

---

## 3. Execution Flow (How the Journey Runs)

### 3.1 Phases

The runner executes in 5 phases:

| Phase | Description | Evidence Captured |
|-------|-------------|-------------------|
| **P0** | (Env B only) Capture initial auth state | `cookies/P0.cookies.json` |
| **P1** | Navigate to decorated landing page | `cookies/P1.cookies.json`, `evidence/P1.page.png` |
| **P2** | Click through to apply page | `cookies/P2.cookies.json` |
| **P3** | Fill form pages (main journey) | `cookies/P3.cookies.json`, `evidence/P3.page.png` |
| **P4** | Pre-submit state | `cookies/P4.cookies.json`, `evidence/P4.page.png` |
| **P5** | Submit and verify | `cookies/P5.cookies.json`, `evidence/P5.submit.page.png`, `evidence/submit.result.json` |

### 3.2 Page Iteration

For each page in `locator_map.pages[]`:

1. **Wait for page visibility:** `page.waitForSelector(visible_when_css, {state: 'visible'})`
2. **Process fields in order:** For each field in `page.fields[]`:
   - Check if field is conditional; skip if condition not met
   - Look up value from identity.json using `field.key`
   - Fill/select/click based on `field.type`
   - Record result in checks array
3. **Click Next:** `page.click(next_button_css)`
4. **Handle popup (if configured):** Check `popup_after_next`, dismiss if active
5. **Proceed to next page**

### 3.3 Field Processing

```
For each field:
├── Is field.conditional defined?
│   ├── Yes → Check if depends_on field has required value
│   │   ├── Condition met → Continue to fill
│   │   └── Condition not met → Record as "skipped_not_visible_conditional"
│   └── No → Continue to fill
│
├── Is identity[field.key] defined?
│   ├── Yes → Use that value
│   └── No → Record as "missing_identity_value" (fail if strict mode)
│
├── Fill based on field.type:
│   ├── text/email/tel/number → page.fill(css, value)
│   ├── select → page.selectOption(css, value)
│   ├── radio → page.click(css)
│   ├── checkbox → page.check(css)
│   └── choices_js → click container, click option
│
└── Record result:
    ├── Success → { ok: true, kind: "filled|checked|selected", field, css }
    └── Failure → { ok: false, kind: "fill_error", field, error }
```

### 3.4 Popup Handling

After clicking Next, if `popup_after_next` is defined:

1. Wait up to `timeout_ms` for `container_css` to be visible
2. If `active_when` conditions defined, evaluate them:
   - `z_index_gt`: Check computed z-index > value
   - `computed_monthly_income_lt`: Check calculated income < threshold
3. If popup is active, click `continue_button_css`
4. Record handling in checks array

---

## 4. Output Files (How the Journey is Stored)

### 4.1 Directory Structure

```
playwright_phased_runner/testcases/<testcase_id>/runs/<runset_id>/
├── runset.meta.json                    # Runset-level metadata
│
├── A-logged_out/
│   ├── run.meta.json                   # Full run configuration
│   │
│   ├── cookies/
│   │   ├── P0.cookies.json             # (Env B only) Initial auth state
│   │   ├── P1.cookies.json             # After landing page
│   │   ├── P2.cookies.json             # After click-through
│   │   ├── P3.cookies.json             # During form fill
│   │   ├── P4.cookies.json             # Pre-submit
│   │   └── P5.cookies.json             # Post-submit
│   │
│   ├── evidence/
│   │   ├── P1.page.png                 # Landing page screenshot
│   │   ├── P3.page.png                 # Mid-form screenshot
│   │   ├── P4.page.png                 # Pre-submit screenshot
│   │   ├── P5.submit.page.png          # Post-submit screenshot
│   │   ├── FAILURE.P5.page.png         # (If failed) Failure state
│   │   ├── submit.result.json          # Field-by-field automation log
│   │   ├── console.events.jsonl        # All console messages
│   │   ├── console.errors.summary.md   # Console errors summary
│   │   ├── datalayer.events.jsonl      # GTM dataLayer pushes
│   │   ├── datalayer.summary.json      # DataLayer event counts
│   │   ├── navigation.timeline.jsonl   # URL changes
│   │   ├── expected_console_logs.json  # Console log verification results
│   │   └── run.error.json              # (If failed) Error details
│   │
│   ├── network/
│   │   └── network.summary.jsonl       # HTTP request log
│   │
│   ├── derived/
│   │   ├── run.summary.json            # Aggregated run results
│   │   └── run.summary.md              # Human-readable summary
│   │
│   ├── exports/
│   │   └── README.md                   # Placeholder for CRM exports
│   │
│   └── notes.md                        # Human observations
│
├── B-logged_in/
│   └── [same structure]
│
└── C-incognito/
    └── [same structure]
```

---

### 4.2 runset.meta.json

**Purpose:** Runset-level metadata spanning all environment runs.

```json
{
  "version": "1.0",
  "runset_id": "run_0002",
  "runset_uid": "uuid-here",
  "testcase_id": "conditional_fields_unhappy_income_lt_1000",
  "testcase_path": "playwright_phased_runner/testcases/conditional_fields_unhappy_income_lt_1000",
  "site": "example.test",
  "era": "era01",
  "reporting": {
    "tags": ["smoke", "release-2026-01"]
  },
  "created_at": "2026-01-26T15:16:32.695Z",
  "last_updated_at": "2026-01-26T15:16:32.697Z",
  "env_runs_seen": ["A-logged_out", "B-logged_in", "C-incognito"]
}
```

---

### 4.3 run.meta.json

**Purpose:** Complete configuration snapshot for a single run.

```json
{
  "run_id": "A_run_0002",
  "runset_id": "run_0002",
  "testcase_id": "conditional_fields_unhappy_income_lt_1000",
  "testcase_path": "playwright_phased_runner/testcases/conditional_fields_unhappy_income_lt_1000",
  "environment": "A",
  "login_state": "logged_out",
  "site": "example.test",
  "timezone": "America/Halifax",
  "run_start_time_local": "Mon Jan 26 2026 11:16:32 GMT-0400",
  "config_era": "era01",
  "reporting": {
    "tags": []
  },
  "runner": {
    "type": "playwright",
    "headed": false,
    "next_wait_ms": 3000,
    "browser": "chromium",
    "browser_channel": null,
    "browser_executable": null,
    "token": "TEST_A_RUN_2",
    "storage_state_in": null,
    "storage_state_out": null,
    "config_path": "runner/config/defaults.json",
    "testcase_config_path": "playwright_phased_runner/testcases/.../testcase.json"
  },
  "test_identity": {
    "vehicle_type": "car",
    "first_name": "TEST_A",
    "email": "user@example.com"
  },
  "test_links": {
    "decorated_landing": "https://example.com/?utm_source=TEST_A_RUN_2&...",
    "direct": "https://example.com/",
    "apply": "https://example.com/apply"
  },
  "locator_map_path": "playwright_phased_runner/testcases/.../locator_map.json",
  "identity_path": "playwright_phased_runner/testcases/.../identity.json"
}
```

---

### 4.4 submit.result.json (The Automation Log)

**Purpose:** Field-by-field record of every action taken during form filling. This is the primary machine-readable record of the journey.

```json
{
  "ts_start": "2026-01-26T15:17:57.431Z",
  "ts_end": "2026-01-26T15:20:24.762Z",
  "phase": "P5",
  "success": false,
  "url_before": "https://example.com/apply/",
  "url_after": "https://example.com/apply/",
  "checks": [
    {
      "ok": true,
      "kind": "checked",
      "field": "vehicle_type",
      "css": "#form input[value='car']"
    },
    {
      "ok": true,
      "kind": "popup_after_next",
      "handled": true,
      "container_css": ".popup-container",
      "continue_button_css": ".popup-continue"
    },
    {
      "ok": true,
      "kind": "filled",
      "field": "first_name",
      "css": "#field-first-name"
    },
    {
      "ok": true,
      "kind": "filled_number",
      "field": "income",
      "css": "#field-income"
    },
    {
      "ok": true,
      "kind": "selected",
      "field": "province",
      "css": "#field-province"
    },
    {
      "ok": true,
      "kind": "selected_choices_js",
      "field": "marital_status",
      "css": ".choices-container",
      "value": "Single"
    },
    {
      "ok": true,
      "kind": "skipped_not_visible_conditional",
      "field": "other_description",
      "css": "#field-other-desc",
      "reason": "Timeout - element not visible"
    },
    {
      "ok": false,
      "kind": "fill_error",
      "field": "problem_field",
      "error": "Element not found"
    },
    {
      "kind": "success_selector_not_found",
      "css": ".confirmation-container",
      "error": "Timeout 30000ms exceeded"
    },
    {
      "kind": "expected_console_log_contains",
      "contains": "test_event trigger succeeded",
      "matched": false,
      "match_count": 0
    }
  ],
  "errors_found": [
    {
      "css": ".form-error",
      "observed": "This field is required"
    }
  ]
}
```

#### Check Kinds (action types)

| Kind | Description |
|------|-------------|
| `checked` | Radio button clicked |
| `filled` | Text field filled |
| `filled_number` | Number field filled |
| `selected` | Native select option chosen |
| `selected_choices_js` | Choices.js option selected |
| `popup_after_next` | Popup handling attempted |
| `skipped_not_visible_conditional` | Conditional field not visible, skipped |
| `fill_error` | Field fill failed |
| `success_selector_not_found` | Success indicator not found after submit |
| `expected_console_log_contains` | Console log verification |

---

### 4.5 run.summary.json (Derived)

**Purpose:** Aggregated results for quick status checks and indexing.

```json
{
  "run_id": "A_run_0002",
  "testcase_id": "conditional_fields_unhappy_income_lt_1000",
  "environment": "A",
  "era": "era01",
  "token": "TEST_A_RUN_2",
  "browser": "chromium",
  "browser_channel": null,
  "reporting": {
    "tags": []
  },
  "links": {
    "decorated_landing": "https://...",
    "direct": "https://...",
    "apply": "https://..."
  },
  "status": "passed|failed",
  "submit": {
    "success": true,
    "url_before": "https://example.com/apply/",
    "url_after": "https://example.com/apply/",
    "filled_count": 25,
    "missing_identity_value": [],
    "missing_selector": [],
    "errors_found_count": 0,
    "expected_console_log_contains": [
      {
        "contains": "test_event trigger succeeded",
        "matched": true,
        "match_count": 1
      }
    ]
  },
  "cookie_counts": {
    "P1": 44,
    "P2": 44,
    "P3": 44,
    "P4": 48,
    "P5": 48
  },
  "datalayer_counts_by_event": {
    "gtm.js": 3,
    "gtm.dom": 3,
    "gtm.load": 3,
    "gtm.click": 50
  },
  "sources_used": [
    "playwright_phased_runner/testcases/.../run.meta.json",
    "playwright_phased_runner/testcases/.../evidence/submit.result.json"
  ]
}
```

---

### 4.6 run.error.json (On Failure)

**Purpose:** Detailed error information when a run fails.

```json
{
  "phase": "P5",
  "message": "TimeoutError: page.waitForSelector: Timeout 30000ms exceeded",
  "stack": "...",
  "url_at_failure": "https://example.com/apply/",
  "failure_screenshot": "evidence/FAILURE.P5.page.png"
}
```

---

### 4.7 Evidence Files

#### cookies/P*.cookies.json
Array of cookie objects with full metadata:
```json
[
  {
    "name": "_ga",
    "value": "GA1.2.123456789.1706000000",
    "domain": ".example.com",
    "path": "/",
    "expires": 1737000000,
    "httpOnly": false,
    "secure": false,
    "sameSite": "Lax"
  }
]
```

#### evidence/console.events.jsonl
One JSON object per line:
```json
{"ts": "2026-01-26T15:18:00.123Z", "type": "log", "text": "Credit Popup: Script loaded", "location": "https://example.com/script.js:50"}
{"ts": "2026-01-26T15:18:01.456Z", "type": "error", "text": "Failed to load resource", "location": "https://example.com/missing.js"}
```

#### evidence/datalayer.events.jsonl
One JSON object per line:
```json
{"ts": "2026-01-26T15:18:00.123Z", "event": "gtm.js", "payload": {"gtm.start": 1706000000}}
{"ts": "2026-01-26T15:18:01.456Z", "event": "gtm.click", "payload": {"gtm.element": "..."}}
```

#### evidence/navigation.timeline.jsonl
One JSON object per line:
```json
{"ts": "2026-01-26T15:17:57.431Z", "event": "navigate", "url": "https://example.com/"}
{"ts": "2026-01-26T15:18:05.789Z", "event": "navigate", "url": "https://example.com/apply/"}
```

#### network/network.summary.jsonl
One JSON object per line:
```json
{"ts": "2026-01-26T15:17:57.500Z", "method": "GET", "url": "https://example.com/", "status": 200, "type": "document"}
{"ts": "2026-01-26T15:17:58.100Z", "method": "GET", "url": "https://example.com/style.css", "status": 200, "type": "stylesheet"}
```

---

## 5. Data Dictionary

### Input File Fields

#### testcase.json

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | Yes | Schema version |
| `testcase_id` | string | Yes | Unique identifier |
| `site` | string | Yes | Target domain |
| `era` | string | Yes | Config era for change tracking |
| `urls.decorated_url_base` | string | Yes | Landing page base URL |
| `urls.direct_url` | string | Yes | Direct site URL |
| `urls.apply_url` | string | Yes | Form URL |
| `assets.locator_map` | string | Yes | Path to locator_map.json |
| `assets.identity` | string | Yes | Path to identity.json |
| `auth_states.B.storage_state_in` | string | No | Path to Playwright storage state for logged-in env |
| `auth_states.B.login_url` | string | No | Login page URL |

#### locator_map.json - Page

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable page name |
| `visible_when_css` | string | Yes | Selector that's visible when page is active |
| `conditional` | object | No | Conditions for page to be active |
| `conditional.depends_on` | string | No | Field key this page depends on |
| `conditional.value` | string | No | Required value for single-value condition |
| `fields` | array | Yes | Fields on this page |
| `next_button_css` | string | No | Selector for Next button (null on last page) |
| `popup_after_next` | object | No | Popup handling config |

#### locator_map.json - Field

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | string | Yes | Unique field identifier (matches identity.json) |
| `type` | string | Yes | Field type (text, radio, select, etc.) |
| `css` | string | Yes* | CSS selector (*or use css_candidates) |
| `css_candidates` | array | No | Array of fallback selectors |
| `container_css` | string | No | Container selector (for choices_js) |
| `required` | boolean | Yes | Whether field is required |
| `label_text` | string | No | Human-readable label |
| `name_attr` | string | No | HTML name attribute |
| `id_attr` | string | No | HTML id attribute |
| `options` | array | No | Available options (for radio/select) |
| `conditional` | object | No | Visibility conditions |

### Output File Fields

#### submit.result.json - Check Object

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Whether action succeeded |
| `kind` | string | Action type (see Check Kinds table) |
| `field` | string | Field key |
| `css` | string | Selector used |
| `value` | string | Value filled/selected (for some kinds) |
| `handled` | boolean | For popup_after_next: whether popup was handled |
| `reason` | string | For skipped/error: explanation |
| `error` | string | For errors: error message |
| `contains` | string | For console log checks: expected text |
| `matched` | boolean | For console log checks: whether matched |
| `match_count` | number | For console log checks: number of matches |

#### run.summary.json

| Field | Type | Description |
|-------|------|-------------|
| `run_id` | string | Unique run identifier |
| `testcase_id` | string | Testcase identifier |
| `environment` | string | A, B, or C |
| `era` | string | Config era |
| `status` | string | "passed" or "failed" |
| `submit.success` | boolean | Whether form submitted successfully |
| `submit.filled_count` | number | Fields successfully filled |
| `submit.missing_identity_value` | array | Fields with no identity value |
| `submit.missing_selector` | array | Fields with no matching element |
| `submit.errors_found_count` | number | Form validation errors found |
| `cookie_counts` | object | Cookie count per phase |
| `datalayer_counts_by_event` | object | DataLayer event counts |
| `sources_used` | array | Files used to generate summary |

---

## 6. File Manifest

### Required Files Per Testcase

| File | Purpose | Created By |
|------|---------|------------|
| `testcase.json` | Root config | Human/LLM scaffold |
| `locator_map.json` | Form structure + selectors | Human/LLM scaffold, refined by walkthrough |
| `identity.json` | Test data values | Human/LLM scaffold |
| `EXPECTED_OUTCOMES.md` | Pass criteria documentation | Human |

### Required Files Per Run

| File | Purpose | Created By |
|------|---------|------------|
| `run.meta.json` | Run configuration snapshot | Runner |
| `evidence/submit.result.json` | Field-by-field automation log | Runner |
| `derived/run.summary.json` | Aggregated results | Runner |
| `derived/run.summary.md` | Human-readable summary | Runner |

### Optional/Conditional Files Per Run

| File | Condition | Purpose |
|------|-----------|---------|
| `cookies/P0.cookies.json` | Env B only | Initial auth state |
| `evidence/run.error.json` | On failure | Error details |
| `evidence/FAILURE.*.page.png` | On failure | Failure screenshot |
| `notes.md` | Human observation | Manual notes |

---

## Appendix: Quick Reference

### Run a testcase
```bash
node framework/runner/cli.js run --testcase <testcase_id> --runset run_0001 --env A-logged_out
```

### Allocate a new runset
```bash
node framework/runner/cli.js new-runset --testcase <testcase_id> --tags "smoke,release"
```

### File lookup order for auth state (Env B)
1. CLI `--storage_state_in`
2. `testcase.json` → `auth_states.B.storage_state_in`
3. `auth_states/<site>/B-logged_in.storage.json`

### Variable interpolation in identity.json
- `{ENV}` → A, B, C
- `{RUN_ITERATION}` → 1, 2, 3...
- `{RUN_ID}` → A_run_0001
- `{RUNSET_ID}` → run_0001
- `{TS}` → ISO timestamp
