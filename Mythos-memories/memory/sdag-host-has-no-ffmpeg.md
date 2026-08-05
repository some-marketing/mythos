---
name: sdag-host-has-no-ffmpeg
description: "SDAG portal host has NO ffmpeg/ffprobe and no sudo — RESOLVED as a non-blocker: ratified posture is broker-side stripping; host ffmpeg permanently unnecessary; host-side checks must not hard-depend on it"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 7c7d1278-0292-4071-932f-f733e234aa05
  modified: 2026-07-31T12:29:11.511Z
---

**Verified live 2026-07-29 over SSH** on `vps.superdavesauto.ca` (66.70.238.182), as `sdautogroup.ca_xuzq2q6pmu`:

- `ffmpeg` and `ffprobe` are **not installed** — absent from `PATH`, `/usr`, `/opt`, `/usr/local`; `rpm -q ffmpeg` confirms. **No sudo**, so the subscription user cannot install packages.

**RESOLVED 2026-07-30/31 — not an MVP blocker.** The ratified posture (august-mvp plan, CORRECTED operator note 2026-07-30T13:47Z; operator reconfirmed in-session 2026-07-31) is **broker-side metadata stripping** (option 2 below, formalized): "host-side ffmpeg is permanently unnecessary; nothing here may depend on it" (plan.md:571). Media re-encoding/stripping happens on the operator-side broker; the host only serves already-stripped artifacts.

Consequences:
- Any host-side check or control that hard-depends on ffmpeg presence is a **defect against the posture**. One such fixed 2026-07-31: `deploy/verify-worker-schedule.sh` check 5 downgraded FAIL→WARN (was making the G5 evidence gate mechanically unclearable).
- `process-upload-jobs.php` still degrades gracefully (video jobs queue rather than fake success) — that behavior stays correct; video derivatives are the broker's job.
- A Websavers ffmpeg install remains a "bonus", never a dependency.

Historical options considered: (1) Websavers installs ffmpeg; (2) process off-host/broker-side — **ratified**; (3) image-only scope — rejected (G-IMAGE-ONLY not adopted; G-MEDIA-BROKER-STRIP replaces it).

Related: [[reference_sdag-portal-ssh-sftp-access]] (same host, access details).
