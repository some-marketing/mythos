---
name: store-credential
description: Securely store a secret (API key, OAuth token, DB password) in macOS Keychain without the value passing through shell history, conversation logs, or tool-call arguments. Activates when the operator says "store an API key," "store a secret," "store a credential," "put this key in the keychain," or names a new external service whose credentials have not yet been stored. Wraps the existing tools/boot/keychain-store.sh script. Emits retrieval and verify-presence one-liners for runner scripts. Designed for forward migration to 1Password CLI (`op`) when that becomes available; swapping the retrieval command has no effect on runner code.
status: provisional
graduation_criteria: Promote to stable after 3+ successful invocations across 2+ distinct service types (e.g., one LLM API key, one OAuth token, one DB password), with no operator-observed friction during invocation or retrieval. Do not graduate on lower evidence. Reason the threshold is this specific: the underlying script and Terminal-window pattern had exactly one successful run when this skill was authored, which does not satisfy the LEARNING_AND_AUTOMATION_DOCTRINE §Promotion Rule ("succeeds repeatedly AND the system can explain why it considers that success trustworthy"). Three invocations across at least two service types provides the repeat-success evidence; the specific-reason framing ensures a future editor removing probationary status must first evaluate whether the reason still applies.
---

<role>
You securely store a secret in macOS Keychain on the operator's behalf, without the secret value ever touching shell history, tool-call arguments, conversation logs, or any surface other than the operator's eyes and the Keychain itself.

This skill exists because credentials need to be retrievable by runners (bridge scripts, API probes, MCP servers) but must NOT be readable in normal operation logs, prompt history, or shared session transcripts. macOS Keychain provides that property. The `security` CLI retrieves credentials at runtime on demand. The gap this skill fills is the invocation pattern: how to get a secret FROM the operator INTO Keychain without putting it through any surface that logs input.

The skill delegates the sensitive step (value entry) to a silenced Terminal prompt (`read -s`) in a window the operator controls directly. The main thread — this skill — never sees the value. Verification happens by length-comparison, not by reading the value back. Failure diagnostics from the Keychain are surfaced so the operator can diagnose access-control or keychain-name issues without exposing the secret.

The operator is required to be physically present at the Terminal window during storage. This is structural, not a limitation. The secret's safety depends on the operator's hands being on the keyboard, not on any process trusted to handle the value.
</role>

<process>

## Arguments

- **service** (required): kebab-case identifier for the credential's purpose, e.g., `inception-api-key`, `openrouter-api-key`, `github-oauth-token`
- **account** (optional, default: `Mythos`): logical account or project the credential belongs to. Use a different account when storing credentials for a different client/project to keep them distinguishable in Keychain.

## Invocation

Run the store flow:

```bash
osascript -e 'tell application "Terminal"
    activate
    do script "${MYTHOS_HOME}/tools/boot/keychain-store.sh <service> <account>"
end tell'
```

A new Terminal window opens. The operator sees:

1. A banner with the service and account names
2. A `Secret:` prompt (input silenced — characters do not echo)
3. Operator pastes the secret, presses Enter
4. Script stores via `security add-generic-password -U`, captures stderr of the verification read to a temp file, reads back the value length, length-compares to input length
5. On success: temp file discarded; operator sees "Stored successfully. Length verified: N characters." plus retrieval one-liners
6. On failure: behavior differs by which step failed:
   - **Storage step** (initial `security add-generic-password` call): failures surface through Terminal's native stderr. The script does not capture stderr from the storage call because `security` needs to be able to prompt for Keychain unlock interactively.
   - **Verification step** (subsequent length-check read): the captured `security` diagnostic is surfaced (sed-indented for readability); temp file is discarded; operator can diagnose why Keychain access failed (access-control, keychain-name mismatch, etc.)

## Emit retrieval one-liner

After storage succeeds, emit this exact pattern for runners to use:

```bash
SERVICE_API_KEY="$(security find-generic-password -a <account> -s <service> -w)"
```

