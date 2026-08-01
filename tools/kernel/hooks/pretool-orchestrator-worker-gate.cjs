#!/usr/bin/env node
'use strict';
// PreToolUse hook - orchestrator-worker gate (blocking, Gemini-strict variant).
//
// ENFORCEMENT_FAMILY: harness-critical
//   Severs the coordinator's execution affordance at the tool boundary so that
//   RLHF context-gravity cannot pull the orchestrator into self-executing work.
//   Designed from the 3-mind synthesis:
//     _dev/reports/analysis/convene-runs/20260618T225101Z-orchestrator-delegation-enforcement/synthesis.md
//
// DESIGN: "Gemini-strict + Codex allowlist"
//   BLOCKED outright (mutation + analysis_execution tool classes):
//     - Write/Edit/MultiEdit to non-orchestration paths
//     - Bash with mutation operators (>, >>, rm, touch, mv, cp), package/build
//       runners (npm, tsc, bun, cargo), runtime (node, python, ./scripts/*),
//       vcs mutations (git commit, git checkout), data transforms, test runners
//     - Repo-wide grep/find, multi-file sed/nl/cat/jq-over-artifacts,
//       shell loops, analysis scripts
//   ALLOWED (trivial_read + orchestration_write tool classes):
//     - ONE targeted Read / ls / git status / git diff -- <one path> / single rg
//     - Write/Edit to orchestration artifact paths (signal, plan, debrief,
//       synthesis, next-session, handoff globs declared below)
//     - Reading returned subagent/convene artifacts
//     - Agent / Task (delegation events - also resets per-turn counters)
//
// DISABLED BY DEFAULT: enforces only when MYTHOS_ORCHESTRATOR_GATE=1.
//   Without that env flag the hook runs in OBSERVE-ONLY mode: logs what it
//   WOULD have blocked to the session state file, then allows.
//
// FAIL-OPEN: any exception, malformed stdin, unknown tool, or missing state ->
//   allow (exit 0). A broken gate can never brick a session.
//   Privileged memory-path classification is intentionally narrower: an
//   existing symlink, multiply linked regular file, or ambiguous filesystem
//   component is classified as an ordinary mutation. This protects the
//   repository/export membrane while leaving the outer hook's unexpected-
//   exception behavior fail-open.
//
// SUBAGENT EXEMPTION: if CLAUDE_SUBAGENT_ID is set -> always allow.
//   Workers are supposed to do the work.
//
// ACTIVATION (operator-only, one line):
//   In tools/kernel/hooks/dispatch-pretool.cjs, add inside main() before the
//   final finish(0) call:
//
//     const owGate = require('./pretool-orchestrator-worker-gate.cjs');
//     const owResult = owGate.main({ tool: lower, payload });
//     if (owResult && owResult.status === 2) finish(2);
//
//   Then set env MYTHOS_ORCHESTRATOR_GATE=1 to switch from observe-only to
//   blocking. The gate can be disabled at any time by unsetting the env var or
//   touching _dev/state/orchestrator-worker-gate/disabled.
//
// STATE: per-session at _dev/state/orchestrator-worker-gate/<session_id>.json
//   Fields: { blocked: number, observed: number, delegations: number,
//             delegated_at_turn: number, log: Array<entry> }
//
// CONTRACT: never throws. Returns { status: 0 | 2, class, reason? }.

const BLOCK_MESSAGE =
  'BLOCKED_BY_ALTITUDE: coordinator is not the worker - route via ' +
  '/dispatch-bridge --target <codex|gemini>, the Agent tool, or a subagent; ' +
  'the coordinator may read returned evidence and write orchestration artifacts.';

