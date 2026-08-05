# Unattended-Readiness Audit — 2026-08-05

**Purpose.** A long run must complete without the operator present. `op` is
perfectly acceptable *provided it can never stop to ask a human*. This audit
covers every class of human-blocking event, not only credentials, and is written
so a machine can re-check it.

**Machine check:** `node tools/boot/preflight-unattended.cjs`
(exit `0` = pass, `1` = a required credential is missing or would prompt, `2` =
the check itself failed). `--json` emits a structured result.

**Safety invariant observed throughout.** No credential value was printed,
logged, or returned at any point. Only names, byte lengths, resolving tiers, and
elapsed times appear below — matching the invariant in
`tools/memory/remember-via-vault.sh`.

---

## 1. Status summary

| Blocking class | Instances found | ELIMINATED | PRE-AUTHORIZED | FAILS-FAST | STILL-BLOCKS |
|---|---:|---:|---:|---:|---:|
| Auth prompts (1Password desktop) | 11 | 10 | 1 | — | 0 |
| Auth prompts (Keychain ACL) | 18 probed | 18 | — | — | 0 |
| Hangs (unbounded waits) | 2 confirmed, 4 already safe | 2 | — | — | 0 |
| Permission denials | 2 observed | 0 | 0 | — | 2 |
| Legitimate gates | 3 exercised | — | — | 3 | — |

**Verdict: the credential and hang classes are closed. Two operator actions
remain**, both permission-allowlist entries (§5).

---

## 2. The class-killer: one shared resolver

Every credential-needing tool now resolves through a single path.

**`tools/credentials/resolve-secret.cjs`** (requireable + CLI)
**`tools/credentials/resolve-secret.sh`** (sourceable; delegates to the `.cjs`
so there is exactly one resolution policy and no drift)

```
resolve(name, { opRef, keychainAccount = 'mythos', legacyServices = [] })
```

Tiers, first hit wins. A one-line stderr diagnostic names the tier and byte
length — never the value:

| Tier | Source | Prompts? |
|---|---|---|
| 1 | `process.env[name]` | no |
| 2 | Keychain `-a mythos -s <name>` | no |
| 3 | Keychain, each `legacyServices` entry | no |
| 4 | `op read <opRef>` — **only** with a Keychain-sourced service-account token | no |
| 5 | Throw, naming exactly how to store the secret | n/a |

**The decisive rule:** tier 4 refuses to invoke `op` *at all* without a
service-account token. Bare `op` is precisely what falls back to 1Password
desktop auth and raises the macOS dialog that stalls an unattended run. The
interactive path is now opt-in via `MYTHOS_ALLOW_OP_DESKTOP=1`.

No shell is used anywhere in the resolver: every subprocess goes through
`execFileSync` with an argv array, so secrets cannot leak via shell tracing and
no metacharacter in a secret can be interpreted. Every subprocess has a hard
timeout and `stdin: 'ignore'`, so none can block on input.

### The root-cause bug

Several call sites hardcoded the **wrong Keychain account** for their token
item. The lookup silently missed, the code fell through to bare `op`, and the
operator got a dialog. Verified pairs on this host (presence only):

| Token item | Actual account |
|---|---|
| `smos-1p-automation-token` | `sm_os` |
| `smos-mythos-automation-token` | `Mythos` |
| `smos-sam-automation-token` | `sm_os` |
| `mythos-1p-automation-token` | `mythos` |

`tools/memory/memory-vault.js` asked for `-a Mythos -s smos-sam-automation-token`
— a pair that does not exist. **Every `/remember` read fell through to `op`.**
The resolver now probes all pairs, so one wrong constant can no longer force the
interactive path.

---

## 3. Converted call sites

