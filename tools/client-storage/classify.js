#!/usr/bin/env node
'use strict';

// CLI: classify.js --client CODE [--out FILE]
//
// Dry-run only -- never moves, renames, or deletes anything. Walks
// clients/CODE/ and classifies every file into a migration class plus a
// semantic role, then writes a report (counts, byte totals, full
// listing) to _dev/reports/analysis/client-storage/CODE__classify__<ts>.md
// plus a machine-readable JSON file alongside it.
//
// PII sanitization: any entry classified PII-MOVE never has its filename
// written to a committed-report surface -- only an opaque unique ID, byte
// count, and 8-character sha256 prefix. The ID -> path/checksum binding lives
// in ignored clients/CODE/pii-path-map.json and is hash-bound into the report.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  parseArgs,
  emitStatus,
  fail,
  EXIT_CODES,
  clientRootPath,
  walkClientTree,
  findCodeTreeDirs,
  isUnderAnyMarkerDir,
  hasCodeTreeSegment,
  isArtifactOutputPath,
  matchesAnyGlob,
  buildGitDirtyCheckerWithSnapshot,
  sha256File,
  loadClientStoragePolicy,
  CODE_EXTENSIONS,
  STUB_EXTENSIONS,
  PRIVATE_CONTROL_RELPATHS,
  isPrivateControlRelPath,
  ALWAYS_KEEP_RELPATHS,
  INVIOLABLE_ROOT_CONTROL_RELPATHS,
  ALWAYS_KEEP_GLOBS,
  CLASSIFY_V2_SCHEMA,
  ensureReportsDir,
  writeAtomic,
  writePiiPathMap,
  loadPiiPathMap,
  loadStorageMap,
  validatePiiPublicMembership,
  loadValidatedSourceSnapshot,
  nowUtcStamp,
  REPO_ROOT
} = require('./lib.js');

function printHelp() {
  process.stdout.write(`classify.js -- dry-run file classifier for one client's storage migration

Usage:
  node classify.js --client CODE [--out FILE]

Classes (checked in this order, first match wins):
  KEEP           operational metadata/contracts, executable automation, and
                 reusable source. HTML is retained only when package/source
                 context or template/preset naming establishes reuse.
  SKIP-STUB      .gsheet / .gdoc / .gform / .gsite (pointers, not files).
  DEFERRED-DIRTY tracked-modified or untracked per \`git status --porcelain\`
                 -- never migrate a diverged working copy.
  PII-MOVE       matches a per-client pii_globs entry.
  MOVE           historical/reference material that is safe to externalize.
  REVIEW         ambiguous material (including standalone HTML) -- fail
                 closed and never treat as migratable.

Semantic roles: CORE-METADATA, EXECUTABLE-AUTOMATION, REUSABLE-SOURCE,
HISTORICAL-REFERENCE, and REVIEW. Non-redacted report entries include the
semantic role and the rule basis.

Never writes, renames, or deletes anything. Writes
_dev/reports/analysis/client-storage/CODE__classify__<UTCts>.{md,json}
(plus --out if given, alongside the default report).
Private root control files pii-path-map.json and rename-map.json are excluded
from inventory, counts, bytes, and listings.

PII-MOVE entries never show a filename in the report -- only an opaque UUID,
byte count, and 8-char sha256 prefix. The ignored private path map is bound
into the public report by schema, client, entry count, and content hash.
DEFERRED-DIRTY paths are always report-redacted without reading their content;
KEEP/SKIP paths inside configured PII contexts are report-redacted as well.
`);
}

const STRUCTURED_CONTACT_EXTENSIONS = new Set(['.csv', '.jsonl']);
const JSONL_CONTACT_CORE_KEYS = new Set([
  'city',
  'email',
  'first_name',
  'last_name',
  'phone',
  'postal',
  'street'
]);
const CSV_CRM_CONTACT_SUFFIXES = [
  'address1_city',
  'firstname',
  'lastname',
  'geo_city',
  'ip_address'
];
const CLASSIFICATION_DECISIONS_SCHEMA = 'ClientStorageClassificationDecisions/1.0';
const DECISION_BUCKETS = Object.freeze({
  KEEP: new Set(['CORE-METADATA', 'EXECUTABLE-AUTOMATION', 'REUSABLE-SOURCE']),
  MOVE: new Set(['HISTORICAL-REFERENCE'])
});

