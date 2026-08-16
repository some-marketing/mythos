#!/usr/bin/env node
'use strict';

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  NARRATIVE_SCHEMA,
  computePlanContentHashes,
  readMarkdownBinding
} = require('../signals/lib/review-task-plan-narrative');
const { resolveTaskPlanPaths } = require('../planning/lib/resolve-task-plan');

// ── Constants ──────────────────────────────────────────────────────────────

const CO_AUTHOR = 'Co-Authored-By: Claude Opus 4.6 (1M context) <user@example.com>';
const CANONICAL_BRANCH = 'recovery/clean-lineage-2026-05-18';

const SENSITIVE_PATTERNS = [
  /\.env$/,
  /\.env\..+$/,
  /credentials\.json$/,
  /creds/i,
  /secret/i,
  /auth.*\.json$/i,
  /token/i,
  /\.pem$/,
  /\.key$/,
];

// Path-prefix rules ordered from most specific to least specific.
// First match wins, so more specific prefixes must come first.
const PATH_RULES = [
  { prefix: 'Mythos-memories/reports/',      group: 'vault-mirror' },
  { prefix: 'Mythos-memories/concepts/',     group: 'vault-mirror' },
  { prefix: 'Mythos-memories/instructions/', group: 'vault-mirror' },
  { prefix: 'Mythos-memories/debriefs/',     group: 'vault-mirror' },
  { prefix: 'Mythos-memories/transcripts/',  group: 'vault-mirror' },
  { prefix: 'Mythos-memories/mocs/',         group: 'vault-mirror' },
  { prefix: 'Mythos-memories/.smart-env/',   group: 'disposable-cache' },
  { prefix: 'Mythos-memories/.obsidian/',    group: 'disposable-cache' },
  { prefix: '_dev/archive/',                 group: 'dev-archive' },
  { prefix: 'tools/codex/prompt-system/',                 group: 'dev-prompts' },
  { prefix: '_dev/research/',                group: 'dev-research' },
  { prefix: 'docs/',                         group: 'docs' },
  { prefix: '.mcp.json',                     group: 'mythos-infrastructure' },
  { prefix: '_dev/reports/signals/',         group: 'dev-signals' },
  { prefix: '_dev/reports/analysis/task-plans/', group: 'dev-task-plans' },
  { prefix: '_dev/reports/',                 group: 'dev-reports' },
  { prefix: '_dev/state/',                   group: 'dev-state' },
  { prefix: '_dev/logs/',                    group: 'dev-state' },
  { prefix: '_dev/autonomy/',               group: 'dev-state' },
  { prefix: '_dev/concepts/',               group: 'dev-concepts' },
  { prefix: '.claude/',                      group: 'mythos-infrastructure' },
  { prefix: '.github/',                      group: 'mythos-infrastructure' },
  { prefix: 'instructions/',                group: 'mythos-infrastructure' },
  { prefix: 'frameworks/',                  group: 'frameworks' },
  { prefix: 'tools/',                       group: 'tooling' },
  { prefix: 'tests/',                       group: 'tests' },
  { prefix: 'package.json',                group: 'mythos-infrastructure' },
  { prefix: 'package-lock.json',           group: 'mythos-infrastructure' },
  { prefix: 'README.md',                   group: 'mythos-infrastructure' },
  { prefix: 'AGENTS.md',                   group: 'mythos-infrastructure' },
  { prefix: '.gitignore',                  group: 'mythos-infrastructure' },
  { prefix: '.gitattributes',              group: 'mythos-infrastructure' },
];

// Clients live under clients/{CODE}/ — extracted dynamically.
const CLIENTS_PREFIX = 'clients/';