| Lane | File | Change | Resolver-routed | Tier that fires | Prompts? |
|---|---|---|---|---|---|
| memory / `/remember` read | `tools/memory/memory-vault.js` | wrong Keychain pair → shared token resolver; bounded the `op` fallback | yes | keychain | no |
| memory / `/remember` write | `tools/memory/remember-via-vault.sh` | already correct (`Mythos`/`smos-mythos-automation-token`) | n/a | keychain | no |
| ai-bridge perplexity | `tools/ai-bridge/perplexity-api/query.js` | added hard timeout to `spawnSync('bunx', …)` | n/a | n/a | no |
| sheets mcp | `tools/mcp/sheets/run-with-op.sh` | order reversed to env→Keychain→op; canonical `SHEETS_*` names added | yes | keychain | no |
| delesign mcp | `tools/mcp/delesign/run-with-op.sh` | bare `op read` → resolver; headless token | yes | onepassword | no |
| youtube mcp | `tools/mcp/youtube/run-with-op.sh` | bare `op read` → resolver; headless token | yes | keychain/op | no |
| crm mcp | `tools/mcp/crm/run-with-op.sh` | shared token probe; desktop fallback now opt-in | yes | onepassword | no |
| meta-ads mcp | `tools/mcp/meta-ads/run-with-op.sh` | shared token probe; desktop fallback now opt-in | yes | onepassword | no |
| telemetry export | `tools/telemetry/dispatches/run-export-with-op.sh` | shared token probe; desktop fallback now opt-in | yes | keychain | no |
| discord bridge | `tools/mcp/discord/run-with-token.sh` | Keychain moved **before** `op` | yes | keychain | no |
| discord api | `tools/mcp/discord/discord-api.sh` | Keychain moved **before** `op` | yes | keychain | no |
| discord auto-responder | `tools/mcp/discord/run-auto-responder.sh` | Keychain moved **before** `op` | yes | keychain | no |
| voice discord | `tools/voice/run-discord-voice.sh` | Keychain moved **before** `op` | yes | keychain | no |
| voice agent | `tools/voice/discord-agent/run.sh` | Keychain moved **before** `op` | yes | keychain | no |
| dart + google-drive | `tools/lib/resolve-credential.cjs` | its token lookup now delegates to the shared probe | yes | keychain | no |

A secondary defect in the Discord and voice lanes: they guarded `op` with
`timeout 3`, but `timeout` lives in `/opt/homebrew/bin`, which is **not on
launchd's bare PATH** — so under launchd the guard did not exist. Keychain-first
removes the dependency on it entirely.

### Still reaching for `op` — and why that is acceptable

| File | Why `op` remains | Unattended risk |
|---|---|---|
| `tools/memory/remember-via-vault.sh` | legitimately writes memory items to the vault | none — token from Keychain, verified headless |
| `tools/memory/memory-vault.js` (source 3) | last-resort vault read | none — now bounded by timeout, and source 2 succeeds |
| `tools/convene/lib/openrouter-bridge.js` | **could not be patched** — governance perimeter | none, *conditionally* — see §6 |
| `tools/expressionengine/lib/ee-auth.js` | Keychain already tried first | low — client CMS lane, not on the run path |
| `tools/wifi-capture/*`, `tools/security/elevenlabs-keys/*`, `tools/status/status.js` | operator-invoked utilities | low — not on the unattended path |

---

## 3b. Hang class — unbounded waits

A hang is worse than a prompt: nothing reports it, so the run stalls silently
until a human notices. I swept the lanes a long run actually touches (convene,
signals, ai-bridge, memory, telemetry) for child processes and network calls
without timeouts.

| Instance | Finding | Status |
|---|---|---|
| `tools/ai-bridge/perplexity-api/query.js:128` | `spawnSync('bunx', ['pplx', …])` with **no timeout** — the known indefinite hang. `bunx` can block resolving/installing the package and `pplx` can block on stdin | **ELIMINATED** — added `timeout` (default 120 s, `PERPLEXITY_TIMEOUT_MS`), `stdin: 'ignore'`, and a distinct timeout error message |
| `tools/memory/memory-vault.js` `op item get` | no timeout | **ELIMINATED** — bounded at 15 s (`MYTHOS_OP_TIMEOUT_MS`) |
| `tools/signals/run-remote-ssh-bridge.js:217` | `spawnSync('ssh', …)` | already safe — `BatchMode=yes` (cannot prompt), `ConnectTimeout=10`, `StrictHostKeyChecking=accept-new`, `timeout: 120000`. Exemplary pattern |
| `tools/ai-bridge/adapters/openrouter.js:35` | `op item get` | already safe — `timeout: 8000` |
| `tools/convene/lib/openrouter-bridge.js:33,46` | `op item list` / `op item get` | already safe — `timeout: 10000` each |
| All `.claude/settings.json` hooks | — | already safe — explicit 5–30 s timeouts |