function normalizedDecisionRelPath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('classification decision relpath is required');
  const normalized = value.split('\\').join('/');
  if (path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('classification decision relpath must stay within the client root');
  }
  return normalized;
}

function loadClassificationDecisions(clientCode) {
  const filePath = path.join(clientRootPath(clientCode), 'classification-decisions.json');
  if (!fs.existsSync(filePath)) return { filePath, decisions: new Map(), binding: null };
  const raw = fs.readFileSync(filePath);
  const document = JSON.parse(raw.toString('utf8'));
  if (document.schema !== CLASSIFICATION_DECISIONS_SCHEMA || document.client !== clientCode || !Array.isArray(document.decisions)) {
    throw new Error('classification decisions schema/client/decisions are invalid');
  }
  const decisions = new Map();
  for (const decision of document.decisions) {
    const relPath = normalizedDecisionRelPath(decision && decision.relpath);
    const disposition = decision && decision.disposition;
    const semanticBucket = decision && decision.semantic_bucket;
    if (!DECISION_BUCKETS[disposition] || !DECISION_BUCKETS[disposition].has(semanticBucket)) {
      throw new Error(`classification decision for ${relPath} has an invalid disposition/semantic bucket`);
    }
    if (typeof decision.rationale !== 'string' || !decision.rationale.trim()) {
      throw new Error(`classification decision for ${relPath} requires a rationale`);
    }
    if (decisions.has(relPath)) throw new Error(`duplicate classification decision for ${relPath}`);
    decisions.set(relPath, {
      klass: disposition,
      semantic_bucket: semanticBucket,
      basis: `operator-approved classification decision: ${decision.rationale.trim()}`
    });
  }
  return {
    filePath,
    decisions,
    binding: {
      required: true,
      schema: CLASSIFICATION_DECISIONS_SCHEMA,
      client: clientCode,
      entry_count: decisions.size,
      sha256: crypto.createHash('sha256').update(raw).digest('hex')
    }
  };
}

function applyClassificationDecisions(classified, decisionSet) {
  const entries = new Map(classified.map((entry) => [entry.relPath.split('\\').join('/'), entry]));
  for (const [relPath, decision] of decisionSet.decisions) {
    const entry = entries.get(relPath);
    if (!entry) throw new Error(`classification decision target is missing: ${relPath}`);
    if (entry.klass !== 'REVIEW') {
      throw new Error(`classification decision may resolve only REVIEW entries: ${relPath} is ${entry.klass}`);
    }
    Object.assign(entry, decision);
  }
  return classified;
}

function readPrefix(filePath, maxBytes = 2 * 1024 * 1024) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const fileSize = fs.fstatSync(fd).size;
    const size = Math.min(fileSize, maxBytes);
    const buffer = Buffer.alloc(size);
    const bytesRead = fs.readSync(fd, buffer, 0, size, 0);
    return {
      ok: true,
      text: buffer.subarray(0, bytesRead).toString('utf8'),
      truncated: fileSize > bytesRead
    };
  } catch {
    return { ok: false, text: '', truncated: false };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function parseCsvHeader(text) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      break;
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields.map((value) =>
    value
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  );
}

function collectObjectKeys(value, keys, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) collectObjectKeys(item, keys, depth + 1);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    keys.add(key.toLowerCase());
    collectObjectKeys(nested, keys, depth + 1);
  }
}

