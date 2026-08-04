---
name: bare-drive-letter-writes-go-phantom
description: "Orwell courier root cause 2026-08-04 — a bare drive letter used as a path resolves relative to CWD, creating a phantom dir where writes self-verify; in-place verification proves nothing about the intended target"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2a3e83da-becd-4845-b2de-1be1dca94142
  modified: 2026-08-04T20:46:02.099Z
---

Root cause of the recurring Orwell "stale payload after verified load" bug (runbook
§14.3/§14.9 and the 2026-08-04 recurrence), artifact-confirmed 2026-08-04T20:44Z:
`Mount-Courier` returned a bare drive letter (`F`, no colon). `load-courier.ps1`
consumed it as a path (`Join-Path $dl …`, `-LiteralPath $dl`, `Copy-Item -Destination
$dl`), which PowerShell resolves RELATIVE to the session CWD. A `New-Item -Force`
created the phantom directory `C:\Users\<user>\F\`, after which every
remove/copy/hash cycle self-verified inside it — hash checks passed while the real
courier VHDX was never written. Found by the hardened `first-boot.ps1` fail-closed
assertion (independent read of the real mount) plus a marker-persistence experiment
and a direct listing of the phantom dir containing the full misdirected payload triple.

**Why:** Two general lessons. (1) A hash/read-back verification performed through the
same path variable that did the write only proves self-consistency, not that the
intended target was written — verify through an INDEPENDENT resolution of the target
(exactly what first-boot's assertion did, and why it caught two days of mystery).
(2) In PowerShell, `"F"` is a relative path, `"F:"` is drive-relative (per-drive CWD),
and only `"F:\"` is rooted — APIs that return bare letters invite this whole bug
class. Contract fix: return rooted paths and assert `^[A-Za-z]:\\$` + Test-Path at
every consumer.

**How to apply:** When reviewing or writing any script that receives a drive letter or
mount point: demand the rooted form, assert its shape before use, and never accept a
producer's in-place verification as proof of delivery — require one reader that
resolves the target independently. Phantom-residue check: a "verified but absent"
symptom means search for where the writes actually landed (CWD-relative artifacts)
before suspecting the storage layer. See [[go-is-cascade-down-bubble-up-review]] —
this is why independent per-fold checks exist.
