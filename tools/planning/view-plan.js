#!/usr/bin/env node
'use strict';
/**
 * view-plan.js — ONE command to SEE a plan in the browser.
 *
 * DEPRECATED as a standalone SVG generator. Its old SVG builder read
 * `plan.steps` / `step.depends_on` / `step.classification` — an OLD shape that
 * silently failed on canonical `bounded_plan.steps` plans (which have no
 * `depends_on`). The SVG builder is now folded into
 * tools/planning/lib/plan-visibility.js (buildPlanDagSvg), which reads the
 * canonical shape and degrades gracefully to the older shape.
 *
 * This command is now a thin alias to the readable plan-document render, which
 * embeds the same inline SVG diagram (rendered natively in any browser, no
 * draw.io, no diagrams.net, no missing cluster files) plus the full per-step
 * prose, glossary, and agent-grounding block.
 *
 * Usage:
 *   node tools/planning/view-plan.js <task-id> [--no-open] [--output <path>]
 *
 * Editing (separate flow): export the draw.io + reimport corrections:
 *   node tools/planning/export-drawio-plan.js --plan <id> --include-client
 *   npm run plans:visual:corrections -- --diagram _dev/reports/analysis/visual-plans/<id>.drawio
 */
const { main } = require('./export-plan-document.js');
main();
