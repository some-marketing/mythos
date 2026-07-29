# Setting up `gmail-inbox-agent`

No credentials to configure. This is a repo-local preview slice: it reads a
local JSON file of email-like objects and prints proposed triage decisions.
It never calls the Gmail API, never authenticates, never reads a mailbox, and
never mutates labels or archives anything live.

Confirmed by reading every file in this directory (`preview.js`,
`lib/classifier.js`, `lib/rules.js`, `fixtures/sample-emails.json`,
`README.md`): there is no credential resolution, no OAuth flow, no API
client, and no hardcoded account/session data anywhere in this slice.

## Verify

```
node tools/gmail-inbox-agent/preview.js tools/gmail-inbox-agent/fixtures/sample-emails.json
```

This reads only the local fixture file and prints JSON triage decisions to
stdout. No network access, no credentials, no live Gmail/Dart calls.
