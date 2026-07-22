# Website Research Prompt — Input Guide

> **Purpose:** This document lists every input needed to complete the `02_RESEARCH_PROMPT.md` template. Each field includes the original intake form question and guidance on what makes a good input.

---

## How to Use This Guide

1. Walk through each field with your client (or fill from their intake form)
2. Pay special attention to fields marked **[Critical]** — these dramatically affect output quality
3. Fields marked **[Recommended Addition]** were not in the original intake form but significantly improve the research output
4. Once complete, substitute values into the prompt template

---

## Section 1: Context & Framing

### `{{CLIENT_CONTEXT_BLURB}}` — **[Critical]**

**What it is:** A casual 2-3 sentence intro that frames the research request. This sets the tone and focus for the entire report.

**Guidance:**
- Write this conversationally, as if briefing a colleague
- Include: what the business does, where they operate, and whether they're B2B, B2C, or both
- Mention anything unusual or noteworthy (e.g., "They have rare certifications," "They're pivoting from residential to commercial," "They compete against national franchises")
- This blurb primes the AI to focus on the right market segment and depth level

**Good example:** "Established electrical contractor expanding into solar installations across Nova Scotia. Primarily B2B but starting to take residential solar. They want to be seen as the premium option."

**Weak example:** "Client needs a website." (Too vague — produces generic output)

---

## Section 2: Business Identity

### `{{BUSINESS_NAME}}`

**Intake form question:** Name of Business
**Guidance:** Use the full legal or operating name as the client uses it publicly.

---

### `{{BUSINESS_DESCRIPTION}}` — **[Critical]**

**Intake form question:** About Your Business

**Guidance:**
- One to three sentences covering: what they do, who they serve, where they operate
- Include service specializations if known
- The more specific this is, the more targeted the research output will be

---

### `{{INDUSTRY}}`

**Intake form question:** What Industry Is Your Business In

**Guidance:**
- Use the broadest applicable industry category, but add a sub-category for precision
- Use format like "Construction / Commercial Plumbing" rather than just "Construction"
- This drives the industry trends and competitive analysis sections

---

## Section 3: Project Details

### `{{PROJECT_START_DATE}}`

**Intake form question:** Project Start Date
**Guidance:** YYYY-MM-DD format. Used to calculate timeline feasibility.

---

### `{{SITE_TYPE}}`

**Intake form question:** Is This a New Site, Redesign Or Full Overhaul?

**Guidance:** Options are typically:
- New site (no existing web presence)
- Redesign (existing site, updating look/feel)
- Full overhaul (existing site, rebuilding from scratch)

This affects technical recommendations and content strategy sections.

---

### `{{HAS_DOMAIN}}`

**Intake form question:** Do You Already Have A Domain Name Registered?
**Guidance:** Yes or No.

---

### `{{HAS_HOSTING}}`

**Intake form question:** Do You Already Have Hosting?
**Guidance:** Yes, No, or specify if managed hosting setup is needed.

---

### `{{WEBSITE_URL}}`

**Intake form question:** Website URL
**Guidance:** The target URL for the finished site.

---

### `{{DOMAINS_LIST}}`

**Intake form question:** Current Domain and any Subdomains (One per line)
**Guidance:** List all domains owned, even if not currently in use. Helps with domain strategy recommendations.

---

## Section 4: Audience & Market

### `{{REQUIRED_PAGES}}` — **[Critical]**

**Intake form question:** What Web Pages Will You Need On Your Site?

**Guidance:**
- List all pages the client expects
- The research tool will recommend additional pages based on industry best practices
- Common options: Home, About, Services, Portfolio, Blog, Contact, Testimonials, FAQ, Careers, Emergency Services

---

### `{{CLIENT_TYPE}}` — **[Critical]**

**Intake form question:** Are Your Clients Businesses or Customers?

**Guidance:**
- B2B, B2C, or Both
- This fundamentally changes the buying journey analysis, trust signals, and messaging sections
- If "Both," specify the primary focus (e.g., "Both, but primarily B2B commercial clients")

---

### `{{CLIENT_TYPE_LABEL}}`

**Not in original intake form — derived from `{{CLIENT_TYPE}}`**
**Guidance:** Used in section headers. Keep it short: "B2B", "B2C", or "B2B/B2C"

---

### `{{SERVICE_AREA}}` — **[Critical]**

**Intake form question:** Your Service Area

