# Execution Normalization Guardrails

## Execution Mode Constraints

| Mode | Allowed In | Constraint |
|------|-----------|------------|
| REVIEW_ONLY | Prompts 01, 02 | Produce design documents and gap reports only. No code changes. |
| PATCH_ALLOWED | Prompts 03-05, 07-09 | Write implementation code scoped to the normalization target. Do not modify unrelated framework files. |
| RUN_ONLY | Prompt 06 | Execute parity comparison. Write reports only, not fixes. |
| COORDINATOR | Prompt 10 | Orchestrate template extraction and bootstrap. Delegate implementation to sub-steps. |

## Observational Reporting

All outputs must use observational language:
- **Observation:** — factual description with evidence
- **HYPOTHESIS:** — labeled interpretation (explicitly non-definitive)
- **Open Questions:** — items requiring domain expertise from the framework author

Do not use: Root Cause, Diagnosis, Confidence Level, Recommendation, time estimates, or code snippets in reports.

## Tool Agnosticism

Prompts in this framework must NOT reference specific tools, libraries, or platforms. All tool-specific details are provided through Binding Points declared by the framework author.

Forbidden in prompt text:
- Named tools (Playwright, Selenium, Puppeteer, Notion, Dart, etc.)
- Named file formats specific to a domain (testcase.json, locator_map.json, etc.)
- Named services (WordPress, CRM, WPForms, etc.)

Permitted in prompt text:
- Abstract concepts: "execution environment", "source format", "evidence collector"
- Binding Point references: "the SOURCE_FORMAT declared by the framework author"
- Mythos structural references: manifest.json, guardrails.md, prompt chain

## Binding Point Contract

Every prompt that requires domain-specific knowledge must declare its Binding Points in a table. The framework author supplies concrete values when running the prompt chain. Prompts must operate on bindings abstractly — never assume a binding's concrete value.

## Graduation Path Integrity

Every prompt must include a Graduation Path section (L0-L4). The levels must be:
- Strictly ordered (L0 < L1 < L2 < L3 < L4)
- Independently achievable (reaching L2 on one prompt does not require L2 on another)
- Observable (each level has a concrete indicator, not a subjective judgment)

## File Modification Scope

When in PATCH_ALLOWED mode, changes are scoped to:
- The target framework's directory under `frameworks/`
- Schema files under the target framework's `schemas/` directory
- Runner/compiler code under the target framework's `runner/` or equivalent directory

Do not modify:
- Mythos system files (`instructions/`, `tools/verify/`, `tools/autonomy/`)
- Other frameworks
- Client project data
