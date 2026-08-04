# orwell ant-world testbed — scripts

Tooling for the ant-hive-world Hyper-V testbed on the remote Windows host
`orwell`. Status, evidence, and the acceptance-checklist state live in
`_dev/reports/analysis/ant-world-orwell-runbook__20260802.md`.

**The build is currently halted at a network-topology gate** (runbook §3): the
destination review requires both a Hyper-V Private switch and host-initiated SCP
into the guest, and those are mutually exclusive under Hyper-V. Transfer scripts
(`inbound-push.sh`, `pull-results.sh`, revert procedures) are deliberately not
written yet, because their shape depends on that decision.

## Remote execution

`orwell`'s default shell is `cmd.exe`, so PowerShell must be invoked explicitly.
Quoting through `ssh → cmd.exe → powershell` corrupts scripts silently, so
nothing here passes a script as a quoted string.

| Script | Use |
|---|---|
| `psrun.sh <file.ps1>` | Small scripts. Sends UTF-16LE base64 via `-EncodedCommand`. |
| `psrunfile.sh <file.ps1> [args]` | Larger scripts. `-EncodedCommand` is capped by cmd.exe's 8191-character command line, so this uploads to the dedicated staging path and runs with `-File`. |

Anything over roughly 3 KB needs `psrunfile.sh`.

### Exploratory turns

`run-job.ps1 -Mode turn -Ticks 3000` runs the first bounded exploratory turn
inside the zero-NIC guest (one tick is one simulated day). The guest commits a
checkpoint and emits a dashboard projection to the courier after shutdown.
Checkpoint metadata currently declares `resume_continuity: false`: the live
driver's hive and world-mind weights are process-local and are not exported.
Do not treat a later turn as a continuation until a reviewed mind-state
serialization contract changes that declaration.

Before provisioning a changed runner, load the newest allowlisted payload while
the VM is Off: `psrunfile.sh load-courier.ps1`, then refresh the seed and run the
approved provisioning boot. The loader verifies the staging and courier hashes.

## Payload

`build-export.sh` assembles the **only** content authorized to reach orwell,
per the destination review's D1 ruling. It builds from an explicit file list, so
forbidden content is absent by construction rather than by filter, and it fails
closed on git metadata, symlinks, nested `node_modules`, non-regular files,
credential-shaped filenames, and any `clients/` path component.

```bash
_dev/sim-runs/vm/orwell/build-export.sh [out-dir]
# -> antworld-payload-<UTC>.tar.gz + .sha256 + .MANIFEST.txt (sha256 per file)
```

Expanding that allowlist is a fresh review event, not a code change.

## Image conversion

`convert-image.ps1` turns a Debian cloud `disk.raw` into a Gen2-compatible
dynamic VHDX using only native Windows facilities, because orwell has no
`qemu-img`:

```
disk.raw --append 512-byte VHD footer--> fixed .vhd --Convert-VHD--> .vhdx --Resize-VHD--> 20GB
```

A fixed VHD is exactly the raw payload plus that footer, so the first step is an
append rather than a re-encode. Run it as
`psrunfile.sh convert-image.ps1 genericcloud` (or `generic`).

Two PowerShell 5.1 behaviours are worked around explicitly, and both would
otherwise yield a silently malformed image: `0xFFFFFFFFFFFFFFFF` parses as Int64
`-1` and cannot be cast to `uint64`, and `[int64]` **rounds** rather than
truncating, which corrupts the CHS cylinder count. Do not "simplify" either
guard away.

The script verifies its own output by mounting the VHDX read-only and printing
the partition table; Windows can only parse that if the footer is correct. A
successful run shows a GPT disk carrying an EFI System Partition, which is what
makes a Generation 2 (UEFI-only) boot possible.

## Host paths

Everything on orwell lives under `D:\HyperV\AntWorld` — a separate physical NVMe
from the live `C:\SM_OS` checkout and the fleet worker service, outside both
legacy SM_OS trees, ACL'd to SYSTEM and Administrators only, with content
indexing disabled. Anything downloaded to orwell goes in `Downloads\` there and
nowhere else.

Never fetch, clone, pull, checkout, or modify any git ref on orwell.
