---
name: design-mockup
description: >
  Creates and maintains HTML design mockups informed by competitive audit data.
  Extracts live site computed styles via Playwright MCP for 1:1 chrome wrapping,
  generates standalone preview files, maintains a living design spec document,
  and audits all artifacts for consistency. Use for inventory page redesigns,
  VDP layouts, or any client page where a visual mockup is needed before build.
---
<skill>

<objective>
Produce and maintain client-ready HTML mockups that can be previewed standalone
in a browser or pasted into DevTools on the live site. Mockups are informed by
competitive audit evidence (FEATURE_MATRIX.md, site analyses) and validated
against a living design spec document. Live site chrome (header, nav, footer)
is captured via Playwright MCP and baked into fullpage preview files.

Source of truth: None — this is a new standalone capability developed from
the CLIENTA inventory mockup workflow. The SKILL.md IS the canonical definition.
</objective>

<source_prompt>
None — empirically developed from conversation, not derived from a framework prompt.
</source_prompt>

<prompt_type>Playbook</prompt_type>

<execution_mode>
PATCH_ALLOWED — Creates and modifies HTML mockup files, spec documents, and
chrome extraction artifacts. Browser interaction is read-only (captures computed
styles only, no form submissions or data mutations on target sites).
</execution_mode>

<model_recommendation>
opus — Requires live browser interaction via Playwright MCP for style extraction,
nuanced design decisions informed by competitive data, and cross-artifact
consistency validation.
</model_recommendation>

<quick_start>
1. [GATE: competitive audit exists] Read FEATURE_MATRIX.md and relevant site analyses, OR ask user for design inputs
2. [GATE: spec document exists] Read existing spec, OR create initial spec from user's design direction
3. [AUTO] Extract live site chrome via Playwright MCP → site_chrome.json
4. [AUTO] Build/update raw element HTML mockups (for DevTools paste)
5. [AUTO] Generate fullpage preview files (raw element + site chrome wrapper)
6. [AUTO] Sync spec document with mockup CSS values, maintain Open Questions
7. [AUTO] Run audit: card counts, tokens, toggle states, naming, spec-mockup consistency
8. [USER] Present artifacts with file paths and audit results
</quick_start>

<execution_rules>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, read existing. If FALSE, ask user or create new.</rule>
  <rule id="no-site-mutation">Do not submit forms, create accounts, or modify data on target sites. Read-only browsing for style extraction only.</rule>
  <rule id="naming-convention">All mockup files MUST follow: CLIENT_MOCKUP_PAGE_STATE.html (raw element) and CLIENT_MOCKUP_PAGE_STATE_FULLPAGE.html (standalone preview). Omit STATE for default view.</rule>
  <rule id="spec-sync">After any mockup CSS change, update the spec document to match. Spec and mockup must never contradict.</rule>
  <rule id="no-editorializing">Spec documents use design direction notes, not editorializing. Replace subjective language with actionable specs.</rule>
  <rule id="open-questions">Maintain an Open Questions section in the spec, split by audience (Developer / Dealer / Designer).</rule>
  <rule id="competitive-data">Cross-reference competitive audit data for decisions like sort options, filter categories, and card data density.</rule>
</execution_rules>

<context>
Competitive audit evidence (read-only inputs):
- `_competitive_analysis/derived/FEATURE_MATRIX.md` — Cross-site feature comparison
- `_competitive_analysis/derived/COMPETITIVE_SUMMARY.md` — Executive summary
- `_competitive_analysis/sites/<slug>/derived/site_analysis.md` — Per-site analysis

Mockup output structure:
- `_competitive_analysis/derived/<CLIENT>_MOCKUP_<PAGE>_<STATE>.html` — Raw elements (DevTools paste)
- `_competitive_analysis/derived/<CLIENT>_MOCKUP_<PAGE>_<STATE>_FULLPAGE.html` — Standalone previews
- `_competitive_analysis/derived/site_chrome/<client>_<page>_chrome.json` — Extracted computed styles
- `_competitive_analysis/specs/<CLIENT> <Feature> Specs.md` — Design spec documents

Naming convention:
- CLIENT: CLIENTA, CLIENTC, CLIENTD, CLIENTB, {CLIENT_CODE}, etc.
- PAGE: INVENTORY, VDP, APPLY, HOME, etc.
- STATE: SIMPLE, DETAILED, FILTER_OPEN, MOBILE, etc. (omit for default)
</context>

