# `/tt` alias registration patch — BLOCKED on the convene perimeter

**Status:** `/ticktock` ships and is invocable. **`/tt` does NOT resolve.** The alias
entry belongs in `instructions/canonical/command-aliases.yaml`, which is inside the
convene authority perimeter, so this patch is staged rather than applied.

Enforcement status of the alias today: **ABSENT.** Acceptance test **S3-m** (`/tt`
resolves to `ticktock`, behavior identical) **cannot pass** until this patch lands.

## Why this is a patch and not a landed change

`instructions/canonical/command-aliases.yaml` is a `PROTECTED_PATHS` governance path
under `tools/verify/hooks/pre-write-convene-required.cjs`, wired at
`tools/kernel/hooks/dispatch-pretool.cjs:149-154` and `:178-199`. The gate is
**BLOCKING and FAIL-CLOSED**. Verified live this session — an attempt to read the file
region through a Bash command that merely named it was denied:

```
BLOCKED: governance write to instructions/canonical/command-aliases.yaml requires a
live ConveneReceipt/1.0 covering this path. Run /convene on the proposed change, then
mint a 1Password-backed unlock receipt with tools/verify/convene-unlock.cjs.
```

(Note: that denial fired on a *read-only* `sed -n` command. The Bash-channel matcher
scans command text broadly rather than narrowly read-vs-write — a known false-positive
shape, already recorded in the plan's inherited-gate matrix.)

There is a second, independent reason not to hand-apply this: **`.claude/commands/tt.md`
is a generated artifact of the registry entry.** Hand-writing it would forge generated
provenance and break the alias-authority law — the registry is the authority, and an
alias file that no registry entry produced is a lie about where it came from. So this
patch names the YAML addition and the stub it generates; it does not create the stub.

## Step 1 — the exact YAML addition

File: `instructions/canonical/command-aliases.yaml`
Domain: `aliases` (command domain)
Location: the `# --- Short forms ---` block, currently lines 102–117, after the
`attune:` entry at lines 115–117 (keeping the short-forms block contiguous).

Add exactly:

```yaml
  tt:
    resolves_to: ticktock
    status: primary
```

Registry constraints this satisfies, checked against the file's own header contract:

- **Terminal id, single-hop.** `resolves_to: ticktock` names a terminal command id in
  the commands catalog, not another alias. Alias → alias is forbidden and this is not one.
- **Catalog membership.** The commands domain resolves against `.claude/commands` files.
  `.claude/commands/ticktock.md` exists as of this change — the target is real before the
  alias points at it, not after.
- **Naming.** `tt` is lowercase-kebab; lookup is case-insensitive
  (`tools/user/resolve-alias.cjs` `normalizeName`).
- **Status.** `primary` — an unconditional primary alias per plan step S2 and finding
  TT-005, not `cross-alias` and not `compatibility`.
- **No collision.** No `tt` key exists in the `aliases` domain today. Duplicate spellings
  across *other* domains would be legal and independent, but none exist either.

## Step 2 — the file this generates

`.claude/commands/tt.md`, following the established short-form stub grammar
(`gm.md`, `scry.md`, `aura.md`, `owl.md` — a stub whose body defers to
`.claude/commands/<target>.md`, which
`tools/export-public/check-composed-tree.cjs` validates for alias coverage:
"every alias key in `command-aliases.yaml` must have a matching
`.claude/commands/<alias>.md` in the composed tree").

Expected content, for review — **do not create this file by hand; let the registration
flow produce it:**

```markdown
---
description: Short form of /ticktock
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

<objective>
Run `/ticktock`. `tt` is the short form; the full command body lives under
`.claude/commands/ticktock.md`.
</objective>

<process>
1. Follow `.claude/commands/ticktock.md`.
</process>

<success_criteria>
- `/tt` resolves to the same behavior as `/ticktock`
</success_criteria>
```

## Step 3 — the generator command that must run

After the YAML entry lands, regenerate the derived instruction surfaces so the alias
appears in the generated `AGENTS.md` / `CLAUDE.md` command-alias sections
(`tools/instructions/lib/engine.js` `loadAliasRegistry` reads the registry at
`instructions/canonical/command-aliases.yaml:119`):

```
npm run instructions:check
```

which is `node tools/instructions/generate.js && node tools/instructions/validate.js`.
Generation and validation are one motion here on purpose — a registry entry that
generates but does not validate is not landed.

## Step 4 — the operator gate required

**`/convene` on the proposed change, then a `ConveneReceipt/1.0` covering
`instructions/canonical/command-aliases.yaml`.**

1. Run `/convene` on this alias registration.
2. Mint the receipt: `node tools/verify/convene-unlock.cjs` (1Password/Keychain-HMAC
   backed). The receipt must cover `instructions/canonical/command-aliases.yaml`; a
   receipt covering some other protected path does not transfer.
3. Apply Step 1 while the receipt is live.
4. Run Step 3.

The receipt is the only path. Do not attempt to route the write around the gate, and do
not disable the hook — a governance path whose gate can be argued past is not a
governance path.

## Step 5 — verify after landing

```
npm run instructions:check
node tools/user/resolve-alias.cjs   # or the resolver's API: resolveAlias('commands', 'tt')
```

Expected: `resolveAlias('commands', 'tt')` returns
`{ id: 'ticktock', source: 'canonical', status: 'primary' }`, and
`.claude/commands/tt.md` exists with the stub body above.

Only then may **S3-m** be asserted:
`alias_resolution_test.resolves_to == "ticktock" AND .behavior_identical == true`.
Until then the honest record is: **`/tt` is ABSENT; `/ticktock` is the only invocable
name; S3-m is untestable, not failing.**
