#!/usr/bin/env node
'use strict';

/**
 * print-cascade.cjs — P2 legibility deliverable.
 *
 * Renders ONE real cascade as a human-readable INDENTED TREE. Each line is a
 * plain-English node — e.g. "coordinator (opus) -> dispatched codex review ->
 * 2 model calls, 1.2k tokens" — so a non-engineer can read a run end to end.
 *
 * This is the human-facing twin of query.cjs (machine-facing). Both read the
 * same authoritative append-only store via lib/assemble-tree.cjs.
 *
 * Usage:
 *   node print-cascade.cjs --trace <id|latest> [--file <path>] [--no-legend]
 */

const { queryTrace, sumTree } = require('./lib/assemble-tree.cjs');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function parseArgs(argv) {
  const out = { trace: 'latest', file: null, legend: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--trace') out.trace = argv[++i];
    else if (a === '--file') out.file = argv[++i];
    else if (a === '--no-legend') out.legend = false;
  }
  return out;
}

// ---- plain-English phrasing ------------------------------------------------

function fmtTokens(n) {
  const t = Number(n) || 0;
  if (t === 0) return '0 tokens';
  if (t < 1000) return `${t} tokens`;
  return `${(t / 1000).toFixed(t < 10000 ? 1 : 0)}k tokens`;
}

// A model/mind label for the parenthetical. Prefer the real (witnessed) model
// name; then the structured C6.2 sentinel (a parallel context whose model the
// Stop hook could not verify); then the tier; else say the mind is unrecorded.
function mindLabel(span) {
  if (span.model) {
    const m = String(span.model).toLowerCase();
    // Friendly short names for the common minds.
    if (m.includes('opus')) return 'opus';
    if (m.includes('sonnet')) return 'sonnet';
    if (m.includes('haiku')) return 'haiku';
    if (m.includes('fable')) return 'fable';
    if (m.includes('gemini')) return 'gemini';
    if (m === 'codex' || m.includes('gpt')) return span.model;
    return span.model;
  }
  // C6.2 sentinel: an in-session Claude subagent (parallel context) whose actual
  // model the SubagentStop hook could not independently verify. Render it as a
  // distinct, honest label — NEVER the bare 'mind not recorded' blank — so an
  // operator can tell a witnessed model from an unverified one at a glance.
  if (span.model_verified === false && span.mind_class) {
    const rel = span.mind_relation || 'parallel-context';
    return `${span.mind_class} · ${rel} · model-unverified`;
  }
  if (span.model_tier) return `${span.model_tier}-tier mind`;
  return 'mind not recorded';
}

// The action verb-phrase, from routing_decision + who the child is.
function actionPhrase(node) {
  const s = node.span;
  const rd = s.routing_decision;
  const kids = node.children;
  const kidLabel = (k) => {
    const sub = k.span.subagent_type && k.span.subagent_type !== 'unknown'
      ? k.span.subagent_type : (k.span.actor_role || 'a worker');
    return sub;
  };

  if (kids.length === 0) {
    // A leaf — describe what it did by its own role/work.
    if (s.subagent_type === 'codex') return 'ran a distinct review';
    if (s.work_class_inferred === 'mechanical') return 'did mechanical work';
    if (rd === 'do-self') return 'ran the work itself';
    return 'did its work';
  }

  // Has children — it dispatched.
  if (kids.length === 1) {
    return `dispatched ${kidLabel(kids[0])}`;
  }
  // Multiple children — summarize the fan-out.
  const labels = [...new Set(kids.map(kidLabel))];
  if (labels.length === 1) return `dispatched ${kids.length}x ${labels[0]}`;
  return `dispatched ${kids.length} children (${labels.slice(0, 3).join(', ')}${labels.length > 3 ? ', …' : ''})`;
}

// The economics tail: "N model calls, X tokens" rolled up over the subtree.
function economicsTail(node) {
  const roll = sumTree(node);
  const parts = [];
  if (roll.model_calls > 0) parts.push(`${roll.model_calls} model call${roll.model_calls === 1 ? '' : 's'}`);
  if (roll.tool_uses > 0) parts.push(`${roll.tool_uses} tool use${roll.tool_uses === 1 ? '' : 's'}`);
  parts.push(fmtTokens(roll.tokens));
  if (roll.cost > 0) parts.push(`$${roll.cost.toFixed(4)}`);
  return parts.join(', ');
}

