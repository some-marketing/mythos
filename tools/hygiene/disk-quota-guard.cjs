#!/usr/bin/env node

/**
 * Mythos Disk Quota Guard
 * Path: tools/hygiene/disk-quota-guard.cjs
 *
 * Autonomic host disk space monitor, cache purger, and turn-log rotator.
 * Safe, cross-platform, and verified via triadic code review.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, execSync, spawn } = require('child_process');

const DEFAULT_MIN_FREE_GB = 15;
// Cold storage moved to general_storage 2026-07-09: file_storage's APFS container
// shares 1.5TB with a Time Machine volume (832G) and runs 100% full, ENOSPC on
// write. general_storage is a separate empty 500GB partition on the same drive.
const COLD_STORAGE_MOUNT = '/Volumes/general_storage';
const COLD_STORAGE_ARCHIVE_DIR = path.join(COLD_STORAGE_MOUNT, 'SM_OS_archive');
const COLD_STORAGE_TURNS_DIR = path.join(COLD_STORAGE_ARCHIVE_DIR, 'turns');
const COLD_STORAGE_BACKUP_DIR = path.join(COLD_STORAGE_ARCHIVE_DIR, 'backups');
const DEFAULT_LOCAL_BACKUP_KEEP = 7;
const DEFAULT_REMOTE_BACKUP_KEEP = 4;

const LOCAL_WORKSPACE_DIR = '/Users/admin/dev/Mythos-recovered';
const LOCAL_TURNS_DIR = path.join(LOCAL_WORKSPACE_DIR, '_dev/desktop/work/personal/turns');

function getPositiveIntegerEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (rawValue === undefined) return defaultValue;

  const parsedValue = Number(rawValue);
  if (Number.isSafeInteger(parsedValue) && parsedValue > 0) return parsedValue;

  console.warn(`[DiskQuotaGuard] Invalid ${name} value "${rawValue}". Using default ${defaultValue}.`);
  return defaultValue;
}

function selectRotatableFiles(turnsDir, nowMs = Date.now()) {
  const files = [];

  for (const file of fs.readdirSync(turnsDir)) {
    if (!file.endsWith('.jsonl')) continue;

    const filePath = path.join(turnsDir, file);
    try {
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile()) continue;

      const ageDays = (nowMs - stat.mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays > 3) files.push(file);
    } catch (err) {
      console.warn(`[DiskQuotaGuard] Could not inspect turn log ${file}. Skipping it:`, err.message);
    }
  }

  return files;
}

function claimRegularTurnFile(srcPath, claimPath) {
  fs.renameSync(srcPath, claimPath);
  const claimStat = fs.lstatSync(claimPath);
  if (claimStat.isFile()) return claimStat;

  if (!fs.existsSync(srcPath)) {
    fs.renameSync(claimPath, srcPath);
  } else {
    fs.unlinkSync(claimPath);
  }
  return null;
}

function retainNewestBackupArchives(backupDir, keepCount) {
  try {
    const archives = fs.readdirSync(backupDir)
      .filter(file => /^turns-backup-.*\.tar\.gz$/.test(file))
      .map(file => {
        const filePath = path.join(backupDir, file);
        const stat = fs.lstatSync(filePath);
        return stat.isFile() ? { file, filePath, mtimeMs: stat.mtimeMs } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file));

    for (const archive of archives.slice(keepCount)) {
      try {
        fs.unlinkSync(archive.filePath);
        console.log(`[DiskQuotaGuard] Removed expired local backup archive: ${archive.file}`);
      } catch (err) {
        console.warn(`[DiskQuotaGuard] Could not remove expired local backup archive ${archive.file}:`, err.message);
      }
    }
  } catch (err) {
    console.warn('[DiskQuotaGuard] Local backup retention failed:', err.message);
  }
}

/**
 * Check if the external cold storage drive is actively mounted.
 * Validates device ID and physical sentinel presence.
 * @returns {boolean} True if mounted and writeable
 */
