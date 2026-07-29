'use strict';

/**
 * Target-command compatibility policy for /dispatch-bridge.
 *
 * Rejects impossible actor/command pairs at the runner layer before any signal
 * is produced. Source-of-truth for managed-command actors is the on-disk
 * registry under AGENTS.md / .claude/commands/ / tools/codex/commands/. The
 * allowed set is computed at call-time so the validator stays in lockstep with
 * the canonical surfaces.
 *
 * Policy summary:
 *   /convene          -> ALLOWED for managed-command targets when registered.
 *                        The receiving actor becomes the origin lobe and must
 *                        run tools/convene/convene.js --origin <target>, which
 *                        fans out only to the other lobes. This preserves the
 *                        broadcast shape without self-recursive dispatch.
 *   target=codex      -> --command must be in AGENTS.md "Implemented managed
 *                        commands" line.
 *   target=claude     -> --command must exist as .claude/commands/<name>.md.
 *   target=opencode   -> same shape as claude (managed-command actor).
 *   target=opencode-local -> same shape as opencode; Ollama-backed local
 *                        variant for credential-touching work. Looks in the
 *                        same .opencode/commands directory as opencode.
 *   target=gemini     -> freeform-prompt-target. Empty command and "freeform"
 *                        are allowed; arbitrary slash strings are rejected.
 *   target=openrouter -> same freeform-prompt-target rule as gemini.
 *   managed-command actors with command="freeform" or omitted -> REJECTED.
 *
 * Pure module — only side effect is reading registry sources from
 * `${projectRoot}/AGENTS.md`, `${projectRoot}/.claude/commands/`, and
 * `${projectRoot}/tools/codex/commands/`. Tests can substitute fixtures via
 * the projectRoot argument.
 */

const fs = require('fs');
const path = require('path');

const FREEFORM_PROMPT_TARGETS = Object.freeze(['gemini', 'openrouter', 'remote-ssh']);
const MANAGED_COMMAND_TARGETS = Object.freeze(['codex', 'claude', 'opencode', 'opencode-local']);

const AGENTS_MD_REL = 'AGENTS.md';
const CLAUDE_COMMANDS_REL = path.join('.claude', 'commands');
const CODEX_COMMANDS_REL = path.join('tools', 'codex', 'commands');
const CANONICAL_COMMANDS_REL = path.join('instructions', 'canonical', 'commands');

const SEMANTIC_SCOPES = Object.freeze([
  'repo',
  'pipeline',
  'active-workstreams',
  'named-scope',
  'path'
]);

/**
 * Parse the AGENTS.md "Implemented managed commands" line and return the set
 * of slash-command strings (e.g. "/orchestrate-loop"). Returns an empty array
 * when the line is missing.
 *
 * @param {string} agentsMdPath
 * @returns {{ commands: string[], source: string }}
 */
function readCodexManagedCommands(agentsMdPath) {
  if (!fs.existsSync(agentsMdPath)) {
    return { commands: [], source: agentsMdPath };
  }
  const raw = fs.readFileSync(agentsMdPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const collected = [];
  for (const line of lines) {
    const idx = line.indexOf('Implemented managed commands');
    if (idx === -1) continue;
    const after = line.slice(idx + 'Implemented managed commands'.length);
    const matches = after.match(/\/[a-z][a-z0-9-]*/gi) || [];
    for (const m of matches) collected.push(m.toLowerCase());
  }
  return { commands: Array.from(new Set(collected)), source: agentsMdPath };
}

/**
 * Read the slash-command names exposed by a directory of `.md` (claude) or
 * `.js` (codex) files. Each file basename becomes "/<name>".
 *
 * @param {string} dir
 * @param {string} ext - ".md" or ".js"
 * @returns {string[]}
 */
function readCommandsFromDir(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(ext)) continue;
    const base = entry.name.slice(0, -ext.length);
    if (!base) continue;
    out.push('/' + base.toLowerCase());
  }
  return out;
}

function readCanonicalCommandIds(projectRoot) {
  const dir = path.join(projectRoot, CANONICAL_COMMANDS_REL);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => '/' + entry.name.slice(0, -5).toLowerCase());
}

