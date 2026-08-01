'use strict';

/**
 * tools/client-storage/lib.js
 *
 * Shared helpers for the client-storage tool family (resolve.js, preflight.js,
 * classify.js, migrate.js). Node built-ins only -- no new npm dependencies.
 *
 * Mechanism, not doctrine: this module (and resolve.js in particular) is the
 * authoritative source for "what counts as a client's registered cloud-storage
 * root." If instructions/canonical/guardrails.md ever describes this
 * differently, this code wins (Core alias-authority law).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { resolveCanonicalRoot } = require('../lib/canonical-root.cjs');

const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || resolveCanonicalRoot();
const CLOUD_STORAGE_DIR = path.join(os.homedir(), 'Library', 'CloudStorage');
const CLIENT_STORAGE_REPORTS_DIR = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'client-storage');

// Exit codes shared across the whole tool family. Keep numbers stable --
// downstream orchestration (plan step gates) matches on these.
const EXIT_CODES = {
  OK: 0,
  USAGE_ERROR: 1,
  UNMOUNTED: 2,
  NO_FILE_STORAGE: 3,
  PATH_MISSING: 4,
  CONFLICT_FILES_PRESENT: 5,
  HAZARD_MOUNT: 6,
  NOT_WRITABLE: 7,
  MISSING_CLIENT: 8,
  LOW_DISK: 9,
  QUOTA_UNKNOWN: 10,
  QUOTA_INSUFFICIENT: 11,
  ATTESTATION_REQUIRED: 12,
  RENAMES_REQUIRED: 13,
  CHECKSUM_MISMATCH: 14,
  REPORT_MISSING: 15,
  PREFLIGHT_REQUIRED: 16,
  PREFLIGHT_STALE: 17,
  PREFLIGHT_FAILED: 18,
  CLASSIFY_REQUIRED: 19,
  CLASSIFY_MISMATCH: 20,
  CLASSIFY_DRIFT: 21,
  TARGET_CONFLICT: 22,
  TARGET_COLLISION: 23,
  RENAME_MAP_DRIFT: 24,
  PII_MAP_DRIFT: 25
};

const EXIT_NAMES = Object.fromEntries(Object.entries(EXIT_CODES).map(([k, v]) => [v, k]));

// A preflight report older than this can no longer gate a migrate --execute
// run -- the mount/quota/disk state it certified may no longer hold.
const PREFLIGHT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Hard-denied mount directory name fragments (backstop, regardless of what a
// client.json registers). macOS cloud mounts are normally case-insensitive
// and Unicode-normalizing, so all security comparisons use the same folded
// identity rather than trusting spelling/case differences.
const HAZARD_MOUNT_FRAGMENTS = ['OneDrive2-', 'OneDrive-SharedLibraries'];

const DEFAULT_MIN_FREE_DISK_GB = 15;

// Client-specific classification behavior belongs in the private client.json
// boundary, never in reusable source. These profile names describe generic
// detection mechanisms; they do not identify a client.
const CLASSIFICATION_POLICY_FIELD = 'client_storage_policy';
const PII_FILENAME_PROFILES = {
  'long-numeric-record-id-v1': /(?:^|\/)[^/]*(?:\d[^/]*){13}(?:\.[^/]*)?$/
};
const STRUCTURED_CONTENT_PROFILES = new Set(['crm-contact-export-v1']);

// HTML is intentionally absent. Its role cannot be inferred from its
// extension: it may be reusable application/template source, a captured
// client page, or an ambiguous standalone document. classify.js applies the
// narrower semantic HTML rules.
const CODE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.php', '.py', '.sh', '.sql', '.css', '.spec']);
const CODE_TREE_MARKER_FILES = new Set(['package.json', 'composer.json']);
const CODE_TREE_DIR_SEGMENTS = new Set(['src', 'lib', 'app', 'tools', 'tests', 'vendor', 'node_modules']);
const STUB_EXTENSIONS = new Set(['.gsheet', '.gdoc', '.gform', '.gsite']);
const ARTIFACT_OUTPUT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.html', '.htm', '.css']);
const ARTIFACT_CONTEXT_SEGMENT =
  /^(?:evidence|captures?|reports?|outputs?|exports?|screenshots?|snapshots?|mockups?|audits?)(?:[-_].*)?$/i;
const PRIVATE_CONTROL_RELPATHS = new Set([
  'pii-path-map.json',
  'rename-map.json',
  'source-snapshot.json',
  'remote-identity-map.json',
  'remote-attestation.json',
  'retirement-journal.json',
  '.storage-map.lock'
]);
const PRIVATE_CONTROL_PREFIXES = ['.retirement-staging/'];

const ALWAYS_KEEP_RELPATHS = new Set([
  'client.json',
  'classification-decisions.json',
  'README.md',
  'WORKSPACE_MANIFEST.json',
  'storage-map.json',
  'NEXT_SESSION.md',
  'next-session-handoff.md',
  'whats-next.md'
]);
const INVIOLABLE_ROOT_CONTROL_RELPATHS = new Set([
  'client.json',
  'classification-decisions.json',
  'WORKSPACE_MANIFEST.json',
  'storage-map.json'
]);
const ALWAYS_KEEP_GLOBS = [
  'plans/**',
  'config/**',
  'projects/*/project.json',
  'projects/*/README.md',
  'projects/*/HOW_TO_RUN.md',
  'projects/*/WORKFLOW_GUIDE.md',
  '**/.gitkeep',
  '**/.gitignore'
];

function nowUtcStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function emitStatus(payload) {
  process.stderr.write(JSON.stringify(payload) + '\n');
}

function fail(code, extra) {
  const name = EXIT_NAMES[code] || 'UNKNOWN_ERROR';
  emitStatus({ ok: false, code: name, exit_code: code, ...extra });
  process.exit(code);
}

function clientJsonPath(clientCode) {
  return path.join(REPO_ROOT, 'clients', clientCode, 'client.json');
}

function clientRootPath(clientCode) {
  return path.join(REPO_ROOT, 'clients', clientCode);
}