function isExternalDriveMounted() {
  try {
    if (!fs.existsSync(COLD_STORAGE_MOUNT)) return false;

    // Check for physical sentinel file on external partition
    const sentinelFile = path.join(COLD_STORAGE_MOUNT, '.mount_sentinel');
    if (!fs.existsSync(sentinelFile)) return false;

    // Validate that device IDs differ (ensuring it is not a folder on the root partition)
    const rootStat = fs.statSync('/');
    const mountStat = fs.statSync(COLD_STORAGE_MOUNT);
    if (rootStat.dev === mountStat.dev) return false;

    // Check write access
    fs.accessSync(COLD_STORAGE_MOUNT, fs.constants.W_OK);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Check if an application is currently running using pgrep.
 * @param {string} appName Name of the application binary
 * @returns {boolean} True if running
 */
function isAppRunning(appName) {
  try {
    const platform = os.platform();
    if (platform === 'darwin' || platform === 'linux') {
      execSync(`pgrep -x "${appName}"`, { stdio: 'ignore' });
      return true; // Exit 0 means matches found
    }
  } catch (err) {
    // Exit code non-zero means process is not running
  }
  return false;
}

/**
 * Retrieve available disk space on the system partition in Gigabytes.
 * Uses native cross-platform fs.statfsSync.
 * @returns {number} Usable free space in GB, or -1 on check failure
 */
function getFreeDiskSpaceGB() {
  try {
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync('/');
      // bavail is usable blocks by non-privileged users (matches df's "available" output, unlike bfree)
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      return freeBytes / (1024 * 1024 * 1024);
    }
  } catch (err) {
    console.warn('[DiskQuotaGuard] Native statfsSync failed, falling back to shell df:', err.message);
  }

  // Fallback to df parser on macOS/Unix if native module fails or is on older Node
  try {
    const platform = os.platform();
    if (platform === 'darwin' || platform === 'linux') {
      const output = execSync('df -k /', { encoding: 'utf8' });
      const lines = output.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        // df -k returns values in KB, available is the 4th column (Index 3)
        const availableKB = parseInt(parts[3], 10);
        if (!isNaN(availableKB)) {
          return availableKB / (1024 * 1024);
        }
      }
    }
  } catch (dfErr) {
    console.error('[DiskQuotaGuard] df fallback failed:', dfErr.message);
  }

  return -1; // Explicit non-zero error indicator (no silent fail-open)
}

/**
 * Perform autonomic cache sweeping of safe, unlocked temporary folders.
 * Respects process liveness boundaries.
 */
function autonomicCacheSweep() {
  console.log('[DiskQuotaGuard] Initiating autonomic cache sweep...');

  // 1. Spotify Cache Purging
  if (!isAppRunning('Spotify')) {
    console.log('[DiskQuotaGuard] Spotify is not running. Purging Spotify stream cache...');
    const spotifyCache = path.join(os.homedir(), 'Library/Caches/com.spotify.client');
    try {
      if (fs.existsSync(spotifyCache)) {
        execSync(`rm -rf "${spotifyCache}"/*`, { stdio: 'ignore' });
        console.log('[DiskQuotaGuard] ✓ Spotify cache purged.');
      }
    } catch (err) {
      console.warn('[DiskQuotaGuard] Spotify cache purge failed:', err.message);
    }
  } else {
    console.log('[DiskQuotaGuard] Spotify is active. Skipping Spotify cache purge to prevent corruption.');
  }

  // 2. Google Chrome Web Cache Purging
  if (!isAppRunning('Google Chrome')) {
    console.log('[DiskQuotaGuard] Google Chrome is not running. Purging web cache...');
    const chromeCache = path.join(os.homedir(), 'Library/Caches/Google/Chrome');
    try {
      if (fs.existsSync(chromeCache)) {
        execSync(`rm -rf "${chromeCache}"/*`, { stdio: 'ignore' });
        console.log('[DiskQuotaGuard] ✓ Chrome cache purged.');
      }
    } catch (err) {
      console.warn('[DiskQuotaGuard] Chrome cache purge failed:', err.message);
    }
  } else {
    console.log('[DiskQuotaGuard] Google Chrome is active. Skipping web cache purge to prevent session freezes.');
  }

  // 3. Package and Development Cache Purges
  try {
    console.log('[DiskQuotaGuard] Purging NPM global package cache...');
    execSync('npm cache clean --force', { stdio: 'ignore' });

    console.log('[DiskQuotaGuard] Purging Python uv cache...');
    execSync('uv cache clean', { stdio: 'ignore' });

    console.log('[DiskQuotaGuard] Running Homebrew pruning cleanup...');
    execSync('brew cleanup -s', { stdio: 'ignore' });

    console.log('[DiskQuotaGuard] ✓ Package development caches cleared.');
  } catch (err) {
    console.warn('[DiskQuotaGuard] Package development cache purges completed with warnings:', err.message);
  }
}