const DESCRIPTION_MAP = {
  'mythos-infrastructure': 'Mythos infrastructure and guardrails',
  'dev-archive':           'archived analysis reports',
  'dev-prompts':           'prompt packs',
  'dev-research':          'research artifacts',
  'docs':                  'documentation',
  'dev-reports':          'analysis reports',
  'dev-state':            'dev state and logs',
  'dev-signals':          'coordination signals',
  'dev-concepts':         'concept bundles',
  'dev-task-plans':       'task plans',
  'tooling':              'tools and utilities',
  'tests':                'lifecycle tests',
  'frameworks':           'framework definitions',
  'vault-mirror':         'Derived Obsidian vault mirror (should be gitignored)',
  'disposable-cache':     'Disposable Obsidian caches (should be gitignored)',
  'ungrouped':            'miscellaneous files',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function getRepoRoot() {
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
}

function gitStatus(repoRoot) {
  const raw = execSync('git status --short', { cwd: repoRoot, encoding: 'utf8' }).replace(/\n$/, '');
  if (!raw) return [];
  return raw.split('\n').map(line => {
    // git status --short format: XY filename  (or XY "filename" for paths with spaces)
    const statusCode = line.substring(0, 2).trim();
    let filePath = line.substring(3);
    // Remove surrounding quotes if present
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1);
    }
    return { status: statusCode, file: filePath };
  });
}

function isSensitive(filePath) {
  const basename = path.basename(filePath);
  return SENSITIVE_PATTERNS.some(p => p.test(basename) || p.test(filePath));
}

// Governance-gated paths must NEVER be auto-committed — by the unattended daemon
// or any hygiene run. They change only through the foreground ConveneReceipt gate
// (tools/verify/hooks/pre-write-convene-required.cjs). That gate lives in Claude's
// PreToolUse layer, which the background daemon bypasses; without this filter the
// daemon can commit canonical specs no foreground actor is allowed to touch.
// Single source of truth: reuse the gate's own PROTECTED_PATHS so the two stay in sync.
const { PROTECTED_PATHS: GOVERNANCE_GATED_PATHS } = require('../verify/hooks/pre-write-convene-required.cjs');
function isGovernanceGated(filePath) {
  const rel = String(filePath).replace(/\\/g, '/');
  return GOVERNANCE_GATED_PATHS.some(re => re.test(rel));
}

function isNarrativeIncompleteReview(filePath, repoRoot = getRepoRoot()) {
  const rel = String(filePath).replace(/\\/g, '/');
  if (!/^_dev\/reports\/analysis\/task-plan-reviews\/.+__review(?:__[^/]+|\.structural-precheck)?\.(?:json|md)$/.test(rel)) {
    return false;
  }
  if (rel.includes('__review.structural-precheck.')) return true;

  const absolutePath = path.join(repoRoot, rel);
  const jsonPath = absolutePath.replace(/\.md$/, '.json');
  const markdownPath = absolutePath.replace(/\.json$/, '.md');
  if (!fs.existsSync(jsonPath) || !fs.existsSync(markdownPath)) return true;
  try {
    const review = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const jsonBinding = review.narrative_completion || null;
    const markdownBinding = readMarkdownBinding(markdownPath);
    if (!jsonBinding || !markdownBinding || review.schema !== 'TaskPlanReview/1.0') return true;
    for (const binding of [jsonBinding, markdownBinding]) {
      if (binding.schema !== NARRATIVE_SCHEMA || binding.status !== 'complete' ||
          !String(binding.run_id || '').trim() ||
          !/^[a-f0-9]{64}$/.test(String(binding.plan_content_hash || ''))) {
        return true;
      }
    }
    if (jsonBinding.run_id !== markdownBinding.run_id ||
        jsonBinding.plan_content_hash !== markdownBinding.plan_content_hash) {
      return true;
    }
    const taskId = String(review.task_id || path.basename(jsonPath).replace(/__review\.json$/, ''));
    const resolved = resolveTaskPlanPaths(repoRoot, taskId);
    if (!resolved) return true;
    const hashes = computePlanContentHashes(resolved.jsonPath, resolved.markdownPath);
    return jsonBinding.plan_content_hash !== hashes.plan_content_hash ||
      jsonBinding.plan_json_sha256 !== hashes.plan_json_sha256 ||
      jsonBinding.plan_markdown_sha256 !== hashes.plan_markdown_sha256;
  } catch (_) {
    return true;
  }
}