function readClientJson(clientCode) {
  const p = clientJsonPath(clientCode);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`clients/${clientCode}/client.json is not valid JSON: ${err.message}`);
  }
}

function readClientJsonAtRoot(clientCode, repoRoot = REPO_ROOT) {
  const filePath = path.join(repoRoot, 'clients', clientCode, 'client.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`client.json is not valid JSON: ${error.message}`);
  }
}

function stringArray(value, fieldName) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${CLASSIFICATION_POLICY_FIELD}.${fieldName} must be an array of nonempty strings`);
  }
  return [...new Set(value)];
}

/**
 * Resolve generic private policy from clients/CODE/client.json.
 *
 * client_storage_policy: {
 *   classification: {
 *     protected_paths: [glob], pii_globs: [glob],
 *     pii_filename_profiles: ["long-numeric-record-id-v1"],
 *     structured_content_profiles: ["crm-contact-export-v1"]
 *   },
 *   private_source_snapshot: { enabled: true }
 * }
 */
function loadClientStoragePolicy(clientCode, repoRoot = REPO_ROOT) {
  const client = readClientJsonAtRoot(clientCode, repoRoot);
  const rootPolicy = client ? client[CLASSIFICATION_POLICY_FIELD] : undefined;
  if (rootPolicy === undefined) {
    return {
      protectedPaths: [],
      piiMatchers: [],
      structuredContentProfiles: new Set(),
      privateSourceSnapshotEnabled: false
    };
  }
  if (!rootPolicy || typeof rootPolicy !== 'object' || Array.isArray(rootPolicy)) {
    throw new Error(`${CLASSIFICATION_POLICY_FIELD} must be an object`);
  }
  const classification = rootPolicy.classification === undefined ? {} : rootPolicy.classification;
  if (!classification || typeof classification !== 'object' || Array.isArray(classification)) {
    throw new Error(`${CLASSIFICATION_POLICY_FIELD}.classification must be an object`);
  }
  const protectedPaths = stringArray(classification.protected_paths, 'classification.protected_paths');
  const piiGlobs = stringArray(classification.pii_globs, 'classification.pii_globs');
  const piiFilenameProfiles = stringArray(
    classification.pii_filename_profiles,
    'classification.pii_filename_profiles'
  );
  const structuredProfiles = stringArray(
    classification.structured_content_profiles,
    'classification.structured_content_profiles'
  );
  for (const profile of piiFilenameProfiles) {
    if (!Object.prototype.hasOwnProperty.call(PII_FILENAME_PROFILES, profile)) {
      throw new Error(`unknown PII filename profile: ${profile}`);
    }
  }
  for (const profile of structuredProfiles) {
    if (!STRUCTURED_CONTENT_PROFILES.has(profile)) {
      throw new Error(`unknown structured-content profile: ${profile}`);
    }
  }
  const snapshotPolicy = rootPolicy.private_source_snapshot === undefined
    ? {}
    : rootPolicy.private_source_snapshot;
  if (!snapshotPolicy || typeof snapshotPolicy !== 'object' || Array.isArray(snapshotPolicy)) {
    throw new Error(`${CLASSIFICATION_POLICY_FIELD}.private_source_snapshot must be an object`);
  }
  if (snapshotPolicy.enabled !== undefined && typeof snapshotPolicy.enabled !== 'boolean') {
    throw new Error(`${CLASSIFICATION_POLICY_FIELD}.private_source_snapshot.enabled must be boolean`);
  }
  return {
    protectedPaths,
    piiMatchers: [...piiGlobs, ...piiFilenameProfiles.map((profile) => PII_FILENAME_PROFILES[profile])],
    structuredContentProfiles: new Set(structuredProfiles),
    privateSourceSnapshotEnabled: snapshotPolicy.enabled === true
  };
}

// Basename of the CloudStorage mount directory a given absolute mounted_path
// lives under, e.g. "OneDrive-Organization" for
// ~/Library/CloudStorage/OneDrive-Organization/Clients/CLIENT
function mountDirNameFor(mountedPath) {
  const rel = path.relative(CLOUD_STORAGE_DIR, mountedPath);
  if (rel.startsWith('..') || rel === '') return null;
  return rel.split(path.sep)[0];
}

function normalizedMacPathIdentity(value) {
  return String(value).normalize('NFD').toLowerCase();
}

function isHazardMountName(mountDirName) {
  if (!mountDirName) return false;
  const identity = normalizedMacPathIdentity(mountDirName);
  return HAZARD_MOUNT_FRAGMENTS.some((frag) => identity.includes(normalizedMacPathIdentity(frag)));
}

/**
 * Resolve a client's cloud-storage root, enforcing the allowlist and hazard
 * rules. Returns { ok: true, mountedPath, mountDirName, mountRoot, provider,
 * manifest } on success, or { ok: false, code, ...extra } on any failure --
 * never throws for expected failure modes.
 */
function resolveStorageRoot(clientCode) {
  let clientJson;
  try {
    clientJson = readClientJson(clientCode);
  } catch (err) {
    return { ok: false, code: EXIT_CODES.USAGE_ERROR, reason: err.message };
  }
  if (!clientJson) {
    return { ok: false, code: EXIT_CODES.MISSING_CLIENT, reason: `clients/${clientCode}/client.json not found` };
  }

  const fileStorage = clientJson.file_storage;
  if (!fileStorage || !fileStorage.mounted_path || !fileStorage.provider) {
    return {
      ok: false,
      code: EXIT_CODES.NO_FILE_STORAGE,
      reason: `clients/${clientCode}/client.json has no file_storage.{provider,mounted_path}`
    };
  }
  if (!['gdrive', 'onedrive'].includes(fileStorage.provider)) {
    return {
      ok: false,
      code: EXIT_CODES.NO_FILE_STORAGE,
      reason: `clients/${clientCode}/client.json file_storage.provider must be exactly "gdrive" or "onedrive", got ${JSON.stringify(fileStorage.provider)}`
    };
  }

  const mountedPath = path.resolve(fileStorage.mounted_path);
  const mountDirName = mountDirNameFor(mountedPath);

  if (!mountDirName) {
    return {
      ok: false,
      code: EXIT_CODES.HAZARD_MOUNT,
      reason: `registered mounted_path is not under ${CLOUD_STORAGE_DIR}: ${mountedPath}`
    };
  }

  if (isHazardMountName(mountDirName)) {
    return {
      ok: false,
      code: EXIT_CODES.HAZARD_MOUNT,
      reason: `mount "${mountDirName}" is hard-denied (hazard mount)`
    };
  }

  if (
    fileStorage.mount_dir &&
    normalizedMacPathIdentity(mountDirName) !== normalizedMacPathIdentity(fileStorage.mount_dir)
  ) {
    return {
      ok: false,
      code: EXIT_CODES.HAZARD_MOUNT,
      reason: 'registered mounted_path does not match file_storage.mount_dir'
    };
  }

  const mountRoot = path.join(CLOUD_STORAGE_DIR, mountDirName);
  let mountRootStat;
  try {
    mountRootStat = fs.statSync(mountRoot);
  } catch {
    return { ok: false, code: EXIT_CODES.UNMOUNTED, reason: `mount root does not exist: ${mountRoot}` };
  }
  if (!mountRootStat.isDirectory()) {
    return { ok: false, code: EXIT_CODES.UNMOUNTED, reason: `mount root is not a directory: ${mountRoot}` };
  }

  if (!fs.existsSync(mountedPath)) {
    return { ok: false, code: EXIT_CODES.PATH_MISSING, reason: `registered mounted_path does not exist: ${mountedPath}` };
  }

  const conflicts = shallowConflictScan(mountedPath);
  if (conflicts.length > 0) {
    return {
      ok: false,
      code: EXIT_CODES.CONFLICT_FILES_PRESENT,
      reason: `${conflicts.length} conflict file(s) found under ${mountedPath}`,
      conflicts: conflicts.slice(0, 20)
    };
  }

  return {
    ok: true,
    mountedPath,
    mountDirName,
    mountRoot,
    provider: fileStorage.provider,
    manifest: fileStorage.manifest || 'storage-map.json'
  };
}

// Any path this tool family writes under a resolved mount root MUST pass this
// check first. This is the allowlist rule: a write target is valid only if it
// is (a) under the client's own registered mounted_path, and never under any
// other mount.
function assertUnderRoot(candidatePath, root) {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refused: "${candidatePath}" is not under the allowlisted root "${root}"`);
  }
  return resolvedCandidate;
}

