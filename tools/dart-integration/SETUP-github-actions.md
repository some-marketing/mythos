# Dart Landing Pad Sorter — GitHub Actions Setup

If you run a scheduled workflow (e.g. a `dart-landing-pad-sort.yml`) that calls
`tools/dart-integration/lib/dart-api.js` on `ubuntu-latest`, it needs a Dart
REST API token available to the runner — `dart-api.js` resolves `DART_TOKEN`
through `tools/lib/resolve-credential.cjs`'s 4-source chain (env → macOS
Keychain → 1Password → env-file), but GitHub-hosted Linux runners have no
`security` binary and (usually) no `op` session, so the environment-variable
source is the one that actually resolves in CI.

If "All jobs have failed" with an annotation like:

```
/bin/sh: 1: security: not found
ERROR: DART_TOKEN not resolvable in this context — tried env (DART_TOKEN), macOS Keychain, ...
```

…the cause is the repo secret carrying your Dart token being unset or empty.

## Fix: set a `DART_TOKEN` repo secret

### Step 1 — get a Dart API token

1. Sign into [Dart](https://app.dartai.com) as the Dart user you want this
   workflow to act as. If you've enabled the optional write-identity gate
   (`DART_EXPECTED_USER_NAME` / `DART_EXPECTED_USER_EMAIL` — see SETUP.md),
   the token must belong to that exact user, or `lib/identity.js` will refuse
   writes.
2. Profile → API → generate a new token.
3. Copy the token. Don't paste it into chat or commit it.

### Step 2 — add it as a repository Actions secret

UI path:

1. Open `https://github.com/<your-org>/<your-repo>/settings/secrets/actions`
2. If a `DART_TOKEN` secret already exists → **Update**. Otherwise → **New repository secret**.
3. Name: `DART_TOKEN` (exact, case-sensitive — must match `${{ secrets.DART_TOKEN }}` in the workflow file).
4. Secret: paste the token from Step 1. No quotes, no leading/trailing whitespace.
5. **Add secret**.

Constraints:

- Must be a **Repository secret**, not an **Environment secret**, unless your workflow declares a matching `environment:`.
- Must be a **Secret**, not a **Variable**. Variables aren't masked in logs.
- Must be set at the repo level, not the org level (unless the org secret is explicitly granted to this repo).

CLI alternative (if `gh` is installed locally):

```sh
gh secret set DART_TOKEN --repo <your-org>/<your-repo> --body 'PASTE_TOKEN_HERE'
```

Or read from a file you control:

```sh
gh secret set DART_TOKEN --repo <your-org>/<your-repo> < /path/to/token.txt
```

Wire it into the job's `env:` block explicitly:

```yaml
- run: node tools/dart-integration/landing-pad-poller.js --apply
  env:
    DART_TOKEN: ${{ secrets.DART_TOKEN }}
```

### Step 3 — trigger a run to confirm

Don't wait for the next scheduled cron — trigger manually:

- UI: Actions → your workflow → **Run workflow** → pick your branch → **Run workflow**.
- CLI: `gh workflow run <workflow-file>.yml --repo <your-org>/<your-repo>`

## Reading the result

| Step output | Meaning | Fix |
|---|---|---|
| Job green | Token resolved and Dart accepted it. | — |
| `security: not found` + `DART_TOKEN not resolvable...` | Secret is still unset/empty, or the workflow's `env:` block doesn't pass it through as `DART_TOKEN`. | Re-check Step 2 — verify the secret name and the workflow's `env:` mapping. |
| `Dart API auth error (401)` | Token is set but invalid or revoked. | Generate a new token in Dart (Step 1) and update the secret (Step 2). |
| `Refusing Dart write. Dart API identity mismatch: expected ..., got <other user>` | The optional write-identity gate is enabled and the token belongs to the wrong Dart user. | Either sign into Dart as the expected user and regenerate the token, or unset `DART_EXPECTED_USER_NAME`/`DART_EXPECTED_USER_EMAIL` if you don't need the gate. |

## Optional follow-up: better failure message

`dart-api.js`'s `getToken()`/`resolveToken()` already reports which of the
four sources it tried and misses cleanly on non-macOS runners (the Keychain
source is a soft-miss, not a hard failure) — see `tools/lib/resolve-credential.cjs`
for the shared implementation. If you want CI-specific diagnostics beyond
that (e.g. detecting an empty-but-set `DART_TOKEN` and naming your specific
secret in the message), that's a small wrapper around `resolveToken()` at the
call site — not required to fix the base failure above.

## Reference

- Workflow: your own `.github/workflows/*.yml` calling into this tool
- Token loader: `tools/dart-integration/lib/dart-api.js` (`getToken`, `resolveToken`)
- Shared resolver: `tools/lib/resolve-credential.cjs`
- Identity check (optional): `tools/dart-integration/lib/identity.js` (`verifyDartIdentity`)
- Sorter entry point: `tools/dart-integration/landing-pad-poller.js`
