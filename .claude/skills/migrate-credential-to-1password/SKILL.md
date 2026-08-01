---
name: migrate-credential-to-1password
description: Migrate a credential already stored in macOS Keychain or the macOS Passwords app into 1Password, without the password bytes passing through the LLM, shell history, or tool-call arguments. Activates when the operator says "port the X login to 1password," "move this password to 1password," or "migrate Y credentials," AND the credential already exists in macOS Keychain / Passwords. Companion to [[store-credential]] (which handles fresh secrets-in) and [[github-auth]] (which resolves stored secrets at runtime). Designed for the case where the source is a system password store, not the operator's hands.
status: provisional
graduation_criteria: Promote to stable after 3+ successful migrations across 2+ distinct credential shapes (e.g., web login + API key, or web login + Wi-Fi password). Reason: the boundary-preservation pattern (LLM reads metadata only; operator pastes secret) is the load-bearing claim; 3 runs across 2 shapes proves the pattern survives credential variation, not just one happy path.
---

<role>
You migrate a named credential from macOS Keychain or the macOS Passwords app into 1Password. The password bytes never transit you, your tool calls, the conversation log, or any shell argument list. You handle only non-secret metadata (service name, URL, username). The operator handles the secret-paste step directly in their own UI.

This skill exists because credential reuse is high-friction without a vault, but bulk-exporting Keychain dumps every secret to disk. The middle path: identify one credential at a time, pre-fill 1Password's new-item form with everything non-secret, and let the operator complete the one field that must stay invisible.
</role>

<process>

## Arguments

- **service** (required): name to search for, e.g. `nanoleaf`, `browserstack`. Used as the Keychain `-s` / `-l` value AND the 1Password item title.
- **url** (optional): login URL to pre-fill. If omitted and the credential is an internet password, derive from Keychain server field.

## Steps

### 1. Metadata-only lookup

Try both keychain item types. NEVER pass `-w` — that flag prints the password to stdout, violating the boundary.

```bash
security find-internet-password -s <service> 2>&1 | grep -E '"(acct|srvr|svce|desc)"'
security find-generic-password   -l <service> 2>&1 | grep -E '"(acct|svce|desc)"'
```

Extract: account (`acct`), server (`srvr`), service label (`svce`).

If both return nothing, the credential is likely in the **macOS Passwords app** (Sequoia+), which is not exposed via `security` CLI. Fall through to step 2b.

### 2. Create item via `op` CLI (preferred — no browser)

Verify `op` is signed in: `op account list` should return a row. If not, operator runs `eval $(op signin)` themselves.

Build the create command with metadata only — the password field is left for operator to paste interactively:

```bash
op item create \
  --category=login \
  --title="<Service>" \
  --url="<url>" \
  username="<acct>" \
  password="$(read -s p && echo "$p")"
```

The `$(read -s p && echo "$p")` subshell prompts the operator for the password with input silenced. The bytes never appear in shell history, tool-call arguments, or LLM context. Operator types/pastes, presses Enter, and `op` receives the value via stdout-of-subshell.

If operator prefers GUI: open `https://my.1password.com`, navigate to New Item → Login, pre-fill non-secret fields via `form_input`, stop at password.

### 3. Verify

```bash
op item list --categories Login | grep -i "<service>"
```

Confirms presence without reading the password back. Operator confirmation is the success signal.

## Boundary rules — never relax

- Never call `security find-*-password -w` (dumps password to stdout).
- Never request the password value in chat. The operator pastes it directly into the 1Password field.
- Never type into a password field via browser automation. Title/URL/username only.
- Never store the secret in a temp file, clipboard automation, or log.

</process>

<failure_modes>

- **Classifier blocks `security find-*-password`**: ask operator to add `Bash(security find-internet-password:*)` and `Bash(security find-generic-password:*)` to project `.claude/settings.json` allow list. Reason: metadata reads are safe; the `-w` flag is what's dangerous, and the skill forbids it.
- **Passwords app entry not in Keychain**: macOS Sequoia's Passwords app uses a separate encrypted store. Fall back to step 2b (operator reads metadata aloud).
- **Multiple matches for `-s nanoleaf`**: `security` returns the first match. If wrong, operator should disambiguate via the Passwords app UI and provide the exact account.

</failure_modes>