// Recursive scan for *.conflict* files or "conflicted copy" filenames.
// Listing directory entries does not hydrate dataless cloud placeholder
// files -- only reading their content would -- so this is safe to run
// broadly. depth-bounded as a defensive measure against pathological trees.
function shallowConflictScan(root, maxDepth = 12) {
  const hits = [];
  const isConflictName = (name) => /\.conflict/i.test(name) || /conflicted copy/i.test(name);

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (isConflictName(entry.name)) {
        hits.push(full);
        continue;
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        walk(full, depth + 1);
      }
    }
  }

  walk(root, 0);
  return hits;
}

// Streaming sha256 -- never loads the whole file into memory. Matters once
// multi-gigabyte clients remain in the migration lane, and migrate.js hashes
// every file twice (source, then read-back).
function hashFile(filePath, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function sha256File(filePath) {
  return hashFile(filePath, 'sha256');
}

// Microsoft QuickXorHash, following the published 160-bit/11-bit-rotation
// algorithm. Work is folded by the algorithm's 160-byte period so large
// client files are processed in O(n) byte operations without BigInt churn.
function quickXorHashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hashBytes = Buffer.alloc(20);
    let length = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => {
      const folded = Buffer.alloc(Math.min(160, chunk.length));
      for (let i = 0; i < chunk.length; i += 1) {
        folded[i % 160] ^= chunk[i];
      }
      let shift = ((length % 160) * 11) % 160;
      for (let i = 0; i < folded.length; i += 1) {
        const value = folded[i];
        for (let bit = 0; bit < 8; bit += 1) {
          if (value & (1 << bit)) {
            const position = (shift + bit) % 160;
            hashBytes[Math.floor(position / 8)] ^= 1 << (position % 8);
          }
        }
        shift = (shift + 11) % 160;
      }
      length += chunk.length;
    });
    stream.on('end', () => {
      let remaining = BigInt(length);
      for (let i = 0; i < 8; i += 1) {
        hashBytes[12 + i] ^= Number(remaining & 0xffn);
        remaining >>= 8n;
      }
      resolve(hashBytes.toString('base64'));
    });
  });
}

async function sha256Prefix8(filePath) {
  return (await sha256File(filePath)).slice(0, 8);
}

// Atomic write probe: write and fsync a temp file, publish it with the exact
// exclusive hard-link primitive migrate.js uses, unlink the temp name, read
// back, then delete. A filesystem that cannot hard-link therefore fails
// preflight rather than discovering the incompatibility during migration.
// Returns { ok: true } or { ok: false, reason } and always cleans up.
function atomicWritableProbe(root) {
  const marker = `.client-storage-probe.${process.pid}.${Date.now()}`;
  const tmpPath = path.join(root, `${marker}.tmp`);
  const finalPath = path.join(root, marker);
  const payload = `client-storage-probe ${new Date().toISOString()}\n`;
  let fd;
  try {
    fd = fs.openSync(tmpPath, 'w');
    fs.writeSync(fd, payload);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    fs.linkSync(tmpPath, finalPath);
    fs.unlinkSync(tmpPath);

    const readBack = fs.readFileSync(finalPath, 'utf8');
    if (readBack !== payload) {
      return { ok: false, reason: 'read-back content mismatch after atomic probe' };
    }
    fs.unlinkSync(finalPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed or never opened */
      }
    }
    for (const p of [tmpPath, finalPath]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

// Local free disk space in GB for the partition backing `targetPath`, via
// native statfsSync with a `df -k` shell fallback (mirrors
// tools/hygiene/disk-quota-guard.cjs's approach). Returns -1 on hard failure
// (never silently treated as "plenty of space"). Uses execFileSync with an
// argv array (never a shell-interpolated string) -- df's path argument
// travels as a single argv element, no shell quoting involved.
function getLocalFreeDiskGB(targetPath) {
  try {
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(targetPath);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      return freeBytes / (1024 * 1024 * 1024);
    }
  } catch {
    /* fall through to df */
  }
  try {
    const output = execFileSync('df', ['-k', targetPath], { encoding: 'utf8' });
    const lines = output.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const availableKB = parseInt(parts[3], 10);
      if (!Number.isNaN(availableKB)) return availableKB / (1024 * 1024);
    }
  } catch {
    /* fall through to failure */
  }
  return -1;
}

