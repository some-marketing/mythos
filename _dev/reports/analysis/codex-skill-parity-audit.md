## Project Codex Skill Parity Audit: Mythos

> Audit time: 2026-09-14T16:28:15Z
> Scope: repository-local skills and Claude-command-to-Codex-skill projections. Installed third-party/global plugins are out of scope.
> Mode: read-only. No Mythos files were modified by this audit.

### Assessment

The Codex skill surface is materially incomplete and substantially stale relative to declared Mythos/Claude requirements. Four required system skills are absent, 49 command skills are absent across canonical and declared command surfaces, 45 eligible framework-local skills have no declared Codex projection target, 33 existing Codex skills fail the current Codex validator, and 69 of 104 present canonical command projections are drift candidates.

The requirements source is `.claude/project-claude.yml:9` for skills, `.claude/project-claude.yml:147` for commands, and `.claude/project-claude.yml:389` for subagents. Applying it to Codex is justified by the strict parity policy in `instructions/canonical/system.yaml:9`; however, `instructions/adapters/codex.yaml:18` declares managed commands but no required-skill inventory, which is itself a cause of silent drift.

### Critical Issues

1. **Four manifest-required system skills are missing from Codex**
   - Location: `.claude/project-claude.yml:9`
   - Current: 39 of 43 required system skills have a same-name `.agents/skills` entry.
   - Should be: all 43 required system skills should have a Codex-native projection or an explicit unsupported disposition.
   - Why it matters: these capabilities do not appear in the current Codex skill catalog and cannot be invoked as repository-local skills.
   - Fix: project the four skills from Claude source with canonical provenance and Codex-compatible frontmatter.
   - MISSING: .agents/skills/go/SKILL.md (not found)
   - MISSING: .agents/skills/meditate/SKILL.md (not found)
   - MISSING: .agents/skills/outward-inward-loop/SKILL.md (not found)
   - MISSING: .agents/skills/ticktock/SKILL.md (not found)

2. **Twenty-seven canonical commands lack Codex command skills**
   - Location: `instructions/canonical/commands/ground-in-philosophy.yaml:1` is a representative high-impact example; the comparison covered all 131 canonical command files.
   - Current: 104 of 131 canonical commands have `source-command-*` skills; 27 do not.
   - Should be: every canonical command should have a Codex projection or an explicit unsupported disposition with capability tier.
   - Why it matters: canonical operations can exist while remaining undiscoverable in Codex. This includes philosophy grounding, plan repair, system status, and harness self-help.
   - Fix: extend the canonical projector beyond lifecycle commands, with non-overwriting defaults and truthful execution classification.
   - MISSING: .agents/skills/source-command-aider-self-help/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-amend-plan/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-arc-blocked/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-arc-complete/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-arc-rest/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-arc-status/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-codex-self-help/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-continue-self-help/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-council-of-owls/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-crush-self-help/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-cursor-self-help/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-discord-access/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-el/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-fw-media-video-editing/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-gemini-self-help/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-goose-self-help/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-ground-in-philosophy/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-hermes-self-help/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-kilocode-self-help/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-lint-attributions/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-motivation-scan/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-opencode-self-help/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-pi-self-help/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-repair-plan/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-sm-os-status/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-substrate-fidelity-review/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-write-handoff/SKILL.md (not found)