function splitInvocation(input) {
  return String(input || '').match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }
    return token;
  }) || [];
}

function escapeRouteInput(input) {
  return String(input).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function inferSemanticScope(args, projectRoot) {
  const first = String(args[0] || '').trim();
  if (!first || first === 'repo') return { type: 'repo', value: first || 'repo' };
  if (first === 'pipeline' || first === 'advance-pipeline') return { type: 'pipeline', value: first };
  if (first === 'active-workstreams') return { type: 'active-workstreams', value: first };

  const pathLike = first.startsWith('.') || first.startsWith('/') || first.includes(path.sep);
  if (pathLike) {
    const resolved = path.resolve(projectRoot, first);
    const relative = path.relative(projectRoot, resolved);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
      return { type: 'path', value: first, valid: false, reason: 'path escapes repository root' };
    }
    return { type: 'path', value: relative || '.', valid: true };
  }

  return { type: 'named-scope', value: first };
}

/**
 * Resolve an operator command into a typed, read-only invocation envelope.
 * Unknown intent is preserved and routed; authority/safety failures never are.
 */
function resolveTypedInvocation(params) {
  if (!params || typeof params !== 'object') {
    throw new Error('resolveTypedInvocation: params object required');
  }
  const projectRoot = params.projectRoot;
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('resolveTypedInvocation: projectRoot required');
  }

  const originalInput = String(params.input || '').trim();
  const base = {
    command_id: null,
    typed_arguments: [],
    semantic_scope: null,
    execution_mode: params.executionMode || null,
    harness_capability_state: params.harnessCapabilityState || 'unknown',
    original_input: originalInput,
    terminal_state: 'unsupported',
    resolution_state: 'unresolved',
    resolved_command: '',
    fallback_reason: null
  };

  if (params.authorityAllowed === false) {
    return { ...base, terminal_state: 'blocked', resolution_state: 'refused', fallback_reason: params.authorityReason || 'authority check failed' };
  }
  if (params.safetyAllowed === false) {
    return { ...base, terminal_state: 'blocked', resolution_state: 'refused', fallback_reason: params.safetyReason || 'safety check failed' };
  }
  if (!originalInput) {
    return { ...base, resolved_command: '/help-me-route', fallback_reason: 'empty operator intent' };
  }

  const tokens = splitInvocation(originalInput);
  const head = String(tokens[0] || '').toLowerCase();
  if (head === '/route' || head === '/help-me-route') {
    return { ...base, command_id: head, typed_arguments: tokens.slice(1), terminal_state: 'blocked', resolution_state: 'refused', fallback_reason: 'routing recursion refused' };
  }

  const canonical = readCanonicalCommandIds(params.registryRoot || projectRoot);
  const recognized = /^\/[a-z][a-z0-9-]*$/.test(head) && canonical.includes(head);
  if (!recognized) {
    return {
      ...base,
      resolved_command: `/route "${escapeRouteInput(originalInput)}"`,
      resolution_state: 'routed',
      fallback_reason: 'unrecognized operator intent'
    };
  }

  const typedArguments = tokens.slice(1).map((value, index) => ({ index, type: 'string', value }));
  const semanticScope = inferSemanticScope(tokens.slice(1), projectRoot);
  if (semanticScope.valid === false) {
    return {
      ...base,
      command_id: head,
      typed_arguments: typedArguments,
      semantic_scope: semanticScope,
      terminal_state: 'invalid_scope',
      resolution_state: 'refused',
      fallback_reason: semanticScope.reason
    };
  }

  return {
    ...base,
    command_id: head,
    typed_arguments: typedArguments,
    semantic_scope: semanticScope,
    terminal_state: null,
    resolution_state: 'resolved',
    resolved_command: originalInput,
    fallback_reason: null
  };
}

/**
 * Validate that --target/--command is a coherent pair.
 *
 * @param {object} params
 * @param {string} params.target  - actor id (lowercase recommended)
 * @param {string} [params.command] - exact slash command (or "freeform" or omitted)
 * @param {string} params.projectRoot - absolute path to repo root
 * @returns {{ allowed: boolean, reason: string, registry_source: string }}
 */