// The harness suffix for the parenthetical (c6-mind-coverage-repair). Surfaces
// the execution RUNTIME alongside the mind, so an operator sees mind AND harness
// at a glance (the same model can run under different harnesses). A non-witnessed
// harness keeps its witness_state visible so 'inferred'/'sentinel' never reads as
// a witnessed fact. Empty when no harness is recorded (legacy/unstamped rows).
function harnessLabel(span) {
  if (!span || !span.harness) return '';
  const ws = span.harness_witness_state;
  return ws && ws !== 'witnessed' ? ` @${span.harness}·${ws}` : ` @${span.harness}`;
}

function nodeLine(node) {
  const s = node.span;
  const role = s.actor_role || s.subagent_type || 'actor';
  const orphanMark = node._orphan ? ' ⚠orphan' : '';
  const statusMark = s.status && s.status !== 'ok' ? ` [${s.status}]` : '';
  return `${role} (${mindLabel(s)}${harnessLabel(s)}) → ${actionPhrase(node)} → ${economicsTail(node)}${statusMark}${orphanMark}`;
}

// ---- tree rendering --------------------------------------------------------

function renderNode(node, prefix, isLast, lines, isRoot) {
  const connector = isRoot ? '' : (isLast ? '└─ ' : '├─ ');
  lines.push(prefix + connector + nodeLine(node));
  const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
  node.children.forEach((c, i) => {
    renderNode(c, childPrefix, i === node.children.length - 1, lines, false);
  });
}

const LEGEND = [
  'Legend:',
  '  role (mind)      — the actor and the model/mind it ran on (coordinator routes; worker executes; reviewer verifies)',
  '  → action         — what it did: "ran the work itself" (leaf) or "dispatched <child>" (fanned out)',
  '  → economics      — rolled up over its whole subtree: model calls (token-spending LLM turns),',
  '                     tool uses (mechanical/0-token actions), total tokens, and $cost when metered',
  '  ⚠orphan          — its declared parent span was not found in this trace (e.g. lost across a log rotation)',
  '  [status]         — shown only when not "ok" (corrected/reopened/parked/aborted)',
  '  · tokens "0"     — emitted at a shell boundary that does not meter tokens (the span is real; the count is just not captured there)'
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const res = queryTrace(PROJECT_ROOT, args.trace, { file: args.file });

  if (!res.ok) {
    process.stderr.write(`No cascade to render: ${res.reason}`
      + (res.trace_id ? ` (${res.trace_id})` : '') + '\n');
    if (res.traces && res.traces.length) {
      process.stderr.write('Available traces:\n');
      for (const t of res.traces.slice(0, 10)) {
        process.stderr.write(`  ${t.trace_id} (${t.span_count} spans, ${t.latest_ts})\n`);
      }
    }
    process.exit(1);
  }

  const lines = [];
  lines.push(`Cascade ${res.trace_id}`);
  const e = res.economics;
  lines.push(`(${res.tree.stats.node_count} nodes, depth ${res.tree.stats.max_depth}, `
    + `${e.model_calls} model calls, ${fmtTokens(e.tokens)} total)`);
  lines.push('');

  res.tree.roots.forEach((root, i) => {
    renderNode(root, '', i === res.tree.roots.length - 1, lines, true);
  });

  // Correlate join footer — what signal/debrief surfaces this cascade ties to.
  const c = res.correlates || {};
  const joinBits = [];
  if ((c.signals || []).length) joinBits.push(`${c.signals.length} signal(s): ${c.signals.map((x) => x.file).join(', ')}`);
  if ((c.escalations || []).length) joinBits.push(`${c.escalations.length} escalation(s)`);
  if ((c.debriefs || []).length) joinBits.push(`${c.debriefs.length} debrief(s): ${c.debriefs.map((x) => x.file).join(', ')}`);
  if (joinBits.length) {
    lines.push('');
    lines.push('Joined to: ' + joinBits.join(' | '));
  }
  if (res.tree.orphans.length) {
    lines.push(`Note: ${res.tree.orphans.length} orphan edge(s) — parent span(s) not in this trace (rotation/coverage gap).`);
  }

  if (args.legend) {
    lines.push('');
    lines.push(...LEGEND);
  }

  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

if (require.main === module) main();

module.exports = { nodeLine, fmtTokens, mindLabel, harnessLabel, actionPhrase };
