---
name: mockup-brief
description: >
  Bridges the gap between competitive site audit and design mockup creation.
  Reads audit evidence (FEATURE_MATRIX.md, site analyses), guides the user through
  design direction decisions, extracts brand tokens from the live site, and produces
  a structured mockup_brief.json + initial spec document skeleton. This brief becomes
  the input for /framework:mockup, replacing ad-hoc conversational decisions with
  a documented, auditable handoff artifact.
---
<skill>

<objective>
Produce a structured design brief that captures all decisions needed before building
mockups: which competitive patterns to adopt or skip (with rationale), brand token
palette, view states to create, card data density, and open questions by audience.
The brief also generates an initial spec document skeleton pre-populated with
adopted patterns.

This skill sits between /framework:site-audit and /framework:mockup in the workflow chain:
  site-audit → mockup-brief → mockup

Source of truth: None — new capability bridging audit and mockup workflows.
</objective>

<source_prompt>
None — empirically developed from the gap identified between site-audit and design-mockup.
</source_prompt>

<prompt_type>Playbook</prompt_type>

<execution_mode>
PATCH_ALLOWED — Creates mockup_brief.json and initial spec document. Reads audit
evidence and live site (via Playwright MCP for brand token extraction). Does not
modify audit artifacts or existing mockup files.
</execution_mode>

<model_recommendation>
opus — Requires reading and synthesizing competitive audit evidence across multiple
sites, making nuanced design recommendations, and producing structured output that
must be internally consistent. Needs Playwright MCP for brand token extraction.
</model_recommendation>

<quick_start>
1. [GATE: audit exists] Read FEATURE_MATRIX.md + COMPETITIVE_SUMMARY.md + relevant site analyses
2. [USER] Ask user for target client, page, live site URL, and high-level design direction
3. [AUTO] Extract brand tokens from live site via Playwright MCP
4. [AUTO] Analyze audit data — identify adoptable patterns per category
5. [USER] Present pattern recommendations — user confirms/rejects each category
6. [AUTO] Generate mockup_brief.json with all decisions captured
7. [AUTO] Generate initial spec document skeleton from brief
8. [USER] Present brief + spec skeleton for final review
</quick_start>

<execution_rules>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, read existing. If FALSE, ask user.</rule>
  <rule id="no-modify-audit">Do not modify audit artifacts (FEATURE_MATRIX.md, site analyses, etc.). Read-only.</rule>
  <rule id="rationale-required">Every adopted and skipped pattern MUST have a rationale. No unexplained decisions.</rule>
  <rule id="audience-tagging">Open questions MUST be tagged by audience: developer, dealer, or designer.</rule>
  <rule id="brand-tokens-from-site">Brand tokens should be extracted from the live site, not invented. If the site uses CSS custom properties, capture those. If not, extract the dominant colors from computed styles.</rule>
  <rule id="brief-is-input">The mockup_brief.json becomes a required input for /framework:mockup. Do not skip it.</rule>
</execution_rules>

<context>
Audit evidence inputs (read-only):
- `_competitive_analysis/derived/FEATURE_MATRIX.md` — Cross-site feature comparison
- `_competitive_analysis/derived/COMPETITIVE_SUMMARY.md` — Executive summary
- `_competitive_analysis/sites/<slug>/derived/site_analysis.md` — Per-site analysis
- `_competitive_analysis/sites/<slug>/evidence/sort_and_pagination.json` — Sort options
- `_competitive_analysis/sites/<slug>/evidence/filter_panel.json` — Filter categories
- `_competitive_analysis/sites/<slug>/evidence/vehicle_card_sample.json` — Card data fields

Output location:
- `_competitive_analysis/briefs/<client>_<page>_brief.json` — Structured design brief
- `_competitive_analysis/specs/<CLIENT> <Feature> Specs.md` — Initial spec document
</context>

