---
name: new-export-target
description: Spin up a new public export target (a themed or plain re-skinned public repo) from the private Mythos canon via the export-public pipeline — map + denylist authoring by shipped-tree diff, staged surface, composed-tree semantic gate, distinct-family review ladder, apply with live verification. Use when the operator wants a second/third public repo derived from Mythos (precedents: learning-language-models 2026-07-02, mythos 2026-07-21).
version: 1.0.0
execution_mode: COORDINATOR
trust_tier: reviewed
---

<skill>

<objective>
Produce a fully-populated, leak-scanned, independently-reviewed public repo from the
private Mythos canon as a SECOND (or Nth) export target: a parameterized export map +
denylist, a staged surface for target-specific content (docs, commands, aliases,
generator), a composed-tree semantic gate, a distinct-family adversarial review ladder,
and an applied + live-verified target — ending at operator gates (commit in target,
push, visibility flip).
</objective>

<prompt_type>Coordinator</prompt_type>

<execution_mode>
COORDINATOR — the invoking session orchestrates; bounded workers implement; a
distinct-family reviewer (Codex by default) validates. Producer never validates its
own acceptance-grade outcome. Target-repo commit/push/public-flip are operator gates.
</execution_mode>

<model_recommendation>
Frontier coordinator; sonnet-tier workers for bounded authoring; distinct-family
(non-Claude) reviewer for every review round.
</model_recommendation>

<quick_start>
1. [AUTO] Recon: enumerate what the PRIOR release actually shipped (shipped tree, not the export map — maps drift); extract ExportMap/denylist/alias schemas
2. [USER] Rulings: target repo/remote, theme+lexicon direction, framework scope (which shipped set), vocabulary sources
3. [AUTO] If themed: research leg (Perplexity or equivalent web-grounded mind) for the lexicon; ratify in a concept doc — the naming authority for all workers
4. [AUTO] Pipeline: ensure --map/--denylist parameterization, forbidden[] raw-scan (case-insensitive, path-aware, byte/encoding-aware inspectFile), receipt run-id namespacing — defaults byte-identical (prove it)
5. [AUTO] Map + denylist: derive framework/unit entries by DIFFING private dirs against the shipped public tree (private-only→exclude, sanitization-shaped→mock, drift→export); brand substitutions; hard-block private-canon terms (fail, never substitute)
6. [AUTO] Staged surface under tools/export-public/<target>-surface/: themed README/QUICKSTART/LEXICON, command files (alias-layer doctrine: mythic/theme names are aliases, authority stays generic), alias registry, canonical layer + generator staged FROM the shipped public tree; subdir-targeted units (never target repo root — EP-S2-002); root files via place-root-docs enumerated lane
7. [AUTO] Composed-tree gate (check-composed-tree.cjs): package-script resolution, generate+validate, alias coverage AND stub-target validation, operation-mode parity, setup smoke (both streams), private-substrate scan (content + paths, all encodings), whole-tree denylist scan
8. [AUTO] Review ladder: dispatch-bridge → codex /review-progress with a written brief; repair findings via the owning workers; re-review until CLEAR_FOR_APPLY; iteration ceiling ~5 then bubble to operator
9. [AUTO] Apply: exporter --apply + place-root-docs --apply; in-target npm install, instructions:generate/validate, setup smoke; fix live regressions and re-verify
10. [USER] Operator gates: commit in target (custody gate is not repo-aware — operator runs it), push to remote, public visibility flip
</quick_start>

<execution_rules>
  <rule id="shipped-tree-is-truth">The prior release's ON-DISK shipped tree outranks the export map when they disagree; derive new entries by diff, record the derivation in the map's notes.</rule>
  <rule id="alias-layer-doctrine">Theme names are alias records (resolves_to + status); canonical ids stay generic; authority/state/errors belong to the resolved command. No directory renames.</rule>
  <rule id="membrane-precise-tokens">Ban precise private tokens (_dev/ paths, HandoffSignal, private schema ids, client codes, world-canon) — never blanket generic nouns (session/lifecycle/bridge).</rule>
  <rule id="forbidden-fails-never-substitutes">A forbidden term's presence means the wrong file class was selected; hard-block on RAW pre-substitution text and paths, all lanes, case-insensitive, encoding-aware.</rule>
  <rule id="gate-proves-behavior">The composed gate must EXECUTE the beginner path (both output streams) and validate semantics (stub targets, mode parity), not just presence.</rule>
  <rule id="producer-validator">Repairs by Claude workers; review by a distinct family; if the reviewer executes repairs, swap the re-review family.</rule>
  <rule id="private-until-verified">Target repo stays private/unpushed until the full gate + review ladder clears; push and public flip are separate operator gates.</rule>
  <rule id="mock-hygiene">Mocks are substitution-processed on copy and scanned like exports; target-specific configs (map/denylist) are excluded + mock-shadowed with .example versions so real config never ships.</rule>
</execution_rules>

<context>
Implementation surfaces (all exist and are tested — reuse, don't rebuild):
- tools/export-public/export-public.cjs — exporter (--map/--denylist/--apply/--force; inspectFile shared primitive)
- tools/export-public/place-root-docs.cjs — enumerated root-file lane (root_files map field, mode-preserving)
- tools/export-public/check-composed-tree.cjs — semantic pre-apply gate (private-only, not shipped)
- tools/export-public/config/mythos-export-map.json + denylist-mythos.json — worked example of a second target
- tools/export-public/mythos-surface/ — worked example of a staged surface
- _dev/concepts/mythos-public-port.md — worked example of a ratified lexicon/decision concept
- _dev/reports/analysis/mythos-public-port__preapply-repair-2-plan.json — worked example of the review-repair plan shape (expected_outcomes/required_gates)
</context>

<inputs>
  <required>
    <input name="TARGET_REPO">Absolute path of the target repo (blank or wipeable)</input>
    <input name="TARGET_REMOTE">Git remote URL (preflight-checked by the exporter)</input>
    <input name="SCOPE_RULING">Operator ruling: which framework set + what stays private</input>
  </required>
  <optional>
    <input name="THEME">Lexicon/theme direction (omit for a plain re-brand)</input>
    <input name="BASE_MAP">Prior export map to derive from (default framework-export-map.json)</input>
  </optional>
</inputs>

<outputs>
  <output name="export-map">tools/export-public/config/&lt;target&gt;-export-map.json</output>
  <output name="denylist">tools/export-public/config/denylist-&lt;target&gt;.json (forbidden[] + brand subs)</output>
  <output name="staged-surface">tools/export-public/&lt;target&gt;-surface/ (docs, commands, aliases, canonical, generator)</output>
  <output name="concept">_dev/concepts/&lt;target&gt;-public-port.md (ratified decisions + lexicon)</output>
  <output name="review-artifacts">briefs, review-progress verdicts, repair plans under _dev/reports/analysis/</output>
  <output name="target-repo">populated, generated, validated target awaiting operator commit/push/flip</output>
</outputs>

<success_criteria>
- check-composed-tree.cjs reports CLEAR on every dimension (package scripts, generate/validate, alias coverage + stub targets, mode parity, setup smoke, private substrate 0/0/0, denylist 0, root_files)
- Distinct-family review verdict CLEAR_FOR_APPLY on the final changeset
- Target repo: install + generate + validate + setup all pass live; zero private tokens by scan
- Every alias in the registry is a callable command file resolving to one generic authority
- Operator gates reached with truthful evidence (no unverified claims)
</success_criteria>

</skill>
