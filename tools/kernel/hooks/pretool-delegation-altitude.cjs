#!/usr/bin/env node
'use strict';
// PreToolUse hook — detect "coordinator-as-default-worker creep".
//
// ENFORCEMENT_FAMILY: quality-process
//   (tier-s2a-safety-family-lint — tier-consuming quality/process scaffolding,
//   never a safety gate.)
//
// tier-s2d-closeout-and-delegation-consumers (tier-enforcement-implementation
// slice 2; convene 20260611T130035Z conditions 8, 9, 11): this hook is ALSO
// the consumer of the `delegation-altitude-cap` add (ProcessTierRule/1.1,
// resolved LIVE via readSessionAdds — never tier names). On Agent/Task
// dispatches by sessions carrying the add it checks, REPORT-ONLY:
//   * the recursive coordinator-tier invariant over the stamped
//     coordination_scope / judgment_ceiling (checkCoordinationInvariant —
//     haiku session-root coordination is reported as forbidden; subtree
//     coordination requires a declared judgment ceiling at-or-below the
//     coordinator's tier per the operator's fork resolution);
//   * subtree-contract artifact presence (payload.subtree_contract /
//     MYTHOS_SUBTREE_CONTRACT must exist on disk for subtree coordinators);
//   * dispatch altitude: dispatching a mind whose name-inferred tier ranks
//     ABOVE the coordinator's (acceptance must route upward), or a same-tier
//     review-shaped dispatch (producer-can't-self-validate risk).
//   Reviewer-role sessions are EXEMPT — keyed on payload.session_role /
//   MYTHOS_SESSION_ROLE, NEVER on model name (condition 8): gpt-5/opus
//   distinct-reviewer lanes are untouched.
//   Events land in _dev/state/tier-gate-soak/delegation-altitude-cap.jsonl;
//   exit-2 engages only if the operator flips the add's mode to "blocking".
//   Kill switch: _dev/state/kill-switches/delegation-altitude-cap.off.
//
// (The pre-existing advisory/breaker below is the 2026-06 coordinator-creep
// layer and is unchanged by slice 2.)
//
// Purpose: realize "the coordinator is not the default worker". When the main
// thread does repeated bounded authoring (Write/Edit/MultiEdit to source or
// content files, OR authoring-shaped Bash redirects/sed -i to those files)
// without ever delegating to a submind (Agent/Task), emit an advisory at the
// moment the creep is happening, nudging toward delegation — and naming the
// concrete delegable cluster of paths so the coordinator can act.
//
// Invoked with `--tool <agent|task|edit|bash>` telling the hook which matcher
// fired (the coordinator wires the matchers to pass this). agent/task = a
// delegation happened (resets the spawn-recency baseline); edit = an authoring
// tool fired; bash = a Bash command fired (counted as authoring ONLY when it
// matches a tight authoring shape — a redirect / tee / sed -i / perl -i whose
// target path ends in an AUTHORING_EXT).
//
// Input channel: the PreToolUse harness delivers a JSON payload on stdin
// (top-level `session_id`, nested `tool_input` with `file_path`/`command`),
// mirroring snapshot-current-session.cjs and coordination-dispatcher.js. The
// hook reads stdin ONCE and reuses it. CLAUDE_SESSION_ID / CLAUDE_TOOL_INPUT
// env remain a fallback so the previously-working env path never regresses.
//
// Session-id resolution: payload.session_id -> CLAUDE_SESSION_ID/CLAUDE_SESSION
// -> the active-session registry `_current-id` -> day-<date>. The day-<date>
// fallback is last-resort only; keying state by the real per-session id stops
// concurrent sessions from corrupting each other's counts.
//
// Spawn suppression DECAYS (it is not permanent): a spawn records
// editsAtLastSpawn = state.edits. The advisory re-fires when authoring resumes
// and OUTRUNS the last delegation — i.e. (edits - editsAtLastSpawn) >= THRESHOLD
// and it has been >= 3 edits since the last warning.
//
// Governs ONLY the main thread: no-ops silently when CLAUDE_SUBAGENT_ID is set
// (subagents are SUPPOSED to author).
//
// Contract: NEVER throws. By DEFAULT never blocks (advisory stdout, exit 0).
// Layer 2 (S3): an OPT-IN enforcing breaker can block (exit 2) ONLY when all of:
//   (a) enforcing is explicitly enabled (env SMOS_DELEGATION_ALTITUDE_ENFORCE=1
//       OR marker file _dev/state/delegation-altitude/enforce), AND
//   (b) it is NOT overridden (env SMOS_DELEGATION_ALTITUDE_OVERRIDE=1 OR marker
//       file _dev/state/delegation-altitude/override), AND
//   (c) authoring-since-last-delegation has crossed the HARD cap.
// Fail-open by construction: the outer try/catch exits 0, so ANY internal error
// (including a failed config read) results in NO block — a broken breaker can
// never freeze work. Interruptability is preserved: the operator can override
// per-action or disable enforcing entirely, both without code changes.
//
// Reversible: remove the PreToolUse matcher entries that call this script from
// settings to disable. The script itself is inert unwired, and enforcing is OFF
// until explicitly enabled.