function validateTargetCommandCompat(params) {
  if (!params || typeof params !== 'object') {
    throw new Error('validateTargetCommandCompat: params object required');
  }
  const target = String(params.target || '').trim().toLowerCase();
  const command = params.command === undefined || params.command === null
    ? ''
    : String(params.command).trim();
  const projectRoot = params.projectRoot;
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('validateTargetCommandCompat: projectRoot required');
  }
  if (!target) {
    return { allowed: false, reason: 'target actor required', registry_source: '(none)' };
  }

  // Freeform-prompt-target policy ------------------------------------------
  // Gemini and OpenRouter receive freeform prompts (no Mythos slash-command
  // surface inside their runtime). The accepted shape is therefore:
  //   - command === '' (omitted), or
  //   - command === 'freeform' (explicit marker)
  // Arbitrary slash strings remain REJECTED for freeform targets — that
  // recreates Defect 3 (slash-command pretense / command-task-fit failure).
  // The lower runner (tools/signals/lib/dispatch-bridge.js buildDispatchResult)
  // permits this shape for freeform targets in concert with this validator;
  // both surfaces must agree.
  const isFreeformTarget = FREEFORM_PROMPT_TARGETS.includes(target) || target.startsWith('openrouter-');
  if (isFreeformTarget) {
    if (command === '' || command.toLowerCase() === 'freeform') {
      return { allowed: true, reason: null, registry_source: 'tools/signals/lib/target-command-policy.cjs:FREEFORM_PROMPT_TARGETS (freeform shape)' };
    }
    // Arbitrary slash strings under freeform-prompt-targets recreate Defect 3.
    return {
      allowed: false,
      reason: `target ${target} is a freeform-prompt-target; arbitrary slash command "${command}" is REJECTED. Slash-command pretense under freeform-prompt-targets recreates the Defect 3 command-task-fit failure. Pass --command "" or --command freeform, or route the work to a managed-command actor with a real slash command.`,
      registry_source: 'tools/signals/lib/target-command-policy.cjs:FREEFORM_PROMPT_TARGETS'
    };
  }

  // Managed-command actors --------------------------------------------------
  if (!MANAGED_COMMAND_TARGETS.includes(target)) {
    return {
      allowed: false,
      reason: `target "${target}" is not registered (managed-command actors: ${MANAGED_COMMAND_TARGETS.join(', ')}; freeform-prompt-targets: ${FREEFORM_PROMPT_TARGETS.join(', ')})`,
      registry_source: 'tools/signals/lib/target-command-policy.cjs:MANAGED_COMMAND_TARGETS'
    };
  }

  // Managed-command actor MUST receive a real slash command.
  if (command === '' || command.toLowerCase() === 'freeform') {
    return {
      allowed: false,
      reason: `target ${target} is a managed-command actor; --command must be a real registered slash command. "freeform" or omission is REJECTED — rewrite as a real command or route to a freeform-prompt-target (gemini, openrouter).`,
      registry_source: target === 'codex'
        ? 'AGENTS.md (Implemented managed commands)'
        : '.claude/commands/ or tools/codex/commands/'
    };
  }

  // Extract leading slash-command head (e.g. "/review-task-plan some-id" -> "/review-task-plan").
  const headMatch = command.match(/^(\/[a-z][a-z0-9-]*)(?:\s|$)/i);
  if (!headMatch) {
    return {
      allowed: false,
      reason: `command "${command}" is not a syntactically valid slash command for managed-command actor ${target}`,
      registry_source: 'tools/signals/lib/target-command-policy.cjs (syntax check)'
    };
  }
  const cmdLower = headMatch[1].toLowerCase();

  if (target === 'codex') {
    const reg = readCodexManagedCommands(path.join(projectRoot, AGENTS_MD_REL));
    if (reg.commands.length === 0) {
      return {
        allowed: false,
        reason: `AGENTS.md "Implemented managed commands" line not found at ${AGENTS_MD_REL}; cannot validate codex command "${command}"`,
        registry_source: reg.source
      };
    }
    if (!reg.commands.includes(cmdLower)) {
      return {
        allowed: false,
        reason: `command "${command}" is not in AGENTS.md "Implemented managed commands" list (${reg.commands.join(', ')})`,
        registry_source: reg.source
      };
    }
    return {
      allowed: true,
      reason: `command "${command}" is in AGENTS.md managed list for codex`,
      registry_source: reg.source
    };
  }

  if (target === 'claude') {
    const dir = path.join(projectRoot, CLAUDE_COMMANDS_REL);
    const cmds = readCommandsFromDir(dir, '.md');
    if (cmds.length === 0) {
      return {
        allowed: false,
        reason: `${CLAUDE_COMMANDS_REL}/ is empty or missing; cannot validate claude command "${command}"`,
        registry_source: dir
      };
    }
    if (!cmds.includes(cmdLower)) {
      return {
        allowed: false,
        reason: `command "${command}" is not registered under ${CLAUDE_COMMANDS_REL}/`,
        registry_source: dir
      };
    }
    return {
      allowed: true,
      reason: `command "${command}" exists at ${CLAUDE_COMMANDS_REL}/${command.replace(/^\//, '')}.md`,
      registry_source: dir
    };
  }

  if (target === 'opencode' || target === 'opencode-local') {
    // Both opencode and opencode-local mirror Claude's command surface
    // (.claude/commands/) per the dispatch-bridge runner mapping; if a distinct
    // .opencode/commands directory materializes, that path is consulted first.
    // opencode-local is the Ollama-backed variant used for credential-touching
    // work; it shares the same command surface as opencode.
    const opDir = path.join(projectRoot, '.opencode', 'commands');
    let dir = opDir;
    let cmds = readCommandsFromDir(dir, '.md');
    if (cmds.length === 0) {
      dir = path.join(projectRoot, CLAUDE_COMMANDS_REL);
      cmds = readCommandsFromDir(dir, '.md');
    }
    if (cmds.length === 0) {
      return {
        allowed: false,
        reason: `no opencode or claude command directory found; cannot validate opencode command "${command}"`,
        registry_source: opDir
      };
    }
    if (!cmds.includes(cmdLower)) {
      return {
        allowed: false,
        reason: `command "${command}" is not registered under ${path.relative(projectRoot, dir)}/`,
        registry_source: dir
      };
    }
    return {
      allowed: true,
      reason: `command "${command}" exists at ${path.relative(projectRoot, dir)}/${command.replace(/^\//, '')}.md`,
      registry_source: dir
    };
  }

  // Unreachable.
  return {
    allowed: false,
    reason: `unhandled target "${target}"`,
    registry_source: '(none)'
  };
}