// -- Orchestration artifact path globs (Write/Edit to these -> allowed) ---------
// These are the coordinator's own durable outputs: signals, plans, debriefs,
// synthesis documents, next-session handoffs, coordination notes.
const ORCHESTRATION_GLOBS = [
  /\b_dev[/\\]reports[/\\]signals[/\\]/,
  /\b_dev[/\\]reports[/\\]analysis[/\\]/,
  /\b_dev[/\\]reports[/\\]lifecycle[/\\]/,
  /\b_dev[/\\]state[/\\]session-boundary[/\\]/,
  /\b_dev[/\\]state[/\\]orchestrator-worker-gate[/\\]/,
  /\b_dev[/\\]handoffs?[/\\]/,
  // Legacy path retained so in-flight SM_OS sessions remain writable.
  /\bsm_os-memories[/\\]/,
  /(?:^|[/\\])(?:plan|debrief|synthesis|handoff|next-session|cross-session|session-boundary|HANDOFF|DEBRIEF)[-._]/i,
  /(?:handoff|debrief|synthesis|next-session|cross-session|session-boundary)\.(?:md|json|yaml|txt)$/i,
  /\b_dev[/\\]reports[/\\]convene-runs[/\\]/,
  /\b_dev[/\\]reports[/\\]review-progress[/\\]/,
  // Returned subagent / convene artifacts (read by coordinator to synthesize)
  /\bconvene-runs[/\\]/,
  /\breview-progress[/\\]/,
  /\breview-task-plan[/\\]/,
];

// -- Mutation Bash patterns (Gemini-strict block list) --------------------------
// These patterns classify Bash as mutation or analysis_execution -> BLOCKED.
const MUTATION_BASH_PATTERNS = [
  // Redirection / file writes
  { label: 'redirect-write', re: /(?:^|[^2])>>?(?!\|)\s*\S/ },
  // Destructive file ops
  { label: 'rm', re: /\brm\b/ },
  { label: 'touch', re: /\btouch\b/ },
  { label: 'mv', re: /\bmv\b/ },
  { label: 'cp', re: /\bcp\b/ },
  // Package / build tools
  { label: 'npm', re: /\bnpm\b/ },
  { label: 'tsc', re: /\btsc\b/ },
  { label: 'bun', re: /\bbun\b/ },
  { label: 'cargo', re: /\bcargo\b/ },
  { label: 'make', re: /\bmake\b/ },
  { label: 'yarn', re: /\byarn\b/ },
  { label: 'pnpm', re: /\bpnpm\b/ },
  // Runtime execution
  { label: 'node', re: /\bnode\s+\S/ },
  { label: 'python', re: /\bpython[23]?\s+\S/ },
  { label: 'scripts', re: /\.\/(scripts?|tools?|bin|src)[/\\]\S/ },
  // VCS mutations
  { label: 'git-commit', re: /\bgit\s+commit\b/ },
  { label: 'git-checkout', re: /\bgit\s+checkout\b/ },
  { label: 'git-reset', re: /\bgit\s+reset\b/ },
  { label: 'git-rebase', re: /\bgit\s+rebase\b/ },
  { label: 'git-push', re: /\bgit\s+push\b/ },
  { label: 'git-merge', re: /\bgit\s+merge\b/ },
  // Test runners
  { label: 'jest', re: /\bjest\b/ },
  { label: 'mocha', re: /\bmocha\b/ },
  { label: 'vitest', re: /\bvitest\b/ },
];

// -- Analysis-execution Bash patterns (repo-wide recon -> BLOCKED) --------------
const ANALYSIS_BASH_PATTERNS = [
  // Repo-wide find (no path scoped to a single known file)
  { label: 'find-broad', re: /\bfind\s+\.(?:\s|$)/ },
  { label: 'find-broad-root', re: /\bfind\s+[/](?:\s|$)/ },
  // Multi-file cat / head / tail (piped or semicoloned)
  { label: 'cat-multi', re: /\bcat\b.*\|/ },
  { label: 'sed-without-inplace', re: /\bsed\b(?!.*-i).*\|/ },
  // jq over arbitrary paths
  { label: 'jq', re: /\bjq\b/ },
  // Shell loops
  { label: 'for-loop', re: /\bfor\s+\w+\s+in\b/ },
  { label: 'while-loop', re: /\bwhile\b.*\bdo\b/ },
  // broad rg / grep (no specific file argument, searching repo root)
  { label: 'rg-broad', re: /\brg\b[^|;]*(?:-r|--[a-z]*dir|\.(?:\s|$)|\/\s*(?:;|$))/ },
  { label: 'grep-broad', re: /\bgrep\b.*-r/ },
];

