---
name: site-audit
description: >
  Performs UX, SEO, and structural analysis of external websites via Playwright MCP.
  Captures screenshots, DOM structure, schema markup, meta tags, filter patterns, and
  product/listing card layouts. Produces per-site evidence + cross-site comparison.
  Use for competitive analysis, auditing client sites, or benchmarking.
---
<skill>

<objective>
Execute a data-driven competitive site audit across one or more external websites.
For each site, run a 6-phase browser capture (navigate, SEO extract, filters,
vehicle/product card, sort/pagination, mobile). Produce per-site evidence and
derived analysis, then synthesize cross-site comparison artifacts. No login
credentials are used; only publicly accessible pages are audited.

Source of truth: None (new capability, not derived from an existing prompt)
</objective>

<source_prompt>
None — this is a new standalone capability, not derived from a framework prompt.
</source_prompt>

<prompt_type>Atomic</prompt_type>

<execution_mode>
FINDINGS_ONLY + PATCH_ALLOWED — Browser interaction is read-only (no form
submissions, no logins, no data mutations on target sites). Evidence files and
analysis reports are written to the local filesystem under the audit base path.
</execution_mode>

<model_recommendation>
opus — Requires live browser interaction via Playwright MCP, DOM analysis,
nuanced UX evaluation, and cross-site synthesis of qualitative observations.
</model_recommendation>

<quick_start>
1. [GATE: sites.json exists] Load existing sites.json OR collect target URLs from user
2. [AUTO] For each site: run 6-phase browser capture (navigate, SEO extract, filters, vehicle/product card, sort/pagination, mobile)
3. [AUTO] Write per-site evidence + derived analysis (site_analysis.json + site_analysis.md)
4. [AUTO] Cross-site synthesis: FEATURE_MATRIX.md + COMPETITIVE_SUMMARY.md
5. [AUTO] Run verify_audit.cjs verification script
6. [USER] Present findings and ask for next action
</quick_start>

<execution_rules>
  <rule id="sequential-per-site">Execute all 6 phases for one site before moving to the next. Do not interleave.</rule>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, behave as [USER]. If FALSE, proceed as [AUTO].</rule>
  <rule id="no-mutation">Do not submit forms, create accounts, or modify data on target sites. Read-only browsing.</rule>
  <rule id="single-browser">Only one browser session at a time. Close before opening a new site.</rule>
  <rule id="evidence-first">Always capture screenshot + DOM snapshot before attempting extraction.</rule>
</execution_rules>

<agent_orchestration>
  <agents>
    <agent name="capture-agent" model="opus" mode="FINDINGS_ONLY + PATCH_ALLOWED">
      Browser interaction specialist. Navigates target sites via Playwright MCP,
      captures screenshots, extracts DOM structure, SEO metadata, filter panels,
      product cards, and pagination patterns. Writes raw evidence files.
      Tools: Read, Write, Bash, Glob, mcp__plugin_playwright_playwright__browser_*
    </agent>
    <agent name="analysis-agent" model="sonnet" mode="REVIEW_ONLY">
      Reads captured evidence (screenshots, DOM snapshots, SEO JSON) and produces
      per-site site_analysis.json + site_analysis.md. No browser access.
      Tools: Read, Write, Bash, Grep, Glob
    </agent>
    <agent name="verification-agent" model="sonnet" mode="REVIEW_ONLY">
      Runs verify_audit.cjs and validates completeness of all evidence and
      derived artifacts. Reports PASS/FAIL per site and overall.
      Tools: Read, Bash, Glob
    </agent>
  </agents>

  <management_rules>
    <rule name="single-browser">Only one browser session active at any time. capture-agent must close browser between sites.</rule>
    <rule name="status-tracking">Maintain a meta.json per site tracking phase completion (pending/done/error).</rule>
    <rule name="completion-gate">All sites must reach capture-complete before analysis-agent begins cross-site synthesis.</rule>
    <rule name="verification-gate">verify_audit.cjs must PASS before presenting results to user.</rule>
    <rule name="return-contracts">
      capture-agent returns: { site_slug, phases_completed, evidence_paths[], errors[] }
      analysis-agent returns: { site_slug, analysis_path, feature_count, issues[] }
      verification-agent returns: { overall_pass, per_site_results[], missing_artifacts[] }
    </rule>
    <rule name="error-isolation">If one site fails, log the error in its meta.json and continue to the next site. Do not abort the entire audit.</rule>
  </management_rules>

  <coordinator_sequence>
    <step order="1">Load sites.json and validate all site definitions have required fields (slug, name, url, inventory_path).</step>
    <step order="2">For each site in sites.json (sequentially): dispatch capture-agent to run 6-phase capture.</step>
    <step order="3">After each site capture completes: verify evidence directory has expected artifacts.</step>
    <step order="4">Once all sites captured: dispatch analysis-agent for per-site analysis (site_analysis.json + site_analysis.md).</step>
    <step order="5">Once all per-site analyses complete: dispatch analysis-agent for cross-site synthesis (FEATURE_MATRIX.md + COMPETITIVE_SUMMARY.md).</step>
    <step order="6">Dispatch verification-agent to run verify_audit.cjs.</step>
    <step order="7">Present results to user with paths, summary, and next-action options.</step>
  </coordinator_sequence>
