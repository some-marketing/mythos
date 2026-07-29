# Design Research — Variable Guide

Reference guide for all `{{VARIABLE}}` placeholders used in the design research prompt template.

---

## Standard Intake Variables

### Context & Framing

| Variable | Description | Example Format | Required |
|---|---|---|---|
| `{{CLIENT_CONTEXT_BLURB}}` | Casual 2-3 sentence intro framing the research request. Sets tone and focus for the entire report. | "Established electrical contractor expanding into solar installations across Nova Scotia. Primarily B2B but starting to take residential solar." | **Required** |

### Business Identity

| Variable | Description | Example Format | Required |
|---|---|---|---|
| `{{BUSINESS_NAME}}` | Full legal or operating business name as used publicly. | "Acme Plumbing Ltd." | **Required** |
| `{{BUSINESS_DESCRIPTION}}` | One to three sentence description covering what the business does, who they serve, and where they operate. | "Commercial and residential plumbing and heating company serving the Greater Toronto Area." | **Required** |
| `{{INDUSTRY}}` | Industry category with optional sub-category for precision. | "Construction / Commercial Plumbing" | **Required** |

### Project Details

| Variable | Description | Example Format | Required |
|---|---|---|---|
| `{{PROJECT_START_DATE}}` | Date when project work begins. | "2026-04-15" (YYYY-MM-DD) | Optional |
| `{{SITE_TYPE}}` | Whether this is a new site, redesign, or full overhaul. | "This is a new site" / "Redesign" / "Full overhaul" | Optional |
| `{{HAS_DOMAIN}}` | Whether a domain name is already registered. | "Yes" / "No" | Optional |
| `{{HAS_HOSTING}}` | Whether hosting is already in place. | "Yes" / "No" / "No - need managed setup" | Optional |
| `{{WEBSITE_URL}}` | Target URL for the finished site. | "www.example.com" | Optional |
| `{{DOMAINS_LIST}}` | All domains and subdomains owned by the client. | "example.com, example.ca, shop.example.com" | Optional |

### Audience & Market

| Variable | Description | Example Format | Required |
|---|---|---|---|
| `{{REQUIRED_PAGES}}` | List of pages the client wants on the site. | "Home Page, About / Team, Services, Portfolio / Gallery, Contact" | Optional |
| `{{CLIENT_TYPE}}` | Whether clients are businesses (B2B), consumers (B2C), or both. | "B2B" / "B2C" / "Both, but primarily B2B commercial clients" | **Required** |
| `{{CLIENT_TYPE_LABEL}}` | Short label derived from CLIENT_TYPE, used in report section headers. | "B2B" / "B2C" / "B2B/B2C" | **Required** |
| `{{SERVICE_AREA}}` | Geographic coverage area. Be as specific as possible. | "Greater Vancouver, British Columbia" | **Required** |
| `{{TARGET_CLIENTS}}` | Specific client segments the business serves. | "Commercial property managers, general contractors, facility managers at hospitals and schools" | Optional |
| `{{PRIMARY_GOAL}}` | Main objective for the website. | "Generate leads for commercial projects" / "Establish credibility with GCs for tender bids" | Optional |

### Brand & Design

| Variable | Description | Example Format | Required |
|---|---|---|---|
| `{{HAS_BRANDING}}` | Whether existing brand guidelines or style guide exists. | "Yes" / "Not yet" | Optional |
| `{{COLOUR_PALETTE}}` | Brand colors (names, hex codes, or both). | "White, Black, #B87333 Copper" | **Required** |
| `{{INSPIRATION_SITES}}` | Reference websites with notes on what the client likes about each. | "example1.com (like the layout), example2.com (like the simplicity)" | Optional |

### Content & Operations

| Variable | Description | Example Format | Required |
|---|---|---|---|
| `{{SOCIAL_MEDIA}}` | Social media platforms the business is active on. | "Facebook, Instagram, LinkedIn" | Optional |
| `{{CONTENT_STATUS}}` | Whether content for the site is ready. | "Content is ready" / "Partial content available" / "Need assistance with content creation" | Optional |
| `{{LAUNCH_DATE}}` | Target launch date for the website. | "2026-06-01" (YYYY-MM-DD) | Optional |
| `{{MAINTENANCE_NEEDS}}` | Ongoing maintenance and support requirements. | "No" / "Yes - as-needed support only" / "Yes - monthly maintenance plan" | Optional |
| `{{SEO_NEEDS}}` | Whether SEO setup is needed. | "Yes" / "No" | Optional |
| `{{LANGUAGE_NEEDS}}` | Whether the site needs multiple language versions. | "No, English only" / "Yes - English and French" | Optional |

---

## Enhanced Variables (Recommended Additions)

These variables are not part of the standard intake form but significantly improve research output quality.

| Variable | Description | Example Format | Required |
|---|---|---|---|
| `{{KEY_SERVICES}}` | Top 5-10 services in order of revenue importance. | "1. Commercial boiler installations, 2. Emergency repair, 3. Residential plumbing" | Optional |
| `{{CERTIFICATIONS_CREDENTIALS}}` | Professional certifications, licenses, insurance coverage, and industry memberships. | "Red Seal Certified, $5M commercial liability insurance, NLCA member" | Optional |
| `{{TESTIMONIALS_REFERENCES}}` | Existing client testimonials or references with names, titles, and companies. | "Jane Doe, VP Operations, ABC Corp — worked with us on system integration" | Optional |
| `{{UNIQUE_SELLING_POINTS}}` | What makes the business different from competitors. | "We're one of the only contractors in the province who still work on steam heating systems." | Optional |
| `{{COMPETITOR_NAMES}}` | Main competitors and who the business loses bids/jobs to. | "Summit Plumbing, Dawe's Plumbing, Avalon Plumbing" | Optional |
| `{{ELEVATOR_PITCH}}` | 30-second pitch explaining why a client should hire this business over a competitor. | "With us, you get a personable relationship with the owner — no corporate runaround." | Optional |
| `{{REVENUE_MODEL}}` | How the business makes money and the split between revenue streams. | "60% new construction, 30% maintenance contracts, 10% emergency calls" | Optional |
| `{{BUSINESS_HISTORY}}` | How long the business has been operating and notable milestones. | "Started 8 years ago as a one-person operation, now 12 employees." | Optional |

---

## Completeness Tiers

### Tier 1 — Minimum Viable (7 variables)
Produces a useful but generic report.
- `{{CLIENT_CONTEXT_BLURB}}`
- `{{BUSINESS_NAME}}`
- `{{BUSINESS_DESCRIPTION}}`
- `{{INDUSTRY}}`
- `{{CLIENT_TYPE}}` + `{{CLIENT_TYPE_LABEL}}`
- `{{SERVICE_AREA}}`
- `{{COLOUR_PALETTE}}`

### Tier 2 — Full Intake (all standard variables)
Produces high-quality, targeted output.
- All Tier 1 variables
- All remaining standard intake variables listed above

### Tier 3 — Enhanced (all variables)
Produces superior, deeply targeted output.
- All Tier 2 variables
- All enhanced variables listed above
