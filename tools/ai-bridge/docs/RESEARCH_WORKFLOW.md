# Research Workflow Contract

> Status: DEFINED (contract shape only -- dispatch not yet automated)
> Updated: 2026-03-27

## Purpose

Define how research workflows flow through the cross-AI dispatch system.

Research is the first non-Gemini workflow type the dispatch system should handle. This document captures the contract shape so that when a research dispatcher is built (Perplexity, ChatGPT, or API-based), it integrates with the shared foundation rather than repeating Gemini-specific patterns.

## Flow

```
Context Packaging -> Dispatch -> Validation -> Result Routing
```

### 1. Context Packaging

Before dispatch, the orchestrator (Claude Code or a skill) must:
- Read project context (CLAUDE.md, manifest, framework list, existing research)
- Read relevant existing research artifacts in _dev/research/
- Select the appropriate research prompt template
- Inject project context and user's topic into the template
- Add isolation instruction ("do not reference prior conversations")
- Add evidence rules and output format expectations

The dispatch contract represents this as:
```
DispatchRequest {
  provider: 'perplexity' | 'chatgpt-api' | ...,
  workflow_type: 'research',
  context: {
    project_root: string,
    existing_research: string[],
    topic: string,
    depth: 'quick' | 'medium' | 'deep'
  },
  prompt: string,  // The fully-built research prompt
  options: {
    isolation: true,
    export_format: 'markdown',
    ...provider-specific options
  }
}
```

### 2. Dispatch

The dispatcher sends the prompt to the external AI tool and collects the response.

For research workflows, dispatch involves:
- Opening a fresh thread/conversation (isolation)
- Submitting the prompt with correct mode selection (e.g., Deep Research vs Pro Search)
- Waiting for completion (research can take 3-10 minutes)
- Handling mid-research clarification requests (auto-respond or escalate)
- Exporting/capturing the results

### 3. Validation

Research-specific validation checks (in addition to shared validation from validate-dispatch.js):

| Check | Severity | Description |
|---|---|---|
| response_exists | error | Response is non-empty |
| response_parseable | error | Response is structured text |
| has_citations | warning | Response contains inline citation links |
| citation_quality | warning | Citations are URLs, not just "[1]" footnotes |
| has_structured_sections | warning | Response uses markdown sections |
| coverage_check | warning | Key terms from the prompt appear in the response |
| isolation_check | info | Response does not reference prior conversations |
| needs_verification_tags | info | Uncertain claims are tagged NEEDS VERIFICATION |

These checks are not yet implemented as automated validators. When a research dispatcher is built, they should be implemented in a `validators/research-validator.js` module that composes with the shared `validate-dispatch.js` base.

### 4. Result Routing

After validation, research results are routed to:
- Project research directory: `_dev/research/{topic}/`
- Naming convention: `{NN}_results_{conversation|report}.md`
- Process metadata recorded (timestamps, tools used, validation results)
- Results presented to the user for review before packaging

The dispatch contract represents this as:
```
DispatchResult {
  provider: 'perplexity',
  workflow_type: 'research',
  status: 'success' | 'validation_fail' | 'error',
  response: { raw_text, structured_sections, citations },
  validation: { passed, checks: [...] },
  artifacts: ['_dev/research/topic/01_results_report.md'],
  metadata: {
    research_depth: 'deep',
    tool_mode: 'Deep Research',
    elapsed_ms: 420000,
    citation_count: 23,
    ...
  }
}
```

## What Is Deferred

The following are explicitly not implemented yet:

1. **Automated research dispatch**: No dispatcher exists for Perplexity, ChatGPT, or any research-oriented tool. Research prompts are currently executed manually by the operator.

2. **Research-specific validators**: The validation checks described above exist only as a contract. No `research-validator.js` module exists yet.

3. **Research prompt templates**: Template files for research prompts are not yet in the dispatch system. Research prompts are currently authored ad hoc or via `_dev/prompts/` prompt packs.

4. **Depth budget management**: Perplexity Deep Research has a ~5/day limit. Budget tracking and auto-prioritization are not implemented.

5. **Multi-prompt orchestration**: Running a prompt pack (multiple prompts sequentially with rate limiting) is not automated. The operator runs prompts one at a time.

6. **QA batch dispatch**: Sending research results to ChatGPT for QA review is a manual workflow.

7. **Mid-stream evidence injection**: Integrating new evidence sources into an active research workflow is manual.

## How This Connects to the Shared Foundation

The research workflow contract uses the same primitives as the Gemini design workflow:

| Primitive | Design (Gemini) | Research (future) |
|---|---|---|
| DispatchRequest | url, selector, objective | topic, depth, prompt pack |
| DispatchResult | proposed HTML, validation | research report, citations |
| Validation base | validate-dispatch.js | validate-dispatch.js + research validator |
| Provider-specific | validate-response.js (inline styles) | research-validator.js (citations) |
| Dispatcher registry | dispatchers.js -> gemini-browser | dispatchers.js -> perplexity |

The shared dispatch contract, validation base, and registry are already in place. Adding a research dispatcher requires:
1. A new dispatcher module in `dispatchers/`
2. A new validator in `lib/validators/` (or a standalone module)
3. Registration in `lib/dispatchers.js`

No changes to the shared foundation are needed.

## First Research Path (Manual, System-Tracked)

Until automated dispatch is built, the recommended first research path is:

1. **Context packaging**: Claude Code gathers project context and builds a research prompt using existing prompt packs in `_dev/prompts/`
2. **Manual dispatch**: The operator pastes the prompt into Perplexity (fresh window, isolation instruction included)
3. **Manual intake**: The operator downloads results and places them in the project's research directory
4. **System validation**: Claude Code reads the results and applies the shared validation base (response exists, is parseable, has expected structure)
5. **System routing**: Claude Code moves validated results to the correct directory with consistent naming

Steps 1, 4, and 5 are already system-handled. Steps 2 and 3 are the manual gap that a Perplexity dispatcher would close.