</agent_orchestration>

<context>
Data-driven configuration and verification:
- `sites.json` — Array of site definitions. Each entry: { slug, name, url, inventory_path, notes }
- `scripts/verify_audit.cjs` — Node.js verification script. Validates all expected evidence and derived files exist per site.

Evidence structure (per site, under `sites/<site_slug>/`):
- `evidence/` — Raw capture artifacts:
  - `screenshot__homepage.png` — Full-page homepage screenshot
  - `screenshot__inventory.png` — Inventory/listing page screenshot
  - `screenshot__inventory_mobile.png` — Mobile viewport inventory screenshot
  - `dom_snapshot__inventory.txt` — Accessibility tree / DOM snapshot
  - `seo_extract.json` — Meta tags, schema markup, OG tags, canonical URL
  - `filter_panel.json` — Filter categories, options, counts, UX patterns
  - `vehicle_card_sample.json` — Representative listing card structure
  - `sort_and_pagination.json` — Sort options, pagination type, items per page
- `derived/` — Analysis artifacts:
  - `site_analysis.json` — Structured analysis (features, scores, observations)
  - `site_analysis.md` — Human-readable analysis narrative
  - `meta.json` — Capture status tracking (phases completed, timestamps, errors)

Cross-site outputs (at audit base path):
- `FEATURE_MATRIX.md` — Side-by-side feature comparison table
- `COMPETITIVE_SUMMARY.md` — Executive summary with key findings and patterns
</context>

