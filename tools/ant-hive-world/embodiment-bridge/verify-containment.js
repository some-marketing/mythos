#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/embodiment-bridge/verify-containment.js -- plan
// ant-hive-world-orwell-sim-containment, S3.
//
// Adversarially evidences the S0 design memo's 8-row threat-model /
// acceptance matrix (M1-M8) against the S2-built image
// (ant-hive-embodiment-bridge:s2) actually running on Orwell, per each
// row's DECLARED evidence type:
//
//   RUNTIME control  -> configuration-inspection assertion (docker inspect
//                        / in-container config reads) PLUS a bounded
//                        positive-and-negative-controlled adversarial probe.
//   BUILD-TIME control (M8) -> digest/lock verification + image-layer
//                        inspection + secret/cache scan + a negative build
//                        fixture. NOT runtime-probed (a runtime probe
//                        cannot exercise build-time behavior).
//
// This script runs from the Mac and drives Orwell entirely over plain SSH
// (`docker --context default ...`) -- no scheduled-task lane is needed:
// every command here operates on the already-built local image
// (ant-hive-embodiment-bridge:s2) or issues local `docker build`/`docker
// create`/`docker run` calls that never touch a registry, so Docker
// Desktop's Windows credential-helper flakiness (see the S2 section of the
// host-change receipt) does not apply.
//
// SCOPE DISCLAIMER (mirrors S0 design memo item 9 and the plan's S3 step,
// verbatim in spirit): this script asserts ONLY the 8 declared matrix rows
// below. A clean PASS on every row is evidence that the declared, approved
// controls are configured and enforced as designed -- it is NOT a claim
// that every possible container-escape or side-channel vector has been
// tested or eliminated. Three residual risks the S0 memo names explicitly
// (shared WSL2 kernel, the NT AUTHORITY\SYSTEM Docker Desktop host
// service, and microarchitectural/timing side-channels) are NOT directly
// probed by any test below and remain operator-accepted-pending-S0
// residuals regardless of this script's result. A fourth (the WSL2 VM
// hypervisor boundary itself) is likewise carried forward as a
// lower-probability documented residual, not eliminated by these probes.
//
// Usage: node verify-containment.js [--keep-staging] [--host <addr>]
//        node verify-containment.js --selftest

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SSH_ALIAS = 'orwell';
const HOST_OVERRIDE_ARG = (() => {
  const i = process.argv.indexOf('--host');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();

// -----------------------------------------------------------------------
// Copy-free / ssh-only repair (2026-07-18, amendment
// ant-hive-world-orwell-sim-containment__amendment__20260718T223834Z,
// supersedes the prior alias-expansion/copy-utility portability approach):
// this script issues ONLY plain remote-shell calls with the host token and
// command. It does no nested alias resolution and does not reconstruct a
// connection from a partial config subset (that approach discarded the
// working SSH config and still failed in the distinct auditor's sandbox,
// which can run a bare remote command directly). The host token
// is used EXACTLY as given (default "orwell"); --host is an optional
// verbatim override, never required, never auto-resolved. File transfer
// (probe scripts, Dockerfile fixtures, requirements-lock variants) uses
// ssh + stdin (PowerShell reads base64 off stdin and writes the decoded
// bytes to the target path) -- see sshPutFile() below.
// -----------------------------------------------------------------------
const HOST = HOST_OVERRIDE_ARG || SSH_ALIAS;

function targetSshArgs(extra) {
  return [...(extra || []), HOST];
}

const SSH_OPTS = ['-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes'];

const IMAGE = 'ant-hive-embodiment-bridge:s2';
const EXPECTED_IMAGE_ID =
  'sha256:59ea5d22103b0906c1d8233f481b338a039b8c8f7dbdd7ef50e6b05d412d9802';
const BASE_IMAGE_DIGEST =
  'python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93';

const REMOTE_STAGE_DIR =
  'C:\\Users\\taylo\\smos_ant_embodiment\\verify-containment-s3';
// No REMOTE_SCRATCH_DIR anymore: /scratch is a size-capped in-container
// tmpfs (repair 2026-07-18), not a Windows host directory.
const REMOTE_NEGTEST_DIR =
  'C:\\Users\\taylo\\smos_ant_embodiment\\verify-containment-s3-negtest';
const REPO_DOCKERFILE = path.join(__dirname, 'Dockerfile');
const REPO_REQ_LOCK = path.join(__dirname, 'requirements-lock.txt');
const REPO_BRIDGE_STEP = path.join(__dirname, 'bridge_step.py');
const REPO_BRIDGE_SCENE = path.join(__dirname, 'bridge_scene.xml');

// -----------------------------------------------------------------------
// The exact production `docker run` invocation this script verifies.
// This is the intended runtime flag set per S0 design memo items 3-6.
// (The verification harness ADDS one extra read-only bind mount, of the
// probe scripts themselves, only for adversarial-probe rows below -- that
// mount is verification tooling, not part of the design, carries no
// write access, and is called out explicitly wherever used.)
// -----------------------------------------------------------------------
// Repair 2026-07-18 (amendment ant-hive-world-orwell-sim-containment__amendment__20260718T212942Z,
// operator decision): the sole writable mount is now a SIZE-CAPPED tmpfs,
// not an unbounded Windows bind mount. bridge_step.py performs no file I/O
// beyond stdout -- confirmed by source read, it never opens/writes any
// path under /scratch -- so there is no cross-invocation persistence
// requirement; tmpfs ephemerality (wiped on every `docker run --rm` exit)
// fits the fresh-minds-each-run rule exactly.
// Operator directive 2026-07-18 (mid-repair, copy-free-verifier task): bump
// the tmpfs cap from 256m to 4g -- Orwell has ~32GB RAM so a 4GB
// memory-backed tmpfs is safe headroom, still the single writable mount,
// still fully ephemeral (wiped on every `docker run --rm` exit).
const SCRATCH_TMPFS_ARGS = ['--mount', 'type=tmpfs,destination=/scratch,tmpfs-size=4g'];
const SCRATCH_TMPFS_SIZE_BYTES = 4 * 1024 * 1024 * 1024;

const PROD_RUN_FLAGS = [
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
  '--user', '10001:10001'
];

const PROD_RUN_INVOCATION_STRING =
  `docker run --rm ${PROD_RUN_FLAGS.join(' ')} ${IMAGE}`;

// -----------------------------------------------------------------------
// SSH helpers (remote-shell-only and copy-free)
// -----------------------------------------------------------------------

function sshExec(cmd, { timeoutMs = 60000, label = '' } = {}) {
  const result = spawnSync(
    'ssh',
    [...targetSshArgs(SSH_OPTS), cmd],
    { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.error) {
    throw new Error(`SSH invocation failed${label ? ` (${label})` : ''}: ${result.error.message}`);
  }
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function dockerCmd(argsStr, opts) {
  return sshExec(`cmd /c docker --context default ${argsStr}`, opts);
}

// Copy-free file transfer: pipe the local file's base64 content over the
// ssh connection's stdin to a remote PowerShell one-liner that decodes it
// and writes the bytes to the target Windows path. This is a single
// `ssh <host> <command>` invocation with data on stdin -- functionally the
// `ssh host 'cat > path' < local` pattern, adapted for a Windows/PowerShell
// remote instead of POSIX `cat`. No separate copy process is spawned.
function sshPutFile(localPath, remoteWindowsPath) {
  const b64 = fs.readFileSync(localPath).toString('base64');
  const escapedPath = remoteWindowsPath.replace(/'/g, "''");
  const psInner = `$b64 = [Console]::In.ReadToEnd(); ` +
    `[IO.File]::WriteAllBytes('${escapedPath}', [Convert]::FromBase64String($b64))`;
  const remoteCmd = `powershell -NoProfile -NonInteractive -Command "${psInner.replace(/"/g, '\\"')}"`;
  const result = spawnSync(
    'ssh',
    [...targetSshArgs(SSH_OPTS), remoteCmd],
    { input: b64, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.error) {
    throw new Error(`ssh file-put failed (${remoteWindowsPath}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`ssh file-put exited ${result.status} (${remoteWindowsPath}): ${stripSshBanner(result.stderr)}`);
  }
}

function stripSshBanner(stdout) {
  return stdout
    .split(/\r?\n/)
    .filter((l) => !/post-quantum|store now, decrypt later|openssh\.com\/pq/i.test(l))
    .join('\n');
}

// wsl.exe writes UTF-16LE to a non-console (piped) stdout when invoked
// non-interactively over SSH -- over this transport that arrives as
// null-byte-interleaved text (see the S1 host-change receipt's "Method /
// transport notes"). Strip the null bytes so the resulting text is plain
// ASCII/UTF-8-shaped and regex-matchable.
function stripUtf16Nulls(str) {
  return str.replace(/ /g, '');
}

function parseLastJsonLine(stdout) {
  const lines = stripSshBanner(stdout).split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch (_) {
      // keep scanning backwards
    }
  }
  throw new Error(`No JSON line found in:\n${stdout}`);
}

// -----------------------------------------------------------------------
// Probe script payloads (staged to Orwell, bind-mounted read-only into
// throwaway containers for the adversarial probes -- never baked into the
// verified image itself).
// -----------------------------------------------------------------------

const CONTAINMENT_PROBE_PY = `
import json, os, re, socket, sys, stat, subprocess

def discover_dns_forwarder():
    try:
        with open("/etc/resolv.conf") as f:
            for line in f:
                m = re.match(r"\\s*nameserver\\s+(\\S+)", line)
                if m:
                    return m.group(1)
    except Exception:
        pass
    return "192.168.65.1"

def tcp_probe(host, port, timeout=3):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        s.connect((host, port))
        s.close()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}

def dns_tunnel_probe(host, port=53, timeout=3):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        s.connect((host, port))
        qname = b"\\x0aexfiltest\\x07example\\x03com\\x00"
        query = bytes([0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]) + qname + bytes([0x00, 0x01, 0x00, 0x01])
        payload = len(query).to_bytes(2, "big") + query
        s.sendall(payload)
        resp = s.recv(512)
        s.close()
        return {"ok": True, "resp_len": len(resp)}
    except Exception as e:
        return {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}

def net_check():
    out = {}
    out["tcp_out_1.1.1.1:443"] = tcp_probe("1.1.1.1", 443)
    fwd = discover_dns_forwarder()
    out["dns_forwarder_ip"] = fwd
    out["dns_tunnel_%s:53" % fwd] = dns_tunnel_probe(fwd, 53)
    try:
        ifaces = os.listdir("/sys/class/net")
    except Exception as e:
        ifaces = ["ERROR:%s" % e]
    out["interfaces"] = ifaces
    return out

def try_write(path, content=b"x"):
    try:
        with open(path, "wb") as f:
            f.write(content)
        return "WROTE"
    except Exception as e:
        return type(e).__name__ + ": " + str(e)

def fs_check():
    out = {}
    out["write_scratch"] = try_write("/scratch/containment_probe_test.txt")
    out["write_root"] = try_write("/containment_probe_test.txt")
    out["write_etc"] = try_write("/etc/containment_probe_test.txt")
    out["write_usr"] = try_write("/usr/containment_probe_test.txt")
    try:
        os.symlink("../sibling_escape_target", "/scratch/relative_escape_link")
        with open("/scratch/relative_escape_link") as f:
            data = f.read(64)
        out["relative_symlink_escape"] = "SUCCEEDED: " + repr(data)
    except Exception as e:
        out["relative_symlink_escape"] = "BLOCKED: " + type(e).__name__ + ": " + str(e)
    finally:
        try:
            os.unlink("/scratch/relative_escape_link")
        except Exception:
            pass
    return out

def host_symlink_read():
    # Reads a symlink placed INSIDE /scratch from the HOST side, before the
    # container starts, pointing at a sibling host file outside the scratch
    # tree. Setup/teardown of that host-side symlink happens outside this
    # script (PowerShell, run by the caller); this mode only performs the
    # in-container read attempt.
    out = {}
    p = "/scratch/host_escape_link"
    out["is_symlink"] = os.path.islink(p)
    try:
        with open(p) as f:
            out["read"] = "SUCCEEDED: " + repr(f.read(64))
    except Exception as e:
        out["read"] = "BLOCKED: " + type(e).__name__ + ": " + str(e)
    return out

def identity_check():
    out = {}
    out["uid"] = os.getuid()
    out["gid"] = os.getgid()
    try:
        with open("/proc/self/status") as f:
            status = f.read()
    except Exception as e:
        status = "ERROR:%s" % e
    caps = {}
    for line in status.splitlines():
        if line.startswith("Cap"):
            k, v = line.split(":", 1)
            caps[k.strip()] = v.strip()
    out["capabilities"] = caps
    for line in status.splitlines():
        if line.startswith("NoNewPrivs"):
            out["no_new_privs"] = line.strip()
    out["write_root_only_path"] = try_write("/root/containment_probe_test.txt")
    # Repair 2026-07-18: /scratch is now a size-capped tmpfs mounted with
    # Docker's default noexec,nosuid,nodev options (confirmed via
    # /proc/mounts), so a setuid binary written there can no longer be
    # executed at all -- there is no writable+executable path anywhere in
    # the container (rootfs is read-only; /tmp and /scratch are both
    # noexec). That is a STRONGER identity/privilege invariant than the
    # prior test (which executed the setuid binary and merely confirmed
    # the setuid bit did not escalate euid); record which case occurred.
    p = "/scratch/suid_test_bin"
    try:
        with open(p, "wb") as f:
            f.write(b"#!/bin/sh\\nid -u\\n")
        os.chmod(p, 0o4755)
        st = os.stat(p)
        out["setuid_bit_set_after_chmod"] = bool(st.st_mode & stat.S_ISUID)
        try:
            result = subprocess.run([p], capture_output=True, text=True, timeout=5)
            out["setuid_exec_reported_uid"] = result.stdout.strip()
            out["python_euid_after_exec"] = os.geteuid()
            out["setuid_exec_blocked_by_noexec"] = False
        except PermissionError as e:
            out["setuid_exec_blocked_by_noexec"] = True
            out["setuid_exec_block_error"] = type(e).__name__ + ": " + str(e)
    except Exception as e:
        out["setuid_probe_error"] = type(e).__name__ + ": " + str(e)
    finally:
        try:
            os.unlink(p)
        except Exception:
            pass
    return out

def device_check():
    out = {}
    try:
        out["dev_listing"] = sorted(os.listdir("/dev"))
    except Exception as e:
        out["dev_listing"] = "ERROR:%s" % e
    for dev in ("/dev/sda", "/dev/mem", "/dev/kmsg"):
        try:
            with open(dev, "rb") as f:
                f.read(1)
            out["access_%s" % dev] = "SUCCEEDED"
        except Exception as e:
            out["access_%s" % dev] = "BLOCKED: " + type(e).__name__ + ": " + str(e)
    try:
        pids = [p for p in os.listdir("/proc") if p.isdigit()]
        out["proc_pid_count"] = len(pids)
        out["proc_pids"] = sorted(int(p) for p in pids)
    except Exception as e:
        out["proc_pid_count"] = "ERROR:%s" % e
    return out

def docker_socket_check():
    out = {}
    candidates = ["/var/run/docker.sock", "/run/docker.sock", "\\\\\\\\.\\\\pipe\\\\docker_engine"]
    for c in candidates:
        exists = os.path.exists(c)
        out[c] = {"exists": exists}
        if exists:
            try:
                s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                s.settimeout(2)
                s.connect(c)
                s.close()
                out[c]["connect"] = "SUCCEEDED"
            except Exception as e:
                out[c]["connect"] = "BLOCKED: " + type(e).__name__ + ": " + str(e)
    try:
        with open("/proc/mounts") as f:
            mounts = f.read()
    except Exception as e:
        mounts = "ERROR:%s" % e
    out["docker_sock_in_mounts"] = ("docker.sock" in mounts) or ("docker_engine" in mounts)
    return out

def pid_exhaustion_probe(target_extra=250):
    children = []
    denied_at = None
    spawned = 0
    try:
        for i in range(target_extra):
            try:
                p = subprocess.Popen(["/bin/sleep", "0.5"])
                children.append(p)
                spawned += 1
            except OSError:
                denied_at = spawned
                break
    finally:
        for p in children:
            try:
                p.wait(timeout=2)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass
    return {"spawned_before_denied": spawned, "denied": denied_at is not None, "denied_at": denied_at}

def fd_exhaustion_probe(target_extra=1400):
    fds = []
    denied_at = None
    try:
        for i in range(target_extra):
            try:
                f = open("/proc/self/status", "rb")
                fds.append(f)
            except OSError:
                denied_at = len(fds)
                break
    finally:
        opened = len(fds)
        for f in fds:
            try:
                f.close()
            except Exception:
                pass
    return {"opened_before_denied": opened, "denied": denied_at is not None, "denied_at": denied_at}

def scratch_exhaustion_probe(cap_mb=4352):
    # Repair 2026-07-18: /scratch is a 4 GiB-capped tmpfs.
    # Write past that cap and confirm the kernel denies further writes with
    # ENOSPC -- proving scratch-disk usage is bounded by the sized tmpfs
    # itself (an in-RAM cap), not silently spilling onto host disk the way
    # an unbounded bind mount could.
    import errno as errno_mod
    chunk = b"\\0" * (1024 * 1024)  # 1 MiB
    written_mb = 0
    error = None
    error_errno = None
    path_ = "/scratch/exhaustion_probe.bin"
    try:
        with open(path_, "wb") as f:
            for _ in range(cap_mb):
                f.write(chunk)
                f.flush()
                written_mb += 1
    except OSError as e:
        error = "%s: %s" % (type(e).__name__, e)
        error_errno = e.errno
    finally:
        try:
            os.unlink(path_)
        except Exception:
            pass
    return {
        "written_mb_before_stop": written_mb,
        "error": error,
        "errno": error_errno,
        "is_enospc": error_errno == errno_mod.ENOSPC,
    }

def resource_limits_report():
    import resource
    out = {}
    out["RLIMIT_NOFILE"] = list(resource.getrlimit(resource.RLIMIT_NOFILE))
    try:
        with open("/sys/fs/cgroup/pids.max") as f:
            out["cgroup_pids_max"] = f.read().strip()
    except Exception as e:
        out["cgroup_pids_max"] = "ERROR:%s" % e
    try:
        with open("/sys/fs/cgroup/memory.max") as f:
            out["cgroup_memory_max"] = f.read().strip()
    except Exception as e:
        out["cgroup_memory_max"] = "ERROR:%s" % e
    try:
        with open("/sys/fs/cgroup/cpu.max") as f:
            out["cgroup_cpu_max"] = f.read().strip()
    except Exception as e:
        out["cgroup_cpu_max"] = "ERROR:%s" % e
    return out

def kernel_check():
    out = {}
    try:
        out["uname"] = list(os.uname())
    except Exception as e:
        out["uname"] = "ERROR:%s" % e
    try:
        with open("/proc/1/comm") as f:
            out["proc1_comm"] = f.read().strip()
    except Exception as e:
        out["proc1_comm"] = "ERROR:%s" % e
    return out

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    fns = {
        "net": net_check, "fs": fs_check, "identity": identity_check, "host_symlink_read": host_symlink_read,
        "device": device_check, "docker_socket": docker_socket_check,
        "pid_exhaustion": pid_exhaustion_probe, "fd_exhaustion": fd_exhaustion_probe,
        "scratch_exhaustion": scratch_exhaustion_probe,
        "resource_limits": resource_limits_report, "kernel": kernel_check,
    }
    if mode == "all":
        out = {k: fn() for k, fn in fns.items() if k not in ("pid_exhaustion", "fd_exhaustion", "scratch_exhaustion")}
    elif mode in fns:
        out = {mode: fns[mode]()}
    else:
        out = {"error": "unknown mode %s" % mode}
    print(json.dumps(out, default=str))

if __name__ == "__main__":
    main()
`;

// -----------------------------------------------------------------------
// Result accumulator
// -----------------------------------------------------------------------

const rows = [];
function record(id, control, type, pass, evidence, extra) {
  rows.push({ id, control, type, pass, evidence, extra: extra || null });
}

function step(label, fn) {
  process.stdout.write(`[running] ${label}...\n`);
  try {
    return fn();
  } catch (err) {
    process.stdout.write(`[error] ${label}: ${err.message}\n`);
    throw err;
  }
}

// -----------------------------------------------------------------------
// Setup: stage probe scripts on Orwell
// -----------------------------------------------------------------------

function setupStaging() {
  sshExec(`cmd /c if not exist "${REMOTE_STAGE_DIR}" mkdir "${REMOTE_STAGE_DIR}"`, { label: 'mkdir stage dir' });
  // No host scratch directory is created/needed anymore: /scratch is a
  // size-capped tmpfs (repair 2026-07-18), fully in-container, with no
  // host-filesystem backing to stage or clean up.

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-containment-'));
  const localProbePath = path.join(tmpDir, 'containment_probe.py');
  fs.writeFileSync(localProbePath, CONTAINMENT_PROBE_PY, 'utf8');
  sshPutFile(localProbePath, `${REMOTE_STAGE_DIR}\\containment_probe.py`);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return `${REMOTE_STAGE_DIR}\\containment_probe.py`;
}

function cleanupStaging(keepStaging) {
  if (keepStaging) return;
  sshExec(`cmd /c rmdir /s /q "${REMOTE_STAGE_DIR}"`, { label: 'cleanup stage dir' });
}

function runProbe(probeRemotePath, mode, extraRunFlags, timeoutMs) {
  const flags = [
    ...PROD_RUN_FLAGS,
    '-v', `${probeRemotePath}:/tmp/containment_probe.py:ro`,
    ...(extraRunFlags || [])
  ];
  const cmd = `run --rm ${flags.join(' ')} --entrypoint python ${IMAGE} /tmp/containment_probe.py ${mode}`;
  const result = dockerCmd(cmd, { label: `probe:${mode}`, timeoutMs: timeoutMs || 45000 });
  if (result.status !== 0) {
    throw new Error(`probe ${mode} exited ${result.status}: ${stripSshBanner(result.stderr)}`);
  }
  return parseLastJsonLine(result.stdout);
}

// -----------------------------------------------------------------------
// Config-inspection assertion: docker create with PROD_RUN_FLAGS, inspect
// HostConfig + Config, then remove. This is the single source of truth
// for "is the control actually configured" across M1-M6.
// -----------------------------------------------------------------------

function inspectProdConfig() {
  const createResult = dockerCmd(
    `create ${PROD_RUN_FLAGS.join(' ')} --entrypoint sleep ${IMAGE} 3600`,
    { label: 'create for inspect' }
  );
  if (createResult.status !== 0) {
    throw new Error(`docker create failed: ${stripSshBanner(createResult.stderr)}`);
  }
  const cid = stripSshBanner(createResult.stdout).trim().split(/\r?\n/).pop().trim();

  try {
    const hostConfigResult = dockerCmd(`inspect --format "{{json .HostConfig}}" ${cid}`, { label: 'inspect HostConfig' });
    const hostConfig = parseLastJsonLine(hostConfigResult.stdout);

    const userResult = dockerCmd(`inspect --format "{{.Config.User}}" ${cid}`, { label: 'inspect User' });
    const user = stripSshBanner(userResult.stdout).trim();

    return { cid, hostConfig, user };
  } finally {
    dockerCmd(`rm -f ${cid}`, { label: 'remove inspect container' });
  }
}

// -----------------------------------------------------------------------
// M1: Network isolation via interface removal
// -----------------------------------------------------------------------

function checkM1(probePath, cfg) {
  const configOk = cfg.hostConfig.NetworkMode === 'none';

  // Negative test: the actual declared runtime config (--network none).
  const negParsed = runProbe(probePath, 'net').net;

  // Positive control: identical probe from a NORMAL-network container,
  // proving the probe methodology itself detects success (not just
  // measuring a broken target/DNS failure unrelated to isolation).
  const posFlags = [
    '--network', 'bridge',
    '-v', `${probePath}:/tmp/containment_probe.py:ro`
  ];
  const posResult = dockerCmd(
    `run --rm ${posFlags.join(' ')} --entrypoint python ${IMAGE} /tmp/containment_probe.py net`,
    { label: 'M1 positive control', timeoutMs: 30000 }
  );
  const posParsed = parseLastJsonLine(posResult.stdout).net;

  const positiveDetects =
    posParsed['tcp_out_1.1.1.1:443'].ok === true &&
    posParsed[`dns_tunnel_${posParsed.dns_forwarder_ip}:53`].ok === true;
  const negativeBlocked =
    negParsed['tcp_out_1.1.1.1:443'].ok === false &&
    negParsed[`dns_tunnel_${negParsed.dns_forwarder_ip}:53`].ok === false &&
    JSON.stringify(negParsed.interfaces) === JSON.stringify(['lo']);

  const pass = configOk && positiveDetects && negativeBlocked;
  record(
    'M1',
    'Network isolation via interface removal',
    'RUNTIME',
    pass,
    `config: NetworkMode=${cfg.hostConfig.NetworkMode} (want "none"); ` +
    `positive-control (bridge net) tcp_out=${posParsed['tcp_out_1.1.1.1:443'].ok} dns_tunnel=${posParsed[`dns_tunnel_${posParsed.dns_forwarder_ip}:53`].ok} (both should be true, proving methodology); ` +
    `negative (network none) interfaces=${JSON.stringify(negParsed.interfaces)} tcp_out=${negParsed['tcp_out_1.1.1.1:443'].ok} dns_tunnel=${negParsed[`dns_tunnel_${negParsed.dns_forwarder_ip}:53`].ok} (all should show failure/lo-only)`,
    { positive: posParsed, negative: negParsed }
  );
}

// -----------------------------------------------------------------------
// M2: Filesystem read-only + single scratch, no symlink escape
// -----------------------------------------------------------------------

function checkM2(probePath, cfg) {
  // Repair 2026-07-18: /scratch is now a size-capped tmpfs (--mount
  // type=tmpfs,destination=/scratch,tmpfs-size=4g), not a Windows host
  // bind mount -- so there are no Binds at all in the production
  // invocation, and the tmpfs mount must show up in HostConfig.Mounts with
  // the expected target and size.
  const scratchMount =
    Array.isArray(cfg.hostConfig.Mounts) &&
    cfg.hostConfig.Mounts.find((m) => m.Type === 'tmpfs' && m.Target === '/scratch');
  const scratchMountOk =
    !!scratchMount &&
    scratchMount.TmpfsOptions &&
    scratchMount.TmpfsOptions.SizeBytes === SCRATCH_TMPFS_SIZE_BYTES;
  const noBinds = cfg.hostConfig.Binds === null || (Array.isArray(cfg.hostConfig.Binds) && cfg.hostConfig.Binds.length === 0);
  const configOk = cfg.hostConfig.ReadonlyRootfs === true && noBinds && scratchMountOk;

  const fsResult = runProbe(probePath, 'fs');
  const fs_ = fsResult.fs;

  // NOTE on the prior host-side symlink-escape sub-test: that test placed a
  // symlink on the Windows HOST filesystem inside the (formerly bind-
  // mounted) scratch directory, then confirmed the container could not
  // read through it into a sibling host file. Since /scratch is now an
  // in-container tmpfs with no host-filesystem backing at all, that entire
  // attack surface is structurally eliminated (there is no host path
  // mapped into the container to seed a symlink into) rather than merely
  // blocked by policy -- so the sub-test is removed as inapplicable, not
  // silently dropped. This is a strict containment improvement over the
  // bind-mount design, not a coverage gap.
  const writesBlocked =
    fs_.write_scratch === 'WROTE' &&
    fs_.write_root.startsWith('OSError') &&
    fs_.write_etc.startsWith('OSError') &&
    fs_.write_usr.startsWith('OSError');

  const relSymlinkBlocked = fs_.relative_symlink_escape.startsWith('BLOCKED');

  const pass = configOk && writesBlocked && relSymlinkBlocked;
  record(
    'M2',
    'Filesystem read-only + single scratch (tmpfs), no symlink escape',
    'RUNTIME',
    pass,
    `config: ReadonlyRootfs=${cfg.hostConfig.ReadonlyRootfs}, Binds=${JSON.stringify(cfg.hostConfig.Binds)} (want none -- scratch is tmpfs, not a bind), ` +
    `scratch tmpfs mount=${JSON.stringify(scratchMount)} (want Target=/scratch, SizeBytes=${SCRATCH_TMPFS_SIZE_BYTES}); ` +
    `positive: scratch write=${fs_.write_scratch}; ` +
    `negative: root write=${fs_.write_root}, etc write=${fs_.write_etc}, usr write=${fs_.write_usr}; ` +
    `relative symlink escape (outside mounted subtree)=${fs_.relative_symlink_escape}; ` +
    `host-side bind-mount symlink-escape sub-test removed: /scratch has no host-filesystem backing under the tmpfs design, so that attack surface no longer exists (structural elimination, not a policy block)`,
    { fs: fs_ }
  );
}

// -----------------------------------------------------------------------
// M3: Resource limits incl. pids + fd
// -----------------------------------------------------------------------

function checkM3(probePath, cfg) {
  const configOk =
    cfg.hostConfig.PidsLimit === 128 &&
    Array.isArray(cfg.hostConfig.Ulimits) &&
    cfg.hostConfig.Ulimits.some((u) => u.Name === 'nofile' && u.Hard === 1024) &&
    cfg.hostConfig.NanoCpus === 2000000000 &&
    cfg.hostConfig.Memory === 2147483648;

  const limitsResult = runProbe(probePath, 'resource_limits');
  const limits = limitsResult.resource_limits;
  const cgroupOk =
    limits.cgroup_pids_max === '128' &&
    limits.cgroup_memory_max === '2147483648';

  const pidResult = runProbe(probePath, 'pid_exhaustion');
  const pidEx = pidResult.pid_exhaustion;
  const pidBounded = pidEx.spawned_before_denied <= 250 && pidEx.denied === true;

  const fdResult = runProbe(probePath, 'fd_exhaustion');
  const fdEx = fdResult.fd_exhaustion;
  const fdBounded = fdEx.opened_before_denied <= 1400 && fdEx.denied === true;

  // Repair 2026-07-18 (blocker #2, new active probe): confirm scratch-disk
  // usage is bounded by the sized tmpfs (4 GiB) -- writing past the cap
  // must fail with ENOSPC inside the container's own tmpfs, not silently
  // spill onto host disk. This probe raises only its memory cgroup to 5 GiB
  // so the 4 GiB tmpfs ceiling, rather than the production 2 GiB memory
  // ceiling, is the first limit reached. The production configuration is
  // independently asserted above and remains --memory 2g.
  const scratchResult = runProbe(
    probePath,
    'scratch_exhaustion',
    ['--memory', '5g', '--memory-swap', '5g'],
    180000
  );
  const scratchEx = scratchResult.scratch_exhaustion;
  const scratchExhaustionBounded =
    scratchEx.is_enospc === true &&
    scratchEx.written_mb_before_stop >= 4095 &&
    scratchEx.written_mb_before_stop <= 4096;

  const pass = configOk && cgroupOk && pidBounded && fdBounded && scratchExhaustionBounded;
  record(
    'M3',
    'Resource limits incl. pids + fd + scratch (tmpfs) disk exhaustion',
    'RUNTIME',
    pass,
    `config: PidsLimit=${cfg.hostConfig.PidsLimit}, Ulimits=${JSON.stringify(cfg.hostConfig.Ulimits)}, NanoCpus=${cfg.hostConfig.NanoCpus}, Memory=${cfg.hostConfig.Memory}; ` +
    `cgroup pids.max=${limits.cgroup_pids_max}, memory.max=${limits.cgroup_memory_max}, cpu.max=${limits.cgroup_cpu_max}; ` +
    `bounded pid-exhaustion probe: spawned ${pidEx.spawned_before_denied} before denial at pids-limit 128 (target cap 250, denied=${pidEx.denied}); ` +
    `bounded fd-exhaustion probe: opened ${fdEx.opened_before_denied} before denial at ulimit nofile=1024 (target cap 1400, denied=${fdEx.denied}); ` +
    `bounded scratch(tmpfs)-exhaustion probe: wrote ${scratchEx.written_mb_before_stop}MiB before denial (attempted 4352MiB against 4g tmpfs-size cap, with a probe-only 5g memory allowance), errno=${scratchEx.errno} (ENOSPC=${scratchEx.is_enospc}), error="${scratchEx.error}" -- denial occurs at the 4 GiB ceiling in-container and does not spill to host disk`,
    { limits, pidEx, fdEx, scratchEx }
  );
}

// -----------------------------------------------------------------------
// M4: Identity / privilege
// -----------------------------------------------------------------------

function checkM4(probePath, cfg) {
  const configOk =
    cfg.user === '10001:10001' &&
    JSON.stringify(cfg.hostConfig.CapDrop) === JSON.stringify(['ALL']) &&
    JSON.stringify(cfg.hostConfig.SecurityOpt) === JSON.stringify(['no-new-privileges']);

  const idResult = runProbe(probePath, 'identity');
  const id_ = idResult.identity;

  const capsAllZero = Object.values(id_.capabilities).every((v) => /^0+$/.test(v));
  const noNewPrivsSet = /NoNewPrivs:\s*1/.test(id_.no_new_privs || '');
  const uidOk = id_.uid === 10001 && id_.gid === 10001;
  const rootWriteBlocked = String(id_.write_root_only_path).includes('Permission');
  // Repair 2026-07-18: /scratch is now a noexec tmpfs (Docker's default
  // tmpfs mount options), so a setuid binary written there can no longer
  // be executed at all -- accept EITHER of two valid outcomes: (a) the
  // legacy case, exec succeeded but euid did not escalate past 10001, or
  // (b) the new, strictly stronger case, exec was denied outright by
  // noexec before setuid semantics could even apply (there is no
  // writable+executable path anywhere in the container).
  const setuidBitWasSet = id_.setuid_bit_set_after_chmod === true;
  const suidProbeOk =
    setuidBitWasSet &&
    (id_.setuid_exec_blocked_by_noexec === true ||
      (id_.setuid_exec_blocked_by_noexec === false && id_.python_euid_after_exec === 10001));

  const pass = configOk && capsAllZero && noNewPrivsSet && uidOk && rootWriteBlocked && suidProbeOk;
  record(
    'M4',
    'Identity / privilege (non-root, caps dropped, no-new-privileges)',
    'RUNTIME',
    pass,
    `config: User=${cfg.user}, CapDrop=${JSON.stringify(cfg.hostConfig.CapDrop)}, SecurityOpt=${JSON.stringify(cfg.hostConfig.SecurityOpt)}; ` +
    `positive: uid/gid=${id_.uid}/${id_.gid} (running as configured non-root allowed op); ` +
    `negative: capabilities all-zero=${capsAllZero} (${JSON.stringify(id_.capabilities)}), ${id_.no_new_privs}, root-only-path write=${id_.write_root_only_path}, ` +
    `setuid probe: bit set on file=${id_.setuid_bit_set_after_chmod}, exec blocked outright by noexec tmpfs=${id_.setuid_exec_blocked_by_noexec} ` +
    (id_.setuid_exec_blocked_by_noexec
      ? `(${id_.setuid_exec_block_error} -- no writable+executable path exists in the container at all, strictly stronger than euid-stayed-stable)`
      : `(exec succeeded, euid stayed ${id_.python_euid_after_exec}, reported uid=${id_.setuid_exec_reported_uid})`),
    { identity: id_ }
  );
}

// -----------------------------------------------------------------------
// M5: Device / host-namespace denial
// -----------------------------------------------------------------------

function checkM5(probePath, cfg) {
  const configOk =
    Array.isArray(cfg.hostConfig.Devices) &&
    cfg.hostConfig.Devices.length === 0 &&
    cfg.hostConfig.PidMode === '' &&
    cfg.hostConfig.IpcMode === 'private' &&
    cfg.hostConfig.Privileged === false;

  const devResult = runProbe(probePath, 'device');
  const dev = devResult.device;

  const noHostDevices = !dev.dev_listing.some((d) =>
    ['sda', 'sdb', 'nvme0n1', 'mem', 'kmsg'].includes(d)
  );
  const rawDevicesBlocked =
    dev['access_/dev/sda'].startsWith('BLOCKED') &&
    dev['access_/dev/mem'].startsWith('BLOCKED') &&
    dev['access_/dev/kmsg'].startsWith('BLOCKED');
  const isolatedPidNs = dev.proc_pid_count === 1 && JSON.stringify(dev.proc_pids) === '[1]';

  const pass = configOk && noHostDevices && rawDevicesBlocked && isolatedPidNs;
  record(
    'M5',
    'Device / host-namespace denial',
    'RUNTIME',
    pass,
    `config: Devices=${JSON.stringify(cfg.hostConfig.Devices)}, PidMode="${cfg.hostConfig.PidMode}" (want host PID namespace NOT set), IpcMode=${cfg.hostConfig.IpcMode}, Privileged=${cfg.hostConfig.Privileged}; ` +
    `positive: container's own minimal /dev=${JSON.stringify(dev.dev_listing)}; ` +
    `negative: host block-device/mem/kmsg access=${dev['access_/dev/sda']} | ${dev['access_/dev/mem']} | ${dev['access_/dev/kmsg']}; ` +
    `pid namespace isolated: sees only its own pid(s)=${JSON.stringify(dev.proc_pids)} (host PID namespace not visible)`,
    { device: dev }
  );
}

// -----------------------------------------------------------------------
// M6: Docker daemon socket / named-pipe mount denial
// -----------------------------------------------------------------------

function checkM6(probePath, cfg) {
  const bindsHaveNoSocket =
    !JSON.stringify(cfg.hostConfig.Binds || []).includes('docker.sock') &&
    !JSON.stringify(cfg.hostConfig.Binds || []).includes('docker_engine');

  // Positive control: from the HOST (outside any container), confirm the
  // named pipes genuinely exist and are enumerable -- proves the detector
  // below is checking against a real, reachable target, not a name that
  // never exists on this host regardless of mount status.
  const pipeCheckResult = sshExec(
    `powershell -NoProfile -Command "(Get-ChildItem '\\\\.\\pipe\\').Name -join ','"`,
    { label: 'M6 positive control (host pipe enumeration)' }
  );
  const pipeNames = stripSshBanner(pipeCheckResult.stdout);
  const positiveControlOk =
    pipeNames.includes('docker_engine') && pipeNames.includes('dockerDesktopLinuxEngine');

  const sockResult = runProbe(probePath, 'docker_socket');
  const sock = sockResult.docker_socket;
  const allAbsent = Object.keys(sock)
    .filter((k) => k !== 'docker_sock_in_mounts' && k !== 'mounts_raw')
    .every((k) => sock[k].exists === false);
  const notInMounts = sock.docker_sock_in_mounts === false;

  const pass = bindsHaveNoSocket && positiveControlOk && allAbsent && notInMounts;
  record(
    'M6',
    'Docker daemon socket / named-pipe mount denial',
    'RUNTIME',
    pass,
    `config: Binds contain no socket/pipe reference=${bindsHaveNoSocket} (${JSON.stringify(cfg.hostConfig.Binds)}); ` +
    `positive control: host named pipes docker_engine/dockerDesktopLinuxEngine genuinely exist and enumerable=${positiveControlOk}; ` +
    `negative: from inside, /var/run/docker.sock exists=${sock['/var/run/docker.sock'].exists}, /run/docker.sock exists=${sock['/run/docker.sock'].exists}, windows pipe path exists=${sock['\\\\\\\\.\\\\pipe\\\\docker_engine'] ? sock['\\\\\\\\.\\\\pipe\\\\docker_engine'].exists : 'n/a-not-applicable-inside-linux-container'}; ` +
    `no docker.sock/docker_engine string anywhere in /proc/mounts=${notInMounts}`,
    { sock, pipeNames }
  );
}

// -----------------------------------------------------------------------
// M7: Active isolation mode / backend
// -----------------------------------------------------------------------

function checkM7(probePath) {
  const kernelResult = runProbe(probePath, 'kernel');
  const kern = kernelResult.kernel;
  const unameStr = Array.isArray(kern.uname) ? kern.uname.join(' ') : String(kern.uname);
  const isWsl2Kernel = /microsoft-standard-WSL2/i.test(unameStr);

  const infoResult = dockerCmd(
    `info --format "{{.OperatingSystem}} | {{.OSType}} | {{.KernelVersion}} | {{.ServerVersion}}"`,
    { label: 'M7 docker info' }
  );
  const infoLine = stripSshBanner(infoResult.stdout).trim();
  const backendReportsWsl2 = /microsoft-standard-WSL2/i.test(infoLine) && infoLine.includes('linux');

  const wslListResult = sshExec('cmd /c wsl -l -v', { label: 'M7 wsl -l -v' });
  const wslList = stripUtf16Nulls(stripSshBanner(wslListResult.stdout));
  const dockerDesktopDistroRunningV2 = /docker-desktop\s+Running\s+2/.test(wslList.replace(/\s+/g, ' '));

  const pass = isWsl2Kernel && backendReportsWsl2 && dockerDesktopDistroRunningV2;
  record(
    'M7',
    'Active isolation mode / backend (WSL2, no silent fallback)',
    'RUNTIME',
    pass,
    `in-container kernel uname=${unameStr} (WSL2 kernel string present=${isWsl2Kernel}); ` +
    `docker info backend=${infoLine} (reports WSL2=${backendReportsWsl2}); ` +
    `wsl -l -v shows docker-desktop distro Running at WSL VERSION 2=${dockerDesktopDistroRunningV2} (no silent fallback to a different/weaker mode)`,
    { unameStr, infoLine, wslList }
  );
}

// -----------------------------------------------------------------------
// M8: Build-time supply-chain trust (NOT runtime-probed)
// -----------------------------------------------------------------------

function checkM8() {
  const evidence = [];
  let pass = true;

  // (a) Digest/lock verification against S0-recorded pins.
  const dockerfile = fs.readFileSync(REPO_DOCKERFILE, 'utf8');
  const digestPinned = dockerfile.includes(BASE_IMAGE_DIGEST);
  const reqLock = fs.readFileSync(REPO_REQ_LOCK, 'utf8');
  const allDepsHashPinned = reqLock
    .split(/\n(?=\S)/)
    .filter((block) => /^[A-Za-z0-9_.-]+==\S/.test(block)) // real dep lines only, not comment lines mentioning "=="
    .filter((block) => block.length > 0)
    .every((block) => /--hash=sha256:[0-9a-f]{64}/.test(block));
  evidence.push(`base image digest pinned in Dockerfile=${digestPinned} (${BASE_IMAGE_DIGEST}); all dep entries hash-pinned=${allDepsHashPinned}`);
  if (!digestPinned || !allDepsHashPinned) pass = false;

  const idResult = dockerCmd(`inspect --format "{{.Id}}" ${IMAGE}`, { label: 'M8 image id' });
  const actualId = stripSshBanner(idResult.stdout).trim();
  const idMatches = actualId === EXPECTED_IMAGE_ID;
  evidence.push(`built image ID matches recorded S2 digest=${idMatches} (${actualId})`);
  if (!idMatches) pass = false;

  // (b) Image-layer inspection: confirm no build creds/caches persisted.
  const findResult = dockerCmd(
    `run --rm --network none --entrypoint find ${IMAGE} / -xdev -not -path "/proc/*" -not -path "/sys/*"`,
    { label: 'M8 layer listing', timeoutMs: 30000 }
  );
  const listing = stripSshBanner(findResult.stdout);
  const forbiddenPatterns = [
    /\/root\/\.cache\/pip/i,
    /\.netrc/i,
    /\.pypirc/i,
    /id_rsa/i,
    /\.ssh\//i,
    /\/(build|negtest)\/.*\.txt/i,
    /pip_credential/i
  ];
  const secretHits = forbiddenPatterns.filter((re) => re.test(listing));
  const noPersistedSecrets = secretHits.length === 0;
  evidence.push(`layer/filesystem scan of final image: no build-credential/cache paths found=${noPersistedSecrets} (patterns checked: pip cache, .netrc, .pypirc, id_rsa, .ssh/, build-dir stray files, pip_credential)`);
  if (!noPersistedSecrets) pass = false;

  // (c) Negative build fixture 1: mismatched hash pin must be rejected.
  sshExec(`cmd /c if not exist "${REMOTE_NEGTEST_DIR}" mkdir "${REMOTE_NEGTEST_DIR}"`, { label: 'M8 negtest dir' });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-containment-negtest-'));

  const mismatchedLock = reqLock.replace(
    /--hash=sha256:43c1cba5cb44d36840721166feb74600c193452f8510c0b249c4208cb534a171/,
    '--hash=sha256:' + '0'.repeat(64)
  );
  const mismatchedChanged = mismatchedLock !== reqLock;
  const localMismatchedLock = path.join(tmpDir, 'requirements-lock.txt');
  fs.writeFileSync(localMismatchedLock, mismatchedLock, 'utf8');
  fs.copyFileSync(REPO_DOCKERFILE, path.join(tmpDir, 'Dockerfile'));
  fs.copyFileSync(REPO_BRIDGE_STEP, path.join(tmpDir, 'bridge_step.py'));
  fs.copyFileSync(REPO_BRIDGE_SCENE, path.join(tmpDir, 'bridge_scene.xml'));

  sshPutFile(path.join(tmpDir, 'Dockerfile'), `${REMOTE_NEGTEST_DIR}\\Dockerfile`);
  sshPutFile(localMismatchedLock, `${REMOTE_NEGTEST_DIR}\\requirements-lock.txt`);
  sshPutFile(path.join(tmpDir, 'bridge_step.py'), `${REMOTE_NEGTEST_DIR}\\bridge_step.py`);
  sshPutFile(path.join(tmpDir, 'bridge_scene.xml'), `${REMOTE_NEGTEST_DIR}\\bridge_scene.xml`);

  const mismatchBuildResult = dockerCmd(
    `build --no-cache -t ant-hive-verify-negtest:mismatch ${REMOTE_NEGTEST_DIR}`,
    { label: 'M8 negative fixture: mismatched hash', timeoutMs: 90000 }
  );
  const mismatchRejected =
    mismatchBuildResult.status !== 0 &&
    /DO NOT MATCH THE HASHES|HashMismatch/i.test(mismatchBuildResult.stdout + mismatchBuildResult.stderr);
  evidence.push(`negative fixture (deliberately mismatched dependency hash) rejected by build=${mismatchRejected} (mismatchedLock actually differs from real lock=${mismatchedChanged})`);
  if (!mismatchRejected || !mismatchedChanged) pass = false;

  // (d) Negative build fixture 2: injected build-time credential must not
  // persist into the runtime stage.
  const credDockerfile = `ARG BASE_IMAGE=${BASE_IMAGE_DIGEST}
FROM \${BASE_IMAGE} AS base
FROM base AS builder
WORKDIR /build
COPY requirements-lock.txt .
RUN echo "SECRET_TOKEN_SHOULD_NOT_PERSIST" > /build/.pip_credential_fixture \\
    && python -m venv /opt/venv \\
    && /opt/venv/bin/pip install --no-cache-dir --require-hashes -r requirements-lock.txt \\
    && rm -rf /root/.cache/pip
FROM base AS runtime
RUN groupadd --gid 10001 simrunner \\
    && useradd --uid 10001 --gid simrunner --no-create-home --shell /usr/sbin/nologin simrunner
COPY --from=builder /opt/venv /opt/venv
WORKDIR /app
COPY bridge_step.py bridge_scene.xml ./
ENV PATH="/opt/venv/bin:\${PATH}" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN chown -R simrunner:simrunner /app
USER simrunner
ENTRYPOINT ["python", "bridge_step.py"]
CMD ["--steps", "1"]
`;
  const localCredDockerfile = path.join(tmpDir, 'Dockerfile.credtest');
  fs.writeFileSync(localCredDockerfile, credDockerfile, 'utf8');
  sshPutFile(localCredDockerfile, `${REMOTE_NEGTEST_DIR}\\Dockerfile`);
  sshPutFile(REPO_REQ_LOCK, `${REMOTE_NEGTEST_DIR}\\requirements-lock.txt`);

  const credBuildResult = dockerCmd(
    `build --no-cache -t ant-hive-verify-negtest:credfixture ${REMOTE_NEGTEST_DIR}`,
    { label: 'M8 negative fixture: injected credential', timeoutMs: 90000 }
  );
  const credBuildSucceeded = credBuildResult.status === 0;
  let credDidNotPersist = false;
  if (credBuildSucceeded) {
    const credCheckResult = dockerCmd(
      `run --rm --network none --entrypoint cat ant-hive-verify-negtest:credfixture /build/.pip_credential_fixture`,
      { label: 'M8 cred persistence check' }
    );
    credDidNotPersist = credCheckResult.status !== 0 && /No such file/i.test(credCheckResult.stderr);
    dockerCmd(`rmi ant-hive-verify-negtest:credfixture`, { label: 'cleanup negtest cred image' });
  }
  evidence.push(`negative fixture (injected build-time credential in builder stage) fails to persist into runtime image=${credDidNotPersist} (build itself succeeded=${credBuildSucceeded}, as expected -- the assertion is non-persistence, not build failure)`);
  if (!credDidNotPersist) pass = false;

  sshExec(`cmd /c rmdir /s /q "${REMOTE_NEGTEST_DIR}"`, { label: 'cleanup negtest dir' });
  fs.rmSync(tmpDir, { recursive: true, force: true });

  record(
    'M8',
    'Build-time supply-chain trust',
    'BUILD-TIME',
    pass,
    evidence.join(' || '),
    { evidence }
  );
}

// -----------------------------------------------------------------------
// Residual risks (carried forward, not eliminated by any probe above)
// -----------------------------------------------------------------------

const RESIDUAL_RISKS = [
  "Shared WSL2 kernel: all Linux containers on Orwell share ONE WSL2 kernel. A kernel-level LPE/container-escape CVE could reach the WSL2 VM or other containers; namespace/cgroup isolation does not protect against this. Operator-accepted 2026-07-17, NOT eliminated by any probe above.",
  "NT AUTHORITY\\SYSTEM Docker Desktop host service (com.docker.service): if the daemon socket/pipe were ever exposed into a container (M6 exists to catch this), a compromised sim could reach full Windows host takeover via that SYSTEM-privileged service. This vector exists ONLY if M6 is violated; M6 passing here does not retroactively eliminate the service privilege level as a structural fact.",
  "Microarchitectural/timing side-channels (cache contention, power/timing) between the container and other workloads on the shared physical host/kernel. Documented for operator awareness, NOT mitigated or tested by this script.",
  "WSL2 VM hypervisor boundary itself: a real but lightweight Hyper-V-based VM boundary; a hypervisor-level escape is lower-probability than a shared-kernel escape but not provably impossible. Not probed here."
];

// -----------------------------------------------------------------------
// Copy-free regression guard
// -----------------------------------------------------------------------

function runSelftest() {
  const sourceFiles = [__filename, path.join(__dirname, 'bridge-client.js')];
  const copyUtility = ['s', 'cp'].join('');
  const configExpansion = ['ssh', '-G'].join(' ');
  const grepPattern = `${copyUtility}|ssh[[:space:]]+-G`;
  const grepResult = spawnSync('grep', ['-nE', grepPattern, ...sourceFiles], {
    encoding: 'utf8',
    timeout: 10000
  });

  if (grepResult.error) {
    process.stderr.write(`SELFTEST FAIL: source grep could not run: ${grepResult.error.message}\n`);
    return false;
  }
  if (grepResult.status === 0) {
    process.stderr.write(`SELFTEST FAIL: forbidden ${copyUtility} or ${configExpansion} source occurrence found:\n${grepResult.stdout}`);
    return false;
  }
  if (grepResult.status !== 1) {
    process.stderr.write(`SELFTEST FAIL: source grep exited ${grepResult.status}: ${grepResult.stderr}\n`);
    return false;
  }

  process.stdout.write(`SELFTEST PASS: no ${copyUtility} or ${configExpansion} call sites in verify-containment.js or bridge-client.js\n`);
  return true;
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------

function printTable() {
  const lines = [];
  lines.push('');
  lines.push('='.repeat(100));
  lines.push('S3 CONTAINMENT VERIFICATION -- ant-hive-world-orwell-sim-containment');
  lines.push('='.repeat(100));
  lines.push('');
  lines.push('SCOPE: this report asserts ONLY the 8 rows of the S0 design memo\'s threat-model /');
  lines.push('acceptance matrix (M1-M8), each per its declared evidence type. It does NOT claim to');
  lines.push('prove the absence of every possible container escape. See "Residual risks" below.');
  lines.push('');
  for (const r of rows) {
    lines.push(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.id} (${r.type}) -- ${r.control}`);
    lines.push(`       evidence: ${r.evidence}`);
    lines.push('');
  }
  lines.push('-'.repeat(100));
  lines.push('Exact docker run invocation verified:');
  lines.push(`  ${PROD_RUN_INVOCATION_STRING}`);
  lines.push('-'.repeat(100));
  lines.push('Residual risks (operator-accepted-pending-S0, NOT eliminated by the probes above):');
  for (const r of RESIDUAL_RISKS) {
    lines.push(`  - ${r}`);
  }
  lines.push('-'.repeat(100));
  const allPass = rows.every((r) => r.pass);
  lines.push(allPass ? 'RESULT: ALL DECLARED MATRIX ROWS PASS' : 'RESULT: ONE OR MORE ROWS FAILED -- BLOCKING FINDING, DO NOT PROCEED');
  lines.push('='.repeat(100));
  console.log(lines.join('\n'));
  return allPass;
}

function main() {
  if (process.argv.includes('--selftest')) {
    process.exit(runSelftest() ? 0 : 1);
  }

  const keepStaging = process.argv.includes('--keep-staging');
  let probePath;
  try {
    probePath = step('staging probe scripts on Orwell', setupStaging);
    const cfg = step('inspecting production run configuration', inspectProdConfig);

    step('M1: network isolation', () => checkM1(probePath, cfg));
    step('M2: filesystem policy', () => checkM2(probePath, cfg));
    step('M3: resource limits', () => checkM3(probePath, cfg));
    step('M4: identity/privilege', () => checkM4(probePath, cfg));
    step('M5: device/namespace denial', () => checkM5(probePath, cfg));
    step('M6: docker socket/pipe denial', () => checkM6(probePath, cfg));
    step('M7: active backend confirmation', () => checkM7(probePath));
    step('M8: build-time supply-chain trust', checkM8);
  } finally {
    step('cleaning up staged files on Orwell', () => cleanupStaging(keepStaging));
  }

  const allPass = printTable();
  process.exit(allPass ? 0 : 1);
}

main();
