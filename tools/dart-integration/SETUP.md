# Dart Integration — Setup Guide

Node.js tooling (`lib/dart-api.js` and everything built on it — relay, the
response checker, task/plan projection, the landing pad poller, etc.) plus an
optional Google Apps Script pair that routes client emails and meeting notes
into Dart tasks.

## Part 1 — Node CLI credentials (DART_TOKEN)

Every Node script in this directory resolves `DART_TOKEN` at runtime through
the shared credential resolver, `tools/lib/resolve-credential.cjs` — a
4-source chain, first hit wins:

1. **Environment variable** — `DART_TOKEN` in your shell or CI config.
2. **macOS Keychain** — seed it once, headless-friendly forever after:
   ```
   tools/boot/keychain-store.sh DART_TOKEN mythos
   ```
3. **1Password** — `op read op://Automation/DART/DART_TOKEN` (or the
   `credential` field), resolved via a service-account token
   (`OP_SERVICE_ACCOUNT_TOKEN` env var, or a Keychain item named
   `mythos-1p-automation-token`/`mythos`).
4. **Env file fallback** — `.env.local` or `.env` at the repo root, or
   `~/.mythos/.env`. See `env.example` in this directory for the exact key.

The field declaration lives in `creds.config.json` in this directory. Run
`node tools/lib/generate-env-example.cjs tools/dart-integration/creds.config.json`
to regenerate `env.example` if that config changes.

### Get a Dart API token

1. Sign into [Dart](https://app.dartai.com) → Profile → API.
2. Generate a new token, copy it.
3. Seed it into one of the four sources above (Keychain is recommended for a
   local/headless setup — see step 2).

### Verify

```
node -e "require('./tools/dart-integration/lib/dart-api').probeAuthState().then(r => console.log(JSON.stringify(r, null, 2)))"
```

A successful verify reports `{ ok: true, state: 'valid', source: '<which of the four sources resolved it>' }`
and the live workspace config — never the token value itself. On a miss it
reports which sources were tried and the exact Keychain seed command to run.

### Optional: gate writes to a specific Dart user

`lib/identity.js` can refuse Dart *writes* (create/update/delete/comment)
unless the token belongs to a specific Dart user — useful if you don't want a
misconfigured token silently writing to the wrong workspace. This is **off by
default**. To enable it, set:

```
DART_EXPECTED_USER_NAME=<your Dart display name>
DART_EXPECTED_USER_EMAIL=<your Dart account email>
```

With neither set, `verifyDartIdentity()` is a pass-through.

## Part 2 — Google Apps Script (optional: client email / meeting notes → Dart)

If you also want client emails and Gemini meeting notes routed into Dart
tasks automatically, the `apps-script/` directory has a standalone Apps
Script project for that. It uses its own Script Properties token, independent
of the Node-side resolver above.

### Prerequisites

- Google Workspace account
- Dart API token (same one from Part 1, or a separate one)
- Gmail filters for client email domains

### Step 1: Create the Apps Script Project

1. Go to [script.google.com](https://script.google.com)
2. Click **New Project**
3. Name it `Mythos Dart Integration`
4. Replace the contents of `Code.gs` with the file from `apps-script/Code.gs`
5. Click the gear icon (Project Settings) → check **Show "appsscript.json" manifest file**
6. Replace `appsscript.json` contents with the file from `apps-script/appsscript.json`

### Step 2: Set Your Dart Token

1. In Apps Script → Project Settings → Script Properties
2. Add property: `DART_TOKEN` = your token from Part 1

### Step 3: Test the Connection

1. In the editor, select `testDartConnection` from the function dropdown
2. Click **Run**
3. Authorize the requested permissions when prompted
4. Check Execution Log — should say "Dart API connected"

### Step 4: Set Up Gmail Labels & Filters

Create the Gmail label:
- `dart/pending`

Create Gmail filters (Settings → Filters → Create new filter) for each client
domain you want routed, applying label `dart/pending`. `Code.gs` ships with
placeholder entries (`client-a.example`, etc.) in `CLIENT_ROUTING` — replace
these with your own client domains and dartboard names before relying on
routing.

### Step 5: Enable Triggers

1. In the editor, select `setupTriggers` from the function dropdown
2. Click **Run**
3. This creates:
   - `processClientEmails` — every 5 minutes
   - `processMeetingNotes` — every 15 minutes

### How It Works

**Email flow:**
```
Client sends email
  → Gmail filter applies dart/pending label
  → Apps Script picks up labeled thread (every 5 min)
  → Matches sender email/domain to CLIENT_ROUTING
  → Searches Dart for existing task with matching subject
  → Match: adds email as comment to existing task
  → No match: creates new task on client's dartboard
  → Moves label from dart/pending → dart/processed
```

**Meeting notes flow:**
```
Google Meet call ends
  → Gemini saves notes as Google Doc in "Meet Notes" folder
  → Apps Script scans folder for new docs (every 15 min)
  → Matches meeting title keywords to MEETING_KEYWORDS
  → Searches Dart for existing task related to meeting
  → Match: adds notes as comment to existing task
  → No match: creates new task with notes as description
  → Marks doc as processed (via description field)
```

Both flows fall back to the `General/Tasks` dartboard if no client match is
found. Edit `CLIENT_ROUTING` and `MEETING_KEYWORDS` directly in `Code.gs` —
there is no separate JSON mirror to keep in sync in this export.

### Monitoring

- **Execution logs**: Apps Script → Executions (left sidebar)
- **Errors**: Failed runs show in the execution log with error details
- **Processed emails**: Check the `dart/processed` Gmail label
- **Processed notes**: Check the file description in Drive for "dart-processed" marker

### Troubleshooting

| Issue | Fix |
|---|---|
| "DART_TOKEN not set" | Add token in Script Properties |
| "Label not found" | Create `dart/pending` label in Gmail |
| No emails processing | Check Gmail filters are applying the label |
| Wrong dartboard | Update the domain mapping in `CLIENT_ROUTING` |
| Meeting notes not found | Verify "Meet Notes" folder exists in Drive |
| API rate limits | Increase trigger interval (10-15 min for email) |
