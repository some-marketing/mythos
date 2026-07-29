# 04 — Surface Dream Output in Glanceable Location

**Stage:** build
**Mode:** PATCH_ALLOWED
**Risk:** low

## Objective

Surface the top non-obvious dream associations in a glanceable location the operator sees at session start — typically the Tier 0 contextual hint output.

## Process

1. Identify the target output surface:
   - Claude Code: `contextual-inject.cjs` SessionStart hook output
   - Other harnesses: session greeting, MOTD, or status dashboard
   - Fallback: a dedicated dream-inject script that emits to stdout

2. Extend the output surface to read `dream-report.md` and parse the "Most non-obvious" section.

3. Format dream entries clearly:
   ```
   [dream]   concept Foo ⟷ concept Bar — shared: term1, term2, term3
   ```

4. Control volume:
   - Default to top 10 non-obvious pairs
   - Make the count configurable (e.g., `--max-dreams` flag)
   - Never flood the output — dreams are advisory, not load-bearing

5. Test: start a fresh session and verify dream entries appear in the glanceable output alongside other contextual hints.

## Expected Output

- Updated hint/context injection script with dream parsing
- Verified: dream entries appear at session start

## Gates

- Only non-obvious pairs surfaced (not top associations, which are already obvious)
- Max 10 entries by default
- Each entry includes basis (shared rare terms) so the operator can judge relevance