**Guidance:**
- Be as specific as possible: province/state, city, region, radius
- This drives the market context research, competitor identification, and local SEO recommendations
- More specific is always better for research quality

---

### `{{TARGET_CLIENTS}}` — **[Critical]**

**Intake form question:** Please Specify Who Your Business Works With

**Guidance:**
- List specific client types with as much detail as possible
- Good: "Commercial property managers, general contractors, facility managers at hospitals and schools, residential home builders"
- Weak: "Businesses" (too vague)
- This directly shapes the buyer psychology and messaging sections
- If unknown, describe the types of projects the business takes on and the research tool will infer

---

### `{{PRIMARY_GOAL}}`

**Intake form question:** What Is Your Site's Primary Goal

**Guidance:**
- Be specific about what "success" looks like for this website
- Good options: "Generate leads for commercial projects," "Establish credibility with GCs for tender bids," "Drive emergency service calls," "Support sales team with case studies and credentials"
- Multiple goals are fine — list in priority order

---

## Section 5: Brand & Design

### `{{HAS_BRANDING}}`

**Intake form question:** Do you have existing branding guidelines or a style guide?

**Guidance:**
- If yes, the design section will build on existing guidelines
- If no, the report will recommend establishing brand direction from scratch

---

### `{{COLOUR_PALETTE}}` — **[Critical]**

**Intake form question:** Colour Palette

**Guidance:**
- Provide color names, hex codes, or a link to a palette generator result
- Minimum 2-3 colors (background, primary, accent)
- The more specific, the better: "#B87333 copper" beats "some kind of bronze/copper"
- If the client has no preference, note that and the report will recommend based on industry norms

---

### `{{INSPIRATION_SITES}}` — **[Critical]**

**Intake form question:** Are There Any Sites You Really Like/Want To Use As Inspiration?

**Guidance:**
- Include both the URL and what the client likes about it
- Even sites from unrelated industries are useful if the client likes the style
- These get analyzed in the design recommendations section
- 2-4 sites is ideal

---

## Section 6: Content & Operations

### `{{SOCIAL_MEDIA}}`

**Intake form question:** What Social Media Networks are you on?
**Guidance:** List platforms with links if available. Helps with social proof and content distribution strategy.

---

### `{{CONTENT_STATUS}}`

**Intake form question:** Content Ready?

**Guidance:**
- Options: "Content is ready," "Partial content available," "Need assistance with content creation"
- Affects the content strategy depth and timeline recommendations

---

### `{{LAUNCH_DATE}}`

**Intake form question:** Desired Launch Date
**Guidance:** YYYY-MM-DD. The timeline section will be built around this date.

---

### `{{MAINTENANCE_NEEDS}}`

**Intake form question:** Do you need ongoing maintenance and support?

**Guidance:**
- Options: "No," "Yes - as-needed support only," "Yes - monthly maintenance plan," "Yes - full managed service"
- Affects technical platform and hosting recommendations

---

### `{{SEO_NEEDS}}`

**Intake form question:** Do you need SEO setup?

**Guidance:**
- Even if "No," the report will include basic SEO best practices within other sections
- "Yes" adds deeper SEO keyword research and technical SEO recommendations

---

### `{{LANGUAGE_NEEDS}}`

**Intake form question:** Will your website need multiple language versions?
**Guidance:** Affects technical implementation (multilingual plugins, translation workflows).

---

## Section 7: Recommended Additional Inputs

These fields were **not** in the standard intake form but significantly improve research output quality. Consider adding them to your intake process.

---

### `{{KEY_SERVICES}}` — **[Recommended Addition]**

**What to ask:** "List your top 5-10 services in order of revenue importance"

**Why it matters:** Knowing about specific service specializations drives the competitive analysis and content strategy. Without an explicit service listing, the research tool makes generic assumptions.

---

### `{{CERTIFICATIONS_CREDENTIALS}}` — **[Recommended Addition]**

**What to ask:** "List all professional certifications, licenses, insurance coverage, and industry memberships"

**Why it matters:** Certifications, specific insurance amounts, and industry memberships are powerful trust signals and competitive differentiators. The research tool can assess their rarity in the local market.

---

### `{{TESTIMONIALS_REFERENCES}}` — **[Recommended Addition]**

**What to ask:** "Do you have existing client testimonials or references? List names, titles, companies, and a brief quote if available"