// Canonical Mythos orchestration commands the coordinator may run directly.
// These commands move control-plane state; they are not worker implementation.
const ORCHESTRATION_BASH_ALLOW_PATTERNS = [
  /^node\s+tools\/signals\/(?:follow-signal|dispatch-bridge|run-actor-bridge|close-signal|next-step|needs-attention-scan)\.js\b/,
  /^node\s+tools\/planning\/(?:assess-similarity|check-existing-work|reconcile-task-outcomes|validate-task-plan)\.js\b/,
  /^node\s+tools\/planning\/(?:component-index|validate-component-tags)\.cjs\b/,
  /^node\s+tools\/sessions\/(?:consume-boundary|session-start-cross-session-consumer|session-end-boundary-log)\.cjs\b/,
  /^npm\s+run\s+(?:codex:boot|codex:hook|manifest:check)\b/,
];

// -- trivial-read allow patterns for Bash --------------------------------------
// These are the exact narrow shapes the coordinator may run.
const TRIVIAL_BASH_ALLOW_PATTERNS = [
  // git status (no args, or --short variants)
  /^git\s+status\b/,
  // git diff -- <one path> (exactly one path after --)
  /^git\s+diff\b[^|;]*--\s+\S+\s*$/,
  // git diff with no file args (show staged/unstaged summary - not broad)
  /^git\s+diff\b(?:\s+--(?:stat|name-only|cached))?\s*$/,
  // git log (read-only, no mutations)
  /^git\s+log\b/,
  // git branch (read-only)
  /^git\s+branch\b/,
  // ls (any form)
  /^ls\b/,
  // single rg with a specific file or --max-count=1
  /^rg\b[^|;]*(?:--max-count=1|-m\s*1)\b/,
  // single rg with a specific file path as last arg (not -r)
  /^rg\b(?!\s+-r)(?!\s+--[\w]*dir)[^|;]*\s+\S+\.\w+\s*$/,
  // echo (diagnostic only)
  /^echo\b/,
  // pwd, date, which, type (diagnostics)
  /^(?:pwd|date|which|type)\b/,
  // cat of a single named file (no pipe)
  /^cat\s+\S+\s*$/,
  // head / tail of a single named file
  /^(?:head|tail)\s+(?:-\d+\s+)?\S+\s*$/,
];

// -- Helpers --------------------------------------------------------------------

function hasUnsafeLinkComponent(rootPath, candidatePath, pathImpl, fsImpl) {
  const relative = pathImpl.relative(rootPath, candidatePath);
  const components = [rootPath];
  let current = rootPath;
  for (const segment of relative.split(pathImpl.sep).filter(Boolean)) {
    current = pathImpl.join(current, segment);
    components.push(current);
  }

  for (const component of components) {
    try {
      const stat = fsImpl.lstatSync(component);
      if (stat.isSymbolicLink()) return true;
      // A regular file with multiple directory entries may be a hard link to
      // a tracked file. Editing either name mutates the shared inode, so such
      // a target cannot receive privileged memory-write classification.
      if (stat.isFile() && stat.nlink > 1) return true;
    } catch (err) {
      // A missing component cannot currently redirect this synchronous check.
      // Any other ambiguity fails closed for privileged classification. The
      // eventual tool write is separate, so this is not an atomic TOCTOU guard.
      if (err && err.code === 'ENOENT') return false;
      return true;
    }
  }
  return false;
}

function resolveMemoryPath(filePath, projectDir, pathImpl) {
  const fp = String(filePath || '');
  if (!fp) return null;
  const projectRoot = pathImpl.resolve(projectDir);
  const candidate = pathImpl.isAbsolute(fp)
    ? pathImpl.resolve(fp)
    : pathImpl.resolve(projectRoot, fp);
  const memoryRoot = pathImpl.join(projectRoot, 'Mythos-memories');
  return { candidate, memoryRoot };
}

