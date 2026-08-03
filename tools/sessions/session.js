#!/usr/bin/env node
'use strict';

const {
  registerSession,
  heartbeat,
  closeSession,
  sweepExpired,
  listActive,
  getSession,
  getCurrentSessionId,
  setCurrentSessionId,
  setCurrentTask
} = require('./lib/active-session-registry');

function parseArgs(argv) {
  const out = { _: [], surface: [] };
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }

    const eq = token.indexOf('=');
    const rawKey = eq === -1 ? token.slice(2) : token.slice(2, eq);
    const key = rawKey.replace(/-/g, '_');
    let value;

    if (eq !== -1) {
      value = token.slice(eq + 1) || true;
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        value = next;
        i++;
      } else {
        value = true;
      }
    }

    if (key === 'surface' || key === 'working_surface') {
      out.surface.push(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node tools/sessions/session.js <command> [options]

Track active Mythos agent sessions.

Commands:
  register                         Register or refresh an active session
  heartbeat                        Refresh an active session heartbeat
  close                            Close an active session
  sweep                            Sweep expired active sessions
  list                             List active sessions (JSON)
  monitor                          Pretty table of live sessions + current tasks
  get                              Get one active session
  whoami                           Show this machine's current session
  update                           Set current task on a session

Options:
  --session-id <id>                Session identifier (defaults to _current-id sidecar for update/whoami)
  --actor-id <id>                  Actor identifier, e.g. claude-opus-4-7:kerneling-rupert
  --actor-type <type>              Actor type for TTL policy lookup, e.g. claude-opus-4-7
  --current-branch <branch>        Current git branch
  --expected-interval-ms <ms>      Expected interval for computed TTL actors
  --surface <path>                 Working surface for register; repeatable
  --working-surface <path>         Alias for --surface
  --task <text>                    Current task text (for update)
  --command <slash-cmd>            Current slash command (for update)
  --scope <text>                   Current task scope (for update)
  --append-to-surface              Also append task to working_surface (for update)
  --max-age-ms <ms>                Active-session freshness window for list/sweep
  --archive=false                  Delete expired sessions instead of archiving on sweep
  --sweep-expired                  Sweep expired sessions before list
  --help                           Show this help
`);
}

function requireSessionId(args) {
  if (!args.session_id) {
    throw new Error('--session-id is required');
  }
  return args.session_id;
}

function booleanFlag(value) {
  if (value === undefined) {
    return false;
  }
  if (value === true) {
    return true;
  }
  return !['false', '0', 'no'].includes(String(value).toLowerCase());
}

function archiveFlag(value) {
  if (value === undefined) {
    return true;
  }
  return booleanFlag(value);
}

function main() {
  const args = parseArgs(process.argv);
  const command = args._[0];

  if (args.help || args.h || !command) {
    printHelp();
    process.exit(command ? 0 : 2);
  }

  let result;
  if (command === 'register') {
    result = registerSession({
      sessionId: args.session_id,
      actorId: args.actor_id,
      actorType: args.actor_type,
      currentBranch: args.current_branch,
      expectedIntervalMs: args.expected_interval_ms,
      workingSurface: args.surface
    });
    // Ground the machine-wide current-session sidecar so write-ledger and
    // custody hooks resolve the SAME session id even when the harness sets no
    // CLAUDE_* env (codewhale registers a session but no env reaches Bash).
    if (result && result.session_id) {
      try {
        setCurrentSessionId(result.session_id);
      } catch (error) {
        // best-effort; registration succeeded, sidecar write is advisory
      }
    }
  } else if (command === 'heartbeat') {
    result = heartbeat(requireSessionId(args));
  } else if (command === 'close') {
    result = closeSession(requireSessionId(args));
  } else if (command === 'sweep') {
    result = sweepExpired({
      maxAgeMs: args.max_age_ms,
      archive: archiveFlag(args.archive)
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.errors.length ? 1 : 0);
  } else if (command === 'list') {
    result = listActive({
      maxAgeMs: args.max_age_ms,
      sweepExpired: booleanFlag(args.sweep_expired)
    });
  } else if (command === 'monitor') {
    const sessions = listActive({
      maxAgeMs: args.max_age_ms,
      sweepExpired: booleanFlag(args.sweep_expired)
    });
    printMonitorTable(sessions);
    process.exit(0);
  } else if (command === 'whoami') {
    const id = args.session_id || getCurrentSessionId();
    if (!id) {
      throw new Error('no _current-id sidecar; pass --session-id explicitly');
    }
    result = getSession(id);
    if (!result) {
      throw new Error(`active session not found: ${id}`);
    }
  } else if (command === 'update') {
    const id = args.session_id || getCurrentSessionId();
    if (!id) {
      throw new Error('no _current-id sidecar; pass --session-id explicitly');
    }
    if (args.task === undefined) {
      throw new Error('--task is required for update');
    }
    result = setCurrentTask(id, args.task === true ? '' : args.task, {
      command: args.command,
      scope: args.scope,
      appendToSurface: booleanFlag(args.append_to_surface)
    });
  } else if (command === 'get') {
    result = getSession(requireSessionId(args));
    if (!result) {
      throw new Error(`active session not found: ${args.session_id}`);
    }
  } else {
    throw new Error(`unknown command: ${command}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

function ageString(iso, nowMs) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '?';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function truncate(text, max) {
  const s = text == null ? '' : String(text);
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

function printMonitorTable(sessions) {
  const nowMs = Date.now();
  const headers = ['SESSION', 'ACTOR', 'BRANCH', 'PID', 'AGE', 'TASK'];
  const rows = sessions.map((s) => [
    truncate(s.session_id || '?', 8),
    truncate(s.actor_id || s.actor_type || '-', 24),
    truncate(s.current_branch || '-', 32),
    String(s.pid || '-'),
    ageString(s.last_heartbeat, nowMs),
    truncate(s.current_task || (Array.isArray(s.working_surface) && s.working_surface[0]) || '-', 60)
  ]);

  if (rows.length === 0) {
    console.log('(no active sessions)');
    return;
  }

  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(fmt(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(fmt(r));
  console.log('');
  console.log(`${rows.length} active session(s).`);
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    status: 'error',
    message: error.message
  }, null, 2));
  process.exit(2);
}
