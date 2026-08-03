#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/embodiment-bridge/bridge-client.js -- plan
// ant-hive-world-embodiment-s2-bridge, S1; re-pointed at the contained
// environment by plan ant-hive-world-embodiment-containment, S4.
//
// Trivial round-trip: invokes bridge_step.py on the remote host, now INSIDE the
// S3-adversarially-verified container (image ant-hive-embodiment-bridge:s2,
// digest set by operator via ANT_HIVE_EMBODIMENT_IMAGE_DIGEST),
// using the exact flag set S3 verified against the full M1-M8 threat-model
// matrix (see operator-held containment receipts,
// S3 section, "Exact `docker run` invocation verified"). Previously this ran
// bridge_step.py directly on the remote host via `venv\Scripts\python.exe`;
// S4 replaces that bare-host invocation with the contained one, keeping the
// I/O contract identical: `docker run` is issued over plain SSH (no
// scheduled-task lane needed -- the image is already local, no registry
// credentials required), and the container's stdout (the one-line JSON
// result) is captured through the SSH/docker-CLI pipe exactly as the bare
// host's stdout was -- NOT through any socket inside the container's own
// network namespace, which is intentionally `--network none`. This preserves
// the JSON round-trip contract verify-s1-roundtrip.js and
// verify-s2-perception.js (sibling plan ant-hive-world-embodiment-s2-bridge,
// S1/S2, custody: that plan) already validated against bare-host execution.
//
// bridge_step.py itself performs no file I/O beyond stdout (see its own
// header/body) -- the containment flag set's single /scratch tmpfs mount is
// carried here for consistency with the S3-verified invocation, not because
// this specific script needs writable storage.
//
// Fresh-minds: every invocation is `docker run --rm`, so every call starts a
// brand-new container -- a fresh MjModel/MjData is built from bridge_scene.xml
// on every run (see bridge_step.py), with no state carried across calls, per
// the project's standing fresh-minds-each-run rule.
//
// Usage: node bridge-client.js [--steps N]

const { spawnSync } = require('child_process');

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const STEPS = parseInt(argVal('--steps', '1'), 10);
const HOST_OVERRIDE = argVal('--host', null);

// S3-verified image identity (operator-held containment receipts).
const IMAGE = 'ant-hive-embodiment-bridge:s2';
const IMAGE_DIGEST = process.env.ANT_HIVE_EMBODIMENT_IMAGE_DIGEST || '';

// Repair 2026-07-18 (operator repair 2026-07-18,
// operator decision): the sole writable mount is now a SIZE-CAPPED tmpfs,
// not an unbounded Windows bind mount. bridge_step.py performs no file I/O
// beyond stdout (confirmed by source read) -- it never touches /scratch --
// so there is no cross-invocation persistence requirement here; tmpfs
// ephemerality (wiped on every `docker run --rm` exit, per fresh-minds) is
// exactly the right fit, not a gap.
// Operator directive 2026-07-18 (mid-repair, copy-free-verifier task): bump
// the tmpfs cap from 256m to 4g -- the remote host has ample RAM, so a 4GB
// memory-backed tmpfs is safe headroom, still the single writable mount,
// still fully ephemeral (wiped on every `docker run --rm` exit).
const SCRATCH_TMPFS_ARGS = ['--mount', 'type=tmpfs,destination=/scratch,tmpfs-size=4g'];

// Exact S3-verified containment flag set -- do not add/remove/reorder
// without re-running verify-containment.js against the change.
const CONTAINMENT_ARGS = [
  '--rm',
  '--network', 'none',
  '--read-only',
  '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m',
  ...SCRATCH_TMPFS_ARGS,
  '--pids-limit', '128',
  '--ulimit', 'nofile=1024:1024',
  '--cpus', '2',
  '--memory', '2g',
  '--memory-swap', '2g',
  '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges',
  '--user', '10001:10001',
];

// -----------------------------------------------------------------------
// Copy-free / ssh-only repair (2026-07-18, amendment
// (operator repair 2026-07-18, copy-free/ssh-only):
// this script issues ONLY plain `ssh <host> <command>` calls. It does NOT
// perform nested alias expansion and does NOT reconstruct a connection
// from a partial config subset -- both failed in a sandbox that can run a
// bare remote command directly. The host token
// is used EXACTLY as given (default from ANT_HIVE_EMBODIMENT_HOST); --host is an optional
// verbatim override, never a requirement, never auto-resolved.
// -----------------------------------------------------------------------
const HOST = HOST_OVERRIDE || process.env.ANT_HIVE_EMBODIMENT_HOST || 'ant-hive-embodiment-host';

function sshArgs() {
  return ['-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes', HOST];
}

function assertImageDigestRemote() {
  const result = spawnSync('ssh', [
    ...sshArgs(),
    `docker --context default inspect --format "{{.Id}}" ${IMAGE}`
  ], { encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not verify ${IMAGE} digest on the remote host before use: ${result.error ? result.error.message : result.stderr}`);
  }
  const actual = result.stdout.trim();
  if (actual !== IMAGE_DIGEST) {
    throw new Error(`Refusing to run: ${IMAGE} on the remote host has digest ${actual}, expected the S3-verified ${IMAGE_DIGEST}. This is not the adversarially-evidenced image.`);
  }
}

function stepOnRemote(steps, opts) {
  const skipDigestCheck = opts && opts.skipDigestCheck === true;
  if (!skipDigestCheck) assertImageDigestRemote();
  const dockerCmd = [
    'docker', '--context', 'default', 'run',
    ...CONTAINMENT_ARGS,
    IMAGE,
    '--steps', String(steps)
  ].join(' ');
  const result = spawnSync('ssh', [
    ...sshArgs(),
    dockerCmd
  ], { encoding: 'utf8', timeout: 60000 });

  if (result.error) {
    throw new Error(`SSH invocation failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`bridge_step.py exited ${result.status}: ${result.stderr}`);
  }
  // stdout may carry SSH banner/warning lines before the JSON line -- find
  // the line that actually parses as JSON with an "ok" field.
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && parsed.ok === true) return parsed;
    } catch (_) {
      // not the JSON line, keep scanning
    }
  }
  throw new Error(`No valid JSON result line found in stdout:\n${result.stdout}`);
}

if (require.main === module) {
  try {
    const result = stepOnRemote(STEPS);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(`BRIDGE_ROUND_TRIP_FAILED: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { stepOnRemote };