function isLexicallyCanonicalMemoryPath(
  filePath,
  projectDir = resolveProjectDir(),
  pathImpl = require('path')
) {
  const resolved = resolveMemoryPath(filePath, projectDir, pathImpl);
  return Boolean(resolved && resolved.candidate.startsWith(resolved.memoryRoot + pathImpl.sep));
}

function isLexicallyMemoryRootPath(
  filePath,
  projectDir = resolveProjectDir(),
  pathImpl = require('path')
) {
  const resolved = resolveMemoryPath(filePath, projectDir, pathImpl);
  if (!resolved) return false;
  return resolved.candidate.toLowerCase().startsWith(
    resolved.memoryRoot.toLowerCase() + pathImpl.sep
  );
}

function isCanonicalMemoryPath(
  filePath,
  projectDir = resolveProjectDir(),
  pathImpl = require('path'),
  fsImpl = require('fs')
) {
  const resolved = resolveMemoryPath(filePath, projectDir, pathImpl);
  return Boolean(
    resolved
    && resolved.candidate.startsWith(resolved.memoryRoot + pathImpl.sep)
    && !hasUnsafeLinkComponent(resolved.memoryRoot, resolved.candidate, pathImpl, fsImpl)
  );
}

function isOrchestrationPath(filePath, projectDir, pathImpl, fsImpl) {
  const fp = String(filePath || '');
  // Any casing of a path lexically inside the private memory root must pass
  // every exact-canonical memory check. This blocks case-insensitive filesystems
  // from reaching the canonical directory through a lookalike path and then
  // regaining privilege through a generic artifact-name glob.
  if (isLexicallyMemoryRootPath(fp, projectDir, pathImpl)) {
    return isCanonicalMemoryPath(fp, projectDir, pathImpl, fsImpl);
  }
  return ORCHESTRATION_GLOBS.some((re) => re.test(fp));
}

function classifyBash(command) {
  const cmd = String(command || '').trim();
  if (!cmd) return 'trivial_read'; // empty -> allow

  // Canonical control-plane commands must remain available in enforcing mode.
  for (const re of ORCHESTRATION_BASH_ALLOW_PATTERNS) {
    if (re.test(cmd)) return 'orchestration_write';
  }

  // Check mutation patterns FIRST - redirect operators override any trivial label.
  // (e.g. `echo "x" > file.json` is a write, not a diagnostic echo.)
  for (const p of MUTATION_BASH_PATTERNS) {
    if (p.re.test(cmd)) return 'mutation';
  }

  // Check analysis_execution patterns before the trivial allowlist.
  for (const p of ANALYSIS_BASH_PATTERNS) {
    if (p.re.test(cmd)) return 'analysis_execution';
  }

  // Trivial-read allowlist: only reached when no mutation/analysis matched.
  for (const re of TRIVIAL_BASH_ALLOW_PATTERNS) {
    if (re.test(cmd)) return 'trivial_read';
  }

  // Default: treat unknown Bash as trivial_read (fail-open for unrecognized ops)
  return 'trivial_read';
}

function classifyTool(tool, toolInput, projectDir, pathImpl, fsImpl) {
  const t = String(tool || '').toLowerCase();
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};

  // Delegation events
  if (t === 'agent' || t === 'task') return 'delegation';

  // Read-family tools
  if (t === 'read') return 'trivial_read';
  if (t === 'glob') return 'trivial_read';
  if (t === 'ls') return 'trivial_read';

  // Bash: classify by command content
  if (t === 'bash') {
    const cmd = String(input.command || input.cmd || '');
    return classifyBash(cmd);
  }

  // Write / Edit / MultiEdit: depends on target path
  if (t === 'write' || t === 'edit' || t === 'multiedit') {
    const fp = String(input.file_path || '');
    if (isOrchestrationPath(fp, projectDir, pathImpl, fsImpl)) return 'orchestration_write';
    // MultiEdit may have edits array
    if (t === 'multiedit' && Array.isArray(input.edits)) {
      if (input.edits.every((e) => isOrchestrationPath(e && e.file_path, projectDir, pathImpl, fsImpl))) {
        return 'orchestration_write';
      }
    }
    return 'mutation';
  }

  // Grep / search tools - treat as analysis_execution unless narrow
  if (t === 'grep' || t === 'search') return 'analysis_execution';

  // WebFetch, WebSearch - read-only orchestration research, allow
  if (t === 'webfetch' || t === 'websearch') return 'trivial_read';

  // MCP tools - allow (coordinator needs to dispatch via MCP)
  // (Tool names containing __ are MCP tools)
  if (t.includes('__')) return 'orchestration_write';

  // EnterPlanMode, ExitPlanMode, EnterWorktree, ExitWorktree - routing ops
  if (/^(?:enter|exit)(?:planmode|worktree)$/i.test(t)) return 'orchestration_write';

  // Unknown tool -> allow (fail-open)
  return 'trivial_read';
}