Remaining un-timed `execSync`/`spawnSync` calls in these lanes invoke fast local
binaries (`security`, `git rev-parse`, `which`, `launchctl`) that cannot
realistically block. All new code in this change sets `stdin: 'ignore'`, so no
subprocess can wait for input that will never come.

---

## 4. Key port results

`tools/boot/port-keys-to-keychain.sh` extended from 3 to 17 mappings
(canonical name → legacy Keychain service → 1Password reference) and **run**.

| Result | Count | Keys |
|---|---:|---|
| Already present | 3 | `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY` |
| Newly ported | 14 | `DISCORD_BOT_TOKEN`, `ELEVENLABS_API_KEY`, `DART_TOKEN`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `GOOGLE_ADS_{CLIENT_ID,CLIENT_SECRET,DEVELOPER_TOKEN,REFRESH_TOKEN,CUSTOMER_ID,LOGIN_CUSTOMER_ID}`, `SHEETS_{CLIENT_ID,CLIENT_SECRET,REFRESH_TOKEN}` |
| No source | 0 | — |

Twelve came from legacy Keychain entries under non-`mythos` accounts; two
(`LANGFUSE_*`) came from 1Password via the headless service-account token. The
port itself raised no prompt.

### Keychain ACL readability — tested, not assumed

An item created by a different app (e.g. `gemini-cli`) can raise an
"allow / always allow" dialog when `security` reads it. All 18 canonical items
were probed with a 5-second hard timeout, so a dialog would surface as a
blocked read rather than a hang:

**18 readable non-interactively (~15 ms each), 0 would prompt, 0 unreadable.**

No `security set-generic-password-partition-list` remedy is needed. Should a
future item ever fail this probe, the remedy is:

```
security set-generic-password-partition-list -S apple-tool:,apple: -a mythos -s <NAME> -k <login-keychain-password>
```

---

## 5. Permission denials — operator action required

Two observed denials halt work silently from the operator's perspective. The
current project allowlist (`.claude/settings.local.json`) already permits
`Bash(node *)`, `git add`, `git commit`, and the read-only git verbs, but **not**
`git push`, and not the VM sim runner.

`.claude/settings.json` is itself inside the governance perimeter and cannot be
edited without a ConveneReceipt, so these belong in
**`.claude/settings.local.json`** — append to `permissions.allow`:

```json
"Bash(git push origin HEAD:*)",
"Bash(git push --set-upstream origin *)",
"Bash(bash _dev/sim-runs/vm/orwell/psrunfile.sh:*)",
"Bash(node tools/boot/preflight-unattended.cjs:*)",
"Bash(bash tools/boot/port-keys-to-keychain.sh:*)"
```

Deliberately **excluded** as too broad:

| Rejected rule | Reason |
|---|---|
| `Bash(git *)` | standing operator constraint — never allowlist bare git |
| `Bash(git push:*)` | would permit `git push --force` to any ref, including `main` |
| `Bash(op *)` | would permit `op item delete`; reads are already allowed |
| `Bash(security *)` | would permit `delete-generic-password`; find is already allowed |

Note the push rules are scoped to `origin HEAD:*` / `--set-upstream`, which
cannot express a force-push to an arbitrary branch. Contribution law still
applies: feature branch and PR, never a direct push to `main`.

---

## 6. Legitimate gates — must fail fast and loud

These *should* stop a run. The requirement is that they fail immediately with a
named reason, never hang or silently no-op. Each was exercised in-session.

| Gate | Trigger | Failure mode | Verdict |
|---|---|---|---|
| Governance perimeter (`tools/verify/hooks/pre-write-convene-required.cjs`) | write to `tools/convene/`, `tools/kernel/`, `tools/verify/`, `tools/planning/`, `tools/substrate/`, `tools/backup/`, `tools/export-public/`, `tools/retrieval/`, `launchd/`, `instructions/canonical/`, `.claude/settings.json` | immediate non-zero + names the path *and* the remedy (`tools/verify/convene-unlock.cjs`) | **FAILS-FAST** |
| Convene perimeter, Bash channel | mutating command whose target cannot be proven outside the perimeter | immediate, fail-closed on ambiguity, names the offending token | **FAILS-FAST** |
| Write-boundary (foreign-code) | write to a path owned by another repo | immediate; currently **observe-only** ("WOULD BLOCK"), enforced only with `MYTHOS_WRITE_BOUNDARY_GATE=1` | **FAILS-FAST** (advisory tier — do not report as BLOCKING) |

