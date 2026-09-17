# tools/ant-hive-world/embodiment-bridge/Dockerfile -- plan
# ant-hive-world-orwell-sim-containment, S2.
#
# Minimal container for bridge_step.py (MuJoCo physics step + perception
# vector, see that file's header). Two stages: the builder stage has
# network access to fetch pinned Python/MuJoCo wheels (verified against
# requirements-lock.txt's sha256 hashes) but NEVER imports or runs
# bridge_step.py / any sim/mind code; the runtime stage copies only the
# built venv + the two sim files, runs as a fixed non-root UID, and has no
# build tooling, pip cache, or credentials.
#
# Runtime network/filesystem/resource/identity policy (--network none,
# --read-only root + single /scratch mount, --cap-drop ALL,
# --security-opt no-new-privileges, --pids-limit, --ulimit nofile,
# --cpus/--memory) is applied at `docker run` time per the S0 design memo
# (_dev/reports/analysis/ant-hive-world-orwell-sim-containment-design-memo.md,
# items 3-6) -- this Dockerfile does not (and cannot) enforce those; S3
# adversarially evidences them against the actual run invocation.
#
# No weight/checkpoint persistence path exists anywhere in this image:
# sim minds are created fresh each run (see S0's fresh-minds constraint);
# there is no volume, no writable path outside /scratch, and no directory
# in this image intended to hold saved model weights.

# Base image pinned by digest (OCI multi-arch index for python:3.11-slim,
# resolved 2026-07-18 via the Docker Hub v2 registry API against
# registry-1.docker.io; the linux/amd64 manifest under this index is
# sha256:00af38ae2ed311628970782e8a2d7f014d8909dbc63cb97bc0a158187f4db045,
# selected automatically for Orwell's linux/amd64 WSL2 Docker Desktop
# engine). Same digest used for both stages so builder and runtime start
# from an identical, verified base.
ARG BASE_IMAGE=python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93

# Single named "base" stage resolves the pinned digest exactly once. Both
# builder and runtime derive FROM this local stage rather than each issuing
# their own `FROM ${BASE_IMAGE}` -- observed on Orwell (S2 build, the
# Session-1-scheduled-task exec lane): two independent registry-metadata
# credential resolutions for the identical digest reliably succeed on the
# first call and fail on the second ("error getting credentials ... A
# specified logon session does not exist") because the scheduled task's
# logon session backing the Windows credential helper does not survive long
# enough for a second resolve. Resolving once and reusing the local stage
# avoids the second resolve entirely; it has no effect on build correctness
# since both stages already required byte-identical base content.
FROM ${BASE_IMAGE} AS base

# ---------------------------------------------------------------------------
# Stage 1: builder -- networked, fetches + hash-verifies pinned deps only.
# ---------------------------------------------------------------------------
FROM base AS builder

WORKDIR /build

# Only the lock file is present here -- bridge_step.py / bridge_scene.xml
# are copied in the runtime stage below, never in this stage, so no
# sim/mind code can execute during this networked build phase.
COPY requirements-lock.txt .

RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --require-hashes \
         -r requirements-lock.txt \
    && rm -rf /root/.cache/pip

# ---------------------------------------------------------------------------
# Stage 2: runtime -- minimal, non-root, no build tooling/caches/credentials.
# ---------------------------------------------------------------------------
FROM base AS runtime

# Fixed non-root UID/GID (S0 item 6: non-root, no --privileged).
RUN groupadd --gid 10001 simrunner \
    && useradd --uid 10001 --gid simrunner --no-create-home \
         --shell /usr/sbin/nologin simrunner

# Only the built venv crosses the stage boundary -- no build tooling, no
# pip cache, no source/wheel files, no credentials.
COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY bridge_step.py bridge_scene.xml ./

ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# /app is owned by simrunner read-only-friendly (no writes expected here at
# runtime -- root filesystem is mounted --read-only at `docker run` time
# per S0 item 4; the sole writable path is the /scratch mount created at
# run time, not baked into this image). No checkpoint/weights directory
# exists in this image -- fresh-minds constraint.
RUN chown -R simrunner:simrunner /app

USER simrunner

ENTRYPOINT ["python", "bridge_step.py"]
CMD ["--steps", "1"]
