# 07 — End-to-End Verification

**Stage:** verify
**Mode:** RUN_ONLY
**Risk:** low

## Objective

Run full end-to-end verification of the dreaming system integration: confirm the build script works, the dream report is fresh, hints include dreams, the scheduled job is active, and entity persistence is functional.

## Process

1. **Rebuild DB:** Run the build script and measure duration. Confirm exit code 0 and dream report written.

2. **Verify freshness:** Check `dream-report.md` modification time is newer than the verification start time.

3. **Verify hint output:** Run the contextual injection script and confirm `[dream]` entries appear in the output with shared rare terms.

4. **Verify scheduling:** Check the scheduled job is loaded and has valid configuration. Run a manual trigger and confirm logs appear.

5. **Verify entity persistence:** Run the entity writer's smoke test: register → write → read → log. Confirm deterministic roundtrip. Confirm privacy floor rejects PII.

6. **Collect evidence:** Write a `verify-evidence.json` artifact recording pass/fail for each check with timestamps and specific observations.

## Expected Output

- `reports/dreaming-system/archive/<integration-name>/verify-evidence.json` — structured verification results

## Gates

- Dream report must be newer than verification start
- Hint output must include at least 1 dream entry
- Entity state write/read must be deterministic
- All 5 checks must pass