<automated_workflow>
  <step id="1" name="gather-inputs" type="GATE">
    [GATE: mockup_brief.json exists at _competitive_analysis/briefs/]

    If brief exists: read it. The brief contains all design decisions (adopted/skipped
    patterns, brand tokens, card data fields, view states, open questions). Use it as
    the primary input — no need to re-read raw audit data.

    If brief does not exist but audit evidence exists: read FEATURE_MATRIX.md and
    COMPETITIVE_SUMMARY.md directly. Recommend running `/framework:mockup-brief` first.

    If neither exists: ask user for design inputs:
    "No design brief or competitive audit found. Please provide:
    1. Target client and page (e.g., CLIENTA Inventory)
    2. Design direction or reference elements
    3. Live site URL for chrome extraction
    Or run `/framework:mockup-brief` first to create a structured brief."

    **STOP and wait for user response if no brief and no audit.**
  </step>

  <step id="2" name="load-or-create-spec" type="GATE">
    [GATE: spec document exists at _competitive_analysis/specs/]

    If exists: read the spec. Note any Open Questions that affect mockup decisions.

    If not exists: create initial spec document with sections:
    1. Filter Bar — element specs from user's design direction
    2. Filter Drawer — UI architecture, accordion, animation
    3. Action Buttons — footer button specs with hover states
    4. Vehicle Card Display (Simple View) — data-light card layout
    5. Vehicle Card Display (Detailed View) — data-rich horizontal card layout
    6. Responsive and Performance Specs — breakpoints, responsive unit candidates
    7. Open Questions — split by Developer / Dealer audience

    Rules for spec content:
    - Use design direction notes, not editorializing
    - Include exact CSS values that match the mockup
    - Flag which values should use responsive units (rem/clamp) in production
  </step>

  <step id="3" name="extract-chrome" type="AUTO">
    [AUTO] Navigate to the live site URL via Playwright MCP.

    Extract computed styles for page chrome elements:
    - Header: background, padding, max-width, logo dimensions, CTA button styles
    - Nav: background, borders, height, link styles (font, weight, color, padding, gap)
    - Accordion/banner: background, text styles, height
    - Page heading: font-size, weight, color, text-align, margin, container padding
    - Footer: background, text styles, container layout, legal text size

    Use browser_evaluate to extract getComputedStyle() for each element.
    Write results to: `_competitive_analysis/derived/site_chrome/<client>_<page>_chrome.json`

    Schema:
    {
      "client": "CLIENTA",
      "url": "https://example.com/inventory/",
      "captured": "YYYY-MM-DD",
      "elements": {
        "header": { "bg": "...", "padding": "...", "maxWidth": "...", ... },
        "nav": { ... },
        "accordion": { ... },
        "heading": { ... },
        "footer": { ... }
      }
    }
  </step>

  <step id="4" name="build-mockups" type="AUTO">
    [AUTO] Create or update raw element HTML mockup files.

    Each mockup is a self-contained `<section>` element with:
    - Inline `<style>` block using CSS custom properties (--brand-blue, etc.)
    - Complete HTML for the page section (filter bar, cards, drawer)
    - Interactive elements (filter drawer open/close, accordion toggles)
    - All card data preserved from competitive audit or user input

    File naming: `<CLIENT>_MOCKUP_<PAGE>_<STATE>.html`
    - One file per view state (e.g., SIMPLE and DETAILED for inventory)
    - Each file has an HTML comment at top: "Paste into DevTools replacing <section id="...">"

    Cross-reference competitive audit for:
    - Sort dropdown options (match what's live on staging)
    - Filter categories (match audit findings)
    - Card data fields (match FEATURE_MATRIX field comparison)
  </step>

  <step id="5" name="generate-previews" type="AUTO">
    [AUTO] Generate fullpage preview files by wrapping raw elements in site chrome.

    For each raw element file, create a corresponding _FULLPAGE.html file:
    1. DOCTYPE + head with reset styles
    2. Site chrome from site_chrome.json, rendered as inline-styled HTML
    3. Page heading (e.g., "Browse our Inventory")
    4. The raw element's `<section>` content (CSS + HTML, verbatim)
    5. Footer from site chrome

    The fullpage file must render correctly when double-clicked in a local browser.
    Images load from CDN (requires internet). All other styling is inline/embedded.
  </step>

  <step id="6" name="sync-spec" type="AUTO">
    [AUTO] Update the spec document to match current mockup CSS values.

    For each spec section:
    - Compare spec values against actual mockup CSS
    - Update any mismatches (spec follows mockup, not the reverse)
    - Ensure Open Questions reflect current state (mark resolved questions)
    - Add responsive unit notes for values that should use rem/clamp in production
    - Clean up any editorializing language
  </step>

  <step id="7" name="audit" type="AUTO">
    [AUTO] Run code-based verification on all mockup artifacts.

    **Primary: Run the verification script:**
    ```
    node _competitive_analysis/scripts/verify_mockups.cjs <CLIENT> <PAGE>
    ```

    The script validates 10 checks programmatically:
    1. Files exist — mockup files found for client/page
    2. Raw + Fullpage pairs — each raw element has a matching _FULLPAGE
    3. Naming convention — files match CLIENT_MOCKUP_PAGE_STATE pattern
    4. Token validation — no deprecated CSS custom properties (var(--blue) etc.)
    5. Card count — each file has at least 1 card element
    6. Sort options — dropdown has 4+ options, cross-referenced against staging audit
    7. Toggle state — correct button has .on class per view state
    8. Focus state — search input has :focus CSS rule
    9. Fullpage HTML — DOCTYPE, head, body, closing tags present
    10. Chrome consistency — fullpage header bg matches site_chrome.json

    **Secondary: Manual spec-mockup consistency check:**
    After the script passes, manually verify that the spec document's CSS values
    match the mockup CSS. This cannot be fully automated because spec values are
    in prose format.

    If the script exits non-zero, fix the issues before presenting results.
  </step>

  <step id="8" name="present-results" type="USER">
    [USER] Present mockup artifacts to user:
    - Files created/updated (with paths)
    - Audit results (PASS/FAIL per check)
    - Open Questions requiring decisions
    - Competitive data that informed decisions

    Ask: "Would you like me to:
    1. Iterate on a specific element's styling
    2. Add a new view state (e.g., mobile, filter open)
    3. Extract chrome from a different page
    4. Update the spec with new design direction
    5. Generate mockups for a different client/page"

    **STOP and wait for user response.**
  </step>
</automated_workflow>

<inputs>
  <required>
    <input name="CLIENT">Client code (CLIENTA, CLIENTC, CLIENTD, etc.)</input>
    <input name="PAGE">Target page (INVENTORY, VDP, APPLY, HOME, etc.)</input>
    <input name="SITE_URL">Live site URL for chrome extraction</input>
  </required>
  <optional>
    <input name="AUDIT_PATH">Path to competitive analysis directory (default: _competitive_analysis/)</input>
    <input name="STATES">View states to generate (default: all defined in spec)</input>
    <input name="SKIP_CHROME">If true, reuse existing site_chrome.json</input>
    <input name="SPEC_ONLY">If true, only update spec document without touching mockups</input>
  </optional>
</inputs>

<outputs>
  <output name="raw-mockups">
    `derived/<CLIENT>_MOCKUP_<PAGE>_<STATE>.html` — Raw elements for DevTools paste
  </output>
  <output name="fullpage-previews">
    `derived/<CLIENT>_MOCKUP_<PAGE>_<STATE>_FULLPAGE.html` — Standalone browser previews
  </output>
  <output name="site-chrome">
    `derived/site_chrome/<client>_<page>_chrome.json` — Extracted computed styles
  </output>
  <output name="spec-document">
    `specs/<CLIENT> <Feature> Specs.md` — Living design spec with Open Questions
  </output>
  <output name="audit-report">
    10-point verification results (PASS/FAIL per check)
  </output>
</outputs>

<success_criteria>
- All mockup files follow naming convention: CLIENT_MOCKUP_PAGE_STATE[_FULLPAGE].html
- Raw element files are self-contained (paste into DevTools and they render)
- Fullpage files render correctly when opened directly in a browser
- No deprecated CSS tokens remain (only --brand-* and --text-grey and --card-shadow)
- Spec document matches mockup CSS values with zero contradictions
- Sort options match competitive audit / staging data
- All interactive elements work (drawer open/close, accordion toggle, search focus)
- Audit passes all 10 checks
- Open Questions in spec are current and split by audience
- Competitive audit data is cited where it informed decisions
</success_criteria>

<safety_rules>
- Never submit forms, log in, or mutate state on target sites during chrome extraction
- Never include real user data or credentials in mockup files
- Never overwrite existing mockup files without user confirmation
- Always use read-only Playwright MCP actions (navigate, screenshot, evaluate) only
</safety_rules>
</skill>
