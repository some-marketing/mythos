# 03 — Wire Into Session Lifecycle Hooks

**Stage:** build
**Mode:** PATCH_ALLOWED
**Risk:** low

## Objective

Wire the dream rebuild script into the session startup hooks so every session begins with fresh associative context.

## Process

1. Identify the session boot hook surface in the target system:
   - Claude Code: `.claude/settings.json` → `hooks.SessionStart`
   - Other harnesses: session-start or boot command configuration
   - Fallback: a shell alias or wrapper script that runs before session start

2. Determine the correct ordering: the dream rebuild must run BEFORE any contextual hint injection, so the fresh dream report is available when hints are emitted.

3. Add the build script to the hook configuration:
   ```json
   {
     "type": "command",
     "command": "node \"${PROJECT_DIR}/tools/memory/build-memory-db.js\"",
     "timeout": 10
   }
   ```

4. Configure the hook to be advisory-only:
   - The build script must not block session boot on failure
   - Use a timeout (10s recommended) that's well above expected rebuild time
   - If the script fails, emit a diagnostic line but continue

5. Test by starting a fresh session and confirming the dream report is rebuilt before any other output.

## Expected Output

- Updated session boot hook configuration with dream rebuild entry
- Verified ordering: rebuild → hint injection

## Gates

- Dream rebuild must not block session boot on failure
- Rebuild must complete in < 5 seconds for typical corpus sizes
- Hook ordering must place rebuild before any hint/context injection