// Minimal glob support: '**' matches across path separators, '*' matches
// within a single segment. Sufficient for the configured protected_paths /
// pii_globs shapes ("dir/**", "dir/sub/**").
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAnyGlob(relPath, globs) {
  const normalized = relPath.split(path.sep).join('/');
  return globs.some((g) => (g instanceof RegExp ? g.test(normalized) : globToRegExp(g).test(normalized)));
}

function isPrivateControlRelPath(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  return (
    PRIVATE_CONTROL_RELPATHS.has(relPath) ||
    PRIVATE_CONTROL_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

// Walk clients/CODE recursively, yielding { relPath, absPath, size, mtimeMs }
// for every regular file. Never follows symlinks. Never reads file content
// (classification is metadata + path shape only, per the dry-run contract).
function walkClientTree(clientRoot) {
  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        let stat;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        results.push({
          relPath: path.relative(clientRoot, full),
          absPath: full,
          size: stat.size,
          mtimeMs: stat.mtimeMs
        });
      }
    }
  }
  walk(clientRoot);
  return results;
}

// Directories (relative to clientRoot) that are, or are descendants of, a
// directory directly containing package.json/composer.json.
function findCodeTreeDirs(clientRoot, files) {
  const markerDirs = new Set();
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const hasMarker = entries.some((e) => e.isFile() && CODE_TREE_MARKER_FILES.has(e.name));
    if (hasMarker) markerDirs.add(path.relative(clientRoot, dir));
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(path.join(dir, entry.name));
    }
  }
  walk(clientRoot);
  return markerDirs;
}

function isUnderAnyMarkerDir(relPath, markerDirs) {
  for (const markerDir of markerDirs) {
    if (markerDir === '') return true;
    if (relPath === markerDir || relPath.startsWith(markerDir + path.sep)) return true;
  }
  return false;
}

function hasCodeTreeSegment(relPath) {
  return relPath.split(path.sep).some((seg) => CODE_TREE_DIR_SEGMENTS.has(seg));
}

// Package/composer markers describe runtime trees, but generated visual and
// rendered outputs nested below them are still reference artifacts. Limit
// the override to output-shaped extensions in explicitly artifact-shaped
// directory segments so runtime assets such as src/assets/logo.png remain
// protected by normal code-tree retention.
function isArtifactOutputPath(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  if (!ARTIFACT_OUTPUT_EXTENSIONS.has(ext)) return false;
  return relPath
    .split(path.sep)
    .slice(0, -1)
    .some((segment) => ARTIFACT_CONTEXT_SEGMENT.test(segment));
}

