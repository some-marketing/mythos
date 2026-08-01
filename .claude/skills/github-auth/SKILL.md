---
name: github-auth
description: Resolve a GitHub Personal Access Token from the four sources the Mythos repo supports (env var, repo-local .env.local, macOS Keychain, 1Password). Activates when a Claude/Codex/Cowork session needs to call the GitHub REST API or run a `gh`-equivalent operation (fetch workflow logs, list runs, dispatch events, query issues) and the token is not already available. Mirrors the multi-source resolver pattern in `tools/dart-integration/lib/dart-api.js`. Runs without operator interruption once the token has been seeded.
status: provisional
graduation_criteria: Promote to stable after 3+ successful invocations across 2+ distinct contexts (e.g., one Cowork sandbox session + one local Mac shell + one CI workflow), with each invocation recorded under `_dev/reports/analysis/skill-invocations/github-auth/<YYYY-MM-DD>-<context>.md`. Reason: the resolver's source-priority order has not yet been exercised under all four source paths in production. Probationary status protects against premature promotion before the env-file path (the new sandbox-friendly path) has accumulated repeat-success evidence.
---

<role>
You resolve a GitHub Personal Access Token on behalf of the calling agent without exposing the token's value to conversation surfaces, tool-call arguments, or files outside the repo's already-protected paths.

This skill exists because the Cowork Linux sandbox cannot run `op` or `security`, and `~/.config/gh/hosts.yml` is not mounted into the sandbox. A resolver that only knows about Keychain or only knows about 1Password therefore cannot serve future Cowork sessions. The resolver in `tools/auth/github-token.js` checks four sources in priority order and returns the first one that resolves to a usable token — which means the same module works on the operator's Mac shell, the Cowork Linux sandbox, and a GitHub Actions runner without any per-context branching by the caller.
</role>

<process>

## Source priority

The resolver checks these in order and returns the first hit:

1. `process.env.GH_TOKEN` (or `GITHUB_TOKEN` as an alias)
   — primary path for CI runners and any shell that has explicitly exported the token.
2. `.env.local` (or `.env`) at the repo root, parsed for `GH_TOKEN=` / `GITHUB_TOKEN=`
   — primary path for the Cowork Linux sandbox. The file is gitignored via the existing `.env.*` rule.
3. macOS Keychain `service=GH_TOKEN, account=smos` (Mac only)
   — mirrors the `DART_TOKEN` convention from `tools/dart-integration/lib/dart-api.js`.
4. 1Password CLI `op read` of `${SMOS_GITHUB_TOKEN_OP_REF:-op://{VAULT}/Mythos GitHub PAT/credential}` (Mac only, `op` signed in)
   — mirrors the `op://{VAULT}/the_kernel/password` convention from `tools/kernel/`.

A caller that wants the resolver to pick a specific source can override env, platform, or `runSecurity`/`runOp` via `resolveToken(options)`.

## Calling from agent code

```js
const { request, resolveToken, probeAuthState } = require('./tools/auth/github-token');

// 1. Probe + diagnose, no API call:
const resolved = resolveToken();
console.log(`token from ${resolved.source}, length ${resolved.token.length}`);

// 2. Use the built-in REST client:
const run = await request('GET', '/repos/some-marketing/Mythos/actions/runs?status=failure&per_page=5');

// 3. Probe auth state (calls GET /user, returns ok/state/login):
const probe = await probeAuthState();
```

## Calling from a shell

```bash
# Print source and length only (does not print the token):
node tools/auth/github-token.js

# Additionally call GET /user to confirm the token is live:
node tools/auth/github-token.js --probe
```

## Seeding the token (one-time per workstation)

If the operator already has a fleet PAT in 1Password, materialize it into `.env.local` once:

```bash
bash tools/auth/seed-github-token.command
```

The script verifies `op whoami`, reads the configured ref, writes the token to `${REPO_ROOT}/.env.local` with mode 600, and prints the resolver's source line so the operator can confirm the file is now picked up. The `.env.local` file is gitignored.

If the operator prefers Keychain (no 1Password), use the `store-credential` skill with `service=GH_TOKEN, account=smos`. The resolver will pick it up via source 3 on Mac shells. The Cowork sandbox still requires `.env.local`, so on Mac the operator can run the seed script with `--from keychain` to copy the Keychain value into `.env.local`.

## Cowork sandbox network allowlist

Even with a valid token, the Cowork Linux sandbox cannot reach `api.github.com` unless it has been added to the sandbox's egress allowlist (Settings → Capabilities, or via workspace admin on Team/Enterprise). The resolver itself works without this — but `request()` calls will fail with a proxy 403 until the allowlist is updated. This is a separate one-time setup step the operator does once per workspace.

## Token rotation

When rotating the PAT:
1. Update the value in 1Password (or Keychain) — same item/service name.
2. Re-run `bash tools/auth/seed-github-token.command` to refresh `.env.local`.
3. Long-running shells may be holding the previous value in `_cachedToken`; restart Node processes that imported the module, or call `clearCache()` on the module export.