The runner reads `process.env.SERVICE_API_KEY` or equivalent. The key is fetched from Keychain at process start, lives in that process's memory only, and is never written to disk.

## Emit verify-presence one-liner (named check-in path)

For confirming a credential is still present without printing its value:

```bash
security find-generic-password -a <account> -s <service> -w | wc -c
```

Returns the byte count (including trailing newline — subtract 1 if comparing to exact length). Non-zero and matching expected length implies the credential is present and retrievable. Zero or length mismatch implies the credential is missing, access-denied, or corrupted.

This is the skill's discoverable check-in verb: operators can confirm a credential is still stored without needing to retrieve its value.

## Fallback when osascript Terminal invocation fails

On systems with restricted AppleScript execution (enterprise-managed machines, certain security policies), `osascript` may fail silently or return an error. In that case, the operator runs the script directly in an existing shell:

```bash
bash ${MYTHOS_HOME}/tools/boot/keychain-store.sh <service> <account>
```

The script behaves identically. The only difference is that the operator is in their existing Terminal rather than a freshly-opened one. Safety properties are unchanged.

## Migration to 1Password CLI (forward compatibility)

When `op` CLI becomes available, storage migrates to 1Password (canonical secret store for this operator's setup). The retrieval pattern swaps:

```bash
# Keychain era (now):
SERVICE_API_KEY="$(security find-generic-password -a <account> -s <service> -w)"

# 1Password era (future):
SERVICE_API_KEY="$(op read 'op://<vault>/<item>/credential')"
```

Runner code is unchanged — it always reads `process.env.SERVICE_API_KEY`. Only the env-var source swaps. Migration is per-credential and reversible.

</process>

<safety_contract>

**NEVER, under any circumstance:**

- Print the secret value to stdout, stderr, or the conversation surface
- Pass the secret value through tool-call arguments
- Write the secret value to any file the skill controls
- Store the secret in a plaintext `.env` file when keychain storage is available
- Use `security find-generic-password ... -w` anywhere the output is captured by Claude's tool-call surface (the `-w` flag prints the secret; that's intentional for runner consumption but harmful for conversation-level observability)

**ALWAYS:**

- Verify storage by length-comparison (not by reading the value back into conversation)
- Use `osascript` (or fallback `bash` invocation) to delegate value entry to a Terminal the operator controls
- Discard temp files containing stderr diagnostics immediately after the error branch surfaces them
- Include the verify-presence one-liner in success output so future check-in is discoverable

The secret's safety posture depends on these boundaries being maintained. The skill's failure mode if these boundaries slip is silent credential leakage.

</safety_contract>

<anti_patterns>

**Do not paste the key into chat.** Even if the operator offers, redirect to the Terminal-window flow. Conversation surfaces log input.

**Do not bypass the Terminal window to save time.** The script's `read -s` prompt is the only path where the secret value is entered without echoing. Any shortcut that bypasses this is a safety regression.

**Do not use `security find-generic-password -w` in Claude's tool calls.** The `-w` flag prints the secret. It's safe in a runner process because runner stdout is not Claude's context; it's unsafe when used by Claude's own Bash tool because the captured output becomes conversation context.

**The verify-presence one-liner also uses `-w`.** `security find-generic-password -a <account> -s <service> -w | wc -c` still retrieves the secret internally — the `wc -c` trims to a byte count, but the secret exists momentarily in the pipe buffer. Claude must not execute this pattern directly via Bash tool — emit it for the operator to run in their Terminal, or run it in a runner process whose stdout is not Claude's context. If Claude needs programmatic confirmation of credential presence from its own context, invoke the runner (whose stdout is filtered) rather than reading stdout directly.

**"Chat" in the "do not paste into chat" rule means any non-Terminal input surface.** Claude's conversation, iMessage, email, Slack, Discord, voice. If the input surface logs, buffers, forwards, or is subject to replay, it is not safe for secrets. Terminal with `read -s` is the only input surface this skill trusts.