// -- State helpers --------------------------------------------------------------

function resolveProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function resolveSessionId(payload) {
  return (
    String((payload && payload.session_id) || '').trim() ||
    process.env.CLAUDE_SESSION_ID ||
    process.env.CLAUDE_SESSION ||
    ('day-' + new Date().toISOString().slice(0, 10))
  );
}

function loadState(stateFile, fs) {
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        blocked: Number.isFinite(parsed.blocked) ? parsed.blocked : 0,
        observed: Number.isFinite(parsed.observed) ? parsed.observed : 0,
        delegations: Number.isFinite(parsed.delegations) ? parsed.delegations : 0,
        delegated_at_turn: Number.isFinite(parsed.delegated_at_turn) ? parsed.delegated_at_turn : 0,
        log: Array.isArray(parsed.log) ? parsed.log : [],
      };
    }
  } catch (_) {
    // missing or corrupt
  }
  return { blocked: 0, observed: 0, delegations: 0, delegated_at_turn: 0, log: [] };
}

function saveState(stateFile, state, fs, path) {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const toWrite = {
      ...state,
      log: (state.log || []).slice(-50), // cap log at 50 entries
    };
    fs.writeFileSync(stateFile, JSON.stringify(toWrite, null, 2) + '\n');
  } catch (_) {
    // best-effort; never throw
  }
}

// -- Main export ----------------------------------------------------------------

/**
 * main({ tool, payload, _fs, _path }) -> { status: 0|2, class, reason? }
 *
 * tool: lowercase tool token (optional; extracted from payload.tool_name if omitted)
 * payload: the PreToolUse JSON payload from stdin
 * _fs / _path: dependency injection for tests
 */
function main(options, _injected) {
  // -- SAFETY: always fail-open ----------------------------------------------
  try {
    return _main(options, _injected);
  } catch (_err) {
    // Never block on our own error.
    return { status: 0, class: 'unknown', reason: 'fail-open-exception' };
  }
}

