---
name: lima-default-template-mounts-host-home
description: "Lima's default Debian template mounts host HOME into the guest — the ant-world isolation config must never inherit _default/mounts; verify with mount + LIMA_CIDATA_MOUNTS=0"
metadata: 
  node_type: memory
  type: project
  originSessionId: 410f8729-6299-4432-9f65-162af689752e
  modified: 2026-08-02T19:26:24.436Z
---

Building the ant-world VM testbed (2026-08-02): Lima's default template silently mounts the host HOME directory into the guest, which would have put the entire home dir — adjacent to Keychain-consuming apps and every repo — inside the "isolated" testing ground. The config at `_dev/sim-runs/vm/ant-world.yaml` deliberately does not inherit `_default/mounts`.

**Why:** the membrane ruling ([[g0-containment-abstract-structure-is-tracked-safe]] sibling decision, operator-decision-20260802-ant-world-vm-isolation.md) requires no host filesystem share; a template default reintroduces it invisibly on any config rewrite.

**How to apply:** any edit to the ant-world VM config must re-run the membrane checklist in `_dev/reports/analysis/ant-world-vm-runbook__20260802.md` — mount table clean, `LIMA_CIDATA_MOUNTS=0`, nftables egress drop counter non-zero, no published ports. Also: `limactl snapshot` is QEMU-only (vz exits "unimplemented") — golden baseline is the protected clone `ant-world-golden`, revert via `revert-to-golden.sh`.