3. **Twenty-two additional declared Claude commands lack Codex command skills**
   - Location: `.claude/project-claude.yml:147`
   - Current: 142 of 190 declared system command files have matching Codex source-command skills. Of the 48 absent declared wrappers, 26 are in the canonical list above, 19 are registered aliases, and 3 are manual/legacy commands. The canonical-only `substrate-fidelity-review` gap makes the union 49.
   - Should be: aliases should resolve to their canonical target without duplicating behavior; manual commands need either canonical promotion or an explicit unsupported disposition.
   - Why it matters: typed operator vocabulary behaves differently across Claude and Codex.
   - Fix: generate thin alias skills from `instructions/canonical/command-aliases.yaml:1`; review the three manual commands before projection.
   - MISSING: .agents/skills/source-command-appraise-grimoire/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-awaken-essence/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-cast-grimoire/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-chi/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-claim-spoils/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-commune/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-contract-ledger/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-empower-grimoire/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-enroll-patron/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-forge-grimoire/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-initiate-status/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-oil/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-open-contract/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-rank-up/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-refine-spoils/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-rehearse-grimoire/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-scribe-grimoire/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-spoils-ledger/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-tt/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-new-export-target/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-outward-inward/SKILL.md (not found)
   - MISSING: .agents/skills/source-command-ticktock/SKILL.md (not found)

4. **Thirty-three existing Codex skills fail the current Codex skill validator**
   - Location: representative failures are `.agents/skills/github-auth/SKILL.md:1` (invalid YAML) and `.agents/skills/audio-output/SKILL.md:1` (unsupported frontmatter keys).
   - Current: 33 of 182 `SKILL.md` files fail `quick_validate.py`. Five contain invalid YAML; the remainder primarily use unsupported Claude-specific frontmatter keys such as `version`, `execution_mode`, `trust_tier`, `status`, or `user-invocable`.
   - Should be: Codex projections should use the supported frontmatter schema while preserving semantic metadata under `metadata` when needed.
   - Why it matters: files may appear on disk yet fail formal Codex packaging or future discovery/loading.
   - Fix: transform frontmatter during projection rather than copying it verbatim.
   - Invalid files: `.agents/skills/audio-output/SKILL.md:1`, `.agents/skills/bp-r/SKILL.md:1`, `.agents/skills/bridge-dispatch-on-acceptance-claims/SKILL.md:1`, `.agents/skills/canonical-path-authority-gate/SKILL.md:1`, `.agents/skills/clean-house/SKILL.md:1`, `.agents/skills/council-of-owls/SKILL.md:1`, `.agents/skills/deliberate/SKILL.md:1`, `.agents/skills/discord-access/SKILL.md:1`, `.agents/skills/discord-configure/SKILL.md:1`, `.agents/skills/dl/SKILL.md:1`, `.agents/skills/dlx/SKILL.md:1`, `.agents/skills/execute-framework/SKILL.md:1`, `.agents/skills/extract-skill/SKILL.md:1`, `.agents/skills/github-auth/SKILL.md:1`, `.agents/skills/google-ads-mcp/SKILL.md:1`, `.agents/skills/lint-attributions/SKILL.md:1`, `.agents/skills/manage-clients/SKILL.md:1`, `.agents/skills/manage-frameworks/SKILL.md:1`, `.agents/skills/migrate-credential-to-1password/SKILL.md:1`, `.agents/skills/new-export-target/SKILL.md:1`, `.agents/skills/oa/SKILL.md:1`, `.agents/skills/oc/SKILL.md:1`, `.agents/skills/orchestrate-loop/SKILL.md:1`, `.agents/skills/orchestrate/SKILL.md:1`, `.agents/skills/owl/SKILL.md:1`, `.agents/skills/plan-task/SKILL.md:1`, `.agents/skills/prompt-refinement/SKILL.md:1`, `.agents/skills/propose-skill-capture/SKILL.md:1`, `.agents/skills/research/reference-compare/SKILL.md:1`, `.agents/skills/ship-workstream/SKILL.md:1`, `.agents/skills/sm-os-remember/SKILL.md:1`, `.agents/skills/state-reconciliation-preamble/SKILL.md:1`, `.agents/skills/store-credential/SKILL.md:1`.