function _main(options, _injected) {
  const fs = (_injected && _injected.fs) || require('fs');
  const path = (_injected && _injected.path) || require('path');

  // -- SUBAGENT EXEMPTION ------------------------------------------------------
  // Workers must be able to work; this gate governs only the top-level coord.
  if (process.env.CLAUDE_SUBAGENT_ID) {
    return { status: 0, class: 'exempt', reason: 'subagent' };
  }

  // -- Resolve payload ---------------------------------------------------------
  let payload = {};
  if (options && options.payload && typeof options.payload === 'object') {
    payload = options.payload;
  } else if (!options || !options.payload) {
    // Read from stdin when called standalone (no injected payload)
    try {
      const raw = fs.readFileSync(0, 'utf8');
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') payload = parsed;
      }
    } catch (_) {
      // malformed stdin -> fail-open
      return { status: 0, class: 'unknown', reason: 'fail-open-stdin' };
    }
  }

  // -- Tool identification -----------------------------------------------------
  const toolToken =
    String((options && options.tool) || '').trim() ||
    String(payload.tool_name || payload.tool || process.env.CLAUDE_TOOL_NAME || '').toLowerCase();

  if (!toolToken) {
    return { status: 0, class: 'unknown', reason: 'no-tool-name' };
  }

  const toolInput =
    (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input :
    (() => {
      try { return JSON.parse(process.env.CLAUDE_TOOL_INPUT || '{}') || {}; } catch { return {}; }
    })();

  // -- Session + state ---------------------------------------------------------
  const projectDir = resolveProjectDir();
  const sessionId = resolveSessionId(payload);
  const stateDir = path.join(projectDir, '_dev', 'state', 'orchestrator-worker-gate');
  const stateFile = path.join(stateDir, sessionId + '.json');

  // -- Kill-switch / disabled marker -------------------------------------------
  const disabledMarker = path.join(stateDir, 'disabled');
  const disabledByFile = (() => { try { return fs.existsSync(disabledMarker); } catch { return false; } })();
  if (disabledByFile) {
    return { status: 0, class: 'exempt', reason: 'kill-switch-file' };
  }

  // -- Gate mode: enforcing vs observe-only ------------------------------------
  const enforcingRaw = String(process.env.MYTHOS_ORCHESTRATOR_GATE || '').trim().toLowerCase();
  const enforcing = ['1', 'true', 'yes', 'on'].includes(enforcingRaw);

  // -- Classify the requested tool ---------------------------------------------
  const toolClass = classifyTool(toolToken, toolInput, projectDir, path, fs);

  // -- Delegation event: record + allow ----------------------------------------
  if (toolClass === 'delegation') {
    const state = loadState(stateFile, fs);
    state.delegations += 1;
    state.delegated_at_turn = Date.now();
    state.log.push({ ts: new Date().toISOString(), class: 'delegation', tool: toolToken });
    saveState(stateFile, state, fs, path);
    return { status: 0, class: 'delegation' };
  }

  // -- Allow classes ------------------------------------------------------------
  if (toolClass === 'trivial_read' || toolClass === 'orchestration_write') {
    return { status: 0, class: toolClass };
  }

  // -- Block classes: mutation or analysis_execution ---------------------------
  // In observe-only mode: log but allow.
  // In enforcing mode: block (exit 2).
  const state = loadState(stateFile, fs);

  const logEntry = {
    ts: new Date().toISOString(),
    class: toolClass,
    tool: toolToken,
    mode: enforcing ? 'blocking' : 'observe-only',
    command: toolInput.command || toolInput.cmd || toolInput.file_path || undefined,
  };
  state.log.push(logEntry);

  if (enforcing) {
    state.blocked = (state.blocked || 0) + 1;
    saveState(stateFile, state, fs, path);
    // Emit block message to stderr (Claude Code displays stderr to the model)
    process.stderr.write(BLOCK_MESSAGE + '\n');
    return { status: 2, class: toolClass, reason: 'blocked' };
  } else {
    state.observed = (state.observed || 0) + 1;
    saveState(stateFile, state, fs, path);
    // Emit observe-only notice to stderr (informational, does not block)
    process.stderr.write(
      '[ORCHESTRATOR-GATE observe-only] WOULD BLOCK: ' + toolClass + ' -> ' + toolToken +
      (logEntry.command ? ' (' + String(logEntry.command).slice(0, 80) + ')' : '') +
      ' - set MYTHOS_ORCHESTRATOR_GATE=1 to enforce. ' + BLOCK_MESSAGE + '\n'
    );
    return { status: 0, class: toolClass, reason: 'observed' };
  }
}

// -- Exports (for tests and dispatch-pretool wiring) ---------------------------
module.exports = {
  BLOCK_MESSAGE,
  ORCHESTRATION_GLOBS,
  ORCHESTRATION_BASH_ALLOW_PATTERNS,
  MUTATION_BASH_PATTERNS,
  ANALYSIS_BASH_PATTERNS,
  TRIVIAL_BASH_ALLOW_PATTERNS,
  classifyBash,
  classifyTool,
  isCanonicalMemoryPath,
  isLexicallyCanonicalMemoryPath,
  isLexicallyMemoryRootPath,
  isOrchestrationPath,
  main,
};

// -- Standalone entry ----------------------------------------------------------
if (require.main === module) {
  try {
    const result = main();
    process.exit(result && result.status === 2 ? 2 : 0);
  } catch (_) {
    // fail-open
    process.exit(0);
  }
}
