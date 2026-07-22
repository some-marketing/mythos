#!/usr/bin/env node
// TEMPLATE — SessionStart hook pattern: a mechanical session-open brief.
//
// This is a worked example, not a wired-in mythos hook. It demonstrates a
// pattern that goes beyond the shipped Mirror hook (tools/user/inject-mirror.cjs,
// wired in .claude/settings.json) — an in-repo working-state brief instead of
// a personal-preference one. It reads whatever pending cross-session state
// your own guild's session-lifecycle tooling writes (this template assumes
// the `_dev/state/session-boundary/pending` and `_dev/reports/analysis`
// shapes from the ported `_dev` contract) and emits it as additionalContext
// in <1s, no LLM call.
//
// Any judgment-requiring half of your own session-open ritual (approving a
// repo-hygiene sweep, reading a kernel doc, etc.) should stay operator- or
// command-invoked, not folded into this hook. Fails silent: a broken brief
// must never block a session from starting.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

function main() {
  const pendingDir = path.join(ROOT, '_dev/state/session-boundary/pending');
  const scopes = safe(() => fs.readdirSync(pendingDir).filter(f => f.endsWith('.json')).map(f => {
    const j = JSON.parse(fs.readFileSync(path.join(pendingDir, f), 'utf8'));
    return `  - ${j.scope}: ${j.recommended_next_command} (${(j.summary || '').slice(0, 110)}…)`;
  }), []);

  const handoff = path.join(ROOT, '_dev/reports/analysis/next-session-handoff.md');
  const handoffLine = safe(() => {
    const head = fs.readFileSync(handoff, 'utf8').split('\n').slice(0, 4).join(' ');
    return `Current system handoff: _dev/reports/analysis/next-session-handoff.md — ${head.slice(0, 140)}`;
  }, 'No system handoff found.');

  const dirty = safe(() => execSync('git status --short | wc -l', { cwd: ROOT, timeout: 8000 }).toString().trim(), '?');

  const ctx = [
    'SESSION BRIEF (mechanical, session-start hook):',
    handoffLine,
    `Dirty tree: ${dirty} files (custody rules apply — foreign files are context, not yours to commit).`,
    scopes.length ? `Pending boundary scopes (consume ONE via your own boundary-consuming tool, e.g. node tools/sessions/consume-boundary.cjs <scope>):\n${scopes.join('\n')}` : 'No pending boundary scopes.',
    'For your guild\'s full session-open ritual (auto-commit, repo hygiene, doctrine read): run your own session-open command. This brief replaces nothing destructive.',
  ].join('\n');

  process.stdout.write(JSON.stringify({
    suppressOutput: true,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx },
  }));
}

safe(main, undefined);