const THRESHOLD = 3;

// S3 hard cap: authoring edits since the last delegation that trip the enforcing
// breaker. Default 12 (4x the advisory THRESHOLD). Env-overridable.
const HARD_CAP = (() => {
  const v = parseInt(process.env.SMOS_DELEGATION_ALTITUDE_HARD_CAP || '', 10);
  return Number.isFinite(v) && v > 0 ? v : 12;
})();

// Only EXPLICIT truthy values enable enforcing/override (Codex S3 finding:
// '0' / 'false' / 'no' / 'off' / '' must NOT enable the breaker).
function isTruthyEnv(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v == null ? '' : v).trim().toLowerCase());
}

// Extensions treated as "authoring" source/content when edited.
const AUTHORING_EXTS = new Set([
  '.cpp', '.h', '.hpp', '.cc', '.cxx', '.cs',
  '.js', '.cjs', '.mjs', '.ts', '.tsx',
  '.py', '.go', '.rs', '.java', '.rb', '.php',
  '.md', '.yaml', '.yml', '.json'
]);

// Path segments that mark non-authoring (machine state/logs) surfaces. NOTE:
// the blanket '.claude/' and the _dev/reports + _dev/handoffs exclusions were
// removed so that authoring of command/skill/agent surfaces (.claude/commands,
// .claude/skills, .claude/agents), concept docs, reports, and handoffs counts
// as real authoring work. Only durable machine state still skips.
const NON_AUTHORING_SEGMENTS = [
  '_dev/state', '_dev/logs', 'node_modules'
];

// Cap on how many recent authoring paths we keep in state for the advisory.
const PATH_HISTORY_CAP = 8;

