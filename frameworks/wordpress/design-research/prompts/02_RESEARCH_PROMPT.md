# Website Design & Market Research Prompt

> **Purpose:** Feed this prompt (with completed variables) into Perplexity, ChatGPT Deep Research, or a similar AI research tool to generate a comprehensive website design and market research report for any business client.
>
> **Tip:** To run the Perplexity leg from the command line, set `PERPLEXITY_API_KEY` in your `.env` and pipe this completed prompt in: `npm run research:perplexity -- "$(cat 02_RESEARCH_PROMPT.md)"` (see `tools/perplexity/README.md`). This is optional — you can paste the prompt into any research tool by hand instead.
>
> **How to use:**
> 1. Complete the intake form in `01_RESEARCH_PROMPT_INPUTS.md`
> 2. Replace all `{{VARIABLE}}` placeholders below with the client's actual values
> 3. Paste the completed prompt into your research tool
> 4. The output should be a ~15-20 page report covering all 13 sections below

---

## The Prompt

```
{{CLIENT_CONTEXT_BLURB}}

Could you do some research into that space, and advise on design aesthetics that would complement this sort of brand, as well as some research on that space/niche for market insights, audience insights, anything?

Here is their intake form:

Name of Business: {{BUSINESS_NAME}}
About Your Business: {{BUSINESS_DESCRIPTION}}
What Industry Is Your Business In: {{INDUSTRY}}
Project Start Date: {{PROJECT_START_DATE}}
Is This a New Site, Redesign Or Full Overhaul: {{SITE_TYPE}}
Do You Already Have A Domain Name Registered: {{HAS_DOMAIN}}
Do You Already Have Hosting: {{HAS_HOSTING}}
Website URL: {{WEBSITE_URL}}
Current Domain and any Subdomains: {{DOMAINS_LIST}}
What Web Pages Will You Need On Your Site: {{REQUIRED_PAGES}}
Are Your Clients Businesses or Customers: {{CLIENT_TYPE}}
Your Service Area: {{SERVICE_AREA}}
Please Specify Who Your Business Works With: {{TARGET_CLIENTS}}
What Is Your Site's Primary Goal: {{PRIMARY_GOAL}}
Do you have existing branding guidelines or a style guide: {{HAS_BRANDING}}
Colour Palette: {{COLOUR_PALETTE}}
Are There Any Sites You Really Like/Want To Use As Inspiration: {{INSPIRATION_SITES}}
What Social Media Networks are you on: {{SOCIAL_MEDIA}}
Content Ready: {{CONTENT_STATUS}}
Desired Launch Date: {{LAUNCH_DATE}}
Do you need ongoing maintenance and support: {{MAINTENANCE_NEEDS}}
Do you need SEO setup: {{SEO_NEEDS}}
Will your website need multiple language versions: {{LANGUAGE_NEEDS}}

Now create a comprehensive Website Design & Market Research Report for this business. The report must cover ALL of the following sections in depth, with real research, cited sources, and actionable recommendations. Do not produce a shallow overview — each section should contain substantive analysis with data points, competitor names, industry statistics, and specific recommendations.

---

### SECTION 1: Market Context & Opportunity Assessment

Research the {{INDUSTRY}} sector in {{SERVICE_AREA}} specifically. Include:
- Current and projected market size, growth rates, and investment trends
- Major projects, developments, or economic drivers in the region
- Labor market conditions (shortages, training pipeline, wage trends)
- Material cost trends affecting the industry
- Regulatory environment and compliance landscape
- How this market environment creates opportunities for {{BUSINESS_NAME}}

Use real statistics and cite sources. Reference specific regional projects, government data, and industry reports.

---

### SECTION 2: {{CLIENT_TYPE_LABEL}} Client Psychology & Buying Journey

Analyze how {{BUSINESS_NAME}}'s target clients ({{TARGET_CLIENTS}}) make purchasing decisions in this industry. Include:
- Primary customer segments with job titles, responsibilities, and pain points
- Decision-making criteria ranked by importance (speed, cost, expertise, trust, etc.)
- The buying journey from problem recognition through vendor selection
- How prospects research and evaluate vendors (what they check, how many they compare)
- Post-purchase relationship dynamics (retention, maintenance contracts, referrals)
- Differences between emergency/urgent vs. planned/project buying behavior

Ground this in actual B2B/B2C research for the {{INDUSTRY}} sector, not generic marketing advice.

---

### SECTION 3: Industry Trends (Current Year)

Research current trends reshaping the {{INDUSTRY}} industry that affect how {{BUSINESS_NAME}} should position itself online. Include:
- Technology trends (smart systems, IoT, automation, remote monitoring)
- Sustainability and environmental trends (regulations, green building, energy efficiency)
- Material and method innovations (new materials, prefabrication, modular approaches)
- Service delivery model evolution (mobile-first, online booking, real-time tracking, virtual consultations)
- Customer expectation shifts (transparency, digital experience, response time)

Focus on trends that have direct implications for website content and positioning strategy.

---

### SECTION 4: Design Aesthetic Recommendations

Based on the colour palette ({{COLOUR_PALETTE}}) and the nature of the business, provide detailed design direction. Include:
- Color psychology analysis — what the chosen colors communicate to the target audience
- The 60-30-10 rule application with specific hex values for primary, secondary, and accent colors
- Typography recommendations (font families, weights, sizes for headers and body)
- Visual style direction (industrial, corporate, clean, rustic, etc.) with rationale
- Photography and imagery guidelines (what to shoot, what to avoid, stock vs. custom)
- Layout principles (grid systems, white space, section structure)
- How the design should differ from competitors / inspiration sites
- Specific UI elements: CTA button styling, hover states, card designs, icon style
- Mobile design considerations specific to this audience

Reference the inspiration sites ({{INSPIRATION_SITES}}) and analyze what works/doesn't work about them.

---

### SECTION 5: Essential Website Features for Conversion

Detail the must-have features for a high-converting {{INDUSTRY}} website. Include:
- Mobile responsiveness requirements with specific benchmarks
- Page load speed targets and optimization strategies
- CTA placement strategy (above fold, in-content, exit-intent) with specific copy examples
- Contact form design (field count, field types, mobile optimization)
- Trust-building elements and where to place them (certifications, reviews, logos, insurance)
- Emergency/urgent contact options (click-to-call, chat, prominent phone numbers)
- Google Maps integration for service area visualization
- Security requirements (SSL, privacy policy, data protection)
- Accessibility standards compliance

Provide specific, implementable recommendations — not generic "make it mobile friendly" advice.

---

### SECTION 6: Content Strategy & Site Architecture

Design the complete site structure and content approach. Include:
- Detailed sitemap with all pages and their hierarchy
- Homepage wireframe/content blocks in priority order
- About page content framework (story, team, credentials, community)
- Individual service page structure and content template
- Portfolio/project gallery organization (filtering, case study format)
- Blog/news section strategy (categories, post frequency, topic pillars)
- FAQ section strategy (questions that serve both UX and SEO)
- Internal linking strategy between pages
- Content formatting guidelines (paragraph length, headings, lists, bold text, scanability)

For each page type, specify the content blocks, their order, and what each block should contain.

---

### SECTION 7: Trust & Credibility Building

Develop a comprehensive trust-building strategy specific to {{INDUSTRY}} {{CLIENT_TYPE}} clients. Include:
- Case study format and structure (challenge, solution, results, testimonial)
- Testimonial collection strategy (who to ask, what format, where to display)
- Credentials and certifications display strategy (badges, logos, descriptions)
- Social proof hierarchy (what matters most to {{CLIENT_TYPE}} buyers)
- Third-party validation (BBB, industry associations, Google reviews strategy)
- Transparency elements (pricing approach, process documentation, insurance/licensing display)
- Risk-reduction messaging (guarantees, warranties, response commitments)

Specify which trust signals matter most for this specific industry and client type.

---

### SECTION 8: Competitive Positioning & Differentiation

Research {{BUSINESS_NAME}}'s competitive landscape in {{SERVICE_AREA}}. Include:
- Identify actual competitors by name with their strengths and weaknesses
- Competitor website analysis (what they do well, where they fall short)
- Market segmentation (small local operators vs. mid-size vs. national brands)
- {{BUSINESS_NAME}}'s unique selling propositions and how to articulate them
- Positioning strategy against each competitor segment
- Messaging differentiation (how to stand out in a crowded market)
- Service specializations that create competitive moats
- Pricing positioning recommendations

Name real competitors. Analyze their actual websites. Provide specific differentiation strategies.

---

### SECTION 9: Technical Implementation Recommendations

Provide specific technical guidance for building the site. Include:
- Platform recommendation with rationale (WordPress, Squarespace, custom, etc.)
- Theme/template recommendations for the chosen platform
- Essential plugins/extensions list with specific product names
- Hosting provider recommendations with regional considerations
- Local SEO implementation (Google Business Profile, structured data, location pages)
- Performance optimization strategy (caching, CDN, image optimization)
- Security implementation (SSL, firewalls, malware protection, backups)
- Analytics and tracking setup (GA4, conversion tracking, call tracking)

Be specific with product names, not generic categories.

---

### SECTION 10: Conversion Optimization Strategies

Detail advanced conversion tactics beyond basic features. Include:
- Lead magnet ideas specific to {{INDUSTRY}} (downloadable guides, checklists, calculators)
- Exit-intent popup strategy with specific copy examples
- Live chat / chatbot implementation recommendations
- A/B testing plan (what elements to test first, testing methodology)
- Landing page strategy for specific campaigns or services
- Email capture and nurture strategy
- Retargeting recommendations
- Conversion rate benchmarks for this industry

Provide specific, actionable tactics with example copy and implementation details.

---

### SECTION 11: Content Development & Messaging Framework

Create the messaging foundation for all website copy. Include:
- Primary value proposition statement
- Headline hierarchy (H1 hero, H2 sections, supporting copy)
- Messaging by audience segment (different copy for different buyer types)
- Service description framework (problem/solution/proof/CTA structure)
- Emergency service messaging (urgency, reassurance, action)
- "About Us" narrative framework (origin, mission, differentiation, community)
- CTA copy variations for different contexts (emergency, quote request, consultation, download)
- Tone and voice guidelines (professional, approachable, authoritative, etc.)

Write example copy that can be adapted, not just describe what the copy should do.

---

### SECTION 12: Project Timeline & Launch Strategy

Build a realistic project timeline. Include:
- Phase breakdown with specific deliverables per phase
- Content development milestones (copy, photography, testimonials, case studies)
- Design milestones (mockups, revisions, approval)
- Development milestones (build, plugin configuration, testing)
- Pre-launch checklist (testing, SEO setup, analytics, security)
- Launch day activities
- Post-launch monitoring and optimization period (2-4 weeks)
- Ongoing maintenance and content calendar

Align the timeline to the desired launch date of {{LAUNCH_DATE}}.

---

### SECTION 13: Measurement & Optimization KPIs

Define the success measurement framework. Include:
- Primary conversion metrics with industry benchmarks
- User experience metrics with targets (session duration, bounce rate, pages per session)
- Goal tracking setup recommendations (form submissions, calls, downloads)
- Traffic source analysis framework
- Monthly reporting template (what to measure, what to look for)
- Quarterly review framework (content updates, technical optimization, testimonial refresh)
- Year-one milestone targets for traffic, leads, and conversions

Provide specific benchmark numbers, not just "track your metrics."

---

Format the entire report with:
- Clear section headers and subheaders
- Data tables where appropriate
- Bullet points for actionable items
- Cited sources with links for all statistics and claims
- Specific recommendations (not generic advice)

The report should be comprehensive enough to serve as both a strategic guide and an implementation reference for the web design team.
```