function inspectStructuredContactDataset(absPath, clientCode, classificationPolicy) {
  const policy = classificationPolicy || loadClientStoragePolicy(clientCode);
  if (!policy.structuredContentProfiles.has('crm-contact-export-v1')) return { status: 'not_applicable' };
  const ext = path.extname(absPath).toLowerCase();
  if (!STRUCTURED_CONTACT_EXTENSIONS.has(ext)) return { status: 'not_applicable' };
  const prefix = readPrefix(absPath);
  if (!prefix.ok) return { status: 'indeterminate' };
  if (!prefix.text && prefix.truncated) return { status: 'indeterminate' };

  if (ext === '.csv') {
    const hasCompleteHeader = /\r|\n/.test(prefix.text);
    if (prefix.truncated && !hasCompleteHeader) return { status: 'indeterminate' };
    const header = parseCsvHeader(prefix.text);
    const exactContactExport = header.includes('email') && header.includes('phone');
    const crmContactExport = CSV_CRM_CONTACT_SUFFIXES.every((suffix) =>
      header.some((column) => column === suffix || column.endsWith(`_${suffix}`))
    );
    return { status: exactContactExport || crmContactExport ? 'sensitive' : 'not_sensitive' };
  }

  const keys = new Set();
  let parsed = 0;
  let parseErrors = 0;
  const lines = prefix.text.split(/\r?\n/);
  if (prefix.truncated && !/[\r\n]$/.test(prefix.text)) lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      collectObjectKeys(JSON.parse(line), keys);
      parsed += 1;
    } catch {
      parseErrors += 1;
    }
    if (parsed >= 200) break;
  }
  if (parseErrors > 0 || (parsed === 0 && (prefix.truncated || prefix.text.trim()))) {
    return { status: 'indeterminate' };
  }
  return {
    status:
      parsed > 0 && [...JSONL_CONTACT_CORE_KEYS].every((key) => keys.has(key))
        ? 'sensitive'
        : 'not_sensitive'
  };
}

function isStructuredContactDataset(absPath, clientCode, classificationPolicy) {
  return inspectStructuredContactDataset(absPath, clientCode, classificationPolicy).status === 'sensitive';
}

const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const EXECUTABLE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.php', '.py', '.sh', '.sql']);
const HISTORICAL_HTML_SEGMENT = /^(?:content[-_]?sources?|archives?|backups?|captures?|snapshots?|exports?|reports?|outputs?)$/i;
// Compound directory names are common in client workspaces. Keep matching
// token-bounded so words such as "presetting" or "backupable" do not acquire
// semantics accidentally. Any bounded *-backup(s) suffix is historical;
// content-source(s) is also historical wherever it occurs as a bounded
// compound phrase.
const HISTORICAL_HTML_COMPOUND_SEGMENT = /(?:^|[-_])content[-_](?:sources?|backups?)(?:$|[-_])|(?:^|[-_])backups?$/i;
const HISTORICAL_HTML_BASENAME = /(?:^|[-_.])(?:post[-_]?content[-_]?backup|content[-_]?source|content[-_]?backup|backup|snapshot|capture)(?:[-_.]|$)/i;
const REUSABLE_HTML_SEGMENT = /^(?:templates?|presets?|components?|layouts?|themes?)$/i;
const REUSABLE_HTML_COMPOUND_SEGMENT = /(?:^|[-_])(?:templates?|presets?|components?|layouts?|themes?)(?:$|[-_])/i;
const REUSABLE_HTML_BASENAME = /(?:^|[-_.])(?:templates?|presets?)(?:[-_.]|$)/i;

function semanticResult(klass, semanticBucket, basis) {
  return { klass, semantic_bucket: semanticBucket, basis };
}

function pathSegments(relPath) {
  return relPath.split(/[\\/]+/).filter(Boolean);
}

