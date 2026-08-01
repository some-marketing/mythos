#!/usr/bin/env node
'use strict';
/*
 * tools/backup/rotate-age-key.cjs
 *
 * Age-key rotation migration helper for the internxt-*.sh backup scripts in
 * this directory.
 *
 * DESTRUCTIVE TOOL. Given an AgeKeyMigration/1.0 inventory (enriched with
 * Internxt file/folder uuids), re-encrypts every existing backup object from
 * the OLD age recipient to the NEW one, then performs a VERIFIED permanent
 * purge of the old ciphertext. Every action is appended to an
 * AgeKeyMigrationLedger/1.0 JSONL ledger. Without --execute it only PRINTS
 * a dry-run plan — no network calls, no writes, no ledger.
 *
 * Fully uuid-based, via the Internxt CLI — it does NOT rely on rclone overwrite
 * semantics. (The Internxt rclone backend has no hashes and a ~100-year modtime
 * precision, so `rclone copyto` SKIPS a same-size overwrite entirely; a re-encrypt
 * of the same plaintext is the same size, so rclone never replaces it. Uploading
 * via `internxt upload-file` instead always creates a distinct object with a new
 * uuid, preserving the name.) Per object the helper:
 *   1. surveys every same-name copy in the parent folder AND trash, downloading
 *      each BY UUID and classifying it by which age key decrypts it;
 *   2. if an old-key copy is the only source, decrypts(old, last legit use) ->
 *      encrypts(new) -> uploads(new, distinct uuid) -> re-surveys;
 *   3. keeps exactly the one new-key copy whose plaintext checksum matches, and
 *      permanently deletes (by uuid) every old-key copy and any stray duplicate;
 *   4. re-surveys and verifies exactly the kept copy remains and NOTHING decrypts
 *      with the old key. It STOPS (no old-key removal) on any ambiguity.
 * It is IDEMPOTENT/resumable: an already-migrated object is detected and skipped.
 *
 * ALL plaintext handling happens inside a vaporizing workspace (RAM-backed via
 * hdiutil when available, else a chmod-700 mktemp dir; removed on exit/SIGINT/SIGTERM).
 *
 * Usage:
 *   node tools/backup/rotate-age-key.cjs --inventory <path> [--execute]
 *     (no --execute)   strict DRY-RUN: prints the per-object action plan; no network, no ledger.
 *     --execute        performs migrate/verify/purge per the inventory dispositions.
 *   --old-key <path>   old age identity file (default: <repo>/.backup-keys/old-age-key.key)
 *   --recipient-file <path>  new recipient .pub (default: tools/backup/age-recipient-v2.pub,
 *                            resolved next to this script)
 *   --keychain-service <s>   keychain service for the new private key
 *                            (default: env AGE_KEYCHAIN_SERVICE or 'backup-age-key-v2')
 *   --keychain-account <a>   keychain account
 *                            (default: env AGE_KEYCHAIN_ACCOUNT or 'backup-tool')
 *   --ledger <path>    ledger JSONL (default: <repo>/.backup-reports/age-key-migration-ledger.jsonl)
 *   --sigint-test      internal SIGINT vaporization test hook (no network, no ledger).
 *
 * Safety: DESTRUCTIVE remote operations (upload, permanent delete) run ONLY under
 * --execute. Treat --execute as an operator-gated action — read the dry-run output
 * first, every time. See SETUP.md in this directory.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ---- arg parsing ----------------------------------------------------------
function parseArgs(argv) {
  const a = {
    inventory: null,
    execute: false,
    oldKey: path.join(REPO_ROOT, '.backup-keys', 'old-age-key.key'),
    recipientFile: path.join(__dirname, 'age-recipient-v2.pub'),
    keychainService: process.env.AGE_KEYCHAIN_SERVICE || 'backup-age-key-v2',
    keychainAccount: process.env.AGE_KEYCHAIN_ACCOUNT || 'backup-tool',
    ledger: path.join(REPO_ROOT, '.backup-reports', 'age-key-migration-ledger.jsonl'),
    sigintTest: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    switch (t) {
      case '--inventory': a.inventory = argv[++i]; break;
      case '--execute': a.execute = true; break;
      case '--old-key': a.oldKey = argv[++i]; break;
      case '--recipient-file': a.recipientFile = argv[++i]; break;
      case '--keychain-service': a.keychainService = argv[++i]; break;
      case '--keychain-account': a.keychainAccount = argv[++i]; break;
      case '--ledger': a.ledger = argv[++i]; break;
      case '--sigint-test': a.sigintTest = true; break;
      case '-h': case '--help': a.help = true; break;
      default: throw new Error(`unknown argument: ${t}`);
    }
  }
  return a;
}

// ---- network guard (tests set ROTATE_AGE_NET_REFUSE=1) ---------------------
function netRefused() { return process.env.ROTATE_AGE_NET_REFUSE === '1'; }
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1e9, ...opts });
  if (r.error) throw r.error;
  return r;
}
function runInternxt(args) {
  if (netRefused()) throw new Error(`network refused (ROTATE_AGE_NET_REFUSE): internxt ${args.join(' ')}`);
  return run('internxt', args);
}
function runRclone(args) {
  if (netRefused()) throw new Error(`network refused (ROTATE_AGE_NET_REFUSE): rclone ${args.join(' ')}`);
  return run('rclone', args);
}

// ---- bounded retry for transient (server/network) failures ----------------
// Classifies the transient error class: timeouts, resets, 5xx, DNS, rate limits.
// The Internxt CLI surfaces its server flake as e.g. "Operation `users.findOne()`
// buffering timed out after 10000ms". Non-transient errors (not found, auth, bad
// input) are NEVER retried — they must STOP immediately.
const TRANSIENT_RE = /timed?\s*out|timeout|buffering timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang ?up|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|EPIPE|network error|temporarily unavailable|rate.?limit|\b5\d\d\b|service unavailable|bad gateway|gateway timeout/i;
function isTransient(text) { return TRANSIENT_RE.test(String(text == null ? '' : text)); }
function getRetryDelays() {
  return (process.env.ROTATE_AGE_RETRY_DELAYS || '5000,15000,45000').split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
}
function sleepSync(ms) { if (ms > 0) spawnSync('sleep', [String(ms / 1000)]); }
// Retry an idempotent thunk on transient failure only. Rethrows non-transient at once.
function withRetry(label, thunk) {
  const delays = getRetryDelays();
  let lastErr;
  for (let i = 0; i <= delays.length; i++) {
    try { return thunk(); }
    catch (e) {
      lastErr = e;
      if (!isTransient(e && e.message) || i === delays.length) throw e;
      process.stderr.write(`[retry] ${label}: transient (${String(e.message).slice(0, 70)}); attempt ${i + 1}/${delays.length} backoff ${delays[i]}ms\n`);
      sleepSync(delays[i]);
    }
  }
  throw lastErr;
}

// ---- vaporizing workspace -------------------------------------------------
let _workspaces = [];
function makeWorkspace() {
  let dir = null;
  let ramDevice = null;
  if (process.platform === 'darwin' && process.env.ROTATE_AGE_NO_RAMDISK !== '1') {
    try {
      const sectors = 2048 * 2048; // 2 GiB in 512-byte sectors (largest object ~300 MiB, several copies)
      const attach = run('hdiutil', ['attach', '-nomount', `ram://${sectors}`]);
      if (attach.status === 0) {
        ramDevice = attach.stdout.trim().split(/\s+/)[0];
        const vol = `backup-agerot-${process.pid}-${Date.now()}`;
        const fmt = run('diskutil', ['erasevolume', 'HFS+', vol, ramDevice]);
        if (fmt.status === 0 && fs.existsSync(`/Volumes/${vol}`)) {
          dir = fs.mkdtempSync(`/Volumes/${vol}/ws-`);
        } else {
          try { run('hdiutil', ['detach', ramDevice]); } catch (_) {}
          ramDevice = null;
        }
      }
    } catch (_) { ramDevice = null; dir = null; }
  }
  if (!dir) dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-agerot-'));
  fs.chmodSync(dir, 0o700);
  const ws = { dir, ramDevice };
  _workspaces.push(ws);
  return ws;
}
function vaporize(ws) {
  if (!ws) return;
  try { if (ws.dir && fs.existsSync(ws.dir)) fs.rmSync(ws.dir, { recursive: true, force: true }); } catch (_) {}
  if (ws.ramDevice) {
    try { spawnSync('hdiutil', ['detach', '-force', ws.ramDevice], { encoding: 'utf8' }); } catch (_) {}
    ws.ramDevice = null;
  }
  _workspaces = _workspaces.filter((w) => w !== ws);
}
function vaporizeAll() { for (const ws of [..._workspaces]) vaporize(ws); }
let _cleanupInstalled = false;
function installCleanup() {
  if (_cleanupInstalled) return;
  _cleanupInstalled = true;
  process.on('exit', vaporizeAll);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { vaporizeAll(); process.exit(sig === 'SIGINT' ? 130 : 143); });
  }
}

// ---- single-instance lock -------------------------------------------------
// Prevents two concurrent --execute runs from racing the same objects (a second
// instance could re-upload/re-delete mid-migration). Machine-local lock in tmpdir.
const LOCK_PATH = path.join(os.tmpdir(), 'backup-rotate-age-key.execute.lock');
function isProcessAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function acquireLock(lockPath = LOCK_PATH) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    const fd = fs.openSync(lockPath, 'wx'); // exclusive create — fails if held
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
    fs.closeSync(fd);
    return lockPath;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let holder = null;
    try { holder = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (_) {}
    if (holder && holder.pid && isProcessAlive(holder.pid)) {
      throw new Error(`another rotate-age-key --execute is already running (pid ${holder.pid}, since ${holder.ts}). Refusing concurrent run.`);
    }
    // stale lock (holder dead) — reclaim it
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), reclaimed_from: holder }));
    return lockPath;
  }
}
function releaseLock(lockPath = LOCK_PATH) {
  try {
    // only remove if we still own it
    const holder = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (holder && holder.pid === process.pid) fs.rmSync(lockPath, { force: true });
  } catch (_) {}
}

// ---- crypto helpers -------------------------------------------------------
function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function readNewRecipient(recipientFile) {
  const txt = fs.readFileSync(recipientFile, 'utf8');
  const line = txt.split('\n').find((l) => l.trim().startsWith('age1'));
  if (!line) throw new Error(`no age recipient in ${recipientFile}`);
  return line.trim();
}
function materializeNewKey(ws, account, service) {
  const r = run('security', ['find-generic-password', '-a', account, '-s', service, '-w']);
  if (r.status !== 0 || !r.stdout || !r.stdout.trim()) {
    throw new Error(`new age key not found in keychain (account ${account}, service ${service})`);
  }
  const p = path.join(ws.dir, 'new-identity.key');
  fs.writeFileSync(p, r.stdout.replace(/\n+$/, '') + '\n', { mode: 0o600 });
  return p;
}
function tryDecrypt(cipherPath, identityFile, outPath) {
  const r = run('age', ['-d', '-i', identityFile, '-o', outPath, cipherPath]);
  return r.status === 0 ? outPath : null;
}
// Classify a ciphertext: which key decrypts it, and its plaintext sha.
function classifyCipher(cipherPath, oldKeyFile, newKeyFile, ws, tag) {
  const oldOut = path.join(ws.dir, `cls-old-${tag}`);
  const newOut = path.join(ws.dir, `cls-new-${tag}`);
  const oldReadable = !!tryDecrypt(cipherPath, oldKeyFile, oldOut);
  const newReadable = !!tryDecrypt(cipherPath, newKeyFile, newOut);
  let sha = null;
  if (newReadable) sha = sha256File(newOut);
  else if (oldReadable) sha = sha256File(oldOut);
  try { if (fs.existsSync(oldOut)) fs.rmSync(oldOut); } catch (_) {}
  try { if (fs.existsSync(newOut)) fs.rmSync(newOut); } catch (_) {}
  return { oldReadable, newReadable, sha };
}

// ---- Internxt CLI wrappers ------------------------------------------------
// Reads are idempotent -> auto-retry the transient-error class with backoff.
function inxtList(folderUuid) {
  return withRetry(`list ${folderUuid}`, () => {
    const r = runInternxt(['list', '-x', '--id', folderUuid, '--json']);
    const j = JSON.parse(r.stdout);
    if (!j.success) throw new Error(`internxt list ${folderUuid}: ${j.message}`);
    return j.list;
  });
}
function inxtTrashList() {
  return withRetry('trash-list', () => {
    const r = runInternxt(['trash-list', '--json']);
    const j = JSON.parse(r.stdout);
    if (!j.success) throw new Error(`internxt trash-list: ${j.message}`);
    return j.list;
  });
}
function inxtDownload(uuid, destDir) {
  return withRetry(`download-file ${uuid}`, () => {
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    const r = runInternxt(['download-file', '-x', '-i', uuid, '-d', destDir, '-o', '--json']);
    const j = JSON.parse(r.stdout);
    if (!j.success) throw new Error(`internxt download-file ${uuid}: ${j.message}`);
    const files = fs.readdirSync(destDir).map((f) => path.join(destDir, f));
    if (!files.length) throw new Error(`download-file ${uuid} produced no file`);
    return files[0];
  });
}
// Replace an object in place. `rclone copyto --ignore-times` is REQUIRED: the
// Internxt rclone backend has no hashes and a ~100-year modtime precision, so a
// plain copyto SKIPS a same-size overwrite (a re-encrypt of the same plaintext is
// the same size). --ignore-times forces the transfer; empirically this HARD-DELETES
// the prior object (new uuid, old uuid gone from folder AND trash — verified).
function rcloneReplace(localPath, remotePath) {
  // --multi-thread-streams 0 is REQUIRED for replace. rclone's multi-thread copy
  // (used above --multi-thread-cutoff, default 256 MiB) fails to REPLACE an existing
  // Internxt object: its "create file metadata" step returns 409 "File already
  // exists" because the old same-name object still exists (multipart minimum on this
  // backend is 100 MiB, so only objects >256 MiB hit the multi-thread path). Single
  // -stream Put replaces cleanly (delete-then-create); verified above 100 MiB.
  // Generous timeouts mirror the large-object producer scripts.
  const r = runRclone(['copyto', '--ignore-times', '--multi-thread-streams', '0',
    '--timeout', '3600s', '--contimeout', '60s', '--retries', '3', '--low-level-retries', '10',
    localPath, remotePath]);
  if (r.status !== 0) throw new Error(`rclone copyto ${remotePath}: ${r.stderr || r.stdout}`);
  return { ok: true, receipt: `rclone copyto --ignore-times --multi-thread-streams 0 -> ${remotePath}` };
}
function inxtDeletePermanent(uuid) {
  const r = runInternxt(['delete-permanently-file', '-x', '-i', uuid, '--json']);
  let j = null; try { j = JSON.parse(r.stdout); } catch (_) {}
  const ok = (j && j.success) || r.status === 0;
  return { ok, receipt: (j && (j.message || JSON.stringify(j))) || (r.stdout || r.stderr || '').trim().slice(0, 300) };
}
function fileFullName(f) { return (f.plainName || '') + (f.type ? '.' + f.type : ''); }

// ---- pure decision logic (unit-tested) ------------------------------------
// Given classified same-name candidates, decide keep/purge/upload. PURE (no I/O).
// candidates: [{ uuid, where, cls:{oldReadable,newReadable,sha} }]
// Returns { error } | { needUpload, keepUuid, purge:[uuid], shaBefore }
function planFromCandidates(candidates, opts = {}) {
  if (!candidates.length) return { error: 'no remote copy found for this object' };
  const unknown = candidates.filter((c) => !c.cls.oldReadable && !c.cls.newReadable);
  if (unknown.length) return { error: `candidate(s) decrypt with neither key (unknown ciphertext): ${unknown.map((c) => c.uuid).join(',')}` };
  const oldCopies = candidates.filter((c) => c.cls.oldReadable);
  const newCopies = candidates.filter((c) => c.cls.newReadable && !c.cls.oldReadable);
  const shaBefore = oldCopies.length ? oldCopies[0].cls.sha : null;
  // all old copies must share one plaintext checksum
  if (oldCopies.length && oldCopies.some((c) => c.cls.sha !== shaBefore)) {
    return { error: 'old-key copies disagree on plaintext checksum' };
  }
  const wantSha = shaBefore != null ? shaBefore : (newCopies.length ? newCopies[0].cls.sha : null);
  const newGood = newCopies.filter((c) => c.cls.sha === wantSha);
  const newBad = newCopies.filter((c) => c.cls.sha !== wantSha);
  if (newBad.length) return { error: `new-key copy checksum mismatch vs source: ${newBad.map((c) => c.uuid).join(',')}` };

  if (newGood.length >= 1) {
    // Already migrated (fully or partially). Keep one; purge old + stray new copies.
    const keepUuid = newGood[0].uuid;
    const purge = [
      ...oldCopies.map((c) => c.uuid),
      ...newGood.slice(1).map((c) => c.uuid),
    ];
    return { needUpload: false, keepUuid, purge, shaBefore: wantSha };
  }
  // No new copy yet: must migrate from an old copy.
  if (!oldCopies.length) return { error: 'no old-key source and no valid new copy' };
  return { needUpload: true, keepUuid: null, purge: oldCopies.map((c) => c.uuid), shaBefore, sourceUuid: oldCopies[0].uuid };
}

// ---- ledger ---------------------------------------------------------------
function ledgerRecord(fields) {
  return {
    ts: new Date().toISOString(),
    remote_path: fields.remote_path ?? null,
    action: fields.action,
    result: fields.result,
    sha256_plain_before: fields.sha256_plain_before ?? null,
    sha256_plain_after: fields.sha256_plain_after ?? null,
    new_recipient: fields.new_recipient ?? null,
    new_key_decrypt_verified: fields.new_key_decrypt_verified ?? false,
    old_readable_after: fields.old_readable_after ?? true,
    trash_purge: fields.trash_purge ?? { verified: null, method_or_receipt: '' },
    version_purge: fields.version_purge ?? { verified: null, method_or_receipt: '' },
    provider_receipt: fields.provider_receipt ?? null,
    notes: fields.notes ?? '',
  };
}
function appendLedger(ledgerPath, rec) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, JSON.stringify(rec) + '\n');
}

// ---- per-object migration + verified purge (execute mode) -----------------
// Survey every same-name copy (folder + trash), download each BY UUID, classify.
function surveyObject(obj, base, ctx, ws) {
  const folder = inxtList(obj.parent_folder_uuid);
  const trash = inxtTrashList();
  const cands = [];
  for (const f of (folder.files || [])) if (fileFullName(f) === base) cands.push({ uuid: f.uuid, where: 'folder' });
  for (const f of (trash.files || [])) if (fileFullName(f) === base) cands.push({ uuid: f.uuid, where: 'trash' });
  for (const c of cands) {
    const dir = path.join(ws.dir, 'srv-' + c.uuid);
    const dl = inxtDownload(c.uuid, dir);
    c.cls = classifyCipher(dl, ctx.oldKey, ctx.newKey, ws, 'srv-' + c.uuid);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  return cands;
}

// Returns { records: [...], stop: bool }.
function migrateObject(obj, ctx) {
  const records = [];
  const ws = makeWorkspace();
  const base = path.basename(obj.remote_path);
  const fail = (action, notes, extra = {}) => { records.push(ledgerRecord({ remote_path: obj.remote_path, action, result: 'fail', new_recipient: ctx.newRecipient, notes, ...extra })); return { records, stop: true }; };
  try {
    let cands = surveyObject(obj, base, ctx, ws);
    let plan = planFromCandidates(cands);
    if (plan.error) return fail('migrate', `survey/plan: ${plan.error}`);

    let shaBefore = plan.shaBefore;
    let keepUuid = plan.keepUuid;

    if (plan.needUpload) {
      // decrypt(old, last legit use) -> encrypt(new) -> upload(new distinct uuid)
      const srcDir = path.join(ws.dir, 'src');
      const srcDl = inxtDownload(plan.sourceUuid, srcDir);
      const plain = path.join(ws.dir, base + '.plain');
      if (!tryDecrypt(srcDl, ctx.oldKey, plain)) return fail('migrate', 'decrypt(old) failed');
      shaBefore = sha256File(plain);
      const cipherNew = path.join(ws.dir, base); // local basename == remote name to preserve it
      const enc = run('age', ['-r', ctx.newRecipient, '-o', cipherNew, plain]);
      if (enc.status !== 0) return fail('migrate', `encrypt(new) failed: ${enc.stderr}`, { sha256_plain_before: shaBefore });

      // Replace, then VERIFY BY RE-SURVEY (ground truth) rather than blind-retrying
      // the write. rcloneReplace is idempotent (copyto same path), so on a transient
      // failure we re-survey; if the new copy did not land and the error was
      // transient, we retry the replace with backoff; a non-transient failure STOPs.
      const delays = getRetryDelays();
      let lastErr = null;
      let up = null;
      for (let attempt = 0; attempt <= delays.length; attempt++) {
        try { up = rcloneReplace(cipherNew, obj.remote_path); lastErr = null; }
        catch (e) { lastErr = e; }
        cands = surveyObject(obj, base, ctx, ws);
        plan = planFromCandidates(cands);
        if (!plan.error && !plan.needUpload && plan.keepUuid) break; // new copy verified present
        if (attempt === delays.length) break;
        if (lastErr && !isTransient(lastErr.message)) break; // non-transient write failure — do not retry
        process.stderr.write(`[retry] replace ${base}: not yet verified${lastErr ? ' (' + String(lastErr.message).slice(0, 60) + ')' : ''}; attempt ${attempt + 1}/${delays.length} backoff ${delays[attempt]}ms\n`);
        sleepSync(delays[attempt]);
      }
      // free large intermediates before proceeding
      for (const p of [plain, cipherNew, srcDir]) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
      if (plan.error) return fail('purge_verify', `post-upload survey: ${plan.error}`);
      if (plan.needUpload || !plan.keepUuid) return fail('migrate', `upload/replace failed or unverified after retries${lastErr ? ': ' + lastErr.message : ' (no new-key copy present)'}`, { sha256_plain_before: shaBefore });
      records.push(ledgerRecord({ remote_path: obj.remote_path, action: 'migrate', result: 'ok', sha256_plain_before: shaBefore, sha256_plain_after: shaBefore, new_recipient: ctx.newRecipient, new_key_decrypt_verified: true, old_readable_after: true, provider_receipt: up ? up.receipt : 'verified by re-survey after transient error', notes: 're-encrypted + replaced object in place via rclone copyto --ignore-times (old object hard-deleted, new uuid)' }));
      keepUuid = plan.keepUuid;
      shaBefore = plan.shaBefore != null ? plan.shaBefore : shaBefore;
    } else {
      records.push(ledgerRecord({ remote_path: obj.remote_path, action: 'migrate', result: 'skipped', sha256_plain_before: shaBefore, sha256_plain_after: shaBefore, new_recipient: ctx.newRecipient, new_key_decrypt_verified: true, old_readable_after: true, notes: 'new-key copy already present (idempotent) — re-encrypt skipped; proceeding to purge' }));
    }

    // PURGE every old-key copy + stray duplicate new copies (all by uuid)
    const receipts = [];
    for (const uuid of plan.purge) {
      const del = inxtDeletePermanent(uuid);
      receipts.push(`${uuid}:${del.ok ? 'ok' : 'FAIL'}:${del.receipt}`);
      records.push(ledgerRecord({ remote_path: obj.remote_path, action: 'delete', result: del.ok ? 'ok' : 'fail', new_recipient: ctx.newRecipient, provider_receipt: del.receipt, old_readable_after: true, notes: `permanent delete of stale/duplicate copy uuid ${uuid}` }));
      if (!del.ok) return fail('purge_verify', `delete-permanently failed for ${uuid}`);
    }

    // VERIFY: re-survey; exactly the kept copy remains, new-key-readable, checksum matches, nothing old-readable
    const post = surveyObject(obj, base, ctx, ws);
    const oldLeft = post.some((c) => c.cls.oldReadable);
    const kept = post.filter((c) => c.uuid === keepUuid && c.cls.newReadable && c.cls.sha === shaBefore);
    const extra = post.filter((c) => c.uuid !== keepUuid);
    const purgeVerified = !oldLeft && kept.length === 1 && extra.length === 0;
    records.push(ledgerRecord({
      remote_path: obj.remote_path,
      action: 'purge_verify',
      result: purgeVerified ? 'ok' : 'fail',
      sha256_plain_before: shaBefore,
      sha256_plain_after: shaBefore,
      new_recipient: ctx.newRecipient,
      new_key_decrypt_verified: kept.length === 1,
      old_readable_after: oldLeft,
      trash_purge: { verified: purgeVerified, method_or_receipt: `internxt delete-permanently-file (${plan.purge.length} uuid(s)); folder+trash re-surveyed by uuid; ${receipts.join(' | ') || 'no stale copies present'}` },
      version_purge: { verified: null, method_or_receipt: 'N/A: Internxt stores no per-file version chain (distinct-object model); no versioned old ciphertext exists to purge' },
      provider_receipt: receipts.join(' | ') || null,
      notes: purgeVerified ? `purge verified: keepUuid ${keepUuid}; sole remaining copy decrypts with NEW key only` : `verify failed: oldLeft=${oldLeft} kept=${kept.length} extra=${extra.length}`,
    }));
    return { records, stop: !purgeVerified };
  } finally {
    vaporize(ws);
  }
}

// Terminal per-object statuses that mean "this object's migration already
// happened and was verified" — a dry-run must never recommend re-running the
// migrate recipe for one of these, even though its disposition still reads
// 'migrate' (disposition is the ORIGINAL plan, status is what actually
// happened since). Kept as an explicit allowlist of known-done states, not
// "anything truthy", so a new status value this helper doesn't yet recognize
// fails safe (still prints the full recipe) rather than silently treating an
// unrecognized status as done.
const COMPLETED_OBJECT_STATUSES = new Set(['migrated_verified']);

// ---- dry-run printing -----------------------------------------------------
function printDryRun(inv, ctx) {
  const alreadyDone = inv.objects.filter((o) => COMPLETED_OBJECT_STATUSES.has(o.status));
  const pending = inv.objects.filter((o) => !COMPLETED_OBJECT_STATUSES.has(o.status));
  console.log('=== rotate-age-key DRY-RUN (no --execute) ===');
  console.log(`inventory:      ${ctx.inventoryPath}`);
  console.log(`old recipient:  ${inv.old_recipient || '(from old key file)'}`);
  console.log(`new recipient:  ${ctx.newRecipient}`);
  console.log(`old key file:   ${ctx.oldKey}${fs.existsSync(ctx.oldKey) ? '' : ' (already removed from disk)'}`);
  console.log(`new key:        keychain ${ctx.keychainAccount}/${ctx.keychainService}`);
  console.log(`ledger (would): ${ctx.ledger}`);
  console.log(`objects:        ${inv.objects.length} (${alreadyDone.length} already migrated+verified, ${pending.length} pending)`);
  console.log('');
  for (const obj of inv.objects) {
    if (COMPLETED_OBJECT_STATUSES.has(obj.status)) {
      console.log(`- ALREADY MIGRATED+VERIFIED (nothing to do) ${obj.remote_path}`);
      console.log(`    status=${obj.status}${obj.old_key_readable === false ? ', old_key_readable=false' : ''}${obj.new_key_readable === true ? ', new_key_readable=true' : ''} — re-running the migrate recipe on this object is not recommended; verify-only if you need re-confirmation.`);
      continue;
    }
    console.log(`- ${obj.disposition.toUpperCase()} ${obj.remote_path}`);
    console.log(`    survey same-name copies by uuid (folder ${obj.parent_folder_uuid || '?'} + trash) -> classify old/new`);
    console.log(`    if old-only: decrypt(old) -> encrypt(new) -> rclone copyto --ignore-times (replaces in place, old hard-deleted) -> re-survey`);
    console.log(`    keep the verified new-key copy; delete-permanently every old-key + stray copy; re-verify none old-key-readable`);
  }
  console.log('');
  if (pending.length === 0) {
    console.log('DRY-RUN complete. Every inventoried object is already migrated+verified — nothing to do. No network calls made, no remote objects touched, no ledger written.');
  } else {
    console.log('DRY-RUN complete. No network calls made, no remote objects touched, no ledger written.');
    console.log('Re-run with --execute (treat as operator-gated — read this dry-run output first) to perform the migration on the pending object(s) above.');
  }
}

// ---- sigint test hook -----------------------------------------------------
function runSigintTest() {
  installCleanup();
  const ws = makeWorkspace();
  const probe = path.join(ws.dir, 'plaintext-probe');
  fs.writeFileSync(probe, 'SIMULATED-DECRYPTED-PLAINTEXT-should-be-vaporized\n', { mode: 0o600 });
  process.stdout.write(`SIGINT-TEST-READY ${ws.dir} ${probe}\n`);
  setInterval(() => {}, 1 << 30);
}

// ---- main -----------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 46).join('\n')); return 0; }
  if (args.sigintTest) { runSigintTest(); return 0; }

  if (!args.inventory) throw new Error('--inventory <path> is required');
  const inv = JSON.parse(fs.readFileSync(args.inventory, 'utf8'));
  if (inv.schema !== 'AgeKeyMigration/1.0') throw new Error(`unexpected inventory schema: ${inv.schema}`);
  if (!Array.isArray(inv.objects)) throw new Error('inventory.objects must be an array');

  const newRecipient = readNewRecipient(args.recipientFile);
  const ctx = {
    inventoryPath: args.inventory,
    oldKey: args.oldKey,
    newRecipient,
    keychainAccount: args.keychainAccount,
    keychainService: args.keychainService,
    ledger: args.ledger,
    newKey: null,
  };

  if (!args.execute) { printDryRun(inv, ctx); return 0; }

  // ---- EXECUTE (destructive — treat as operator-gated) ----
  installCleanup();
  // Single-instance guard: refuse to run if another --execute holds the lock.
  acquireLock();
  process.on('exit', () => releaseLock());
  if (!fs.existsSync(ctx.oldKey)) throw new Error(`old key file not found: ${ctx.oldKey}`);
  withRetry('whoami', () => {
    const who = runInternxt(['whoami']);
    const text = (who.stdout || '') + (who.stderr || '');
    if (/logged out|expired|Missing credentials|not logged/i.test(text)) {
      throw new Error('Internxt CLI not authenticated (run `internxt login`). Refusing to start.');
    }
    if (who.status !== 0) throw new Error(`internxt whoami failed: ${text.slice(0, 100)}`);
    return true;
  });

  const keyWs = makeWorkspace();
  let stop = false;
  let okCount = 0;
  try {
    ctx.newKey = materializeNewKey(keyWs, ctx.keychainAccount, ctx.keychainService);
    for (const obj of inv.objects) {
      if (COMPLETED_OBJECT_STATUSES.has(obj.status)) {
        appendLedger(ctx.ledger, ledgerRecord({ remote_path: obj.remote_path, action: 'migrate', result: 'skipped', new_recipient: ctx.newRecipient, notes: `status ${obj.status} — already migrated+verified, not re-executed` }));
        continue;
      }
      if (obj.disposition !== 'migrate') {
        appendLedger(ctx.ledger, ledgerRecord({ remote_path: obj.remote_path, action: obj.disposition, result: 'skipped', new_recipient: ctx.newRecipient, notes: `disposition ${obj.disposition} not auto-executed by helper` }));
        continue;
      }
      if (!obj.parent_folder_uuid) {
        appendLedger(ctx.ledger, ledgerRecord({ remote_path: obj.remote_path, action: 'migrate', result: 'fail', new_recipient: ctx.newRecipient, notes: 'inventory object missing parent_folder_uuid enrichment — STOP' }));
        stop = true; break;
      }
      console.error(`[migrate] ${obj.remote_path}`);
      const { records, stop: objStop } = migrateObject(obj, ctx);
      for (const rec of records) appendLedger(ctx.ledger, rec);
      if (objStop) { stop = true; console.error(`STOP at ${obj.remote_path} — see ledger`); break; }
      okCount++;
    }
  } finally {
    vaporize(keyWs);
  }

  if (stop) {
    console.error(`Migration HALTED after ${okCount} object(s). Old key must NOT be removed until every object shows old_readable_after:false with verified purge. Review ${ctx.ledger}.`);
    return 2;
  }
  console.log(`Migration complete: ${okCount} object(s) migrated + purged + verified. Review ${ctx.ledger} before removing the old key.`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main() || 0; }
  catch (e) { console.error('ERROR:', e.message); process.exitCode = 1; }
}

module.exports = { parseArgs, makeWorkspace, vaporize, ledgerRecord, readNewRecipient, sha256File, classifyCipher, tryDecrypt, planFromCandidates, isTransient, withRetry, acquireLock, releaseLock, isProcessAlive, printDryRun, COMPLETED_OBJECT_STATUSES };