function main(options = {}) {
  // Subagents are supposed to author; this hook governs only the main thread.
  if (process.env.CLAUDE_SUBAGENT_ID) {
    return { status: 0 };
  }

  const fs = require('fs');
  const path = require('path');

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Parse `--tool <agent|task|edit|bash>` from argv.
  let tool = String(options.tool || '').toLowerCase();
  if (!tool) {
    const idx = process.argv.indexOf('--tool');
    if (idx !== -1 && process.argv[idx + 1]) {
      tool = String(process.argv[idx + 1]).toLowerCase();
    }
  }
  if (!tool) {
    return { status: 0 };
  }

  // Read the PreToolUse stdin payload ONCE (fd 0 is a stream). Tolerate any
  // failure — empty payload on error.
  let payload = options.payload && typeof options.payload === 'object' ? options.payload : {};
  if (!options.payload) {
    try {
      const raw = fs.readFileSync(0, 'utf8');
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          payload = parsed;
        }
      }
    } catch (_) {
      payload = {};
    }
  }

  // tool_input from the payload (preferred), falling back to the env channel
  // so the previously-working CLAUDE_TOOL_INPUT path never regresses.
  let toolInput = {};
  if (payload && typeof payload.tool_input === 'object' && payload.tool_input) {
    toolInput = payload.tool_input;
  } else {
    try {
      const parsedEnv = JSON.parse(process.env.CLAUDE_TOOL_INPUT || '{}');
      if (parsedEnv && typeof parsedEnv === 'object') {
        toolInput = parsedEnv;
      }
    } catch (_) {
      toolInput = {};
    }
  }

  // --- session-id resolution -------------------------------------------------
  // Precedence: payload.session_id -> CLAUDE_SESSION_ID/CLAUDE_SESSION ->
  // active-session registry `_current-id` -> day-<date>. (write-set-registry
  // exposes no current-id reader; the active-session registry holds the durable
  // current session id, mirroring coordination-dispatcher.readCurrentId.)
  function readCurrentIdFromRegistry() {
    try {
      const registry = require(
        path.join(projectDir, 'tools', 'sessions', 'lib', 'active-session-registry.js')
      );
      if (registry && typeof registry.getActiveSessionDir === 'function') {
        const idPath = path.join(registry.getActiveSessionDir(), '_current-id');
        const value = fs.readFileSync(idPath, 'utf8').trim();
        return value || null;
      }
    } catch (_) {
      // best-effort; never throw.
    }
    return null;
  }

  const sessionId =
    (payload && typeof payload.session_id === 'string' && payload.session_id) ||
    process.env.CLAUDE_SESSION_ID ||
    process.env.CLAUDE_SESSION ||
    readCurrentIdFromRegistry() ||
    ('day-' + new Date().toISOString().slice(0, 10));

  const stateDir = path.join(projectDir, '_dev', 'state', 'delegation-altitude');
  const stateFile = path.join(stateDir, sessionId + '.json');

  // Read-modify-write; tolerate missing/corrupt file (treat as zeros).
  // lastBlockEpisode sentinel is -1 (editsAtLastSpawn is always >= 0), so the
  // FIRST block of a never-delegated session still emits one attention-request.
  let state = { spawns: 0, edits: 0, lastWarnAt: 0, editsAtLastSpawn: 0, lastBlockEpisode: -1, paths: [] };
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      state.spawns = Number.isFinite(parsed.spawns) ? parsed.spawns : 0;
      state.edits = Number.isFinite(parsed.edits) ? parsed.edits : 0;
      state.lastWarnAt = Number.isFinite(parsed.lastWarnAt) ? parsed.lastWarnAt : 0;
      state.editsAtLastSpawn = Number.isFinite(parsed.editsAtLastSpawn) ? parsed.editsAtLastSpawn : 0;
      state.lastBlockEpisode = Number.isFinite(parsed.lastBlockEpisode) ? parsed.lastBlockEpisode : -1;
      state.paths = Array.isArray(parsed.paths) ? parsed.paths.filter((p) => typeof p === 'string') : [];
    }
  } catch (_) {
    // missing or corrupt — keep zeros.
  }

  function persist() {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(state) + '\n');
    } catch (_) {
      // best-effort; never throw.
    }
  }

  // A spawn = the coordinator is delegating. Record the edit count at this
  // delegation so suppression DECAYS: only authoring that resumes and outruns
  // this baseline by THRESHOLD re-triggers the advisory.
  if (tool === 'agent' || tool === 'task') {
    // tier-s2d: delegation-altitude-cap add consumer (report-only; fail-open).
    let cap = null;
    try {
      cap = evaluateDelegationCap({ projectDir, sessionId, payload, toolInput });
    } catch (_) {
      cap = null;
    }
    state.spawns += 1;
    state.editsAtLastSpawn = state.edits;
    persist();
    if (cap && cap.status === 2) {
      if (cap.message) process.stderr.write(cap.message + '\n');
      return { status: 2 };
    }
    return { status: 0 };
  }

  if (tool === 'edit' || tool === 'bash') {
    // Resolve the authoring target path for this tool.
    let filePath = '';

    if (tool === 'edit') {
      // Write/Edit/MultiEdit: the edited path is tool_input.file_path.
      filePath = String((toolInput && toolInput.file_path) || '');
    } else {
      // bash: count ONLY a tight authoring shape — a redirect (> / >>), tee,
      // or sed -i / perl -i targeting a path that ends in an AUTHORING_EXT.
      // Ordinary Bash (npm, git, ls, node <script>, ssh, …) is NOT counted.
      // When in doubt, do NOT count — false positives are worse than misses.
      const command = String((toolInput && toolInput.command) || '');
      filePath = extractAuthoringTargetFromBash(command, path);
    }

    if (!filePath) {
      return { status: 0 };
    }

    const ext = path.extname(filePath).toLowerCase();
    const isAuthoringExt = AUTHORING_EXTS.has(ext);

    // Normalize separators for segment matching.
    const normalized = filePath.split(path.sep).join('/');
    const inNonAuthoring = NON_AUTHORING_SEGMENTS.some((seg) => normalized.includes(seg));

    const isAuthoring = isAuthoringExt && !inNonAuthoring;
    if (!isAuthoring) {
      return { status: 0 };
    }

    state.edits += 1;

    // Track the concrete delegable cluster (cap the list).
    state.paths.push(normalized);
    if (state.paths.length > PATH_HISTORY_CAP) {
      state.paths = state.paths.slice(-PATH_HISTORY_CAP);
    }
    persist();

    // DECAYING suppression: warn when authoring since the last delegation has
    // outrun THRESHOLD, and it's been >= 3 edits since the last warning.
    const editsSinceSpawn = state.edits - state.editsAtLastSpawn;
    if (editsSinceSpawn >= THRESHOLD && (state.edits - state.lastWarnAt >= 3)) {
      const cluster = state.paths.join(', ');
      const warning = [
        'DELEGATION ALTITUDE (advisory): ' + state.edits + ' authoring edits to source/content this session (' + editsSinceSpawn + ' since the last delegation). Bounded multi-file authoring is worker work — delegate it to a single Agent and integrate, rather than single-threading it (OWL / best-of-N: the coordinator is not the default worker). The delegable cluster right now is: ' + cluster + '. Delegate these to a single Agent. Keep in-thread only the env-coupled loop (ssh -> build -> diagnose, where each step gates the next) and gates/routing. Independent VERIFICATION still goes to distinct intelligence (e.g. codex bridge), never a same-prior submind.'
      ].join('\n');
      process.stdout.write(warning);

      state.lastWarnAt = state.edits;
      persist();

      // Best-effort telemetry; resolve lib path via CLAUDE_PROJECT_DIR.
      try {
        const telemetry = require(
          path.join(projectDir, 'tools', 'claude', 'lib', 'hook-telemetry.cjs')
        );
        telemetry.appendHookEvent({
          matcher: 'DelegationAltitude',
          event: 'coordinator-worker-creep',
          detail: { edits: state.edits, editsSinceSpawn: editsSinceSpawn }
        });
      } catch (_) {
        // best-effort; never throw.
      }
    }

    // --- S3: OPT-IN enforcing breaker (default OFF) -------------------------
    // Block ONLY when enforcing is enabled, not overridden, and authoring since
    // the last delegation has crossed the HARD cap. Emits a one-shot
    // attention-request so the bubble-up is visible. Fail-open: the outer
    // try/catch exits 0, so any error here results in NO block.
    const fileExists = (p) => { try { return fs.existsSync(p); } catch (_) { return false; } };
    // Codex S3 finding (HIGH): only EXPLICIT truthy values enable/override — so
    // SMOS_DELEGATION_ALTITUDE_ENFORCE=0 (or false/no/off) does NOT enable the
    // breaker. Marker files remain presence-based.
    const enforceOn = isTruthyEnv(process.env.SMOS_DELEGATION_ALTITUDE_ENFORCE)
      || fileExists(path.join(stateDir, 'enforce'));
    const overrideOn = isTruthyEnv(process.env.SMOS_DELEGATION_ALTITUDE_OVERRIDE)
      || fileExists(path.join(stateDir, 'override'));

    if (enforceOn && !overrideOn && editsSinceSpawn >= HARD_CAP) {
      // One attention-request per cap EPISODE. editsAtLastSpawn is constant across
      // all blocked attempts in the same no-delegation streak, so keying dedup on
      // it (not on state.edits, which keeps incrementing) emits exactly one signal
      // per episode (Codex S3 finding: repeated blocked attempts spammed signals).
      let signalWritten = false;
      if (state.lastBlockEpisode !== state.editsAtLastSpawn) {
        try {
          const { createAttentionRequest } = require(
            path.join(projectDir, 'tools', 'verify', 'lib', 'signal.cjs')
          );
          const req = createAttentionRequest('delegation-altitude-breaker', 'delegation-altitude', {
            gate_type: 'human_judgment',
            raising_scope: sessionId,
            question: 'Coordinator made ' + editsSinceSpawn + ' authoring edits since the last delegation (hard cap ' + HARD_CAP + '). Keep going, delegate the cluster, or stop?',
            attempted_resolution: 'Advisory fired at the soft threshold; authoring continued and crossed the hard cap. Cluster: ' + state.paths.join(', '),
            recommended_default: 'Delegate the authoring cluster to a single Agent (coordinator is not the default worker); or stop and bubble up.'
          });
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const outPath = path.join(projectDir, '_dev', 'reports', 'signals', 'attention-request__' + ts + '__delegation-altitude.json');
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, JSON.stringify(req, null, 2));
          signalWritten = true;
        } catch (_) {
          // signal emission is best-effort; never let it prevent the block.
        }
        state.lastBlockEpisode = state.editsAtLastSpawn;
        persist();
      }
      // Codex S3 finding: stderr must not claim a signal was written when it wasn't.
      process.stderr.write(
        'DELEGATION ALTITUDE BREAKER (enforcing): ' + editsSinceSpawn + ' authoring edits since the last delegation '
        + 'exceeds the hard cap (' + HARD_CAP + ') — coordinator-as-worker runaway. Delegate the cluster to a single '
        + 'Agent or bubble up. ' + (signalWritten ? 'An attention-request signal was written for the operator. ' : '')
        + 'Override this action: SMOS_DELEGATION_ALTITUDE_OVERRIDE=1 or `touch _dev/state/delegation-altitude/override`. '
        + 'Disable enforcing: remove _dev/state/delegation-altitude/enforce (or unset SMOS_DELEGATION_ALTITUDE_ENFORCE).\n'
      );
      return { status: 2 };
    }

    return { status: 0 };
  }

  // Unknown tool token — no-op.
  return { status: 0 };
}