</process>

<safety_contract>

**NEVER:**
- Print the token's value to stdout, stderr, or the conversation surface. The self-test prints the source, length, and first 4 chars (the `ghp_`/`github_pat_` prefix) only.
- Pass the token through tool-call arguments. Resolver output goes only into `Authorization: Bearer ...` headers via `https.request`, never via the Bash tool's command surface.
- Write the token to any path other than `.env.local`/`.env` at the repo root (gitignored) or the macOS Keychain.
- Commit `.env.local` or `.env`. The repo's `.gitignore` already excludes these via `.env.*`, but a misconfigured editor or `git add -f` could bypass that — refuse such requests.

**ALWAYS:**
- Use `looksLikeGithubToken()` to sanity-check values pulled from `op read` before caching them. A wrong field name in the 1Password item should raise `GH_TOKEN_OP_VALUE_SUSPICIOUS`, not silently cache a non-token string.
- Surface error codes (`GH_TOKEN_MISSING`, `GH_TOKEN_INVALID`, `GH_TOKEN_OP_NOT_SIGNED_IN`, etc.) so callers can route to the right repair action.
- Distinguish "verified absent" from "unreadable from this runtime context" — same convention as the Dart resolver. A failed read in the sandbox does not prove the Keychain item is missing on the Mac.

</safety_contract>

<anti_patterns>

**Do not paste the token into chat to "let Claude store it."** Use the seed script or the `store-credential` skill. The token's safety depends on it never crossing a logging surface.

**Do not write a token to `.env` (without `.local`) and commit-by-accident.** The `.gitignore` covers both, but `.env.local` is the conventional name for machine-local overrides and is harder to confuse with `.env.example`.

**Do not call `op read` from a runtime path that captures the resolver's stdout into Claude's tool-call surface.** The resolver itself is fine — it reads `op` output internally and only exposes the token via `https.request` headers — but a shell wrapper that does `node -e 'console.log(require(...).getToken())'` over the Bash tool would leak the value to conversation context. If you need to confirm presence from Claude's tool surface, call `node tools/auth/github-token.js` (which prints source/length only) or `--probe`.

**Do not let the resolver's memory cache outlive a token rotation.** A long-running Node process that imported the module before rotation will keep returning the stale token. The fix is `clearCache()` or process restart, not a sleep.

</anti_patterns>

<success_criteria>

- `node tools/auth/github-token.js` prints a `source:` line and a non-zero `length:`.
- `node tools/auth/github-token.js --probe` returns `"ok": true, "state": "valid", "login": "<github-username>"`.
- The Cowork Linux sandbox resolves the token via `env-file:GH_TOKEN` (because `.env.local` is in the repo mount).
- The macOS shell resolves via the highest-priority source the operator has configured (env > env-file > Keychain > 1Password).
- The CI runner resolves via `environment:GITHUB_TOKEN` without touching env-files, Keychain, or 1Password.
- Token value never appears in conversation logs, tool-call arguments, or any tracked file.

</success_criteria>

<notes_for_future_operator>

## How this generalizes

The pattern in `tools/auth/github-token.js` is the canonical multi-source credential resolver for the Mythos repo. New external APIs the project picks up (Linear, Notion, Atlassian, Stripe, etc.) should follow the same shape:

- Module at `tools/auth/<service>-token.js` (or co-located in the integration's lib/ if it has its own dir, like `tools/dart-integration/lib/dart-api.js`)
- Source priority: env var → repo-local env-file → macOS Keychain → 1Password ref
- A typed credential error class with codes that distinguish "missing" from "unreadable from this runtime context"
- A `probeAuthState()` that returns ok/state/source for the boot-time `verify-credentials.cjs` to consume

The graduation rule names env-file as the new path that needs repeat-success evidence — that's the path that unlocks future Cowork sessions, and it has not yet been used in production.

## What the operator does once

1. Generate a fleet GitHub PAT (recommended scopes: `repo`, `workflow`, `read:org`).
2. Store it in 1Password as a Login or API Credential item titled exactly `Mythos GitHub PAT`, vault `Personal`, with the token value in the field named `credential`. (Alternative: store in Keychain via `store-credential` with `service=GH_TOKEN, account=smos`. The resolver finds either.)
3. Run `bash tools/auth/seed-github-token.command` once. This reads from 1Password / Keychain and writes `.env.local` so Cowork sessions can read the token from the repo mount.
4. (One-time, separate concern) Add `api.github.com` to the Cowork sandbox's network allowlist via Settings → Capabilities so the sandbox can actually reach the API.

## Why not just rely on `gh auth login`

`gh` is not installed in the Cowork Linux sandbox, and `~/.config/gh/hosts.yml` is not mounted into the sandbox. A `gh auth login` flow on the user's Mac authenticates the Mac shell only; the sandbox still has no token. The resolver intentionally does not depend on the `gh` CLI for this reason.

</notes_for_future_operator>