<automated_workflow>
  <step id="1" name="load-audit" type="GATE">
    [GATE: audit evidence exists at _competitive_analysis/derived/]

    If exists:
    - Read FEATURE_MATRIX.md — extract the feature comparison table
    - Read COMPETITIVE_SUMMARY.md — extract top findings and patterns
    - Read per-site analyses for sites relevant to the target page type

    If not exists:
    "No competitive audit found at _competitive_analysis/. Run /framework:site-audit first,
    or provide design direction manually."

    **STOP and wait for user response if no audit exists.**
  </step>

  <step id="2" name="collect-inputs" type="USER">
    [USER] Collect target information from user:

    "I'll create a design brief for your mockup. I need:
    1. **Client** — Which client? (e.g., CLIENTA, CLIENTC, CLIENTD)
    2. **Page** — Which page? (e.g., Inventory, VDP, Apply, Home)
    3. **Live site URL** — For brand token extraction (e.g., https://client-a-staging.example/inventory/)
    4. **Design direction** — Any high-level notes? (e.g., 'clean not chunky', 'match AutoTrader density', 'bold and rugged')
    5. **View states** — Which views to mock up? (e.g., Simple + Detailed, or just one)"

    **STOP and wait for user response.**
  </step>

  <step id="3" name="extract-brand-tokens" type="AUTO">
    [AUTO] Navigate to the live site URL via Playwright MCP.

    Extract brand tokens:
    - Check for CSS custom properties on :root or body (--brand-*, --color-*, etc.)
    - Extract dominant colors from header, nav, buttons, links, CTAs via getComputedStyle
    - Capture: primary color, secondary color, accent color, CTA colors, text colors, background colors
    - Extract font stack from body

    Produce a brand_tokens object:
    {
      "--brand-primary": "#137ac3",
      "--brand-secondary": "#ffe700",
      "--brand-cta-blue": "#1a6bb5",
      "--brand-cta-red": "#c53030",
      "--brand-accent": "#f6c843",
      "--text-primary": "#1a202c",
      "--text-secondary": "#718096",
      "--bg-light": "#f5f7f9",
      "font-stack": "system-ui, -apple-system, ..."
    }
  </step>

  <step id="4" name="analyze-patterns" type="AUTO">
    [AUTO] Analyze audit data and categorize competitive patterns.

    For each category, identify what competitors do and form a recommendation:

    **Sort Options:**
    - List all sort options found across competitors
    - Note which are on the client's staging site
    - Recommend: match staging (safe) or expand (with rationale)

    **Filter Categories:**
    - List all filter types found (Make, Model, Year, Price, Mileage, Body, Location, etc.)
    - Note which are on staging
    - Recommend additions/removals

    **Card Data Fields:**
    - Compare data density across competitors (Simple view vs Detailed view)
    - Map which fields appear in each view
    - Recommend field set per view state

    **UI Patterns:**
    - Filter mechanism: sidebar vs drawer vs top-bar vs modal
    - View toggle: grid/list vs simple/detailed
    - Pagination: numbered vs load-more vs infinite scroll
    - Search: inline vs separate bar

    **Trust Elements:**
    - Badges, certifications, safety ratings
    - What competitors show vs what the client has

    **Responsive Behavior:**
    - Mobile breakpoints observed
    - Card stacking patterns
    - Filter behavior on mobile
  </step>

  <step id="5" name="confirm-patterns" type="USER">
    [USER] Present pattern recommendations by category:

    For each category show:
    | Pattern | Source | Recommendation | Rationale |

    With clear **Adopt** / **Skip** / **Decide Later** options per pattern.

    Example:
    "**Sort Options**
    | Pattern | Found In | Recommendation |
    |---|---|---|
    | Newest First | CLIENTA staging, AutoTrader | Adopt — already live |
    | Price High/Low | All 7 sites | Adopt — universal expectation |
    | Year Newest/Oldest | AutoTrader only | Skip — low demand, adds clutter |
    | Distance: Nearest | AutoTrader, HGreg | Decide Later — requires geo service |

    Confirm or adjust each category."

    **STOP and wait for user response.**
  </step>

  <step id="6" name="generate-brief" type="AUTO">
    [AUTO] Generate mockup_brief.json at `_competitive_analysis/briefs/<client>_<page>_brief.json`

    Schema:
    {
      "schema_version": "1.0",
      "created": "YYYY-MM-DD",
      "client": "CLIENTA",
      "page": "INVENTORY",
      "target_url": "https://client-a-staging.example/inventory/",
      "view_states": ["SIMPLE", "DETAILED"],
      "design_direction": "Clean, not chunky. Match site header density.",

      "brand_tokens": {
        "--brand-blue": "#1a6bb5",
        ...
      },

      "adopted_patterns": [
        {
          "category": "sort_options",
          "pattern": "6 sort options (Newest, Oldest, Price H/L, Mileage L/H)",
          "source": "clienta_staging + autotrader_ca",
          "rationale": "Matches what's already live, covers primary use cases"
        },
        ...
      ],

      "skipped_patterns": [
        {
          "category": "sort_options",
          "pattern": "Distance: Nearest",
          "source": "autotrader_ca, hgreg_com",
          "rationale": "Requires geo service dependency, not in v1 scope"
        },
        ...
      ],

      "card_data_fields": {
        "SIMPLE": ["title", "price", "payment", "body_type", "mileage", "drivetrain", "location"],
        "DETAILED": ["title", "price", "payment", "body_type", "transmission", "fuel_type", "engine", "drivetrain", "mileage", "seats", "stock_number", "vin", "location"]
      },

      "open_questions": [
        {
          "id": "Q1",
          "area": "Filter Bar — Location Tag",
          "question": "Dynamic IP geolocation or static text?",
          "options": "A) Static per dealer. B) IP geolocation with fallback.",
          "audience": "dealer"
        },
        ...
      ]
    }
  </step>

  <step id="7" name="generate-spec-skeleton" type="AUTO">
    [AUTO] Generate initial spec document at `_competitive_analysis/specs/<CLIENT> <Feature> Specs.md`

    Pre-populate sections from the brief:
    1. Filter Bar — with adopted sort options, search spec, toggle spec
    2. Filter Drawer — with adopted filter categories, UI pattern
    3. Action Buttons — footer button spec
    4. Vehicle Card Display (Simple View) — with SIMPLE card_data_fields
    5. Vehicle Card Display (Detailed View) — with DETAILED card_data_fields
    6. Responsive & Performance Specs — with responsive unit notes
    7. Open Questions — from brief, split by audience

    Each section has placeholder CSS values marked `[TBD — set during mockup build]`
    for values that depend on visual iteration.

    Design direction notes from the brief are embedded in relevant sections.
  </step>

  <step id="8" name="present-results" type="USER">
    [USER] Present the brief and spec skeleton:

    "Design brief created:
    - Brief: [path to mockup_brief.json]
    - Spec skeleton: [path to spec document]

    Summary:
    - Adopted: [count] patterns across [categories]
    - Skipped: [count] patterns (with rationale)
    - Open Questions: [count] ([by-audience breakdown])
    - View States: [list]
    - Brand Tokens: [count] extracted

    Next step: Run `/framework:mockup CLIENTA INVENTORY <url>` to build mockups from this brief."

    **STOP and wait for user response.**
  </step>
</automated_workflow>

<inputs>
  <required>
    <input name="CLIENT">Client code (CLIENTA, CLIENTC, CLIENTD, etc.)</input>
    <input name="PAGE">Target page (INVENTORY, VDP, APPLY, HOME, etc.)</input>
    <input name="SITE_URL">Live site URL for brand token extraction</input>
  </required>
  <optional>
    <input name="AUDIT_PATH">Path to competitive analysis directory (default: _competitive_analysis/)</input>
    <input name="DESIGN_DIRECTION">High-level design notes from user</input>
    <input name="VIEW_STATES">Comma-separated view states (default: prompted)</input>
  </optional>
</inputs>

<outputs>
  <output name="mockup-brief">
    `_competitive_analysis/briefs/<client>_<page>_brief.json` — Structured design brief with all decisions
  </output>
  <output name="spec-skeleton">
    `_competitive_analysis/specs/<CLIENT> <Feature> Specs.md` — Initial spec document
  </output>
</outputs>

<success_criteria>
- mockup_brief.json is valid JSON with all required fields populated
- Every adopted pattern has a source and rationale
- Every skipped pattern has a rationale
- Open questions are tagged by audience (developer / dealer / designer)
- Brand tokens are extracted from the live site (not invented)
- Spec skeleton has all 7 sections with adopted patterns pre-populated
- Card data fields match the FEATURE_MATRIX comparison for the target page type
- Sort options match what's confirmed from staging + audit
- The brief can be consumed by /framework:mockup without additional conversation
</success_criteria>

<safety_rules>
- Never fabricate audit data; all brief content must trace to actual site-audit evidence
- Never include client credentials or internal URLs in the brief output
- Never modify existing site-audit evidence files
- Always confirm design decisions with the user before finalizing the brief
</safety_rules>
</skill>