function classifyFile(filePath) {
  // Client files: clients/{CODE}/... (must have a subdirectory — loose files under clients/ fall through)
  if (filePath.startsWith(CLIENTS_PREFIX)) {
    const rest = filePath.substring(CLIENTS_PREFIX.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx > 0) {
      const code = rest.substring(0, slashIdx);
      return { group: `client:${code}`, clientCode: code };
    }
  }

  // Static path rules (ordered most-specific-first)
  for (const rule of PATH_RULES) {
    if (filePath.startsWith(rule.prefix)) {
      return { group: rule.group };
    }
  }

  return { group: 'ungrouped' };
}

function descriptionForGroup(groupKey) {
  if (groupKey.startsWith('client:')) {
    const code = groupKey.substring('client:'.length);
    return `${code} client work`;
  }
  return DESCRIPTION_MAP[groupKey] || 'miscellaneous files';
}

function verbForStatuses(statuses) {
  const allNew = statuses.every(s => s === '??');
  if (allNew) return 'Add';
  // All modified (M in either index or worktree)
  const allModified = statuses.every(s => /^M?\s?M?$/.test(s) && s.includes('M'));
  if (allModified) return 'Update';
  return 'Update'; // safe default for mixed/deletions
}

function getHostName() {
  try {
    return execFileSync('hostname', ['-s'], { encoding: 'utf8' }).trim();
  } catch (_) {
    return 'unknown';
  }
}

function buildCommitMessage(verb, description, hostName) {
  return `${verb} ${description}\n\nHost: ${hostName || 'unknown'}\n${CO_AUTHOR}`;
}

function prompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ── Custody helpers ────────────────────────────────────────────────────────

/**
 * Resolve the current session's custody set: the union of
 *   (a) write-ledger paths from _dev/state/active-sessions/<session_id>/write_log.json
 *   (b) owned_artifacts from the active plan's scope_identity
 *
 * Returns { custodySet: Set<string>, sessionId: string|null, resolved: boolean }
 * where custodySet entries are repo-relative paths.
 *
 * When custody cannot be resolved (no session env var, no write-ledger) the
 * caller must treat ALL files as UNKNOWN and preserve existing branch-gate
 * behavior — never broadening the commit surface.
 */
function resolveCustodySet(repoRoot) {
  // Session id may be injected by the Claude Code harness
  const sessionId = process.env.CLAUDE_SESSION_ID || process.env.MYTHOS_SESSION_ID || null;

  const custodySet = new Set();

  if (!sessionId) {
    return { custodySet, sessionId: null, resolved: false };
  }

  // (a) write-ledger — FIX 5: use correct schema (.paths[].path), NOT .entries/.writes
  const ledgerPath = path.join(repoRoot, '_dev', 'state', 'active-sessions', sessionId, 'write_log.json');
  try {
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    // Correct schema: { session_id, paths: [{path, at, tool}], updated_at }
    const entries = Array.isArray(ledger.paths) ? ledger.paths : [];
    for (const entry of entries) {
      const p = typeof entry === 'string' ? entry : (entry.path || '');
      if (p) custodySet.add(p.replace(/^\/+/, ''));
    }
  } catch (_) {
    // Ledger absent or unreadable — not fatal; owned_artifacts may still provide coverage
  }

  // (b) owned_artifacts from THIS SESSION's active plan only.
  // FIX 5: NEVER union all plans — only the plan that belongs to the current session.
  // We identify the current session's plan by matching the session_id field inside
  // the plan's scope_identity or the top-level session_id field. If no such match
  // exists, we skip owned_artifacts (safe: no-session fallback does not broaden).
  const planDir = path.join(repoRoot, '_dev', 'reports', 'analysis', 'task-plans');
  try {
    const planFiles = fs.readdirSync(planDir).filter(f => f.endsWith('.json'));
    for (const pf of planFiles) {
      try {
        const plan = JSON.parse(fs.readFileSync(path.join(planDir, pf), 'utf8'));
        // Only include owned_artifacts from plans that are explicitly tied to THIS session.
        // FIX C: read scope_identity.session_or_run_id first (canonical plan field),
        // then fall back to scope_identity.session_id and top-level session_id.
        const si = plan.scope_identity || plan.scopeIdentity || {};
        const planSessionId =
          si.session_or_run_id ||
          si.sessionOrRunId ||
          si.session_id ||
          si.sessionId ||
          plan.session_id ||
          null;
        if (planSessionId !== sessionId) continue; // not this session's plan
        const artifacts = si.owned_artifacts || si.ownedArtifacts || [];
        for (const a of artifacts) {
          if (typeof a === 'string') custodySet.add(a.replace(/^\/+/, ''));
        }
      } catch (_) {
        // Skip unreadable plan files
      }
    }
  } catch (_) {
    // planDir absent — not fatal
  }

  return { custodySet, sessionId, resolved: true };
}