5. **Most present canonical command projections are stale candidates**
   - Location: the projection authority gap is visible in `tools/skills/sync-skills.py:35`, which discovers Claude skills but not Claude commands, while `tools/skills/sync-lifecycle-command-skills.cjs:8` covers only six lifecycle commands.
   - Current: of 104 canonical commands with present source-command skills, exact objective/process/success-criteria comparison found 35 aligned and 69 with at least one absent canonical clause.
   - Should be: generated command skills should be reproducible from current canonical specs and check cleanly.
   - Why it matters: presence counts substantially overstate behavioral parity. `new-session` is one confirmed example: its older skill omits watcher-start and actor-sweep clauses.
   - Fix: build a general canonical command projector, then independently review exceptions where the canonical spec intentionally uses a thin routing contract.
   - Drift candidates: ad-copy-dev, assemble-prompt-system, audit-framework, author-prompt-system, blueprint, candidate-status, capture-status, capture-task, claim-intake, clean-house, concept-init, concept-promote, convene-gate-status, convene, debrief-run, deliberate, discord-configure, dl, evidence-loop, execute-plan, extract-skill, follow-signal, fw-deliverables-presentation-review, fw-deliverables-scope-verification, fw-deliverables-version-reconciliation, fw-meta-execution-normalization, fw-paid-media-ad-creative, fw-paid-media-campaign-management, fw-project-management-dart-collaboration, fw-project-management-feedback-to-tasks, fw-wordpress-analytics-tracking, fw-wordpress-content-editing, fw-wordpress-design-mockup-validation, fw-wordpress-design-research, fw-wordpress-documentation, fw-wordpress-page-cro, fw-wordpress-qa, fw-wordpress-seo-audit, fw-wordpress-seo-validation, generate-harness, improve-framework, list-frameworks, new-client, new-framework, new-project, new-session, normalize-capture, oa, oc, orchestrate-loop, owl, plan-pipeline, plan-task, project-status, promote-framework, prompt-refine, reference-compare, remember, replay-framework, review-progress, review-task-plan, route, run-framework, run-plan, scaffold-framework, self-help, sync-manifest, synthesize-debrief, validate-all-frameworks.

6. **Framework-local skill parity has no configured Codex destination**
   - Location: `tools/skills/sync-skills.py:35` deliberately discovers nested framework skills, but `tools/skills/sync-skills.py:272` defaults to an unused `external-harness-skills` directory rather than `.agents/skills`.
   - Current: 45 non-template framework-local `SKILL.md` files exist across 24 declared framework packages; none has a defined repo-local Codex projection contract. Root `source-command-fw-*` skills cover some framework entry points but not the nested helper skills.
   - Should be: the Codex adapter should declare whether framework skills are directly projected, routed through one framework entry skill, or intentionally unsupported.
   - Why it matters: claiming all 45 as simply missing would invent a target naming policy, but ignoring them would hide a large capability gap.
   - Fix: make an explicit architecture decision before generating these skills.

### Recommendations

1. **Create one authoritative Codex skill manifest**
   - Location: `instructions/adapters/codex.yaml:18`
   - Recommendation: declare required direct skills, canonical command projections, aliases, framework projection policy, and capability tier in canonical adapter data.
   - Benefit: future audits compare two explicit sets rather than infer Codex requirements from Claude layout.

2. **Prioritize high-leverage missing skills first**
   - Location: `instructions/canonical/commands/ground-in-philosophy.yaml:1`
   - Recommendation: first add ground-in-philosophy, repair-plan, sm-os-status, the four missing direct system skills, and the remaining lifecycle reconciliation.
   - Benefit: restores governance, recovery, status, and session-continuity capabilities before aliases and convenience wrappers.

3. **Separate generation from capability claims**
   - Location: `tools/skills/sync-lifecycle-command-skills.cjs:17`
   - Recommendation: retain explicit shared-handler versus model-driven classification and extend it command-by-command.
   - Benefit: avoids treating a discoverable Markdown file as proof of mechanical execution.

4. **Do not bulk-overwrite the current `.agents` tree**
   - Location: `tools/skills/sync-lifecycle-command-skills.cjs:109`
   - Recommendation: preserve the non-overwriting default, establish custody, and refresh in reviewed batches.
   - Benefit: the tree is untracked and contains prior-session work; staged reconciliation is safer and auditable.

