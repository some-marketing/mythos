# owl-dispatch — tool-use + single-family-routing enforcement for subagent dispatch

Enforces a subagent-dispatch operating contract mechanically (no inference
cost after build): subagents must use existing tools, build reusable ones,
route within a single declared model family unless the operator says
otherwise, and declare tool provenance on return.

This was ported as a **working file** — it is genuinely self-contained
(only `fs`, `path`, and `child_process.execSync`, all Node builtins) and had
no dependency on any private session/signals machinery.

## The five enforcement layers (this tool covers 2, 3; the coordinator holds 1, 4, 5)

1. **Capability restriction** — set each subagent's tool allowlist by tier (coordinator, at dispatch).
2. **Tool-manifest injection** — `owl-dispatch build` greps `tools/` for tools matching the task and
   injects "you MUST use these, not reimplement" + the standing rules. ← this tool
3. **Return-provenance contract** — the built prompt requires a `TOOLS_USED:` block; `owl-dispatch check`
   validates it and exits nonzero if missing. ← this tool
4. **Reviewer bounce** — the coordinator runs `check` on every return and bounces
   no-provenance / hand-rolled-duplicate work.
5. **Ratchet** — a mechanical action done by hand twice must become a tool before the work is accepted.

## Usage

```
node tools/owl-dispatch/owl-dispatch.js build --task "<task>" [--tier <label>]
    -> prints the wrapped dispatch prompt (paste into your Agent tool's prompt)
node tools/owl-dispatch/owl-dispatch.js check --return-file <path>   # or --text "<...>"
    -> {ok, tools_used|reason}; exit 0 if provenance present, 1 if not
```

## Standing rules injected

Single-model-family routing · tools-first (grep before you build) · build-to-keep (reusable tool + test) ·
provenance-required · OWL (Observe→Weigh→Loop, tier to cheapest accountable mind).

## v1 notes / refinement path

- The tool-scan matches on task keywords; common words (runtime/validate) over-match. v2: rank by
  relevance / restrict to a tool-index. Erring toward showing MORE existing tools is the correct v1
  bias (anti-reinvention).
- Future: a PreToolUse hook that auto-runs `check` on subagent returns, and a tool-index generator so
  the scan is O(1) against a manifest instead of a live find/grep.