/**
 * Partition entries into own/foreign/unknown given a resolved custody set.
 * When custody is not resolved (resolved=false), all entries are UNKNOWN.
 */
function partitionByCustody(entries, { custodySet, resolved, sessionId }, repoRoot) {
  if (!resolved) {
    return { own: [], foreign: [], unknown: entries.slice() };
  }
  const own = [];
  const foreign = [];
  const unknown = [];

  const sessionsDir = path.join(repoRoot, '_dev', 'state', 'active-sessions');

  // Dynamic import of git custody gate classification module
  let gitCustodyGate = null;
  try {
    gitCustodyGate = require('../kernel/hooks/pretool-git-custody-gate.cjs');
  } catch (_) {
    // Fail-silent
  }

  // Load foreign plan artifacts once for auto-commit to optimize performance
  let foreignPlanMap = null;
  if (gitCustodyGate && typeof gitCustodyGate.loadForeignPlanArtifacts === 'function') {
    try {
      foreignPlanMap = gitCustodyGate.loadForeignPlanArtifacts(repoRoot, fs, path, sessionId, { silent: true });
    } catch (_) {}
  }

  for (const entry of entries) {
    if (custodySet.has(entry.file)) {
      own.push(entry);
    } else if (gitCustodyGate && typeof gitCustodyGate.classifyPath === 'function') {
      try {
        const res = gitCustodyGate.classifyPath(entry.file, sessionId, sessionsDir, fs, repoRoot, foreignPlanMap);
        if (res.classification === 'own') {
          own.push(entry);
        } else if (res.classification === 'foreign') {
          foreign.push(entry);
        } else {
          unknown.push(entry);
        }
      } catch (err) {
        unknown.push(entry); // degrade gracefully
      }
    } else {
      // Heuristic fallback
      const isDefinitelyForeign = /^_dev\/state\/active-sessions\/[^/]+\//.test(entry.file) &&
        !entry.file.includes(`/active-sessions/${process.env.CLAUDE_SESSION_ID || process.env.MYTHOS_SESSION_ID}/`);
      if (isDefinitelyForeign) {
        foreign.push(entry);
      } else {
        unknown.push(entry);
      }
    }
  }
  return { own, foreign, unknown };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const autoMode = args.includes('--auto');
  // Foreground detection: any Claude Code-driven invocation (/boot, /new-session,
  // workers, manual) commits its own work unconditionally; only a TRUE unattended
  // runner (launchd/cron, no Claude env) yields to live sessions.
  // Primary signal is the CLAUDECODE env marker, which the Claude Code Bash tool
  // always sets and a launchd/cron runner does not. NOTE: CLAUDE_SESSION_ID /
  // MYTHOS_SESSION_ID are NOT reliable — they are unset in foreground Bash (the real
  // var is CLAUDE_CODE_SESSION_ID). The --foreground flag remains as an explicit
  // override for callers that want to force foreground behavior regardless of env.
  const isForegroundSession = args.includes('--foreground') || !!process.env.CLAUDECODE;

  const repoRoot = getRepoRoot();
  const hostName = getHostName();

  // B4 — Branch guard
  const currentBranch = execSync('git branch --show-current', { cwd: repoRoot, encoding: 'utf8' }).trim();
  if (currentBranch !== CANONICAL_BRANCH) {
    console.log(`[auto-commit] Not on canonical branch ${CANONICAL_BRANCH} (current: ${currentBranch}), skipping`);
    process.exit(0);
  }

  // B5 — Lock file
  const lockFile = path.join(repoRoot, '.auto-commit.lock');
  const acquireLock = () => {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    } catch (err) {
      // Lock exists — check if the owning process is still alive
      let staleLock = false;
      try {
        const existingPid = parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
        if (!isNaN(existingPid)) {
          try {
            process.kill(existingPid, 0);
          } catch (_) {
            // Process not found — lock is stale
            staleLock = true;
          }
        } else {
          staleLock = true;
        }
      } catch (_) {
        staleLock = true;
      }
      if (staleLock) {
        try { fs.unlinkSync(lockFile); } catch (_) {}
        fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
      } else {
        console.log('[auto-commit] Another instance running, skipping');
        process.exit(0);
      }
    }
  };
  acquireLock();
  process.on('exit', () => { try { fs.unlinkSync(lockFile); } catch (_) {} });

  // CHANGE 2 — Daemon-only guards. These only run for the unattended background
  // runner: `--auto` WITHOUT `--foreground`. Foreground callers (/boot, /new-session)
  // pass `--foreground` and commit their own work unconditionally; a plain interactive
  // run (no `--auto`) is also exempt (the operator is explicitly driving it).
  const daemonGuardsActive = autoMode && !isForegroundSession;
  if (daemonGuardsActive) {
    // CHANGE 2a — Staged-index skip: another actor has staged files; defer.
    try {
      execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: repoRoot });
      // Exit 0 = nothing staged, continue
    } catch (stagedCheckErr) {
      if (stagedCheckErr.status === 1) {
        console.log('[auto-commit] Staged content detected in index at startup, deferring to avoid collision');
        process.exit(0);
      }
      // Other git errors: degrade gracefully
      console.log(`[auto-commit] Staged-index check failed (continuing): ${stagedCheckErr.message}`);
    }

    // CHANGE 2b — Session-aware pause: yield if any active session is live.
    try {
      const registryPath = path.join(repoRoot, 'tools', 'sessions', 'lib', 'active-session-registry.js');
      const { listActive } = require(registryPath);
      const activeSessions = listActive({ sweepExpired: true });
      if (activeSessions.length > 0) {
        console.log(`[auto-commit] daemon: ${activeSessions.length} active session(s) present, deferring`);
        process.exit(0);
      }
    } catch (sessionErr) {
      console.log(`[auto-commit] Session registry check failed (continuing): ${sessionErr.message}`);
    }
  }

  const entries = gitStatus(repoRoot);

  if (entries.length === 0) {
    console.log('[auto-commit] Working tree clean');
    process.exit(0);
  }

  // Filter out sensitive files AND governance-gated paths. Governance-gated paths
  // (canonical specs, council/convene tooling, settings.json) change only through
  // the foreground ConveneReceipt gate — auto-commit must never commit them, or the
  // daemon (running outside the PreToolUse hook) silently bypasses that gate.
  const sensitiveFiles = entries.filter(e => isSensitive(e.file));
  const gatedFiles = entries.filter(e => !isSensitive(e.file) && isGovernanceGated(e.file));
  const incompleteReviewFiles = entries.filter(e =>
    !isSensitive(e.file) && !isGovernanceGated(e.file) && isNarrativeIncompleteReview(e.file, repoRoot)
  );
  const safeEntries = entries.filter(e =>
    !isSensitive(e.file) && !isGovernanceGated(e.file) && !isNarrativeIncompleteReview(e.file, repoRoot)
  );

  if (sensitiveFiles.length > 0) {
    console.log(`[auto-commit] Skipping ${sensitiveFiles.length} sensitive file(s):`);
    for (const f of sensitiveFiles) {
      console.log(`  SKIP ${f.file}`);
    }
    console.log();
  }

  if (gatedFiles.length > 0) {
    console.log(`[auto-commit] Skipping ${gatedFiles.length} governance-gated file(s) (require ConveneReceipt, not auto-commit):`);
    for (const f of gatedFiles) {
      console.log(`  SKIP ${f.file}`);
    }
    console.log();
  }

  if (incompleteReviewFiles.length > 0) {
    console.log(`[auto-commit] Skipping ${incompleteReviewFiles.length} incomplete task-plan review artifact(s):`);
    for (const f of incompleteReviewFiles) {
      console.log(`  NARRATIVE_INCOMPLETE ${f.file}`);
    }
    console.log();
  }

  if (safeEntries.length === 0) {
    console.log('[auto-commit] No safe files to commit');
    process.exit(0);
  }

  // Custody filter — only stage/commit files in the current session's custody set.
  // Foreign files are never proposed; unknown files are included (with a log note)
  // when custody cannot be resolved (preserves existing behavior in daemon context).
  const custody = resolveCustodySet(repoRoot);
  let committableEntries = safeEntries;

  if (!custody.resolved) {
    console.log('[auto-commit] Custody scoping skipped: no session id resolvable — falling back to branch-gate behavior only');
  } else {
    const { own, foreign, unknown } = partitionByCustody(safeEntries, custody, repoRoot);

    if (foreign.length > 0) {
      console.log(`[auto-commit] Skipping ${foreign.length} out-of-custody (foreign) file(s):`);
      for (const f of foreign) {
        console.log(`  OUT_OF_CUSTODY ${f.file}`);
      }
      console.log();
    }

    if (unknown.length > 0) {
      // Operator decision 2026-06-19: include own+unknown, exclude only foreign
      // (mirrors gate unknown=pass posture — unknown ≠ foreign, so auto-commit
      // passes them through just as the PreToolUse gate does).
      console.log(`[auto-commit] Custody note: ${unknown.length} file(s) have no write-ledger entry (session ${custody.sessionId}); including as unconfirmed (operator decision 2026-06-19: include own+unknown, exclude only foreign)`);
    }

    // Operator decision 2026-06-19: include own+unknown, exclude only foreign
    // (mirrors gate unknown=pass posture).
    committableEntries = [...own, ...unknown];
  }

  if (committableEntries.length === 0) {
    console.log('[auto-commit] No in-custody files to commit');
    process.exit(0);
  }

  // Group files
  const groups = new Map();
  for (const entry of committableEntries) {
    const { group } = classifyFile(entry.file);
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group).push(entry);
  }

  // Separate ungrouped from the rest
  const ungrouped = groups.get('ungrouped') || [];
  const committableGroups = new Map(groups);
  if (autoMode && ungrouped.length > 0) {
    committableGroups.delete('ungrouped');
  }

  // Sort groups for deterministic output: non-client groups first (alphabetical), then client groups
  const sortedKeys = [...committableGroups.keys()].sort((a, b) => {
    const aIsClient = a.startsWith('client:');
    const bIsClient = b.startsWith('client:');
    if (aIsClient !== bIsClient) return aIsClient ? 1 : -1;
    return a.localeCompare(b);
  });

  // Build plan
  const plan = sortedKeys.map(groupKey => {
    const files = committableGroups.get(groupKey);
    const statuses = files.map(f => f.status);
    const verb = verbForStatuses(statuses);
    const description = descriptionForGroup(groupKey);
    const message = `${verb} ${description}`;
    return { groupKey, files, message, verb, description };
  });

  // ── Display plan ──

  const totalFiles = plan.reduce((sum, g) => sum + g.files.length, 0);
  console.log(`[auto-commit] ${plan.length} group${plan.length !== 1 ? 's' : ''}, ${totalFiles} files`);
  console.log();

  for (const g of plan) {
    console.log(`  ${g.groupKey} (${g.files.length} file${g.files.length !== 1 ? 's' : ''}) \u2192 "${g.message}"`);
  }

  if (autoMode && ungrouped.length > 0) {
    console.log();
    console.log(`  ungrouped (${ungrouped.length} file${ungrouped.length !== 1 ? 's' : ''}) \u2192 SKIPPED (requires interactive confirmation)`);
    for (const f of ungrouped) {
      console.log(`    ${f.status} ${f.file}`);
    }
  }

  console.log();

  // ── Dry run stops here ──

  if (dryRun) {
    console.log('[auto-commit] Dry run complete, no changes made');
    process.exit(0);
  }

  // ── Interactive confirmation ──

  if (!autoMode) {
    const answer = await prompt('Proceed with commits? [y/N] ');
    if (answer !== 'y' && answer !== 'yes') {
      console.log('[auto-commit] Aborted');
      process.exit(0);
    }
  }

  // ── Execute commits ──

  let committed = 0;
  let failed = 0;

  for (const g of plan) {
    const filePaths = g.files.map(f => f.file);
    try {
      // Stage files explicitly (use execFileSync to avoid shell escaping issues)
      execFileSync('git', ['add', '--'].concat(filePaths), {
        cwd: repoRoot,
        encoding: 'utf8',
      });

      // CHANGE 1 — pathspec-scoped commit: `--only -- <paths>` creates a temporary index
      // containing ONLY these files, commits it, then restores the real index. This makes
      // it structurally impossible to swallow another actor's staged files regardless of timing.
      const commitMsg = buildCommitMessage(g.verb, g.description, hostName);
      execFileSync('git', ['commit', '--only', '-m', commitMsg, '--'].concat(filePaths), {
        cwd: repoRoot,
        encoding: 'utf8',
      });

      committed++;
    } catch (err) {
      failed++;
      console.error(`[auto-commit] ERROR committing ${g.groupKey}: ${err.message}`);
      // Unstage only this group's files so foreign actors' staged files are not touched
      try {
        execFileSync('git', ['reset', 'HEAD', '--'].concat(filePaths), { cwd: repoRoot, encoding: 'utf8' });
      } catch (_) {
        // reset failure is non-fatal — continue to next group
      }
    }
  }

  // ── Final status ──

  console.log();
  const finalStatus = execSync('git status --short', { cwd: repoRoot, encoding: 'utf8' }).trim();
  const treeState = finalStatus ? 'files remaining' : 'working tree clean';

  if (failed > 0) {
    console.log(`[auto-commit] ${committed}/${plan.length} committed (${failed} failed), ${treeState}`);
  } else {
    console.log(`[auto-commit] \u2713 ${committed}/${plan.length} committed, ${treeState}`);
  }

  // Exit codes
  if (failed > 0) {
    process.exit(1);
  }
  if (autoMode && ungrouped.length > 0) {
    process.exit(2); // partial success — ungrouped files skipped
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[auto-commit] Fatal: ${err.message}`);
    process.exit(1);
  });
}

// Exported for tests/regression guards. Requiring this module must NOT run main()
// (guarded above), so importers can exercise the filters without committing.
module.exports = {
  isSensitive,
  isGovernanceGated,
  isNarrativeIncompleteReview,
  GOVERNANCE_GATED_PATHS
};