// argv-array Git probes, never shell-interpolated. `git status --porcelain`
// intentionally hides ignored files, so check-ignore must be explicit:
// ignored local dumps are deferred just like untracked/modified files.
// check-ignore exit 1 means positively "not ignored"; any other probe error
// is indeterminate and therefore deferred.
function isGitDirty(repoRoot, absPath) {
  const rel = path.relative(repoRoot, absPath);
  const ignored = spawnSync('git', ['check-ignore', '-q', '--', rel], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (ignored.status === 0) return true;
  if (ignored.status !== 1 || ignored.error) return true;

  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', rel], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (status.status !== 0 || status.error) return true;
  return status.stdout.trim().length > 0;
}

function buildGitDirtyChecker(repoRoot, files) {
  return buildGitDirtyCheckerWithSnapshot(repoRoot, files, new Set());
}

function buildGitDirtyCheckerWithSnapshot(repoRoot, files, stableIgnoredRepoPaths = new Set()) {
  const repoRelativePaths = files.map((file) => path.relative(repoRoot, file.absPath));
  const commonClientPath = (() => {
    if (repoRelativePaths.length === 0) return '.';
    const splitPaths = repoRelativePaths.map((value) => value.split(path.sep));
    const common = [];
    for (let index = 0; index < splitPaths[0].length - 1; index += 1) {
      const segment = splitPaths[0][index];
      if (!splitPaths.every((parts) => parts[index] === segment)) break;
      common.push(segment);
    }
    return common.length > 0 ? common.join(path.sep) : '.';
  })();
  const status = spawnSync(
    'git',
    ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--', commonClientPath],
    {
      cwd: repoRoot,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024
    }
  );
  if (status.status !== 0 || status.error) {
    throw new Error('unable to establish the client subtree git status; classification halted');
  }
  const dirty = new Set();
  for (const record of status.stdout.toString('utf8').split('\0')) {
    if (!record) continue;
    const relPath = record.slice(3);
    if (relPath) dirty.add(path.normalize(relPath));
  }

  const ignoreInput = Buffer.from(`${repoRelativePaths.join('\0')}\0`);
  const ignored = spawnSync('git', ['check-ignore', '-z', '--stdin'], {
    cwd: repoRoot,
    input: ignoreInput,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024
  });
  if (![0, 1].includes(ignored.status) || ignored.error) {
    throw new Error('unable to establish ignored client files; classification halted');
  }
  for (const relPath of ignored.stdout.toString('utf8').split('\0')) {
    if (relPath && !stableIgnoredRepoPaths.has(path.normalize(relPath))) {
      dirty.add(path.normalize(relPath));
    }
  }
  return (absPath) => dirty.has(path.normalize(path.relative(repoRoot, absPath)));
}

// OneDrive filename compatibility lint. Returns a list of violation reasons,
// empty if the name/path is fine.
const ONEDRIVE_ILLEGAL_CHARS = /["*:<>?\\|]/;
const ONEDRIVE_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

function lintOneDriveTargetPath(fullTargetPath) {
  const violations = [];
  const segments = fullTargetPath.split(path.sep).filter(Boolean);
  for (const seg of segments) {
    if (ONEDRIVE_ILLEGAL_CHARS.test(seg)) violations.push(`illegal character in "${seg}"`);
    if (seg !== seg.trim()) violations.push(`leading/trailing space in "${seg}"`);
    if (/\.$/.test(seg) && seg !== '.' && seg !== '..') violations.push(`trailing dot in "${seg}"`);
    const base = seg.split('.')[0].toUpperCase();
    if (ONEDRIVE_RESERVED_NAMES.has(base)) violations.push(`reserved device name "${seg}"`);
  }
  if (fullTargetPath.length > 380) violations.push(`full target path exceeds 380 chars (${fullTargetPath.length})`);
  return violations;
}

function ensureReportsDir() {
  fs.mkdirSync(CLIENT_STORAGE_REPORTS_DIR, { recursive: true });
  return CLIENT_STORAGE_REPORTS_DIR;
}

function writeAtomic(filePath, content) {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

function loadStorageMap(clientCode) {
  const p = path.join(clientRootPath(clientCode), 'storage-map.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function newStorageMap(clientCode, resolved) {
  return {
    schema_version: 1,
    client: clientCode,
    drive: { provider: resolved.provider, mounted_path: resolved.mountedPath, mount_dir: resolved.mountDirName },
    rules: { moved: [], kept: [] },
    entries: []
  };
}

// clients/CODE/rename-map.json -- the approved OneDrive-rename mapping
// written by preflight.js (--renames-approved) and applied by migrate.js.
// Lives inside the client's own directory (not under the committed
// _dev/reports/analysis/client-storage narrative surface) because, for a PII
// client, it necessarily carries real filenames -- the same boundary
// storage-map.json already draws for private controls (kept untracked by convention).
function renameMapPath(clientCode) {
  return path.join(clientRootPath(clientCode), 'rename-map.json');
}

function loadRenameMap(clientCode) {
  const p = renameMapPath(clientCode);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeRenameMap(clientCode, map) {
  writeAtomic(renameMapPath(clientCode), JSON.stringify(map, null, 2) + '\n');
  return renameMapPath(clientCode);
}

function piiPathMapPath(clientCode) {
  return path.join(clientRootPath(clientCode), 'pii-path-map.json');
}

function loadPiiPathMap(clientCode) {
  const p = piiPathMapPath(clientCode);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writePiiPathMap(clientCode, map) {
  writeAtomic(piiPathMapPath(clientCode), JSON.stringify(map, null, 2) + '\n');
  return piiPathMapPath(clientCode);
}

async function validatePiiPathMapBinding(clientCode, binding) {
  if (
    !binding ||
    binding.required !== true ||
    binding.schema !== 'ClientStoragePiiPathMap/1.0' ||
    binding.client !== clientCode ||
    !Number.isInteger(binding.entry_count) ||
    binding.entry_count < 0 ||
    !/^[a-f0-9]{64}$/.test(binding.sha256 || '')
  ) {
    return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'PII path-map binding is missing or invalid' };
  }
  const mapPath = piiPathMapPath(clientCode);
  if (!fs.existsSync(mapPath)) {
    return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'required pii-path-map.json is missing' };
  }
  let map;
  try {
    map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  } catch (err) {
    return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: `pii-path-map.json is not valid JSON: ${err.message}` };
  }
  if (map.schema !== binding.schema || map.client !== binding.client || !Array.isArray(map.entries)) {
    return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'pii-path-map.json schema/client/entries are invalid' };
  }
  if (map.entries.length !== binding.entry_count) {
    return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'pii-path-map.json entry count changed after classification' };
  }
  const actualSha256 = await sha256File(mapPath);
  if (actualSha256 !== binding.sha256) {
    return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'pii-path-map.json content changed after classification' };
  }
  const index = new Map();
  const retainedIndex = new Map();
  const retiredIndex = new Map();
  const seenPaths = new Set();
  const clientRoot = clientRootPath(clientCode);
  const retainedEntries = map.retained_entries === undefined ? [] : map.retained_entries;
  const retiredEntries = map.retired_entries === undefined ? [] : map.retired_entries;
  if (!Array.isArray(retainedEntries) || !Array.isArray(retiredEntries)) {
    return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'pii-path-map.json retained or retired entries are invalid' };
  }
  for (const [collection, destination] of [
    [map.entries, index],
    [retainedEntries, retainedIndex]
  ]) {
    for (const item of collection) {
      if (
        !item ||
        typeof item.pii_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.pii_id) ||
        typeof item.repo_relpath !== 'string' ||
        !Number.isFinite(item.size) ||
        item.size < 0 ||
        !/^[a-f0-9]{64}$/.test(item.sha256 || '') ||
        index.has(item.pii_id) ||
        retainedIndex.has(item.pii_id) ||
        seenPaths.has(item.repo_relpath)
      ) {
        return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'pii-path-map.json contains an invalid or duplicate identity' };
      }
      try {
        assertUnderRoot(path.join(clientRoot, item.repo_relpath), clientRoot);
      } catch {
        return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'pii-path-map.json contains a path outside the client root' };
      }
      destination.set(item.pii_id, item);
      seenPaths.add(item.repo_relpath);
    }
  }
  for (const item of retiredEntries) {
    if (
      !item ||
      typeof item.pii_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.pii_id) ||
      typeof item.private_remote_relpath !== 'string' ||
      !Number.isFinite(item.size) ||
      item.size < 0 ||
      !/^[a-f0-9]{64}$/.test(item.sha256 || '') ||
      !Number.isFinite(Date.parse(item.retired_at)) ||
      index.has(item.pii_id) ||
      retainedIndex.has(item.pii_id) ||
      retiredIndex.has(item.pii_id) ||
      seenPaths.has(item.private_remote_relpath)
    ) {
      return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'pii-path-map.json contains an invalid retired identity' };
    }
    try {
      assertUnderRoot(path.join(clientRoot, item.private_remote_relpath), clientRoot);
    } catch {
      return { ok: false, code: EXIT_CODES.PII_MAP_DRIFT, reason: 'pii-path-map.json contains a retired path outside the client root' };
    }
    retiredIndex.set(item.pii_id, item);
    seenPaths.add(item.private_remote_relpath);
  }
  return { ok: true, map, mapPath, index, retainedIndex, retiredIndex };
}

