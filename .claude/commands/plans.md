---
description: Render the local Mythos plan visibility dashboard
mode: REVIEW_ONLY
---

<objective>
Give the human operator a single repo-native entrypoint for understanding current Mythos plans and their interconnections without replacing task-plan authority.
</objective>

<process>
- Run `npm run plans:dashboard` to rebuild the generated dashboard bundle from current task-plan artifacts.
- Run `npm run plans:document -- <task-id> --no-open` to render one self-contained readable plan document as `<task-id>.plan.html`, including the plain `What this is` lead sentence, context, steps, inline diagram, glossary, and agent-grounding block.
- Run `npm run plans:dashboard:all-visuals` when every detected relationship workstream needs a generated focused visual brief, not only the default dashboard top workstreams.
- Run `npm run plans:where` to print the current generated dashboard paths, counts, quick views, and top workstream routes without rebuilding.
- Run `npm run plans:where -- --plan <task-id>` to locate one plan's source artifact, focused dashboard map, workstream brief, next command, Plan Action Board lane membership, compact connection evidence, incoming/outgoing relationship counts, direct neighbors, workstream peers, and plan-specific remediation rows.
- Run `npm run plans:where -- --workstream <cluster-id>` to locate one connected workstream's focused map, visual brief, suggested next plan, status mix, relationship intents, and sample plans.
- Run `npm run plans:where -- --from <task-id> --to <task-id>` to find a bounded connection path between two visible task plans, including relationship intent, source edge direction, and the plan sequence.
- Use the HTML dashboard Connection Path Finder to choose two plans and render their connection path directly in the visual graph.
- Use the HTML dashboard selected-plan Local Flow visual to scan immediate incoming and outgoing relationships around one selected plan.
- Use the HTML dashboard All filtered plans graph toggle when the default readable graph cap hides part of the current filtered plan set.
- Use the HTML dashboard Visible Relationships table to read the currently filtered source-to-target links with relationship type, interpreted intent, and evidence.
- Use relationship confidence labels to distinguish declared metadata links from derived task-id mention links before treating an edge as load-bearing.
- Use the HTML dashboard relationship-confidence filter and dashboard index Relationship Confidence overview to inspect high, medium, and derived relationship edges separately.
- Use the HTML dashboard Workstream Matrix to inspect every detected relationship cluster, including smaller workstreams that do not have generated visual briefs.
- Use Workstream Connection Stories to understand why every detected workstream is grouped together, including dominant relationship intents, example source-to-target links, evidence snippets, bridge plans, or isolated-workstream wording when no links exist yet.
- Use the Workstream Connection Stories search, intent filter, and story-type filter to find specific workstream explanations without scanning every story row.
- Share or reopen Workstream Connection Story filters through the dashboard URL hash using story search, story intent, or linked-versus-isolated story mode.
- Use the dashboard index Priority Scan and `npm run plans:where` Priority scan section to see the first few generated inspection candidates with reasons, map links, source paths, and next commands.
- Use the dashboard index Dashboard Navigator to jump directly to the plan-map section that answers the current question before scanning the full page.
- Use the dashboard index Operator Question Router when the operator has a plain-language question such as where to start, what can run now, what needs routing repair, how plans interconnect, which workstream to inspect, where the map is weak, what changed recently, or where the full dashboard is.
- Use the dashboard index How To Read This Map guide when the operator needs definitions for generated map, workstream, relationship, confidence, action lane, map quality, review lane, or visual brief terms and their trust boundaries.
- Use the Protocol Readiness section in the dashboard index, Markdown report, or `npm run plans:where` to see which plans carry Current State, Question / Work, Desired State, bounded steps, review lane, risk tier, and completion evidence before treating a plan as routed for execution.
- Use Execution Readiness in the dashboard index, Markdown report, or `npm run plans:where` to separate truly routeable action candidates from work that needs protocol repair, dependency review, map repair, or impact review first.
- Use Routing Blockers in the dashboard index, Markdown report, or `npm run plans:where` when ready-looking plans exist but no work is ready to route, so the first blocking lane and repair command are visible.
- Use First Repair Path in the dashboard index, Markdown report, or `npm run plans:where` to follow an operator-prioritized repair ladder before routing work.
- Use Risk Gate Queue in the dashboard index, Markdown report, or `npm run plans:where` to see ready-looking plans that still need operator-gate, codex-bridge, or protocol-repair interpretation before execution.
- Use Orchestration Routing Board in the dashboard index, Markdown report, or `npm run plans:where` to see whether visible work should be repaired before dispatch, held for operator gate, sent through Codex bridge review, verified locally, or amended for missing route metadata.
- Use Command Runbook in the dashboard index, Markdown report, or `npm run plans:where` to see current suggested commands grouped by verb, purpose, source surface, gate/lane, and reason.
- Use the Plan Action Board in the dashboard index, system map, operator brief, or `npm run plans:where` to scan runnable work, dependency-watch items, map repairs, and impact-review candidates as action lanes with exact commands.
- Use the dashboard index Review Lane Routing overview to see whether visible plans route through verify-local, codex-bridge, operator-gate, or missing-review-lane repair before execution.
- Use the `npm run plans:where` Review lane routing section to inspect the same review-lane counts and routes from the terminal.
- Use the dashboard index Action Readiness Flow to see how visible action candidates split across runnable work, dependency-watch work, map repairs, and impact-review lanes.
- Use the dashboard index Plan Protocol Flow to understand how /dl, concept-init, plan-task, review, execution, audit, and handoff fit together.
- Use the dashboard index Workstream Overview to scan the largest connected workstreams as clickable bubbles sized by plan count.
- Use the dashboard index Largest Workstream Breakdown to inspect the biggest connected workstream's status mix, top intents, bridge plans, and suggested next plan before opening its full map.
- Use Workstream Drilldowns in the dashboard index, Markdown report, or `npm run plans:where` to split large connected workstreams into smaller framework/status slices with suggested next commands.
- Use the dashboard index Interconnection Paths to scan ready or important plans with upstream feeders, downstream dependents, workstream context, and exact next commands before opening the full graph.
- Use the dashboard index Dependency & Sequence Chains to scan multi-hop dependency and sequence routes, then open the linked connection-path view for the route.
- Use the dashboard index Connection Evidence Spotlight to inspect representative source-to-target links with interpreted intent, confidence, confidence rationale, and evidence snippets before treating graph lines as load-bearing.
- Use the dashboard index Subtask Hierarchy Spotlight to inspect parent, child, and subtask-style hierarchy relationships before opening the full graph.
- Use the dashboard index Bridge Plans overview to scan highly connected plans that explain how workstreams interlock.
- Use Impact Hubs in the dashboard index, system map, operator brief, or `npm run plans:where` to identify structurally important driver, convergence, and bridge plans before inspecting detailed graph paths.
- Use the dashboard index Relationship Types overview to scan dominant relationship intents and jump to intent-filtered dashboard views.
- Use the dashboard index Status Overview to scan plan-state distribution and jump to status-filtered dashboard views.
- Use the dashboard index Map Quality overview to scan plan-map confidence gaps and jump to quality-filtered dashboard views.
- Use the generated Graph Health section to understand relationship coverage, link density, source/intent mix, and weakest confidence areas before treating the map as complete.
- Use Map Confidence Actions to open filtered weak-area views and identify which source task plans need relationship metadata, routing metadata, risk metadata, or bounded steps.
- Use the Remediation Queue to inspect plan-level weak-area rows with source links, recommended fixes, and next commands.
- Use Unlinked Plan Triage in the dashboard index, system map, operator brief, or `npm run plans:where` to inspect isolated plans that need relationship metadata before the plan map can be treated as complete.
- Use the Visual Flowcharts inventory to find generated Mermaid flowchart artifacts and the command for making another focused plan or workstream brief.
- Use the Visual Coverage Queue to see which detected workstreams still lack generated visual briefs and copy the exact command for generating each queued brief.
- Use readable `<task-id>.plan.html` plan documents when the operator needs the whole plan in one human-readable page rather than a graph-first dashboard or focused visual brief.
- Use Recent Source Activity in the dashboard index, system map, operator brief, or `npm run plans:where` to see the newest visible task-plan source files by filesystem modified time with status, workstream, next command, and source link.
- Use Plan Progress Timeline in the dashboard index, system map, operator brief, or `npm run plans:where` to see recently touched visible plans with status, workstream, next step, next command, and quality signals.
- Use `_dev/reports/analysis/visual-plans/index.html` as the searchable local visual-brief library when many workstream briefs have been generated.
- Use `_dev/reports/analysis/visual-plans/visual-plan-adapter-manifest.json` as the local handoff manifest for BuilderIO/Agent-Native-style visual-plan tooling; it is derived context only and does not push to hosted tools.
- Open or report `_dev/reports/analysis/plan-visibility__index.html` as the primary local dashboard entrypoint.
- Use `_dev/reports/analysis/plan-visibility__current.html` for the default system-only view.
- Use `_dev/reports/analysis/plan-visibility__all.html` only when client-plan visibility is explicitly intended.
- Use `_dev/reports/analysis/plan-visibility__current.json` and `_dev/reports/analysis/plan-visibility__all.json` as derived model exports for adapters or review.
- Run `npm run plans:dashboard:smoke` when changing the dashboard renderer or when visual proof is needed; it verifies the rendered HTML and writes screenshot evidence.
- If the dashboard shows a plan that is ready to execute, route execution through `/review-task-plan <task-id>` or `/run-plan <task-id>` as appropriate. Do not execute from this command.
</process>

