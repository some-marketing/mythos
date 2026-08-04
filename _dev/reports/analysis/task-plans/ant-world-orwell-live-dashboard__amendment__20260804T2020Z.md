# Amendment — ant-world-orwell-live-dashboard — 2026-08-04T20:20Z

**Trigger:** codex GPT-5.5 distinct-family review (managed bridge run `20260804T201348Z`,
scope `orwell-provision-hardening-review`) of the uncommitted provisioning-hardening
slice returned 3 MAJOR + 1 MODERATE, including *plan custody does not match the
reviewed slice*. Verdict: do not approve execution before a bounded amendment.

## What changed

- **DV1 — custody bound.** The eight files touched by the provisioning repair are now
  bound to this plan: `_dev/sim-runs/vm/orwell/{load-courier.ps1, first-boot.ps1,
  build-export.sh, psrun.sh, psrunfile.sh, check-provisioning.ps1, README.md}` and the
  appended §15 (+addenda) of `ant-world-orwell-runbook__20260802.md`. Acceptance
  evidence: the codex review artifacts + post-fix re-verification + `bash -n` receipts.
  **Extended 2026-08-04T20:52Z** (codex trial `orwell-rooted-path-fix-trial`, MAJOR
  custody finding): the rooted-path root-cause fix additionally binds
  `courier-lib.ps1`, `run-job.ps1`, `harvest-results.ps1`, `verify-membrane.ps1`.
  Live-retry evidence obligation (codex MODERATE): the retry transcript must carry a
  mounted-VHD identity receipt — path-shape validation is not volume-identity
  validation.
- **DV2 — G-REMOTE-MUTATION signatures updated.** The gate packet must use
  `psrunfile.sh load-courier.ps1 -ExpectedSha256 <sha256>` and
  `psrunfile.sh first-boot.ps1 -ExpectedSha256 <same>`, and must open with read-only
  remote inspection (payload-visible `check-provisioning.ps1`, `Staging\In` listing)
  to settle H1 vs H2 with evidence before any mutation.
- **DV3 — publication contract.** Manifest-written-last is the completion marker for
  the export triple (coordinator default, reversible); transcript names are
  PID-suffixed; `ExpectedSha256` is validated 64-hex before any courier operation.

## DV4 — guest boot-lifecycle repair (added 2026-08-04T23:17Z)

The baseline was blocked by a chain of guest boot defects (systemd ordering cycle ×2,
oneshot runtime deadlock, one-boot-lag on unit rewrites) — root-caused from the guest
journal and repaired by redesigning the runner: the in-script cloud-init wait is
removed; `job.env` presence is the job-boot discriminator (host invariant: run-job
writes it, first-boot deletes it), probed via read-only mount, fail-closed to
never-run/never-poweroff. Execution-verified by the r6 run (3,000 ticks, STATUS 0,
harvest manifest clean). Distinct trial: codex run `20260804T231047Z`
(REJECT_PENDING_AMENDMENT — 1 MAJOR stale-spec-on-unmanaged-boots + 3 MODERATE), fixes
in flight (consume-on-pickup rename + deadline-expiry refusal + fault-vs-deferral
marker separation + comment sweep), r7 re-verification required before commit.
Custody: the user-data runner + unit sections join this plan's bound set. The two
never-exercised probe-failure branches are recorded as written-not-verified pending a
fault-injection check.

## Unchanged

Risk tier `high`, review lane `operator-gate`. No remote mutation authorized by this
amendment.

## Open operator decisions (from the codex review)

1. Keep the hardening inside this plan (default taken here) vs split into a separately
   reviewed prerequisite.
2. Manifest-last marker (default taken) vs versioned-directory publication.
3. Checkpoint recovery: halt-for-repair vs last-known-good — S0 contract territory,
   untouched by this amendment.

Paired JSON: `ant-world-orwell-live-dashboard__amendment__20260804T2020Z.json`
