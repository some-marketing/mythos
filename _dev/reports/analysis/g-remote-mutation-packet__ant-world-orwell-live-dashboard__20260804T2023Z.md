# G-REMOTE-MUTATION gate packet — ant-world-orwell-live-dashboard

**Written:** 2026-08-04T20:23Z · Orchestrator: Fable 5 main chain (`/go` run)
**Plan:** `_dev/reports/analysis/task-plans/ant-world-orwell-live-dashboard__plan.json`
**Amendment:** `ant-world-orwell-live-dashboard__amendment__20260804T2020Z` (custody + signatures)
**Review chain:** sonnet diagnosis → sonnet hardening (8 files) → codex GPT-5.5 adversarial
review (3 MAJOR + 1 MODERATE, run `20260804T201348Z`) → sonnet fixes → coordinator
mechanical re-verification of all four findings (manifest-last order at
`build-export.sh:150-152`; PID transcripts at `psrun.sh:12`/`psrunfile.sh:45`; 64-hex
validation at `load-courier.ps1:22`/`first-boot.ps1:18`; ASCII-clean check on all
shipped .ps1 files).

**Intended payload (already built and hop-1 verified per the 08-04 failure report):**
`antworld-payload-20260804T033550Z.tar.gz`
SHA-256 `c5ba85c6af404bcbc23dcff540bb765d0ffa116e77269be7fdfd91f728c257ff`

All commands run from `_dev/sim-runs/vm/orwell/`. Every `psrunfile.sh`/`psrun.sh`
invocation now leaves a durable transcript under `_dev/state/orwell-transcripts/`.
Note: `psrunfile.sh` ships ALL sibling .ps1 files, so the hardened scripts deploy on
the first invocation below.

## Phase 1 — READ-ONLY inspection (no mutation; settles H1 vs H2 with evidence)

```
cd /Users/admin/mythos/_dev/sim-runs/vm/orwell
bash psrun.sh "Get-ChildItem -LiteralPath 'D:\HyperV\AntWorld\Staging\In' | Sort-Object LastWriteTime | Format-Table Name,Length,LastWriteTime -AutoSize"
bash psrunfile.sh check-provisioning.ps1
```

Interpretation guide:
- If `Staging\In` shows only the `20260802T200855Z` archive → H1 confirmed (the 08-04
  push never landed; the old self-referential check "verified" the stale archive).
- If `Staging\In` holds the `20260804T033550Z` triple but check-provisioning reports the
  old archive on the courier → H2 favored (loader threw mid-run before its copy block).
- check-provisioning now prints the courier's payload name + SHA-256 directly.

## Phase 2 — MUTATION (only after you review Phase 1 output)

```
cd /Users/admin/mythos/_dev/sim-runs/vm/orwell
bash inbound-push.sh
bash psrunfile.sh load-courier.ps1 -ExpectedSha256 c5ba85c6af404bcbc23dcff540bb765d0ffa116e77269be7fdfd91f728c257ff
bash psrunfile.sh refresh-seed.ps1
bash psrunfile.sh first-boot.ps1 -ExpectedSha256 c5ba85c6af404bcbc23dcff540bb765d0ffa116e77269be7fdfd91f728c257ff
```

Fail-closed guarantees now in place: load-courier refuses unless the newest staged
archive matches the hash above; first-boot hashes the archive actually on the courier
and refuses to `Start-VM` on mismatch; both validate the hash shape before touching
anything. A stale payload can no longer silently boot.

## Phase 3 — after boot completes

```
bash psrunfile.sh check-provisioning.ps1
```

Then the 3,000-tick baseline per the runbook's exploratory-turn procedure (plan S2),
with harvest restricted to the sanitized dashboard projection only.

## Open operator decisions (from the codex review — none block Phase 1)

1. Keep the 8-file hardening inside this plan (amendment default) vs split it into a
   separately reviewed prerequisite.
2. Manifest-last completion marker (default taken) vs versioned-directory publication.
3. Checkpoint recovery: halt-for-repair vs last-known-good — S0 contract territory.

## Phase 1 RESULTS (executed 2026-08-04T20:24Z, read-only)

Transcripts: `_dev/state/orwell-transcripts/20260804T202419Z__80210__inspect-staging.ps1.log`
and `20260804T202443Z__80687__check-provisioning.ps1.log`.

- **Staging\In:** BOTH payload triples present. The `20260804T033550Z` archive is there
  with the correct hash `c5ba85c6…` (remote-verified this session). **H1 refuted** —
  the push landed.
- **Courier:** still holds the OLD `20260802T200855Z` archive, mtime
  2026-08-02T21:20Z — untouched on 08-04. The old `PAYLOAD-MANIFEST.txt` and
  `job.env.consumed` are also still present, meaning `load-courier.ps1`'s entire
  remove-and-copy block never executed on 08-04. **H2 confirmed as the failure
  shape:** the loader was either never invoked or threw before its mutation block;
  which of the two is unknowable because no transcript existed then — the exact gap
  the hardening now closes.
- **STATUS:** `cancelled-before-start` — residue of the 08-02 CANCEL, untouched since.
- **Membrane:** audit clean — loopback only, no routes, no listeners, no host shares,
  no unexpected credential material.

Conclusion: remote staging is healthy and the intended payload is already staged.
Phase 2 as written is exactly right: load-courier will select the 08-04 archive
(newest by name), verify it against `c5ba85c6…`, replace the stale courier contents,
and first-boot will refuse to start unless the courier really carries it.

**Packet correction:** the Phase 1 inline `psrun.sh "<command>"` form in the original
packet was wrong — `psrun.sh` takes a script FILE. Phase 1 was executed via a
scratchpad `inspect-staging.ps1` plus `psrunfile.sh check-provisioning.ps1`. Phase 2's
commands are unaffected (all are `psrunfile.sh <script> -ExpectedSha256 …` file
invocations, which is the correct form).

## Known residual gap (recorded, not blocking)

`inbound-push.sh` still selects the newest archive by glob and dies (rather than
falling back to the newest COMPLETE triple) if a partial publish coexists — the
manifest-last contract is not yet honored by this consumer. Recorded in runbook §15
addendum; candidate follow-up slice.