function validatePiiPublicMembership(publicEntries, piiIndex) {
  const publicPii = (publicEntries || []).filter((entry) => entry && entry.klass === 'PII-MOVE');
  if (publicPii.length !== piiIndex.size) {
    return {
      ok: false,
      code: EXIT_CODES.PII_MAP_DRIFT,
      reason: 'public PII entry count does not exactly match the bound private path map'
    };
  }
  const seenIds = new Set();
  for (const entry of publicPii) {
    const mapped = piiIndex.get(entry.pii_id);
    if (
      !mapped ||
      seenIds.has(entry.pii_id) ||
      mapped.size !== entry.size ||
      mapped.sha256.slice(0, 8) !== entry.sha256_prefix
    ) {
      return {
        ok: false,
        code: EXIT_CODES.PII_MAP_DRIFT,
        reason: 'public PII identities or attributes do not exactly match the bound private path map'
      };
    }
    seenIds.add(entry.pii_id);
  }
  return { ok: true };
}

const CLASSIFY_V2_SCHEMA = 'ClientStorageClassify/2.0';
const CLASSIFY_V1_SCHEMA = 'ClientStorageClassify/1.0';
const CLASSIFICATION_DECISIONS_SCHEMA = 'ClientStorageClassificationDecisions/1.0';
const SOURCE_SNAPSHOT_SCHEMA = 'ClientStorageSourceSnapshot/1.0';
const SEMANTIC_BUCKETS_BY_CLASS = {
  KEEP: new Set(['CORE-METADATA', 'EXECUTABLE-AUTOMATION', 'REUSABLE-SOURCE']),
  MOVE: new Set(['HISTORICAL-REFERENCE']),
  'PII-MOVE': new Set(['HISTORICAL-REFERENCE']),
  'DEFERRED-DIRTY': new Set(['REVIEW']),
  'SKIP-STUB': new Set(['HISTORICAL-REFERENCE']),
  REVIEW: new Set(['REVIEW'])
};

function exactNumericMap(actual, expected) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) =>
      key === expectedKeys[index] && Number.isFinite(actual[key]) && actual[key] === expected[key]
    );
}

function sha256FileSync(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(filePath, 'r');
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function sourceSnapshotPath(clientCode, repoRoot = REPO_ROOT) {
  return path.join(repoRoot, 'clients', clientCode, 'source-snapshot.json');
}

function loadValidatedSourceSnapshot(clientCode, repoRoot = REPO_ROOT) {
  const snapshotPath = sourceSnapshotPath(clientCode, repoRoot);
  if (!fs.existsSync(snapshotPath)) return null;
  const policy = loadClientStoragePolicy(clientCode, repoRoot);
  if (!policy.privateSourceSnapshotEnabled) {
    throw new Error('private ignored-source snapshots are not enabled by client storage policy');
  }
  const raw = fs.readFileSync(snapshotPath);
  let document;
  try {
    document = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('private source snapshot is not valid JSON');
  }
  if (
    document.schema !== SOURCE_SNAPSHOT_SCHEMA ||
    document.client !== clientCode ||
    !Array.isArray(document.entries)
  ) {
    throw new Error('private source snapshot schema, client, or entries are invalid');
  }

  const clientRoot = path.join(repoRoot, 'clients', clientCode);
  const stableIgnoredRepoPaths = new Set();
  const ignoredCandidates = [];
  const seen = new Set();
  for (const entry of document.entries) {
    const relPath = entry && entry.relpath;
    const normalized = typeof relPath === 'string' ? relPath.split('\\').join('/') : '';
    if (
      !normalized ||
      path.isAbsolute(normalized) ||
      normalized === '..' ||
      normalized.startsWith('../') ||
      normalized.includes('/../') ||
      isPrivateControlRelPath(normalized) ||
      seen.has(normalized) ||
      !Number.isInteger(entry.size) ||
      entry.size < 0 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256 || '')
    ) {
      throw new Error('private source snapshot contains an invalid or duplicate entry');
    }
    seen.add(normalized);
    const absPath = path.join(clientRoot, normalized);
    let stat;
    try {
      stat = fs.statSync(absPath);
    } catch {
      throw new Error('private source snapshot target is missing');
    }
    if (!stat.isFile() || stat.size !== entry.size || sha256FileSync(absPath) !== entry.sha256) {
      throw new Error('private source snapshot content drifted; regenerate it before classification');
    }
    const repoRelPath = path.normalize(path.relative(repoRoot, absPath));
    stableIgnoredRepoPaths.add(repoRelPath);
    ignoredCandidates.push(repoRelPath);
  }

  const ignored = spawnSync('git', ['check-ignore', '-z', '--stdin'], {
    cwd: repoRoot,
    input: Buffer.from(`${ignoredCandidates.join('\0')}\0`),
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024
  });
  if (![0, 1].includes(ignored.status) || ignored.error) {
    throw new Error('unable to validate private source snapshot ignore state');
  }
  const confirmedIgnored = new Set(
    ignored.stdout.toString('utf8').split('\0').filter(Boolean).map((value) => path.normalize(value))
  );
  if (confirmedIgnored.size !== stableIgnoredRepoPaths.size ||
      [...stableIgnoredRepoPaths].some((value) => !confirmedIgnored.has(value))) {
    throw new Error('private source snapshot may authorize only currently ignored files');
  }

  return {
    stableIgnoredRepoPaths,
    binding: {
      required: true,
      schema: SOURCE_SNAPSHOT_SCHEMA,
      client: clientCode,
      entry_count: document.entries.length,
      total_bytes: document.entries.reduce((sum, entry) => sum + entry.size, 0),
      sha256: crypto.createHash('sha256').update(raw).digest('hex')
    }
  };
}