<success_criteria>
- The dashboard bundle is regenerated from current repo state
- The operator can find the index page without remembering generated file paths
- The operator can locate a specific plan, connected workstream, or connection path from the command line
- The selected-plan locator and selected-plan dashboard detail expose current Plan Action Board lane membership when the plan appears in an action lane
- The selected-plan locator and selected-plan dashboard detail expose compact relationship evidence explaining why neighboring plans are connected
- The selected-plan dashboard detail renders a Local Flow visual for immediate incoming and outgoing relationships
- The HTML dashboard can render a visual connection path between two selected plans
- The HTML dashboard can render every currently filtered plan in the relationship graph when the all-filtered graph toggle is enabled
- The HTML dashboard exposes the currently filtered relationships as a readable source/target/type/intent/evidence table
- Relationships expose confidence labels and confidence rationale in the shared model, Markdown reports, HTML dashboard, and selected-plan locator context
- The dashboard can filter visible relationships and visible plans by relationship confidence, and the dashboard index links directly to confidence-filtered views
- The shared model and HTML dashboard Workstream Matrix include every detected relationship cluster, not only the dashboard-visible top clusters
- Workstream Connection Stories explain every detected workstream with deterministic relationship examples, evidence snippets, bridge-plan context, or isolated-workstream wording
- The HTML dashboard can search and filter Workstream Connection Stories by text, relationship intent, and linked-versus-isolated story type
- The HTML dashboard preserves Workstream Connection Story filters in the URL hash so filtered explanation views can be reopened
- The dashboard index and command-line locator expose a generated priority scan for the next few plans or workstreams to inspect
- The dashboard index renders a Dashboard Navigator with anchor links and short purposes for major plan-map sections
- The shared model, dashboard index, Markdown report, and plans:where locator render an Operator Question Router that maps common operator questions to exact views and commands
- The shared model, dashboard index, Markdown report, and plans:where locator render a How To Read This Map guide with vocabulary, usage guidance, and trust boundaries
- The shared model, dashboard index, Markdown report, and plans:where locator render Protocol Readiness with protocol-ready counts, missing-field checks, repair rows, and exact repair commands
- The shared model, dashboard index, Markdown report, and plans:where locator render Execution Readiness lanes that separate ready-to-route work from protocol-repair, dependency-review, map-repair, and impact-review first work
- The shared model, dashboard index, Markdown report, and plans:where locator render Routing Blockers explaining why ready-looking work is not yet routeable and which blocker lane to clear first
- The shared model, dashboard index, Markdown report, and plans:where locator render First Repair Path with an ordered repair ladder, exact first command, and map route before execution
- The shared model, dashboard index, Markdown report, and plans:where locator render Risk Gate Queue with high-risk ready items, gate owner, reason, exact command, and map route before execution
- The shared model, dashboard index, Markdown report, and plans:where locator render Orchestration Routing Board with route owner, actor route, reason, first plan, exact command, and map route before dispatch or execution
- The shared model, dashboard index, Markdown report, and plans:where locator render Command Runbook with current command suggestions grouped by verb, purpose, source surface, gate/lane, reason, and exact command
- The Plan Action Board exposes runnable, dependency-watch, map-repair, and impact-review lanes with reasons, source links, map routes, and exact next commands
- The dashboard index renders a Review Lane Routing overview with counts and links for verify-local, codex-bridge, operator-gate, and missing-review-lane repair views
- `npm run plans:where` renders the same Review lane routing counts and routes in terminal and JSON output
- The dashboard index renders a visual Action Readiness Flow from visible action candidates to the current action lanes
- The dashboard index renders a visual plan protocol flow without requiring hosted visual tooling
- The dashboard index renders a visual top-workstream overview without requiring hosted visual tooling
- The dashboard index renders a Largest Workstream Breakdown for the biggest connected workstream with status mix, top intents, bridge plans, suggested next, and a focused-map link
- The shared model, dashboard index, Markdown report, and plans:where locator render Workstream Drilldowns that split large connected workstreams into smaller framework/status slices with suggested next commands
- The dashboard index renders Interconnection Paths showing upstream feeders, downstream dependents, workstream context, and next commands for current action paths
- The dashboard index and plans:where locator render dependency and sequence chains with exact connection-path links
- The dashboard index renders Connection Evidence Spotlight cards with source-to-target links, interpreted intent, confidence, confidence rationale, evidence snippets, and connection-path routes
- The dashboard index renders Subtask Hierarchy Spotlight cards with parent plans, child/subtask counts, child examples, confidence, evidence snippets, and hierarchy-filtered routes
- The dashboard index renders a visual bridge-plan overview without requiring hosted visual tooling
- Impact Hubs expose the highest-impact connected plans with role, link counts, workstream context, source links, next commands, map routes, and why-it-matters summaries
- The dashboard index renders a visual relationship-type overview without requiring hosted visual tooling
- The dashboard index renders a visual plan-status overview without requiring hosted visual tooling
- The dashboard index renders a visual map-quality overview without requiring hosted visual tooling
- The generated view labels itself as derived context, not authority
- System-only view remains the default; client-plan view remains explicit
- Interconnections include explicit metadata links and derived task-id mention links
- Graph Health exposes relationship coverage, link density, and map-confidence gaps
- Map Confidence Actions expose filtered routes and remediation guidance for weak graph areas
- The Remediation Queue exposes plan-level source links and next commands for weak graph areas
- Unlinked Plan Triage exposes isolated plans with source links, next commands, map routes, and relationship-metadata repair guidance
- The Visual Flowcharts inventory exposes generated Mermaid artifacts, map links, and generation commands
- The Visual Coverage Queue exposes missing workstream visual briefs with exact generation commands
- The readable plan-document route is first-class: `npm run plans:document -- <task-id> --no-open` renders a self-contained `<task-id>.plan.html` with a plain `What this is` lead sentence and preserves task-plan JSON/MD as authority
- Recent Source Activity exposes the newest visible task-plan source files with modified time, status, workstream context, source link, and next command
- Plan Progress Timeline exposes recently touched visible plans with status, workstream, next step, next command, and quality signals
- The all-visuals dashboard build can generate a focused visual brief for every detected relationship workstream
- The visual brief library has a searchable local HTML index for generated workstream briefs
- The command does not mutate task-plan source artifacts or execute plans
</success_criteria>

<handoff>
primary_dashboard: _dev/reports/analysis/plan-visibility__index.html
regenerate: npm run plans:dashboard
regenerate_all_visuals: npm run plans:dashboard:all-visuals
locate: npm run plans:where
locate_plan: npm run plans:where -- --plan <task-id>
locate_workstream: npm run plans:where -- --workstream <cluster-id>
locate_path: npm run plans:where -- --from <task-id> --to <task-id>
readable_plan_document: npm run plans:document -- <task-id> --no-open
visual_plan_adapter_manifest: _dev/reports/analysis/visual-plans/visual-plan-adapter-manifest.json
visual_brief_library: _dev/reports/analysis/visual-plans/index.html
generate_visual_brief: npm run plans:visual -- --plan <task-id> --write
visual_smoke: npm run plans:dashboard:smoke
execute_selected_plan: /run-plan <task-id>
review_selected_plan: /review-task-plan <task-id>
amend_dashboard_plan: /amend-plan plan-visibility-surface
</handoff>
