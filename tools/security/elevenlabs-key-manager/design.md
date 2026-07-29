# ElevenLabs Key Manager — design note (historical)

> **Status: historical design rationale, superseded.** This directory
> originally held a working manifest-validator + `op`-command-emitter tool.
> It has been superseded by `tools/security/elevenlabs-keys/`, which keeps the
> same "one key per trust boundary" philosophy but adds fail-closed
> allow-listed scopes (rather than a deny-list), capability isolation
> enforcement, a real (safety-guarded) `op` integration with stdin-only secret
> handling, and live scope validation against the ElevenLabs API. Only this
> design note is kept here, for the reasoning that carried forward. See
> `tools/security/elevenlabs-keys/` for the current, working tool.

## Purpose

Manage ElevenLabs API keys as a **metadata manifest** plus a set of emitted
1Password (`op`) commands. The tool validates that each key is scoped to the
minimum it needs and stays inside its trust boundary, then emits copy-paste
commands the operator runs to create/rotate/retrieve the keys in the
`Automation` vault. It does not create keys and does not store them; it makes
the *policy* mechanical and reviewable.

## Trust-boundary model: one key per trust boundary, not per permission

A single ElevenLabs workspace can mint many keys. The failure mode is a
"kitchen-sink" key that carries every scope and is pasted into every runner —
one leak then compromises voice cloning, transcription, and workspace admin at
once. This tool models **one key per trust boundary**:

| profile | trust_boundary | why it is its own key |
|---|---|---|
| tts-narration-prod | narration | read-mostly TTS; can render audio, cannot touch the voice library |
| stt-transcription-prod | transcription | speech-in only; no synthesis, no voices |
| voice-cloning-mgmt | voice-identity | the ONLY key allowed `voices:write` (identity-forgery surface); backend/admin, fastest rotation |
| agent-phone-prod | conversational-agent | live agent; TTS+STT+`eleven_agents:write`, but never the voice library |
| media-utilities-optional | optional-media | not provisioned; isolation/music/sfx utilities, minted only if needed |

Boundaries, not permissions, are the unit because a boundary is what you reason
about when a key leaks: "what could the holder of *this* key do?" A per-permission
split would multiply keys without changing the blast radius.

## Scope taxonomy and classification

`lib.cjs` (in this superseded version) encoded the full ElevenLabs scope
taxonomy (`TAXONOMY`). A manifest lists scopes in three buckets — `access` (an
action scope, emitted plain), `read` (emitted `<base>:read`), `write`
(emitted `<base>:write`). A raw token may also carry an explicit
`:read`/`:write` suffix, which wins over the bucket. `classifyScope()`
normalized and classified each into one of:

- **admin / privilege-escalation** — `workspace:write`, `service_accounts`,
  `group_members`, `workspace_members_invite`, `workspace_members_remove`,
  `terms_of_service_accept`, `user:write`, `ads_engine`. Never on a workload key.
- **identity-sensitive** — `voices:write` (managing the voice library).
- **caution** — `webhooks` (recommend dashboard config).
- **standard** — everything else.
- **unknown** — not in the taxonomy (typo guard).

The current tool (`elevenlabs-keys/`) replaced this deny-list classification
with a fail-closed **allow-list** per scope section, which rejects unknown or
misspelled capabilities by default rather than merely flagging them.

## Safety rules the validator enforced

1. No workload key may hold any admin scope → **FAIL**.
2. `voices:write` only on `trust_boundary: voice-identity` → else **FAIL**.
3. `conversational-agent` must not hold `voices:write` → **FAIL** (explicit).
4. `narration` must not hold `voices:write` → **FAIL** (explicit).
5. `webhooks` on any key → **WARN** (dashboard-only recommended).
6. Recommend (WARN if missing, provisioned keys only): `auto_disable_if_leaked:
   true`, non-null `rotation_days`, non-`unlimited` quota.
7. Unknown scope → **FAIL** (typo guard).
8. Any raw-secret-shaped field on a profile (`credential`, `token`, `api_key`,
   …) → **FAIL** — the manifest references keys by profile name only.

`not_provisioned` profiles were still subject to scope-safety rules (1–5, 7–8)
but skipped the provisioning-hygiene WARNs (6). The current tool keeps this
same behavior (see `isProvisioned()` / `assertManifestSafe()`).

## The contract: the tool never touches secrets; `op` is run by the operator

This superseded version **never ran `op` at all** — it only emitted commands
for the operator to paste and run themselves:

- No code path accepted, read, echoed, or stored a raw key.
- `plan` emitted `op item create` with `credential[password]=<PASTE_KEY_HERE>` —
  a literal placeholder. The operator pasted the real value (minted in the
  ElevenLabs dashboard) into the emitted command, in their own shell.
- `retrieval` emitted `op read "op://<vault>/<vault_path>/credential"` for
  runner scripts; the secret was resolved at run time by `op`, never by this
  tool.
- Vault name was configurable (`--vault`, default `Automation`); no hardcoded
  absolute paths.

The current tool (`elevenlabs-keys/provision-key.js`) goes further: it *does*
invoke `op` directly (behind a strict, tested allow-list of subcommands), but
still never lets a raw key touch argv, shell history, or a log line — the key
is read only from stdin and piped to `op item create ... -` over stdin.

## Note for review

The vault item **title** convention used by both versions is `<provider>/<profile>`
(e.g. `elevenlabs/<profile>`), which contains a `/`. This makes the retrieval
reference `op://Automation/elevenlabs/<profile>/credential`.