function projectTargetCapabilities(params) {
  const target = String(params && params.target || '').trim().toLowerCase();
  const command = String(params && params.command || '').trim();
  const projectRoot = params && params.projectRoot;
  const commandCheck = validateTargetCommandCompat({ target, command, projectRoot });
  const requiredMcp = Array.isArray(params && params.requiredMcp) ? params.requiredMcp : [];
  const availableMcp = new Set(Array.isArray(params && params.availableMcp) ? params.availableMcp : []);
  const missingMcp = requiredMcp.filter((id) => !availableMcp.has(id));
  return {
    target_supported: FREEFORM_PROMPT_TARGETS.includes(target) || MANAGED_COMMAND_TARGETS.includes(target),
    command_supported: commandCheck.allowed,
    mcp_ready: missingMcp.length === 0,
    privacy_compatible: params && params.privacyCompatible !== false,
    references: commandCheck.registry_source && path.isAbsolute(commandCheck.registry_source)
      ? [path.relative(projectRoot, commandCheck.registry_source)]
      : [],
    errors: [
      ...(commandCheck.allowed ? [] : [commandCheck.reason]),
      ...(missingMcp.length ? [`missing MCP capabilities: ${missingMcp.join(', ')}`] : [])
    ]
  };
}

module.exports = {
  validateTargetCommandCompat,
  resolveTypedInvocation,
  FREEFORM_PROMPT_TARGETS,
  MANAGED_COMMAND_TARGETS,
  SEMANTIC_SCOPES,
  // Exposed for tests.
  readCodexManagedCommands,
  readCommandsFromDir,
  readCanonicalCommandIds,
  splitInvocation,
  inferSemanticScope,
  projectTargetCapabilities
};