5. **Repair the audit tooling before making it a gate**
   - Location: `.claude/project-claude.yml:9`
   - Recommendation: update the project-config verifier to understand current framework skill directories and optional command argument hints.
   - Benefit: the existing verifier reports 239 failures, many caused by obsolete structural assumptions rather than missing Codex capabilities.

### Inventory (Observed)

- Skills: 182 repository-local Codex `SKILL.md` files under `.agents/skills`; 181 unique frontmatter names; 0 duplicate names; 33 validator failures.
- Claude system skills: 44 `SKILL.md` files under `.claude/skills`; 43 are manifest-required system names and one is the unmanifested but mirrored `research/reference-compare` skill.
- Framework skills: 46 source files, of which 45 are eligible after excluding `_template`.
- Slash commands: 190 system command files declared by `.claude/project-claude.yml:147`; 142 corresponding Codex source-command skills.
- Canonical commands: 131; 104 have source-command skills, 27 are missing, and 69 of the 104 present projections are drift candidates.
- Subagents: 15 system subagents required by `.claude/project-claude.yml:389`; the dedicated Codex philosophy-grounding agent is present at `.codex/agents/philosophy-grounding.toml:1`.
- Guardrail files: requirements begin at `.claude/project-claude.yml:471`; the mechanical verifier found all seven sections it checked.
- Relative Markdown links: one apparent broken link was detected, but it is the literal placeholder `<filename>` in `.agents/skills/sm-os-remember/SKILL.md:1`, so it is not classified as a missing asset.

### Requirements Coverage

| Category | Required | Present | Missing |
|----------|----------|---------|---------|
| System skills | 43 | 39 | go, meditate, outward-inward-loop, ticktock |
| Declared system command skills | 190 | 142 | 48 |
| Canonical command skills | 131 | 104 | 27 |
| Alias command skills among declared commands | 19 | 0 | 19 |
| Manual/legacy command skills among declared commands | 3 | 0 | 3 |
| Framework-local Codex skills | policy unspecified | 0 direct projections | 45 eligible sources awaiting a destination policy |
| Codex skill schema validity | 182 files | 149 valid | 33 invalid |

### Mechanical Verification

- The repository's project-config verifier ran against a temporary symlink overlay so its report write did not modify Mythos. Result: FAIL, 996/1235 checks passed (81%), with 239 findings. Its skill/command checks assume every skill has three specific XML tags, forbid Markdown headings, and require every command to have `argument-hint`; these assumptions do not match many current canonical assets, so this result is evidence that the verifier itself needs reconciliation rather than proof of 239 Codex gaps.
- `npm run instructions:validate:skip-claude` passed schema and all 28 framework registry checks but failed because `AGENTS.md` is drifted from the changed Codex adapter.
- Command-resolution coverage reported 131 canonical commands, 141 findings, and zero harnesses with full command resolution.
- The existing Codex quick validator found exactly 33 invalid skill packages.
- No repository files were written by the audit.

### Next Steps

1. **Canonicalize requirements** — add a Codex required-skill/projection manifest before generating more files.
2. **Governance batch** — add the ground-in-philosophy command skill, repair-plan, sm-os-status, and the four missing direct system skills.
3. **Canonical command batch** — project the remaining 24 missing canonical commands and reconcile the 69 drift candidates with review exceptions for thin routing specs.
4. **Alias batch** — generate 19 thin alias skills that resolve to canonical targets and contain no duplicate behavior.
5. **Framework decision** — choose direct projection versus routed access for the 45 eligible framework-local skills.
6. **Schema repair batch** — normalize the 33 invalid frontmatter blocks without changing skill semantics.
7. **Regenerate and verify** — resolve custody on generated Claude/Codex surfaces, regenerate instructions, rerun both parity checks, and require an independent completion audit.