function validateSourceSnapshotBinding(report, repoRoot = REPO_ROOT) {
  const binding = report && report.source_snapshot_binding;
  let current;
  try {
    current = loadValidatedSourceSnapshot(report && report.client, repoRoot);
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  if (!current && (binding === null || binding === undefined)) return { ok: true };
  if (!current || !binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return { ok: false, reason: 'classification source-snapshot binding presence drifted' };
  }
  if (
    binding.required !== current.binding.required ||
    binding.schema !== current.binding.schema ||
    binding.client !== current.binding.client ||
    binding.entry_count !== current.binding.entry_count ||
    binding.total_bytes !== current.binding.total_bytes ||
    binding.sha256 !== current.binding.sha256
  ) {
    return { ok: false, reason: 'classification source-snapshot binding does not match the current private snapshot' };
  }
  return { ok: true };
}

/**
 * Validate the versioned semantic classification contract shared by
 * preflight and migrate. V1 execution compatibility is deliberately closed:
 * every legacy report must be regenerated by the V2 semantic classifier.
 * V2 must be complete and internally count/byte consistent.
 */
function validateClassificationDecisionsBinding(report, repoRoot = REPO_ROOT) {
  const clientCode = report && report.client;
  const binding = report && report.classification_decisions_binding;
  if (typeof clientCode !== 'string' || !clientCode) {
    return { ok: false, reason: 'classification report client is missing' };
  }

  const decisionsPath = path.join(repoRoot, 'clients', clientCode, 'classification-decisions.json');
  const decisionsExist = fs.existsSync(decisionsPath);
  if (!decisionsExist && (binding === null || binding === undefined)) return { ok: true };
  if (!decisionsExist) {
    return { ok: false, reason: 'classification decision binding exists but its decision file is missing' };
  }
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return { ok: false, reason: 'classification decision file exists but the report binding is missing' };
  }

  let raw;
  let document;
  try {
    raw = fs.readFileSync(decisionsPath);
    document = JSON.parse(raw.toString('utf8'));
  } catch {
    return { ok: false, reason: 'classification decision file is unreadable or malformed' };
  }
  if (
    document.schema !== CLASSIFICATION_DECISIONS_SCHEMA ||
    document.client !== clientCode ||
    !Array.isArray(document.decisions)
  ) {
    return { ok: false, reason: 'classification decision file schema, client, or decisions are invalid' };
  }

  const currentHash = crypto.createHash('sha256').update(raw).digest('hex');
  if (
    binding.required !== true ||
    binding.schema !== CLASSIFICATION_DECISIONS_SCHEMA ||
    binding.client !== clientCode ||
    binding.entry_count !== document.decisions.length ||
    binding.sha256 !== currentHash
  ) {
    return { ok: false, reason: 'classification decision binding does not match the current decision file' };
  }
  return { ok: true };
}

function validateClassifyReportSemantics(report, options = {}) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.entries)) {
    return { ok: false, reason: 'classification report entries are missing or malformed' };
  }

  if (report.schema === CLASSIFY_V1_SCHEMA) {
    return {
      ok: false,
      code: 'LEGACY_RECLASSIFICATION_REQUIRED',
      reason: 'LEGACY_RECLASSIFICATION_REQUIRED: ClientStorageClassify/1.0 cannot authorize preflight or migration; run the V2 semantic classifier'
    };
  }

  if (report.schema !== CLASSIFY_V2_SCHEMA) {
    return { ok: false, reason: 'classification schema is unsupported or missing; reclassify with the semantic classifier' };
  }

  const classCounts = {};
  const classBytes = {};
  const semanticCounts = {};
  const semanticBytes = {};
  for (const entry of report.entries) {
    const allowedBuckets = entry && SEMANTIC_BUCKETS_BY_CLASS[entry.klass];
    if (
      !allowedBuckets ||
      !allowedBuckets.has(entry.semantic_bucket) ||
      typeof entry.basis !== 'string' ||
      entry.basis.trim() === '' ||
      !Number.isInteger(entry.size) ||
      entry.size < 0
    ) {
      return { ok: false, reason: 'V2 classification entry semantic fields, basis, class, or size are incomplete' };
    }
    classCounts[entry.klass] = (classCounts[entry.klass] || 0) + 1;
    classBytes[entry.klass] = (classBytes[entry.klass] || 0) + entry.size;
    semanticCounts[entry.semantic_bucket] = (semanticCounts[entry.semantic_bucket] || 0) + 1;
    semanticBytes[entry.semantic_bucket] = (semanticBytes[entry.semantic_bucket] || 0) + entry.size;
  }
  if (
    !exactNumericMap(report.counts, classCounts) ||
    !exactNumericMap(report.bytes, classBytes) ||
    !exactNumericMap(report.semantic_counts, semanticCounts) ||
    !exactNumericMap(report.semantic_bytes, semanticBytes) ||
    report.total_files !== report.entries.length ||
    report.total_bytes !== report.entries.reduce((sum, entry) => sum + entry.size, 0)
  ) {
    return { ok: false, reason: 'V2 classification counts, bytes, or totals do not match its entries' };
  }
  // DEFERRED-DIRTY intentionally carries semantic REVIEW but is already
  // excluded from migratable entries and bytes. Only the explicit REVIEW
  // class represents unresolved classification ambiguity.
  if ((classCounts.REVIEW || 0) > 0) {
    return { ok: false, reason: 'classification contains unresolved REVIEW entries; resolve and reclassify before migration' };
  }
  const decisionBinding = validateClassificationDecisionsBinding(report, options.repoRoot || REPO_ROOT);
  if (!decisionBinding.ok) return decisionBinding;
  const sourceSnapshotBinding = validateSourceSnapshotBinding(report, options.repoRoot || REPO_ROOT);
  if (!sourceSnapshotBinding.ok) return sourceSnapshotBinding;
  return { ok: true, contract: 'semantic-v2' };
}