**Do not remove the probationary status section.** The probationary status names its specific reason (one-time success + LEARNING_AND_AUTOMATION_DOCTRINE §Promotion Rule). A future editor removing probationary status must first evaluate whether that reason still applies (3+ invocations across 2+ service types, no friction). Removing the reason-reference alongside the status strips the evidence trail.

**Do not store operator's personal credentials in a shared-account keychain item.** Use `Mythos` account only for project-scoped credentials. Personal credentials should use a distinct account (e.g., `personal`) to keep authorization boundaries clean.

</anti_patterns>

<success_criteria>

- Terminal window opened (via osascript or direct bash invocation)
- Operator pasted the secret into the silenced prompt (secret never visible to Claude)
- Script reported "Stored successfully. Length verified: N characters."
- Retrieval one-liner was emitted for the specific service/account
- Verify-presence one-liner was emitted alongside
- Temp file containing stderr diagnostics was discarded (success path) or surfaced and discarded (failure path)
- No secret value appeared in Claude's conversation, tool-call arguments, or tracked files
- Operator can independently verify storage via the verify-presence one-liner

</success_criteria>

<notes_for_future_operator>

## How to tune this skill

- **The osascript invocation path is brittle on restricted systems.** If failures are frequent, consider rewriting the skill to prefer direct bash invocation and only use osascript when explicitly requested. The current default (osascript first) optimizes for the common case of an unrestricted workstation.

- **The `Mythos` default account is a convenience, not a contract.** If the system accumulates credentials for many distinct projects, split accounts per project rather than cramming everything into `Mythos`. The `security` CLI supports arbitrary account strings.

- **Length-verification has a known weakness.** Two secrets of equal length will not be distinguishable by length-check alone. This is acceptable because the operator typed the secret themselves — we're verifying that storage didn't corrupt or truncate, not that the stored value matches some independent source of truth. If a use case emerges where cryptographic verification of stored value is required, introduce a hash comparison using a temp-file-only pipeline (never passing the hash through Claude's tool calls).

## Graduation rule

**Current status: provisional.** Promotion to `established` requires:

1. At least 3 successful invocations of this skill (not the underlying script alone — the skill path, via this SKILL.md's activation)
2. Coverage of at least 2 distinct service types (e.g., one LLM API key + one OAuth token + one DB password, or similar spread)
3. No operator-observed friction during any of the 3 invocations — "friction" means: operator had to work around a script failure, operator's patience was tested by UX defects, or operator had to explain the skill to itself mid-flow
4. Evidence trail: each invocation recorded at `_dev/reports/analysis/skill-invocations/store-credential/<YYYY-MM-DD>-<service-name>.md` with minimum schema: service, account, outcome, friction-notes, operator-name-if-not-canonical. This canonical evidence location makes promotion auditable — a future editor can list the directory and count invocations without searching across session history.

The threshold is this specific because the underlying pattern had exactly one successful run at authoring time. That's below LEARNING_AND_AUTOMATION_DOCTRINE's "succeeds repeatedly" bar. The probationary status protects the skill from being promoted on vibes.

## Constitutional-surface constraints

- This skill does NOT optimize against its own feedback. It does not train on success/failure telemetry to auto-improve its invocation pattern. Any revision of this skill's process section must be explicit operator action.
- This skill is NOT eligible for auto-activation in automated workflows that don't have operator presence. The Terminal-window-paste step requires human hands on keyboard. If a workflow needs credential storage without operator presence, that workflow must use a different mechanism (CI secrets, sealed vault, etc.), not this skill.

## Migration path reminders

When `op` CLI is installed and 1Password is the canonical store:

1. Store each credential via `op item create` using the canonical 1Password UX (not via this skill)
2. Update runners to read from `op://<vault>/<item>/credential` via `op read` or `op run --env-file=.env.op`
3. Remove the corresponding Keychain entry via `security delete-generic-password -a <account> -s <service>` to avoid duplication
4. Deprecate this skill once all active credentials have migrated — at that point, a `store-credential-1password` skill replaces this one, and this SKILL.md moves to a deprecated reference

</notes_for_future_operator>
