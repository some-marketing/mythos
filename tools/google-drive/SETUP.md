# tools/google-drive -- Drive sharing, organizing, and doc creation

Dependency-free Google Drive helper (raw HTTPS). Adds capabilities a
connected Drive MCP often lacks: setting sharing permissions, renaming/moving
files, replacing a file's content in place, resumable upload of large local
files, and turning a Markdown file into a native Google Doc.

## Credentials

This tool resolves its own credentials (`GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`) at runtime through
`tools/lib/resolve-credential.cjs` -- a 4-source chain, first hit wins:

1. **Environment variable** -- set it in your shell or CI config.
2. **macOS Keychain** -- seed it once, headless-friendly forever after:
   ```
   tools/boot/keychain-store.sh mythos-google-drive client-id
   tools/boot/keychain-store.sh mythos-google-drive client-secret
   tools/boot/keychain-store.sh mythos-google-drive refresh-token
   ```
3. **1Password** -- `op read op://<VAULT>/<ITEM>/<FIELD>`, resolved via a
   service-account token (`OP_SERVICE_ACCOUNT_TOKEN` env var, or a Keychain
   item named `mythos-1p-automation-token`/`mythos`). The vault/item this
   tool targets default to `Automation` / `Mythos Google Drive`; override
   both with the `GDRIVE_OP_VAULT` / `GDRIVE_OP_ITEM` env vars without
   editing any file.
4. **Env file fallback** -- `.env.local` or `.env` at the repo root, or
   `~/.mythos/.env`. See `env.example` in this directory for the exact keys.

See `creds.config.json` in this directory for the authoritative field list.
Regenerate `env.example` if that file changes:

```
node ../lib/generate-env-example.cjs creds.config.json
```

### An additional local fast path (this tool's own, not part of the shared contract)

On top of the shared 4-source chain, `config.js` checks a gitignored local
cache file, `.oauth-creds.json`, FIRST -- before the shared resolver runs at
all. This is a convenience this tool adds for itself (mints once via
`authorize.js`, then never shells out to Keychain/`op` again during normal
use); it is not part of `tools/lib/resolve-credential.cjs`'s contract and no
other tool needs to replicate it.

Named profiles keep account credentials isolated. A profile such as
`somemarketing` resolves profile-specific environment variables, Keychain
service, 1Password item, and local fallback file. It never writes the default
profile:

- Environment prefix: `GDRIVE_PROFILE_SOMEMARKETING_*`
- Keychain service: `mythos-google-drive-somemarketing`
- 1Password item: `Mythos Google Drive (somemarketing)`
- Local fallback: `.oauth-creds.somemarketing.json`

## One-time setup (operator)

1. **Google Cloud Console** (signed in as the Google account this automation
   should act as):
   - Select/create a project; **APIs & Services -> Library -> enable Google
     Drive API**.
   - **OAuth consent screen**: Workspace domain -> **Internal** (no
     verification / test users), or **External** + add yourself as a test
     user for a personal account.
   - **Credentials -> Create OAuth client ID -> application type Desktop
     app.** Desktop clients handle the `localhost:4173` loopback
     automatically.
   - Copy the **Client ID** and **Client secret**.
2. **Authorize once** (mints a long-lived refresh token):
   ```bash
   GOOGLE_OAUTH_CLIENT_ID=<id> GOOGLE_OAUTH_CLIENT_SECRET=<secret> \
     node authorize.js
   ```
   A browser opens; sign in as the target account and approve the Drive
   scope. On success the refresh token is written straight into 1Password
   (`saveToOnePassword`) if `op` is available, or into the gitignored
   `.oauth-creds.json` otherwise -- either way it is durable and never
   printed to the console.

   For a named account/profile, use the downloaded OAuth client JSON directly:
   ```bash
   node authorize.js --profile somemarketing \
     --client-json /path/to/downloaded-oauth-client.json
   ```
   The named flow prefers the profile-specific 1Password item and falls back
   only to its profile-specific gitignored file; it does not overwrite
   `.oauth-creds.json` or the default `Mythos Google Drive` item. Run
   `node authorize.js --help` to inspect options without resolving any
   credentials.

**Reusing an existing OAuth client:** because the resolver is multi-source,
you can authorize with any Google OAuth client you already have (same
Google account/project) by passing its id/secret via the env vars above --
no new Cloud client required. Migrating to a dedicated client later needs no
code change.

## Verify

```bash
node authorize.js --profile somemarketing --client-json /path/to/downloaded-oauth-client.json
# ...then, once a credential is resolvable:
node share.js --file <any-drive-file-or-folder-id> --list
```

A successful verify prints the current permissions on that file/folder. If
credentials are not yet resolvable, `getAccessToken` raises a clear error
naming the missing OAuth field(s) -- never a raw stack trace with secret
values.

## Use

```bash
# Share a folder/file with a person (sends a notification email):
node share.js --file <fileOrFolderId> --email person@example.com --role reader --notify

# Link-sharing ("anyone with the link can view"):
node share.js --file <fileOrFolderId> --anyone --role reader

# Inspect current permissions:
node share.js --file <fileOrFolderId> --list

# Preview without mutating:
node share.js --file <fileOrFolderId> --email person@example.com --dry-run

# Rename a file/folder:
node rename-folder.js <fileOrFolderId> "New Name"

# Replace a file's content in place (keeps id/name/link):
node replace-reel.js <fileId> ./local-file.mp4 video/mp4

# Upload a batch of local assets into a (created-if-missing) subfolder,
# optionally moving an existing file into it afterwards -- see upload-assets.js
# header for the manifest shape:
node upload-assets.js ./upload-manifest.json

# Convert a Markdown file into a native Google Doc:
node create-doc-from-template.js --input ./notes.md --name "My Doc" --parent <driveFolderId>

# Build a nested folder structure and upload a batch of files into it from a
# plan file (dry-run by default; see organize-deliverables.js header for the
# plan shape):
node organize-deliverables.js ./deliverables-plan.json          # plan only
node organize-deliverables.js ./deliverables-plan.json --apply  # execute

# Create a folder, upload a set of files, and share it with a collaborator in
# one shot -- see publish-folder.js header for the manifest shape:
node publish-folder.js ./publish-manifest.json [--dry-run]
```

Roles: `reader` | `commenter` | `writer`. Folder shares propagate to
contents.

## What's not included

One script from the source tree was dropped rather than genericized: a
"create a clean copy doc" variant whose entire body was hardcoded client
marketing copy (contest terms, prices, ad variants) uploaded verbatim as a
Google Doc -- there was no reusable operation left once the client content
was stripped out. The underlying operation ("turn text into a native Google
Doc in a folder") is covered generically by `create-doc-from-template.js`,
which takes the content as an input file instead of embedding it in the
script.

## Security

- `.oauth-creds.json` and `.oauth-creds.<profile>.json` are gitignored; they
  hold the client secret + refresh token. Prefer the Keychain/1Password
  sources above for shared machines.
- Scope is full `drive` (needed to set permissions). The token only acts as
  whichever Google account completed `authorize.js`.
