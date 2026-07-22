# Delesign MCP (scaffold)

An MCP server shell for Delesign (delesign.com), an on-demand design
platform. Ships as a **scaffold** rather than a complete port: the source
this was extracted from had a full order-lifecycle pipeline (brief
generation, order submission, deliverable polling, asset upload, Dart
sync) built around one agency's real brand-registry mapping and internal
identity strings. Rather than ship a half-genericized version of that
pipeline, this scaffold ships the clean mechanical core plus one reusable
pattern, and leaves the order-lifecycle scripts as something you build for
your own workflow on top of this base.

## What's here

- `server.js` / `tools.js` — the MCP server shell and its tool surface (account/project summarization helpers that redact raw response bodies).
- `client.js` / `config.js` — the Delesign API client and its env-driven config.
- `env.example` — placeholder env, dry-run by default.
- `run-with-op.sh` — the 1Password credential-resolution wrapper.
- `lib/leak-patterns.js` — a genericized outbound-message leak-pattern linter: a reusable pattern for catching your own internal jargon, absolute paths, and internal-tool references before a message goes to an external vendor. The pattern list ships with placeholder examples (`your agency name`, `youragency.example`, `YOUR_INTERNAL_CODE`) — replace them with your own agency's actual internal vocabulary and brand tokens.

## What isn't here, and why

The source repo's Delesign integration also included: a brand registry
mapping client codes to Delesign brand ids, an order-submission script built
on that registry, brief-generation and brief-checklist tooling, deliverable
fetch/poll/upload scripts, a Dart message-sync script, and an asset-sweep
watcher. All of it assumed one agency's specific client roster and internal
identity strings (a real operator name as a hardcoded default author,
real Drive-mount paths). Genericizing all of that into a config-driven
scaffold was out of scope for this port — the mechanism is real and useful,
but it needs your own agency's data model, not a scrubbed copy of someone
else's.

If you want the full order-lifecycle pipeline, the pattern to follow is:
extend `tools.js` with the same summarize-and-redact discipline already used
for accounts/projects, keep a brand/client mapping in your own config (not
hardcoded in the tool), and never print raw response bodies or PII to
conversation context.