/**
 * Rotate local turns older than 3 days.
 * Moves files to external drive, replaces them with absolute symbolic links for unbroken local indexes,
 * and packs them into a timestamped backup archive to prevent overwriting.
 */
function compressAndRotateLogs() {
  console.log('[DiskQuotaGuard] Starting turn logs rotation and symlinking...');

  if (!isExternalDriveMounted()) {
    console.warn('[DiskQuotaGuard] Cold storage external drive is not mounted. Turns rotation aborted.');
    return;
  }

  if (!fs.existsSync(COLD_STORAGE_TURNS_DIR)) {
    console.warn(`[DiskQuotaGuard] Cold storage turns directory is missing: ${COLD_STORAGE_TURNS_DIR}. Turns rotation aborted.`);
    return;
  }

  if (!fs.existsSync(LOCAL_TURNS_DIR)) {
    console.log('[DiskQuotaGuard] Local turns folder does not exist. Skipping rotation.');
    return;
  }

  let rawFiles;
  try {
    rawFiles = selectRotatableFiles(LOCAL_TURNS_DIR);
  } catch (err) {
    console.warn('[DiskQuotaGuard] Could not scan local turn logs. Turns rotation aborted:', err.message);
    return;
  }

  if (rawFiles.length === 0) {
    console.log('[DiskQuotaGuard] No new turn logs older than 3 days require rotation.');
    return;
  }

  console.log(`[DiskQuotaGuard] Found ${rawFiles.length} files older than 3 days to rotate.`);

  let archivePackage;
  try {
    fs.mkdirSync(COLD_STORAGE_BACKUP_DIR, { recursive: true });

    // Step 1: Migrate files and establish absolute symlinks for unbroken indexing (S5)
    const rotatedFiles = [];
    for (const file of rawFiles) {
      const srcPath = path.join(LOCAL_TURNS_DIR, file);
      const destPath = path.join(COLD_STORAGE_TURNS_DIR, file);
      const claimPath = path.join(LOCAL_TURNS_DIR, `.${file}.${process.pid}.${Date.now()}.rotating`);

      try {
        // Rename is an atomic per-file claim. Concurrent runs either fail here or claim a symlink,
        // which lstat rejects and restores without copying its cold-storage target.
        const claimStat = claimRegularTurnFile(srcPath, claimPath);
        if (!claimStat) {
          console.log(`[DiskQuotaGuard] Turn log ${file} was already rotated by another process. Skipping it.`);
          continue;
        }

        fs.copyFileSync(claimPath, destPath);

        if (fs.existsSync(destPath) && fs.statSync(destPath).size === claimStat.size) {
          fs.symlinkSync(destPath, srcPath);
          rotatedFiles.push(file);
          try {
            fs.unlinkSync(claimPath);
          } catch (cleanupErr) {
            console.warn(`[DiskQuotaGuard] Rotated ${file}, but could not remove its claimed local copy:`, cleanupErr.message);
          }
        } else {
          throw new Error(`Migration verification failed for file: ${file}`);
        }
      } catch (err) {
        if (fs.existsSync(claimPath) && !fs.existsSync(srcPath)) {
          try {
            fs.renameSync(claimPath, srcPath);
          } catch (restoreErr) {
            console.warn(`[DiskQuotaGuard] Could not restore claimed turn log ${file}:`, restoreErr.message);
          }
        }
        console.warn(`[DiskQuotaGuard] Could not rotate turn log ${file}. Skipping it:`, err.message);
      }
    }

    if (rotatedFiles.length === 0) {
      console.warn('[DiskQuotaGuard] No turn logs were rotated successfully. Backup archive and VPS sync skipped.');
      return;
    }

    console.log(`[DiskQuotaGuard] ✓ Absolute symbolic links established for ${rotatedFiles.length} rotated files.`);

    // Step 2: Pack newly rotated files into a timestamped, non-clobbering backup archive (S3)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    archivePackage = path.join(COLD_STORAGE_BACKUP_DIR, `turns-backup-${timestamp}-${process.pid}.tar.gz`);
    console.log(`[DiskQuotaGuard] Compressing rotated logs to: ${archivePackage}`);

    // Stream only this run's rotated files to tar's stdin to bypass shell ARG_MAX limits.
    execFileSync('tar', ['-czf', archivePackage, '--null', '-T', '-'], {
      cwd: COLD_STORAGE_TURNS_DIR,
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      input: `${rotatedFiles.join('\0')}\0`,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const archiveEntries = execFileSync('tar', ['-tzf', archivePackage], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    if (archiveEntries.length === 0) {
      fs.unlinkSync(archivePackage);
      console.warn('[DiskQuotaGuard] Backup archive contained zero entries. Archive removed and VPS sync skipped.');
      return;
    }

    console.log(`[DiskQuotaGuard] ✓ Backup archive package verified successfully with ${archiveEntries.length} entries.`);

    const localKeep = getPositiveIntegerEnv('SMOS_TURNS_BACKUP_KEEP', DEFAULT_LOCAL_BACKUP_KEEP);
    retainNewestBackupArchives(COLD_STORAGE_BACKUP_DIR, localKeep);

    // Trigger cloud VPS sync asynchronously in the background (S4)
    if (fs.existsSync(archivePackage)) {
      const remoteKeep = getPositiveIntegerEnv('SMOS_TURNS_REMOTE_BACKUP_KEEP', DEFAULT_REMOTE_BACKUP_KEEP);
      backgroundCloudSync(archivePackage, remoteKeep);
    } else {
      console.warn('[DiskQuotaGuard] Verified backup archive is no longer present. VPS sync skipped.');
    }
  } catch (err) {
    if (archivePackage && fs.existsSync(archivePackage)) {
      try {
        fs.unlinkSync(archivePackage);
      } catch (cleanupErr) {
        console.warn('[DiskQuotaGuard] Could not remove incomplete backup archive:', cleanupErr.message);
      }
    }
    console.warn('[DiskQuotaGuard] Turns log compression and rotation completed with warnings:', err.message);
  }
}

/**
 * Dispatch the compressed turns archive to the cloud VPS asynchronously in the background.
 * Uses detached child process spawn with unref() to prevent blocking.
 * @param {string} archivePath Local path to the archive
 * @param {number} remoteKeep Number of newest remote archives to retain
 */
function backgroundCloudSync(archivePath, remoteKeep) {
  const remoteHost = 'ubuntu@{VPS_HOST}';
  const remoteDirectory = '~/memory-archive/macbook/';
  const remoteVPS = `${remoteHost}:${remoteDirectory}`;
  console.log(`[DiskQuotaGuard] Dispatching backup archive to VPS (${remoteVPS}) in the background...`);

  let logOut;
  try {
    const syncLogFile = '/tmp/storage-guard-sync.log';
    logOut = fs.openSync(syncLogFile, 'a');

    const remoteCleanup = `cd ${remoteDirectory} && find . -maxdepth 1 -type f -name 'turns-backup-*.tar.gz' -printf '%T@ %f\\n' | sort -nr | awk 'NR > ${remoteKeep} {sub(/^[^ ]+ /, ""); print}' | while IFS= read -r file; do rm -f -- "$file"; done`;
    const syncScript = [
      'scp -o BatchMode=yes -o ConnectTimeout=5 -- "$1" "$2"',
      'scp_status=$?',
      'if [ "$scp_status" -ne 0 ]; then echo "[DiskQuotaGuard] Background cloud VPS sync failed with status $scp_status."; exit 0; fi',
      'ssh -o BatchMode=yes -o ConnectTimeout=5 "$3" "$4"',
      'cleanup_status=$?',
      'if [ "$cleanup_status" -ne 0 ]; then echo "[DiskQuotaGuard] WARNING: Remote backup retention failed with status $cleanup_status."; fi'
    ].join('\n');

    // Run remote retention only after a successful scp.
    const child = spawn(
      'sh',
      ['-c', syncScript, 'disk-quota-guard-sync', archivePath, remoteVPS, remoteHost, remoteCleanup],
      {
        detached: true,
        stdio: ['ignore', logOut, logOut]
      }
    );

    child.once('error', err => {
      console.warn('[DiskQuotaGuard] Background cloud VPS sync dispatch failed:', err.message);
    });

    // Completely untie the child process from Node's event loop
    child.unref();
  } catch (err) {
    console.warn('[DiskQuotaGuard] Background cloud VPS sync dispatch failed:', err.message);
  } finally {
    if (logOut !== undefined) {
      try {
        fs.closeSync(logOut);
      } catch (err) {
        console.warn('[DiskQuotaGuard] Could not close background sync log descriptor:', err.message);
      }
    }
  }
}

/**
 * Main command line controller.
 */
function main() {
  const args = process.argv.slice(2);
  const isCheckOnly = args.includes('--check');
  const isApply = args.includes('--apply');

  console.log('[DiskQuotaGuard] Running system disk quota check...');
  const freeGB = getFreeDiskSpaceGB();
  
  if (freeGB === -1) {
    console.error('[DiskQuotaGuard] CRITICAL: Disk space check failed entirely!');
    process.exit(1); // Explicit monitoring failure signal (no silent fail-open)
  }

  console.log(`[DiskQuotaGuard] Available System Disk Space: ${freeGB.toFixed(2)} GB`);

  // Active turns directory local validation - ONLY written under --apply to keep check read-only (S6)
  if (isApply && !fs.existsSync(LOCAL_TURNS_DIR)) {
    console.log(`[DiskQuotaGuard] Initializing local turns directory structure: ${LOCAL_TURNS_DIR}`);
    fs.mkdirSync(LOCAL_TURNS_DIR, { recursive: true });
  }

  if (freeGB < DEFAULT_MIN_FREE_GB) {
    console.warn(`[DiskQuotaGuard] WARNING: System disk space is below the ${DEFAULT_MIN_FREE_GB} GB threshold!`);
    
    if (isCheckOnly) {
      console.warn('[DiskQuotaGuard] Check-only mode active. Storage safety actions skipped.');
      process.exit(0); // Fail-safe check
    }

    if (isApply) {
      autonomicCacheSweep();
      compressAndRotateLogs();
    }
  } else {
    console.log('[DiskQuotaGuard] Disk space is healthy. No emergency cleaning required.');
    
    // Always run logs rotation on apply, even if space is healthy, to keep files rotated
    if (isApply) {
      compressAndRotateLogs();
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  claimRegularTurnFile,
  getPositiveIntegerEnv,
  retainNewestBackupArchives,
  selectRotatableFiles
};
