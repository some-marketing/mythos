# Source Document Types

## Overview

The presentation review framework classifies source documents by their role in the project. This classification determines how each document is used during the audit.

## Document Roles

### slide_content_spec
**What it is:** A markdown document that specifies exactly what each slide should contain — titles, body text, image placement, annotations, and narrative flow.

**How it's used:** Primary reference for the slide content audit. Every slide is compared against this spec.

**Detection heuristics:**
- Contains "slide" + numbers (e.g., "Slide 1", "Slide 3")
- Contains "screenshot" references with slide placements
- Often has a structured format with headers per slide
- May include a screenshot manifest section

**Example filenames:** `*_Presentation_Slides*.md`, `*_Slide_Spec*.md`, `*_Deck_Content*.md`

---

### project_scope
**What it is:** The comprehensive project scope document covering all deliverables, phases, technical requirements, and project boundaries.

**How it's used:** Authoritative source for fact-checking claims in the presentation. Pricing, timeline, deliverables, and technical details are verified against this document.

**Detection heuristics:**
- Contains "scope" in filename or first 50 lines
- Has sections for deliverables, timeline, phases
- Often the longest document in the project
- May include technical requirements

**Example filenames:** `*_Project_Scope*.md`, `*_Scope_of_Work*.md`

---

### proposal
**What it is:** The client-facing proposal document, typically including pricing, payment schedule, and deliverable summary.

**How it's used:** Verifies pricing figures, payment terms, and client-facing deliverable descriptions in the presentation.

**Detection heuristics:**
- Contains "proposal" in filename
- Contains dollar amounts, payment schedules
- May have client-facing language and formatting
- Often shorter and more polished than the scope doc

**Example filenames:** `*_Proposal*.md`, `*_Quote*.md`

---

### technical_spec
**What it is:** Technical specification covering the implementation stack, custom post types, plugins, APIs, and architecture decisions.

**How it's used:** Verifies technical claims in the presentation (plugin names, technology choices, integration details).

**Detection heuristics:**
- Contains "technical" or "spec" in filename
- References specific technologies, plugins, APIs
- Contains code snippets, data models, or architecture diagrams
- May reference CPTs, taxonomies, or database structures

**Example filenames:** `*_Technical_Spec*.md`, `*_Tech_Stack*.md`, `*_Architecture*.md`

---

### competitor_research
**What it is:** Analysis of competitor websites, features, and approaches used as reference or inspiration for the project.

**How it's used:** Verifies competitor references in the presentation (names, features, screenshots attributed to competitors).

**Detection heuristics:**
- Contains "competitor" or "inspiration" or "research" in filename
- References multiple external websites or companies
- Contains comparison tables or feature matrices
- May include URLs for competitor sites

**Example filenames:** `*_Competitor*.md`, `*_Research*.md`, `*_Inspiration*.md`

---

### errata
**What it is:** Corrections, build instructions, or prompt documents that contain amendments to earlier documents. Critical for identifying what has changed and must be reflected in the presentation.

**How it's used:** The corrections check (Prompt 06) uses this to verify every correction has been applied in the presentation.

**Detection heuristics:**
- Contains phrases like "correction", "do NOT use", "changed from", "updated to"
- References specific values that should be replaced
- May be a build prompt or instruction document with inline corrections
- Often references other documents by name

**Example filenames:** `*_Errata*.md`, `*_Corrections*.md`, `*_Prompt_v2*.md`, `*_Build_Instructions*.md`

---

### screenshot
**What it is:** Image files (PNG, JPG) used as visual evidence in the presentation.

**How it's used:** Visually verified against the screenshot manifest. Each screenshot is checked for existence, content accuracy, annotations, and correct slide placement.

**Detection heuristics:**
- Image file extensions (.png, .jpg, .jpeg, .gif, .webp)
- Located in a `Screenshots/` subdirectory
- Filenames often include the project prefix and descriptive names
- May include annotations, highlights, or callouts

---

### supporting
**What it is:** Scripts, logs, scraped content, meeting notes, and other files that support the project but aren't directly referenced in the presentation.

**How it's used:** Not directly audited, but may be referenced if other documents point to them.

**Detection heuristics:**
- Python scripts (.py), log files (.log, .txt)
- Meeting notes or transcripts
- Scraped website content
- Virtual environments, cache directories

---

### unknown
**What it is:** Files that cannot be classified into any of the above categories.

**How it's used:** Flagged in the intake manifest for manual review. Not used in the audit.