<automated_workflow>
  <step id="1" name="load-sites" type="GATE">
    [GATE: sites.json exists at provided path]

    If sites.json exists, read and validate it. Each site must have:
    - slug (string, used as directory name)
    - name (string, display name)
    - url (string, homepage URL)
    - inventory_path (string, path/query for inventory page)

    If sites.json does not exist, ask user:
    "Please provide a sites.json path or the target URLs for the audit.
    Each site needs: name, URL, and inventory page path."

    **STOP and wait for user response if sites.json is missing.**
  </step>

  <step id="2" name="capture-loop" type="AUTO">
    [AUTO] For each site in sites.json, execute the 6-phase capture:

    <phase id="1" name="navigate-and-screenshot">
      1a. Navigate to site homepage URL
      1b. Take full-page screenshot → evidence/screenshot__homepage.png
      1c. Navigate to inventory page (url + inventory_path)
      1d. Wait for page load (network idle or main content visible)
      1e. Take full-page screenshot → evidence/screenshot__inventory.png
      1f. Capture DOM snapshot → evidence/dom_snapshot__inventory.txt
    </phase>

    <phase id="2" name="seo-extraction">
      2a. Extract via browser_evaluate:
        - document.title
        - meta description, keywords, robots
        - canonical URL
        - Open Graph tags (og:title, og:description, og:image, og:url)
        - Twitter Card tags
        - JSON-LD structured data (all script[type="application/ld+json"])
        - Schema.org markup
      2b. Write → evidence/seo_extract.json
    </phase>

    <phase id="3" name="filter-panel-capture">
      3a. Identify filter/facet panel on inventory page (sidebar, top bar, or modal)
      3b. Extract filter categories (Make, Model, Year, Price, Mileage, Body Style, etc.)
      3c. For each category: capture available options, counts if visible, UX pattern (checkbox, dropdown, range slider, pills)
      3d. Note search/keyword filter if present
      3e. Write → evidence/filter_panel.json
    </phase>

    <phase id="4" name="vehicle-card-analysis">
      4a. Identify a representative vehicle/product listing card
      4b. Extract card structure: image, title, price, mileage, location, badges, CTA buttons
      4c. Note card layout pattern (grid vs list, image ratio, info density)
      4d. Count visible cards on first page load
      4e. Write → evidence/vehicle_card_sample.json
    </phase>

    <phase id="5" name="sort-and-pagination">
      5a. Identify sort control (dropdown, buttons, etc.)
      5b. Extract available sort options (price low/high, mileage, year, newest, etc.)
      5c. Identify pagination pattern (numbered pages, load more, infinite scroll)
      5d. Note total result count if displayed
      5e. Write → evidence/sort_and_pagination.json
    </phase>

    <phase id="6" name="mobile-viewport">
      6a. Resize browser to mobile viewport (390x844)
      6b. Navigate to inventory page
      6c. Take screenshot → evidence/screenshot__inventory_mobile.png
      6d. Note mobile-specific UX changes (hamburger menu, stacked filters, card layout changes)
      6e. Resize back to desktop (1280x720)
    </phase>

    After all 6 phases for a site: write meta.json with phase completion status.
    Close browser before proceeding to next site.
  </step>

  <step id="3" name="per-site-analysis" type="AUTO">
    [AUTO] For each captured site, produce:
    - derived/site_analysis.json — Structured data: feature inventory, UX patterns, SEO score, observations
    - derived/site_analysis.md — Narrative analysis covering strengths, weaknesses, notable patterns
  </step>

  <step id="4" name="cross-site-synthesis" type="AUTO">
    [AUTO] Read all site_analysis.json files and produce:
    - FEATURE_MATRIX.md — Side-by-side comparison table (sites as columns, features as rows)
    - COMPETITIVE_SUMMARY.md — Executive summary: key differentiators, common patterns, notable gaps, ranked observations
  </step>

  <step id="5" name="verify" type="AUTO">
    [AUTO] Run: node scripts/verify_audit.cjs
    If FAIL: identify missing artifacts, attempt to re-capture, re-verify.
    If PASS: proceed to report.
  </step>

  <step id="6" name="present-results" type="USER">
    [USER] Present audit results to user:
    - Sites captured: [count]
    - Verification: PASS/FAIL
    - Key file paths: FEATURE_MATRIX.md, COMPETITIVE_SUMMARY.md
    - Top 3 findings from competitive summary

    Ask: "Would you like me to:
    1. Deep-dive into a specific site's analysis
    2. Re-capture a site with different parameters
    3. Generate a client-ready presentation summary
    4. Compare specific features across sites"

    **STOP and wait for user response before proceeding.**
  </step>
</automated_workflow>

<inputs>
  <required>
    <input name="SITES_JSON_PATH">Path to sites.json defining target sites</input>
  </required>
  <optional>
    <input name="SITE_SLUG">Specific site slug to audit (default: all sites in sites.json)</input>
    <input name="BASE_PATH">Base directory for evidence output (default: directory containing sites.json)</input>
    <input name="SKIP_CAPTURE">If true, skip capture and run analysis on existing evidence only</input>
  </optional>
</inputs>

<outputs>
  <output name="per-site-evidence">
    `sites/<site_slug>/evidence/` — Screenshots, DOM snapshots, SEO JSON, filter JSON, card JSON, pagination JSON
  </output>
  <output name="per-site-analysis">
    `sites/<site_slug>/derived/site_analysis.json` + `site_analysis.md`
  </output>
  <output name="feature-matrix">
    `FEATURE_MATRIX.md` — Cross-site comparison table
  </output>
  <output name="competitive-summary">
    `COMPETITIVE_SUMMARY.md` — Executive summary with ranked findings
  </output>
  <output name="verification">
    verify_audit.cjs output: PASS/FAIL per site + overall
  </output>
</outputs>

<success_criteria>
- All sites in sites.json have complete evidence directories (6 phases per site)
- Each site has derived/site_analysis.json and derived/site_analysis.md
- FEATURE_MATRIX.md exists with all sites represented as columns
- COMPETITIVE_SUMMARY.md exists with ranked findings
- verify_audit.cjs passes with zero missing artifacts
- No forms submitted, no accounts created, no data mutated on target sites
- Observational reporting principles followed in all analysis output
- Chat output includes file paths, site count, verification status, and top findings
</success_criteria>
</skill>
