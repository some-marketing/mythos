---
name: memory-vault-rewire-state-and-operator-gates
description: "Memory/vault wiring is LIVE as of 2026-07-30 (11 memories, launchd jobs loaded, Mythos-memories populated); OD1/OD2 operator gates still open incl. pushed-secrets remediation call"
metadata: 
  node_type: memory
  type: project
  originSessionId: b07a6739-e94e-44d9-89e4-a715c3deecea
  modified: 2026-08-02T22:04:20.453Z
---

As of 2026-07-30 the Mythos memory architecture is live: memory.sqlite ingests the full corpus (10 pocket + 1 kernel + concepts) each session-start; `Mythos-memories/` is the canonical fresh vault (default-deny gitignore, only `memory/` tracked); launchd jobs `ca.somemarketing.mythos.obsidian-vault-sync` (30min) and `.dream-rebuild` (3AM, now also rebuilds MOCs) are bootstrapped and verified running. Evidence: `_dev/reports/analysis/mythos-memory-vault-rewire__evidence.md`.

**Why:** the port previously existed but was dead (see [[harness-project-dir-is-the-slug-authority]]); this records what is now true so sessions don't re-diagnose.

**How to apply / open gates:**
- **OD1 RESOLVED 2026-08-02T22:04Z (operator ruling):** pushed-history remediation = **forward-only hygiene; no history rewrite** — "it's a private repo so that's fine." Covers the metadata-class exposure AND the sam-identity cluster (values premise "personal stays personal" satisfied by private+access-controlled custody per the operator). Aligned with external doctrine (GitHub/OWASP: rewrites are a secrets-class fallback; this exposure has no credential values — research in the QE evidence-loop artifacts). Residual open bits, all minor: the 11 downgrade candidates (batch disposition pending), untracking `_dev/state/memory-db/` generated files. Prepared actions doc remains at `staged-canonical/od1-od2__prepared-actions.md`.
- **OD2 DONE 2026-08-02 (operator, verified):** `Mythos-memories/` registered in obsidian.json; `.obsidian/` created and gitignore-covered. Residual note: the LEGACY quarantine-class vault (`~/dev/SM_OS-recovered/sm_os-memories`) is still registered and open:true in Obsidian — removing it from the vault list (UI, "Remove from list", does not delete files) is an optional operator tidy given that corpus is supposed to be quarantine/cold-storage.
- Perplexity RESOLVED 2026-07-30: operator logged in (session at ~/.Mythos/browser_profiles/perplexity/), driver repaired + smoke-verified (commit 84c19bd00 — keystroke typing, cookie-modal dismissal, {CLIENT_CODE} placeholder bug fixed, main-region extraction fallback). Browser path is the working rung; .env API key still empty. Backup age recipient seeded (a82906b48).
- Rewire work committed on client-storage-cloud-drives: f127a0812, d7fbe72e2, c59b34f9b, eb05ef117, 24ad6297b.
