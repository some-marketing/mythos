---
name: mythos-memories-reports-is-a-delete-mirror
description: Never write directly into Mythos-memories/reports|concepts|memory|instructions|mocs|transcripts — they are rsync --delete mirrors rebuilt by the obsidian-vault-sync launchd job; direct writes are silently destroyed
metadata: 
  node_type: memory
  type: project
  originSessionId: c190481a-0c8e-4623-85ed-c4cfafb821a9
  modified: 2026-08-02T00:44:13.421Z
---

`Mythos-memories/reports/` (and `concepts/`, `memory/`, `instructions/`, `mocs/`, `transcripts/` there) are NOT storage — they are one-way rsync `--delete` mirrors rebuilt from repo sources (`_dev/reports/analysis/` → `reports/`, etc.) by `tools/hygiene/sync-obsidian-vault.sh` via launchd job `ca.somemarketing.mythos.obsidian-vault-sync`. Any file written directly into a mirrored dir is deleted at the next sync pass, with mtimes preserved from source so the deletion looks like nothing happened.

**Why:** on 2026-08-02 two freshly verified artifacts (the G1 quarantine review packet and the S3b falsifier evidence) vanished from `Mythos-memories/reports/` within ~30 minutes; both had been confirmed on disk by sha256. Cause was this mirror, not an intruder. The relational-substrate-port plan itself names `Mythos-memories/reports/…` as evidence destinations — that is a recorded plan defect needing amendment.

**How to apply:** write substrate/gitignored artifacts under `Mythos-memories/substrate/` (not mirrored, survives) — evidence at `substrate/evidence/`, operator packets at `substrate/g1/`. Anything meant for the vault mirror goes into the SOURCE (`_dev/reports/analysis/` etc.) — but never put substrate-derived personal content there, because that surface is git-trackable and G1-gated. Related: [[sams-corpus-must-be-ported]], [[memory-vault-rewire-state-and-operator-gates]].