All hooks in `.claude/settings.json` carry explicit timeouts (5–30 s), so no
hook can hang a run indefinitely.

**Observability.** Gate denials are appended durably to
`_dev/reports/lifecycle/claude-hook-events.jsonl`
(`tools/claude/lib/hook-telemetry.cjs`), including the
`convene-perimeter-denied` and `dangerous-command-detected` events. If an
unattended run stops, that file names why — a stall is diagnosable after the
fact rather than invisible. This is what makes a legitimate gate acceptable in
an unattended run: it halts, but it leaves a record.

One observation worth noting: the perimeter classifies `sed -n` as write-capable,
so it blocks *reads* performed with `sed`. Correct fail-closed behaviour, but it
means tooling should use `Read`/`cat` for inspection inside the perimeter.

---

## 7. Verification performed

| Check | Result |
|---|---|
| Resolver tier 1 (env) | `OPENROUTER_API_KEY` → `env`, 75 chars |
| Resolver tier 2 (Keychain) | `GEMINI_API_KEY`, `PERPLEXITY_API_KEY` → `keychain` |
| Resolver tier 4 (headless `op`) | resolved in **1518 ms**, token `smos-1p-automation-token`, no prompt |
| memory-vault token path | resolved in **26 ms**, `op` invoked for token: **NO** (was: always) |
| `/remember` write lane | token 867 chars from Keychain in 23 ms; `op` authenticated in 1276 ms; `Mythos Memories` vault visible |
| convene bridge viability | `op item list` headless in **914 ms**, OpenRouter item found |
| Keychain ACL probe | 18/18 readable non-interactively, 0 prompts |
| Shell/Node syntax | 16/16 modified files parse cleanly |
| sheets wrapper functional | all three `SHEETS_*` resolved from Keychain, no `op` field read |
| Preflight | **PASS**, exit 0 |
| **Bare launchd-style environment** (no inherited env vars, `PATH=/usr/bin:/bin:/usr/sbin:/sbin`) | all 5 hot credentials resolved `tier=keychain` in 48–61 ms; preflight `pass=true op_headless=true failures=0 would_prompt=0` |
| Regression check | `dart-api-token.test.js` — 3 failures before *and* after my change (pre-existing, unrelated) |

The bare-environment test is the load-bearing one: it proves resolution does not
secretly depend on an interactive shell's exported variables or on Homebrew
binaries being on `PATH` — the two things that differ between a session where
the operator is present and an unattended launchd start.

Nothing was staged or committed.

---

## 8. Outstanding operator actions

1. **Add the five allow-rules in §5** to `.claude/settings.local.json`. Without
   them a run can still be halted by a denial, which is invisible to the
   operator. *(Blocks unattended git push and the orwell VM sim lane.)*

2. **`tools/convene/lib/openrouter-bridge.js` remains unpatched** — the
   governance perimeter blocked the write, correctly. It resolves the key by
   running `op item list` *first*, so it is only safe unattended while
   `OP_SERVICE_ACCOUNT_TOKEN` is exported in the run environment (verified: 914
   ms, headless). Two options:
   - **Sufficient now:** ensure the run exports the token — `source
     tools/credentials/resolve-secret.sh && ensure_op_service_account_token`.
   - **Proper fix:** run `/convene` on the change, mint a receipt with
     `tools/verify/convene-unlock.cjs`, then reorder it to Keychain-first like
     every other lane.

3. **Optional hardening:** the mcp wrappers default to 1Password item names
   (`mythos-google-oauth-client`, `mythos-langfuse-api`,
   `mythos-moxie-api-credentials`) that do not match the real vault items
   (`sm-os-google-oauth-client`, `smos-langfuse-api`,
   `sm-smos-moxie-api-credentials`). This is now masked by the Keychain tier,
   but the `op` fallback in those lanes would fail if it were ever reached.