function classifyFileDetailed(relPath, absPath, clientCode, markerDirs, dirtyChecker, classificationPolicy) {
  const policy = classificationPolicy || loadClientStoragePolicy(clientCode);
  const isProtected = matchesAnyGlob(relPath, policy.protectedPaths);
  const isAlwaysKeep =
    ALWAYS_KEEP_RELPATHS.has(relPath) ||
    matchesAnyGlob(relPath, ALWAYS_KEEP_GLOBS) ||
    isProtected;
  const ext = path.extname(relPath).toLowerCase();
  const isExplicitSource = CODE_EXTENSIONS.has(ext);
  const isMarkerCode = isUnderAnyMarkerDir(relPath, markerDirs) || hasCodeTreeSegment(relPath);
  const isArtifactOutput = isArtifactOutputPath(relPath);
  const isConfiguredPii = matchesAnyGlob(relPath, policy.piiMatchers);
  const segments = pathSegments(relPath);
  const basename = segments.at(-1) || '';
  const isHtml = HTML_EXTENSIONS.has(ext);
  const isTemplateContract = /(?:^|[\\/])[^\\/]+\.template\.[^\\/]+$/i.test(relPath);
  const isPackageManifest = /(?:^|[\\/])(?:package(?:-lock)?\.json|composer(?:-lock)?\.json)$/i.test(relPath);

  if (INVIOLABLE_ROOT_CONTROL_RELPATHS.has(relPath)) {
    return semanticResult('KEEP', 'CORE-METADATA', 'inviolable root control metadata');
  }
  if (dirtyChecker(absPath)) return semanticResult('DEFERRED-DIRTY', 'REVIEW', 'working-tree state is dirty or untracked');
  if (isConfiguredPii) return semanticResult('PII-MOVE', 'HISTORICAL-REFERENCE', 'configured PII path requires private externalization');
  if (isAlwaysKeep) {
    return semanticResult('KEEP', 'CORE-METADATA', isProtected ? 'configured protected path' : 'operational contract or metadata');
  }
  if (isTemplateContract) return semanticResult('KEEP', 'REUSABLE-SOURCE', 'explicit reusable template contract');
  if (isPackageManifest) return semanticResult('KEEP', 'CORE-METADATA', 'package dependency contract');
  const structuredContact = inspectStructuredContactDataset(absPath, clientCode, policy);
  if (structuredContact.status === 'sensitive') {
    return semanticResult('PII-MOVE', 'HISTORICAL-REFERENCE', 'structured contact dataset requires private externalization');
  }
  if (structuredContact.status === 'indeterminate') {
    throw new Error('structured contact inspection was indeterminate; classification halted');
  }
  if (STUB_EXTENSIONS.has(ext)) return semanticResult('SKIP-STUB', 'HISTORICAL-REFERENCE', 'cloud-native pointer stub has no portable file payload');

  if (isHtml) {
    const isHistoricalHtml =
      segments.slice(0, -1).some((segment) =>
        HISTORICAL_HTML_SEGMENT.test(segment) || HISTORICAL_HTML_COMPOUND_SEGMENT.test(segment)
      ) ||
      HISTORICAL_HTML_BASENAME.test(basename) ||
      isArtifactOutput;
    if (isHistoricalHtml) {
      return semanticResult('MOVE', 'HISTORICAL-REFERENCE', 'HTML content source, backup, capture, or rendered output');
    }
    const isReusableHtml =
      isMarkerCode ||
      segments.slice(0, -1).some((segment) =>
        REUSABLE_HTML_SEGMENT.test(segment) || REUSABLE_HTML_COMPOUND_SEGMENT.test(segment)
      ) ||
      REUSABLE_HTML_BASENAME.test(basename);
    if (isReusableHtml) {
      return semanticResult('KEEP', 'REUSABLE-SOURCE', 'HTML package/source tree or reusable template/preset');
    }
    return semanticResult('REVIEW', 'REVIEW', 'standalone HTML role is ambiguous');
  }

  if (EXECUTABLE_EXTENSIONS.has(ext) && !isArtifactOutput) {
    return semanticResult('KEEP', 'EXECUTABLE-AUTOMATION', `executable source extension ${ext}`);
  }
  if (isExplicitSource && !isArtifactOutput) {
    return semanticResult('KEEP', 'REUSABLE-SOURCE', `reusable source extension ${ext}`);
  }
  if (isMarkerCode && !isArtifactOutput) {
    return semanticResult('KEEP', 'REUSABLE-SOURCE', 'package or source-tree context');
  }
  if (isArtifactOutput) return semanticResult('MOVE', 'HISTORICAL-REFERENCE', 'artifact/output context');
  if (isMarkerCode) return semanticResult('KEEP', 'REUSABLE-SOURCE', 'runtime asset in package or source-tree context');
  return semanticResult('MOVE', 'HISTORICAL-REFERENCE', 'non-operational reference material');
}