// Extract an authoring target path from a Bash command, CONSERVATIVELY. Returns
// the first matching path string, or '' when nothing safely qualifies. Only
// these shapes count, and only when the target path ends in an AUTHORING_EXT:
//   - redirect:  ... > path.ext   or  ... >> path.ext
//   - tee:       tee [opts] path.ext  (also `tee -a path.ext`)
//   - in-place:  sed -i ... path.ext   or  perl -i ... path.ext
// Quotes around the path are tolerated. Anything else returns '' (not counted).
function extractAuthoringTargetFromBash(command, path) {
  if (!command || typeof command !== 'string') {
    return '';
  }

  const extOf = (p) => path.extname(String(p).replace(/['"]/g, '')).toLowerCase();
  const isAuthoringPath = (p) => {
    const cleaned = String(p).replace(/['"]/g, '').trim();
    if (!cleaned || cleaned.startsWith('-')) return false;
    return AUTHORING_EXTS.has(extOf(cleaned));
  };

  // 1) Redirect to a file: `> path` / `>> path` (not `>&`, not fd redirects
  //    like `2>`). Capture the token after the redirect operator.
  const redirectRe = /(?:^|[^0-9&>])>>?\s*("[^"]+"|'[^']+'|[^\s|;&>]+)/g;
  let m;
  while ((m = redirectRe.exec(command)) !== null) {
    const target = m[1];
    if (isAuthoringPath(target)) {
      return target.replace(/['"]/g, '');
    }
  }

  // 2) tee [..-a..] path  — first non-flag token after `tee`.
  const teeRe = /(?:^|[|;&]|\s)tee\b([^|;&]*)/g;
  while ((m = teeRe.exec(command)) !== null) {
    const rest = m[1] || '';
    const tokens = rest.trim().split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      if (tok.startsWith('-')) continue; // skip flags like -a
      if (isAuthoringPath(tok)) {
        return tok.replace(/['"]/g, '');
      }
      break; // first non-flag token wasn't authoring — stop for this tee
    }
  }

  // 3) In-place edits: `sed -i ... path` / `perl -i ... path`. Require the -i
  //    flag, then take the LAST token on that segment as the file target.
  const inplaceRe = /(?:^|[|;&]|\s)(sed|perl)\b([^|;&]*)/g;
  while ((m = inplaceRe.exec(command)) !== null) {
    const rest = m[2] || '';
    if (!/(?:^|\s)-i\b/.test(rest) && !/(?:^|\s)-[a-zA-Z]*i[a-zA-Z]*\b/.test(rest)) {
      continue; // not an in-place edit
    }
    const tokens = rest.trim().split(/\s+/).filter(Boolean);
    for (let j = tokens.length - 1; j >= 0; j -= 1) {
      const tok = tokens[j];
      if (tok.startsWith('-')) continue;
      if (isAuthoringPath(tok)) {
        return tok.replace(/['"]/g, '');
      }
      break; // last non-flag token wasn't an authoring path — don't count
    }
  }

  return '';
}

// ── tier-s2d: delegation-altitude-cap add consumer (report-only) ─────────────
// Consumes the `delegation-altitude-cap` add resolved LIVE from
// ProcessTierRule/1.1 (readSessionAdds — add IDs, never tier names). Enforces
// rule invariant 3 in code at dispatch time, REPORT-ONLY: events go to the
// soak ledger; status 2 is returned only if the operator flips the add's mode
// to "blocking". Reviewer-role exemption keys on ROLE, never model name.
const DELEGATION_CAP_ADD_ID = 'delegation-altitude-cap';
const TIER_GATE_SOAK_DIR_REL = '_dev/state/tier-gate-soak';

function evaluateDelegationCap({ projectDir, sessionId, payload, toolInput } = {}, opts = {}) {
  const fs = require('fs');
  const path = require('path');
  const pt = require('./lib/process-tier.cjs');

  const root = projectDir || process.env.CLAUDE_PROJECT_DIR || pt.ROOT;

  // Test rule override (logged in events, never silent) — same contract as
  // pretool-mutation-plan-gate.cjs.
  let rule;
  let overridePath = null;
  if (opts.rule !== undefined) {
    rule = opts.rule;
  } else {
    const override = String(process.env.MYTHOS_TIER_GATE_RULE_PATH || '').trim();
    if (override && fs.existsSync(override)) {
      rule = pt.readRuleSafe(override);
      overridePath = override;
    } else {
      rule = pt.readRuleSafe();
    }
  }

  const adds = pt.readSessionAdds(sessionId, { rule, stateDir: opts.stateDir });
  const add = adds.find((a) => a && a.id === DELEGATION_CAP_ADD_ID);
  if (!add) return { status: 0 };

  const killRel = (add.bypass_policy && add.bypass_policy.kill_switch) ||
    `_dev/state/kill-switches/${DELEGATION_CAP_ADD_ID}.off`;
  if (fs.existsSync(path.isAbsolute(killRel) ? killRel : path.join(root, killRel))) {
    return { status: 0, killed: true };
  }

  // Reviewer-role exemption (condition 8): role-keyed, never model-keyed.
  const role = String(
    (payload && payload.session_role) || process.env.MYTHOS_SESSION_ROLE || ''
  ).trim().toLowerCase();
  if (role === 'reviewer') return { status: 0, exempt: 'reviewer-role' };

  const stamp = pt.readSessionStamp(sessionId, { stateDir: opts.stateDir });
  if (!stamp) return { status: 0 };

  const events = [];

  // Recursive coordinator-tier invariant over the stamped coordination scope
  // (haiku session-root forbidden; subtree requires a satisfiable ceiling).
  const node = {
    tier: stamp.tier,
    model: stamp.model,
    coordination_scope: stamp.coordination_scope || undefined,
    judgment_ceiling: stamp.judgment_ceiling || undefined
  };
  const invariant = pt.checkCoordinationInvariant(node, { rule });
  for (const v of invariant.violations) {
    events.push({ kind: 'coordination-invariant', reason: v.reason });
  }

  // Subtree contract conditions must be artifact-present (operator fork
  // resolution, condition 9): the contract reference must exist on disk.
  if (stamp.coordination_scope === 'subtree') {
    const contractRef = String(
      (payload && payload.subtree_contract) || process.env.MYTHOS_SUBTREE_CONTRACT || ''
    ).trim();
    const contractAbs = contractRef
      ? (path.isAbsolute(contractRef) ? contractRef : path.join(root, contractRef))
      : null;
    if (!contractAbs || !fs.existsSync(contractAbs)) {
      events.push({ kind: 'subtree-contract', reason: 'subtree-contract-artifact-missing' });
    }
  }

  // Dispatch altitude: a coordinator may not dispatch-and-self-clear judgment
  // work at or above its own tier — route acceptance upward (rule invariant 3).
  const requestedModel = String((toolInput && toolInput.model) || '').trim();
  const coordinatorRank = pt.tierRank(stamp.tier);
  if (requestedModel && coordinatorRank !== null) {
    const dispatched = pt.resolveNameInferredTier({ model: requestedModel, rule });
    const dispatchedRank = pt.tierRank(dispatched.tier);
    if (dispatchedRank !== null && dispatchedRank > coordinatorRank) {
      events.push({
        kind: 'dispatch-altitude',
        reason: 'dispatch-above-own-tier-route-acceptance-upward',
        dispatched_model: requestedModel,
        dispatched_tier: dispatched.tier
      });
    } else if (dispatchedRank === coordinatorRank &&
        /review|audit|judge|verif/i.test(String((toolInput && toolInput.subagent_type) || ''))) {
      events.push({
        kind: 'dispatch-altitude',
        reason: 'same-tier-review-dispatch-self-clear-risk',
        dispatched_model: requestedModel,
        dispatched_tier: dispatched.tier
      });
    }
  }

  if (!events.length) return { status: 0 };

  const message = [
    `DELEGATION-ALTITUDE CAP${add.mode === 'blocking' ? '' : ' (report-only — would block)'}: ${events.map((e) => e.reason).join('; ')}.`,
    'Missing/expected: coordination_scope + judgment_ceiling in the session stamp satisfying coordinator tier >= highest judgment tier in subtree (recursively); subtree coordination requires the four subtree-contract conditions artifact-present; acceptance validation routes upward or to script-verifiable checks.',
    `Operator bypass (kill switch): touch _dev/state/kill-switches/${DELEGATION_CAP_ADD_ID}.off`
  ].join('\n');

  try {
    const dir = path.join(root, TIER_GATE_SOAK_DIR_REL);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${DELEGATION_CAP_ADD_ID}.jsonl`), JSON.stringify({
      schema: 'TierGateSoakEvent/1.0',
      add: DELEGATION_CAP_ADD_ID,
      mode: add.mode,
      session_id: sessionId,
      surface: 'PreToolUse Agent/Task',
      rule_path_override: overridePath,
      ts: new Date().toISOString(),
      decision: 'would-block',
      events,
      message
    }) + '\n');
  } catch (_) {
    // best-effort ledger
  }

  if (add.mode === 'blocking') {
    return { status: 2, message, events };
  }
  return { status: 0, events, message };
}

module.exports = {
  AUTHORING_EXTS,
  DELEGATION_CAP_ADD_ID,
  HARD_CAP,
  NON_AUTHORING_SEGMENTS,
  PATH_HISTORY_CAP,
  THRESHOLD,
  evaluateDelegationCap,
  extractAuthoringTargetFromBash,
  isTruthyEnv,
  main
};

if (require.main === module) {
  try {
    const result = main();
    process.exit(result && result.status === 2 ? 2 : 0);
  } catch (_) {
    // Never throw, never block.
    try { process.exit(0); } catch (_) { /* noop */ }
  }
}