---

## Variable Quick Reference

| Variable | Description |
|---|---|
| `{{CLIENT_CONTEXT_BLURB}}` | 2-3 sentence casual intro about the client |
| `{{BUSINESS_NAME}}` | Legal or operating business name |
| `{{BUSINESS_DESCRIPTION}}` | One-line description of the business |
| `{{INDUSTRY}}` | Industry category |
| `{{PROJECT_START_DATE}}` | When work begins (YYYY-MM-DD) |
| `{{SITE_TYPE}}` | New site, redesign, or overhaul |
| `{{HAS_DOMAIN}}` | Whether domain is registered |
| `{{HAS_HOSTING}}` | Whether hosting exists |
| `{{WEBSITE_URL}}` | Target URL |
| `{{DOMAINS_LIST}}` | All domains/subdomains |
| `{{REQUIRED_PAGES}}` | Pages the client wants |
| `{{CLIENT_TYPE}}` | B2B, B2C, or Both |
| `{{CLIENT_TYPE_LABEL}}` | Descriptive label for section 2 header |
| `{{SERVICE_AREA}}` | Geographic coverage |
| `{{TARGET_CLIENTS}}` | Specific client segments |
| `{{PRIMARY_GOAL}}` | Main website objective |
| `{{HAS_BRANDING}}` | Whether brand guidelines exist |
| `{{COLOUR_PALETTE}}` | Brand colors |
| `{{INSPIRATION_SITES}}` | Reference websites with notes |
| `{{SOCIAL_MEDIA}}` | Active social channels |
| `{{CONTENT_STATUS}}` | Whether content is ready |
| `{{LAUNCH_DATE}}` | Target launch date (YYYY-MM-DD) |
| `{{MAINTENANCE_NEEDS}}` | Ongoing support requirements |
| `{{SEO_NEEDS}}` | Whether SEO setup is needed |
| `{{LANGUAGE_NEEDS}}` | Multi-language requirements |