function classifyFile(relPath, absPath, clientCode, markerDirs, dirtyChecker, classificationPolicy) {
  return classifyFileDetailed(relPath, absPath, clientCode, markerDirs, dirtyChecker, classificationPolicy).klass;
}

function selectReusablePiiMap(priorMap, storageMap, clientCode) {
  const storageHasPii =
    storageMap &&
    (
      !Array.isArray(storageMap.entries) ||
      storageMap.entries.some((entry) => entry && entry.pii_id) ||
      (
        storageMap.preserved_snapshots !== undefined &&
        !Array.isArray(storageMap.preserved_snapshots)
      ) ||
      (
        Array.isArray(storageMap.preserved_snapshots) &&
        storageMap.preserved_snapshots.some((entry) => entry && entry.pii_id)
      )
    );
  if (!priorMap) {
    if (storageHasPii) {
      throw new Error('existing storage-map.json contains PII identities but the prior PII path map is missing; refusing to regenerate');
    }
    return { map: null, disposition: 'new' };
  }
  const seenIds = new Set();
  const seenPaths = new Set();
  const validatePrivateEntry = (entry) => {
    const entryValid =
      entry &&
      typeof entry.pii_id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.pii_id) &&
      typeof entry.repo_relpath === 'string' &&
      Number.isFinite(entry.size) &&
      entry.size >= 0 &&
      /^[a-f0-9]{64}$/.test(entry.sha256 || '') &&
      !seenIds.has(entry.pii_id) &&
      !seenPaths.has(entry.repo_relpath);
    if (entryValid) {
      seenIds.add(entry.pii_id);
      seenPaths.add(entry.repo_relpath);
    }
    return entryValid;
  };
  const retainedEntries =
    priorMap.retained_entries === undefined
      ? []
      : priorMap.retained_entries;
  const retiredEntries =
    priorMap.retired_entries === undefined
      ? []
      : priorMap.retired_entries;
  const validateRetiredEntry = (entry) => {
    const entryValid =
      entry &&
      typeof entry.pii_id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.pii_id) &&
      typeof entry.private_remote_relpath === 'string' &&
      Number.isFinite(entry.size) &&
      entry.size >= 0 &&
      /^[a-f0-9]{64}$/.test(entry.sha256 || '') &&
      Number.isFinite(Date.parse(entry.retired_at)) &&
      !seenIds.has(entry.pii_id) &&
      !seenPaths.has(entry.private_remote_relpath);
    if (entryValid) {
      seenIds.add(entry.pii_id);
      seenPaths.add(entry.private_remote_relpath);
    }
    return entryValid;
  };
  const valid =
    priorMap.schema === 'ClientStoragePiiPathMap/1.0' &&
    priorMap.client === clientCode &&
    Array.isArray(priorMap.entries) &&
    Array.isArray(retainedEntries) &&
    Array.isArray(retiredEntries) &&
    [...priorMap.entries, ...retainedEntries].every(validatePrivateEntry) &&
    retiredEntries.every(validateRetiredEntry);
  if (!valid) {
    if (storageHasPii) {
      throw new Error('existing PII path map is invalid while storage-map.json contains PII identities; refusing to regenerate');
    }
    return { map: null, disposition: 'regenerated_invalid_unmigrated' };
  }
  return { map: priorMap, disposition: 'reused' };
}

function normalizedReportIdentity(relPath) {
  return relPath.split(path.sep).join('/').normalize('NFD').toLowerCase();
}

