# Orwell courier-reversion evidence bundle — 2026-08-04T20:40Z

The recurring "stale payload after verified load" bug (runbook §14.3/§14.9, recurred
08-04) has now been caught under instrumentation. Question for reviewers: **what
mechanism makes a verified write to the courier VHDX not survive to the next mount?**

## Timeline (all times UTC, all transcript-backed under _dev/state/orwell-transcripts/)

- 20:34:44 `load-courier.ps1` run 1 (transcript `20260804T203444Z__9574__load-courier.ps1.log`):
  selected `antworld-payload-20260804T033550Z.tar.gz`, staging hash verified
  `c5ba85c6…`, "courier already detached", chkdsk OK, removed old files, copied new
  archive, **hash of the copy on the mounted courier verified `c5ba85c6…`**,
  dismounted, "courier attached to ant-world at 0/2". VM Off throughout.
- 20:35:01 `refresh-seed.ps1`: touched ONLY the seed vhdx (CIDATA); listed VM drives —
  showed OS avhdx at 0/0, seed at 0/1, **courier at 0/2 present**.
- 20:35:30± `first-boot.ps1` (hardened): pre-boot independent read of the courier →
  **OLD archive** `antworld-payload-20260802T200855Z.tar.gz` (`42b04876…`), old
  PAYLOAD-MANIFEST.txt and job.env.consumed also present. REFUSED to boot (fail-closed
  worked). Note: first-boot's courier touch begins with Detach-Courier → Mount →
  (clear job.env/CANCEL) → Dismount → Attach.
- 20:36:17 `load-courier.ps1` run 2 (transcript `20260804T203617Z__14626__load-courier.ps1.log`):
  IDENTICAL successful output — including "courier already detached" (so first-boot's
  throw left it detached) and on-courier hash verify `c5ba85c6…`, dismount, attach.
- 20:37:22 `check-provisioning.ps1` (read-only; detach → chkdsk → mount RO): **OLD
  archive again**, old manifest, old out/STATUS `cancelled-before-start`. chkdsk: no
  problems.
- 20:37:50± `inspect-disks.ps1` (read-only): Disks dir shows
  `ant-world-courier.vhdx` **mtime 2026-08-04 5:36:17 PM local (= 20:36:17Z — exactly
  load run 2's write window)**, size 71,303,168. `Get-VHD` on the courier: Dynamic, no
  parent, **Attached: False**. VM checkpoint list: ONE Standard checkpoint
  `golden-20260802T185743Z` (2026-08-02). Current VM config: OS avhdx at 0/0
  (parent `ant-world-os.vhdx`), seed at 0/1 — **no courier attached**, despite load
  run 2's "attached at 0/2". Only one avhdx exists and its parent is the OS disk, not
  the courier.

## The contradiction to explain

Within one script invocation the courier mount contains the new archive (hash-verified
in place); the container file's mtime confirms it was written; the next mount — same
literal path `D:\HyperV\AntWorld\Disks\ant-world-courier.vhdx`, via the same
courier-lib state machine — shows the pre-write contents, with chkdsk clean. Attach
state also does not persist (attached at 0/2 → later not attached, with an
intervening detach by check-provisioning accounting for only one of the two losses).

## Code surfaces

- `_dev/sim-runs/vm/orwell/courier-lib.ps1` — Assert/Detach/Attach/Mount/Dismount
  state machine (mandatory chkdsk on mount; FAT32, no journal)
- `_dev/sim-runs/vm/orwell/load-courier.ps1`, `first-boot.ps1`,
  `check-provisioning.ps1` — call sites
- Host: Windows Hyper-V, VM `ant-world`, zero-NIC, Standard checkpoint present,
  VM Off during all operations above.

## Hypotheses on the table (none confirmed)

- Hyper-V Standard-checkpoint interaction: some operation reverts VM device config
  (explaining attach-state loss); unclear how that would revert the vhdx CONTENT.
- Two distinct storage views of the same path (mount cache, stale F: assignment,
  Volume Shadow Copy, ReFS/dedup layer, antivirus rollback?) — content written into a
  view that is discarded.
- Dismount-VHD not flushing FAT32 writes before detach of the host mount, with the
  in-session hash read served from cache (would explain content loss but NOT the
  attach-state loss; and mtime shows the container WAS modified).
- A second actor/process on orwell re-running an old loader or reverting state between
  invocations (codewhale is a live resident actor on the Mac, but nothing known
  resident on orwell; no transcript evidence of concurrent activity).