// Shared MOVE/PII-MOVE entry -> real {relPath, absPath} recovery. PII uses a
// unique opaque ID bound to the ignored private map; content hashes are
// validation attributes, never path selectors, so identical files remain
// independently executable.
function recoverEntryPath(entry, clientRoot, piiIndex) {
  if (entry.klass === 'MOVE') {
    return { relPath: entry.relpath, absPath: path.join(clientRoot, entry.relpath) };
  }
  const mapped = piiIndex.get(entry.pii_id);
  if (!mapped) {
    throw new Error('PII-MOVE opaque identity is missing from the bound private path map');
  }
  if (mapped.size !== entry.size || mapped.sha256.slice(0, 8) !== entry.sha256_prefix) {
    throw new Error('PII-MOVE public identity does not match the bound private path-map attributes');
  }
  return {
    relPath: mapped.repo_relpath,
    absPath: path.join(clientRoot, mapped.repo_relpath),
    expectedSha256: mapped.sha256
  };
}

// Locate classify machine-JSON reports for a client under the reports dir,
// newest first (by filename timestamp, which sorts lexicographically since
// nowUtcStamp() is ISO-based).
function findClassifyReports(clientCode) {
  if (!fs.existsSync(CLIENT_STORAGE_REPORTS_DIR)) return [];
  const prefix = `${clientCode}__classify__`;
  return fs
    .readdirSync(CLIENT_STORAGE_REPORTS_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .sort()
    .reverse()
    .map((name) => path.join(CLIENT_STORAGE_REPORTS_DIR, name));
}

// A helper's presence is never credential evidence. OneDrive Graph access is
// enabled only when the exact registered named profile is complete.
function hasGraphCredentialsConfigured(profile, env = process.env) {
  if (typeof profile !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile)) return false;
  const encoded = Buffer.from(profile.toLowerCase(), 'utf8').toString('hex').toUpperCase();
  const prefix = `MS_GRAPH_PROFILE_${encoded}`;
  return Boolean(
    env[`${prefix}_ACCESS_TOKEN`] ||
    env[`${prefix}_CLIENT_ID`] && env[`${prefix}_CLIENT_SECRET`] && env[`${prefix}_REFRESH_TOKEN`]
  );
}

function parseArgs(argv, { flags = [], valued = [] } = {}) {
  const out = { _: [] };
  for (const f of flags) out[f] = false;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (flags.includes(a.replace(/^--/, ''))) {
      out[a.replace(/^--/, '')] = true;
    } else if (valued.includes(a.replace(/^--/, ''))) {
      const key = a.replace(/^--/, '');
      out[key] = args[++i];
    } else {
      out._.push(a);
    }
  }
  return out;
}

module.exports = {
  REPO_ROOT,
  CLOUD_STORAGE_DIR,
  CLIENT_STORAGE_REPORTS_DIR,
  EXIT_CODES,
  EXIT_NAMES,
  PREFLIGHT_MAX_AGE_MS,
  HAZARD_MOUNT_FRAGMENTS,
  DEFAULT_MIN_FREE_DISK_GB,
  CLASSIFICATION_POLICY_FIELD,
  CODE_EXTENSIONS,
  CODE_TREE_MARKER_FILES,
  CODE_TREE_DIR_SEGMENTS,
  STUB_EXTENSIONS,
  ARTIFACT_OUTPUT_EXTENSIONS,
  ARTIFACT_CONTEXT_SEGMENT,
  PRIVATE_CONTROL_RELPATHS,
  PRIVATE_CONTROL_PREFIXES,
  ALWAYS_KEEP_RELPATHS,
  INVIOLABLE_ROOT_CONTROL_RELPATHS,
  ALWAYS_KEEP_GLOBS,
  nowUtcStamp,
  emitStatus,
  fail,
  clientJsonPath,
  clientRootPath,
  readClientJson,
  loadClientStoragePolicy,
  mountDirNameFor,
  normalizedMacPathIdentity,
  isHazardMountName,
  resolveStorageRoot,
  assertUnderRoot,
  shallowConflictScan,
  sha256File,
  hashFile,
  quickXorHashFile,
  sha256Prefix8,
  atomicWritableProbe,
  getLocalFreeDiskGB,
  globToRegExp,
  matchesAnyGlob,
  isPrivateControlRelPath,
  walkClientTree,
  findCodeTreeDirs,
  isUnderAnyMarkerDir,
  hasCodeTreeSegment,
  isArtifactOutputPath,
  isGitDirty,
  buildGitDirtyChecker,
  buildGitDirtyCheckerWithSnapshot,
  lintOneDriveTargetPath,
  ensureReportsDir,
  writeAtomic,
  loadStorageMap,
  newStorageMap,
  renameMapPath,
  loadRenameMap,
  writeRenameMap,
  piiPathMapPath,
  loadPiiPathMap,
  writePiiPathMap,
  validatePiiPathMapBinding,
  validatePiiPublicMembership,
  CLASSIFY_V1_SCHEMA,
  CLASSIFY_V2_SCHEMA,
  CLASSIFICATION_DECISIONS_SCHEMA,
  SOURCE_SNAPSHOT_SCHEMA,
  sha256FileSync,
  sourceSnapshotPath,
  loadValidatedSourceSnapshot,
  validateSourceSnapshotBinding,
  validateClassificationDecisionsBinding,
  validateClassifyReportSemantics,
  recoverEntryPath,
  findClassifyReports,
  hasGraphCredentialsConfigured,
  parseArgs
};