function specificBasenameStem(normalizedRelPath) {
  const basename = normalizedRelPath.split('/').at(-1);
  const extensionIndex = basename.lastIndexOf('.');
  const stem = extensionIndex > 0 ? basename.slice(0, extensionIndex) : basename;
  const identifyingCharacters = (stem.match(/[a-z0-9]/g) || []).length;
  if (stem.length < 12 || identifyingCharacters < 10) return null;

  // A length threshold alone captures ordinary descriptive filenames in large
  // client trees. Limit cross-directory stem closure to opaque identifiers;
  // full normalized-path containment remains the primary derivative rule.
  const hasUuid = /(?:^|[^0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:$|[^0-9a-f])/.test(stem);
  const hasLongHexToken = /(?:^|[^0-9a-f])[0-9a-f]{16,}(?:$|[^0-9a-f])/.test(stem);
  return hasUuid || hasLongHexToken ? stem : null;
}

function computeReportRedactionClosure(classified, clientCode, classificationPolicy) {
  const policy = classificationPolicy || loadClientStoragePolicy(clientCode);
  const redactedPaths = new Set();
  const sensitivePaths = [];
  const sensitiveStems = new Set();

  function addSensitiveIdentity(relPath) {
    const normalized = normalizedReportIdentity(relPath);
    if (redactedPaths.has(normalized)) return false;
    redactedPaths.add(normalized);
    sensitivePaths.push(normalized);
    const stem = specificBasenameStem(normalized);
    if (stem) sensitiveStems.add(stem);
    return true;
  }

  for (const entry of classified) {
    if (
      entry.klass === 'DEFERRED-DIRTY' ||
      entry.klass === 'PII-MOVE' ||
      matchesAnyGlob(entry.relPath, policy.piiMatchers)
    ) {
      addSensitiveIdentity(entry.relPath);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of classified) {
      const normalized = normalizedReportIdentity(entry.relPath);
      if (redactedPaths.has(normalized)) continue;
      const containsSensitivePath = sensitivePaths.some((sensitivePath) => normalized.includes(sensitivePath));
      const containsSpecificStem = [...sensitiveStems].some((stem) => normalized.includes(stem));
      if ((containsSensitivePath || containsSpecificStem) && addSensitiveIdentity(entry.relPath)) {
        changed = true;
      }
    }
  }
  return redactedPaths;
}

async function buildClassificationArtifacts(classified, clientCode, options = {}) {
  if (typeof options === 'function') options = { idFactory: options };
  const idFactory = options.idFactory || (() => crypto.randomUUID());
  const priorEntries = new Map(
    [
      ...((options.priorMap && options.priorMap.entries) || []),
      ...((options.priorMap && options.priorMap.retained_entries) || [])
    ].map((entry) => [entry.repo_relpath, entry])
  );
  const allPriorEntries = [
    ...((options.priorMap && options.priorMap.entries) || []),
    ...((options.priorMap && options.priorMap.retained_entries) || [])
  ];
  const listing = [];
  const privateEntries = [];
  const retiredEntries = [...((options.priorMap && options.priorMap.retired_entries) || [])];
  const seenIds = new Set(retiredEntries.map((entry) => entry.pii_id));
  let reusedIdentityCount = 0;
  const reportRedactionClosure = computeReportRedactionClosure(classified, clientCode, options.classificationPolicy);
  function allocateOpaqueId(candidate) {
    const opaqueId = candidate || idFactory();
    if (
      typeof opaqueId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(opaqueId) ||
      seenIds.has(opaqueId)
    ) {
      throw new Error('opaque ID generator returned an invalid or duplicate UUID');
    }
    seenIds.add(opaqueId);
    return opaqueId;
  }
  function reportSemanticMetadata(entry) {
    return {
      semantic_bucket: entry.semantic_bucket || (entry.klass === 'KEEP' ? 'REUSABLE-SOURCE' : entry.klass === 'DEFERRED-DIRTY' || entry.klass === 'REVIEW' ? 'REVIEW' : 'HISTORICAL-REFERENCE'),
      basis: entry.basis || 'legacy caller supplied migration class without semantic basis'
    };
  }
  for (const entry of classified) {
    if (entry.klass === 'PII-MOVE') {
      const sha256 = await sha256File(entry.absPath);
      const prior = priorEntries.get(entry.relPath);
      const piiId = allocateOpaqueId(prior && prior.pii_id);
      if (prior) reusedIdentityCount += 1;
      listing.push({
        klass: entry.klass,
        ...reportSemanticMetadata(entry),
        pii_id: piiId,
        size: entry.size,
        sha256_prefix: sha256.slice(0, 8)
      });
      privateEntries.push({
        pii_id: piiId,
        repo_relpath: entry.relPath,
        size: entry.size,
        sha256
      });
    } else if (reportRedactionClosure.has(normalizedReportIdentity(entry.relPath))) {
      listing.push({
        klass: entry.klass,
        ...reportSemanticMetadata(entry),
        report_id: allocateOpaqueId(),
        size: entry.size,
        identity_redacted: true
      });
    } else {
      listing.push({
        klass: entry.klass,
        ...reportSemanticMetadata(entry),
        relpath: entry.relPath,
        size: entry.size
      });
    }
  }
  const piiPathMap = {
    schema: 'ClientStoragePiiPathMap/1.0',
    client: clientCode,
    generated_at: new Date().toISOString(),
    entries: privateEntries,
    retained_entries: allPriorEntries.filter(
      (prior) => !privateEntries.some((active) => active.pii_id === prior.pii_id)
    ),
    retired_entries: retiredEntries
  };
  const membership = validatePiiPublicMembership(listing, new Map(privateEntries.map((entry) => [entry.pii_id, entry])));
  if (!membership.ok) throw new Error(membership.reason);
  return {
    listing,
    piiPathMap,
    reusedIdentityCount,
    newIdentityCount: privateEntries.length - reusedIdentityCount
  };
}

async function buildReportListing(classified, clientCode = 'TEST', classificationPolicy) {
  return (await buildClassificationArtifacts(classified, clientCode, { classificationPolicy })).listing;
}

async function main() {
  const args = parseArgs(process.argv, { valued: ['client', 'out'] });
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (!args.client) {
    process.stderr.write('Usage: node classify.js --client CODE [--out FILE] (see --help)\n');
    process.exit(EXIT_CODES.USAGE_ERROR);
  }

  const clientCode = args.client;
  const clientRoot = clientRootPath(clientCode);
  if (!fs.existsSync(clientRoot)) {
    fail(EXIT_CODES.MISSING_CLIENT, { client: clientCode, reason: `clients/${clientCode} does not exist` });
    return;
  }

  const classificationPolicy = loadClientStoragePolicy(clientCode);
  const files = walkClientTree(clientRoot).filter((file) => !isPrivateControlRelPath(file.relPath));
  const markerDirs = findCodeTreeDirs(clientRoot, files);
  const sourceSnapshot = loadValidatedSourceSnapshot(clientCode);
  const dirtyChecker = buildGitDirtyCheckerWithSnapshot(
    REPO_ROOT,
    files,
    sourceSnapshot ? sourceSnapshot.stableIgnoredRepoPaths : new Set()
  );

  const decisionSet = loadClassificationDecisions(clientCode);
  const classified = applyClassificationDecisions(files.map((f) => ({
    ...f,
    ...classifyFileDetailed(f.relPath, f.absPath, clientCode, markerDirs, dirtyChecker, classificationPolicy)
  })), decisionSet);

  const counts = {};
  const bytes = {};
  const semanticCounts = {};
  const semanticBytes = {};
  for (const c of classified) {
    counts[c.klass] = (counts[c.klass] || 0) + 1;
    bytes[c.klass] = (bytes[c.klass] || 0) + c.size;
    semanticCounts[c.semantic_bucket] = (semanticCounts[c.semantic_bucket] || 0) + 1;
    semanticBytes[c.semantic_bucket] = (semanticBytes[c.semantic_bucket] || 0) + c.size;
  }

  let priorMap;
  let priorLoadFailed = false;
  try {
    priorMap = loadPiiPathMap(clientCode);
  } catch {
    priorLoadFailed = true;
    priorMap = { schema: null, client: null, entries: null };
  }
  const storageMap = loadStorageMap(clientCode);
  const reusable = selectReusablePiiMap(priorMap, storageMap, clientCode);
  if (priorLoadFailed && reusable.disposition === 'regenerated_invalid_unmigrated') {
    reusable.disposition = 'regenerated_unreadable_unmigrated';
  }
  const { listing, piiPathMap, reusedIdentityCount, newIdentityCount } =
    await buildClassificationArtifacts(classified, clientCode, { priorMap: reusable.map, classificationPolicy });
  const piiPathMapFile = writePiiPathMap(clientCode, piiPathMap);
  const piiPathMapSha256 = await sha256File(piiPathMapFile);

  const jsonReport = {
    schema: CLASSIFY_V2_SCHEMA,
    client: clientCode,
    generated_at: new Date().toISOString(),
    counts,
    bytes,
    semantic_counts: semanticCounts,
    semantic_bytes: semanticBytes,
    total_files: classified.length,
    total_bytes: classified.reduce((sum, c) => sum + c.size, 0),
    classification_decisions_binding: decisionSet.binding,
    source_snapshot_binding: sourceSnapshot ? sourceSnapshot.binding : null,
    pii_path_map_binding: {
      required: true,
      schema: piiPathMap.schema,
      client: piiPathMap.client,
      entry_count: piiPathMap.entries.length,
      sha256: piiPathMapSha256
    },
    pii_identity_disposition: reusable.disposition,
    pii_identities_reused: reusedIdentityCount,
    pii_identities_new: newIdentityCount,
    entries: listing
  };

  const mdLines = [
    `# classify: ${clientCode}`,
    '',
    `Generated: ${jsonReport.generated_at}`,
    `Total files: ${jsonReport.total_files}  Total bytes: ${jsonReport.total_bytes}`,
    '',
    '## Counts by class',
    ''
  ];
  for (const klass of Object.keys(counts).sort()) {
    mdLines.push(`- ${klass}: ${counts[klass]} files, ${bytes[klass]} bytes`);
  }
  mdLines.push('', '## Counts by semantic role', '');
  for (const bucket of Object.keys(semanticCounts).sort()) {
    mdLines.push(`- ${bucket}: ${semanticCounts[bucket]} files, ${semanticBytes[bucket]} bytes`);
  }
  mdLines.push('', '## Full listing', '', '| class | semantic role | path / hash | basis | bytes |', '|---|---|---|---|---|');
  for (const entry of listing) {
    const identity =
      entry.klass === 'PII-MOVE'
        ? `pii:${entry.pii_id} / sha256:${entry.sha256_prefix}…`
        : entry.identity_redacted
          ? `redacted:${entry.report_id}`
        : entry.relpath;
    const semanticBucket = entry.semantic_bucket || 'REDACTED';
    const basis = entry.basis || 'redacted';
    mdLines.push(`| ${entry.klass} | ${semanticBucket} | ${identity} | ${basis} | ${entry.size} |`);
  }

  const dir = ensureReportsDir();
  const stamp = nowUtcStamp();
  const mdPath = path.join(dir, `${clientCode}__classify__${stamp}.md`);
  const jsonPath = path.join(dir, `${clientCode}__classify__${stamp}.json`);
  writeAtomic(mdPath, mdLines.join('\n') + '\n');
  writeAtomic(jsonPath, JSON.stringify(jsonReport, null, 2) + '\n');

  if (args.out) {
    writeAtomic(path.resolve(args.out), JSON.stringify(jsonReport, null, 2) + '\n');
  }

  emitStatus({
    ok: true,
    client: clientCode,
    report_md: path.relative(REPO_ROOT, mdPath),
    report_json: path.relative(REPO_ROOT, jsonPath),
    counts,
    bytes
  });
  process.exit(EXIT_CODES.OK);
}

if (require.main === module) {
  main().catch((err) => {
    emitStatus({ ok: false, code: 'USAGE_ERROR', exit_code: EXIT_CODES.USAGE_ERROR, reason: err.message });
    process.exit(EXIT_CODES.USAGE_ERROR);
  });
}

module.exports = {
  main,
  classifyFile,
  classifyFileDetailed,
  inspectStructuredContactDataset,
  isStructuredContactDataset,
  selectReusablePiiMap,
  computeReportRedactionClosure,
  buildClassificationArtifacts,
  buildReportListing,
  loadClassificationDecisions,
  applyClassificationDecisions
};