**Why it matters:** Named testimonials with job titles and companies are far more powerful than anonymous reviews. The research tool can recommend placement strategy for each testimonial.

---

### `{{UNIQUE_SELLING_POINTS}}` — **[Recommended Addition]**

**What to ask:** "What makes your business different from competitors? What can you do that others can't or won't?"

**Why it matters:** Self-identified differentiators allow the research tool to validate and quantify competitive advantages.

---

### `{{COMPETITOR_NAMES}}` — **[Recommended Addition]**

**What to ask:** "Who are your main competitors? Who do you lose bids/jobs to?"

**Why it matters:** Named competitors allow the research tool to do direct website analysis and positioning recommendations rather than generic competitive landscape assessment.

---

### `{{ELEVATOR_PITCH}}` — **[Recommended Addition]**

**What to ask:** "If you had 30 seconds to explain to a potential client why they should hire you instead of a competitor, what would you say?"

**Why it matters:** This captures the business owner's authentic voice and self-perception, which the research tool can refine into polished messaging.

---

### `{{REVENUE_MODEL}}` — **[Recommended Addition]**

**What to ask:** "How does your business make money? What's the split between project work, maintenance contracts, emergency calls, etc.?"

**Why it matters:** Understanding the revenue model allows the content strategy to be weighted appropriately.

---

### `{{BUSINESS_HISTORY}}` — **[Recommended Addition]**

**What to ask:** "How long have you been in business? Any notable milestones, projects, or growth story?"

**Why it matters:** Business history feeds the About page narrative and trust-building strategy. Years in business, notable projects, and growth milestones are powerful credibility signals.

---

## Input Completeness Checklist

### Minimum viable inputs (will produce a useful but generic report):
- [ ] `{{CLIENT_CONTEXT_BLURB}}`
- [ ] `{{BUSINESS_NAME}}`
- [ ] `{{BUSINESS_DESCRIPTION}}`
- [ ] `{{INDUSTRY}}`
- [ ] `{{CLIENT_TYPE}}`
- [ ] `{{SERVICE_AREA}}`
- [ ] `{{COLOUR_PALETTE}}`

### Full intake form (produces high-quality output):
- [ ] All minimum viable inputs above
- [ ] `{{SITE_TYPE}}`
- [ ] `{{REQUIRED_PAGES}}`
- [ ] `{{TARGET_CLIENTS}}`
- [ ] `{{PRIMARY_GOAL}}`
- [ ] `{{INSPIRATION_SITES}}`
- [ ] `{{CONTENT_STATUS}}`
- [ ] `{{LAUNCH_DATE}}`
- [ ] All remaining standard fields

### Enhanced inputs (produces superior output):
- [ ] All full intake form fields above
- [ ] `{{KEY_SERVICES}}`
- [ ] `{{CERTIFICATIONS_CREDENTIALS}}`
- [ ] `{{UNIQUE_SELLING_POINTS}}`
- [ ] `{{COMPETITOR_NAMES}}`
- [ ] `{{ELEVATOR_PITCH}}`
- [ ] `{{TESTIMONIALS_REFERENCES}}`
- [ ] `{{REVENUE_MODEL}}`
- [ ] `{{BUSINESS_HISTORY}}`

---

## Tips for Best Results

1. **More context = better output.** The more detail provided in the intake, the more targeted and actionable the research output will be.

2. **The `{{CLIENT_CONTEXT_BLURB}}` sets the tone.** Write it like you're briefing a smart colleague who knows marketing but not this specific industry. Mention anything unusual, impressive, or challenging about the client's situation.

3. **Service area specificity matters.** A specific city or region produces much better competitor and market research than a broad geographic area.

4. **Name competitors if you know them.** The research tool can analyze their actual websites and positioning, which produces vastly more useful competitive recommendations.

5. **Don't skip the "soft" inputs.** The elevator pitch and USPs capture the business owner's authentic voice and self-perception, which grounds the messaging framework in reality rather than generic industry advice.

6. **Run follow-up prompts.** The main report is comprehensive but you can dive deeper into any section. After getting the main report, try:
   - "Now do a detailed competitive analysis of {{BUSINESS_NAME}} vs. [specific competitors]"
   - "Create a detailed content strategy leveraging {{BUSINESS_NAME}}'s key differentiators"
   - "Analyze the SEO keyword opportunity for [specific services] in [specific location]"
