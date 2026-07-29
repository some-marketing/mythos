'use strict';

const fs = require('fs');
const path = require('path');

const MODE_PATTERN = /\b(FINDINGS_ONLY|RUN_ONLY|REVIEW_ONLY|PATCH_ALLOWED|COORDINATOR|REPO_HYGIENE)\b/;

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function frameworkRootForId(projectRoot, frameworkId) {
  return path.join(projectRoot, 'frameworks', ...String(frameworkId || '').split('/'));
}

function loadFrameworkManifest(projectRoot, frameworkId) {
  const frameworkRoot = frameworkRootForId(projectRoot, frameworkId);
  const manifestPath = path.join(frameworkRoot, 'manifest.json');
  const manifest = safeReadJson(manifestPath);

  return {
    frameworkId: String(frameworkId || ''),
    frameworkRoot,
    manifestPath,
    manifest
  };
}

function loadFrameworkOrchestration(projectRoot, frameworkId, orchestrationKey = 'orchestration_v1') {
  const framework = loadFrameworkManifest(projectRoot, frameworkId);
  const orchestration = framework.manifest
    && typeof framework.manifest === 'object'
    ? framework.manifest[orchestrationKey] || null
    : null;

  return {
    frameworkId: framework.frameworkId,
    frameworkRoot: framework.frameworkRoot,
    manifestPath: framework.manifestPath,
    manifest: framework.manifest,
    orchestrationKey,
    orchestration
  };
}

function buildPromptPhaseIndex(manifest) {
  const index = new Map();
  if (!manifest || typeof manifest !== 'object' || !manifest.prompt_chain) {
    return index;
  }

  for (const [phaseId, promptIds] of Object.entries(manifest.prompt_chain)) {
    if (!Array.isArray(promptIds)) continue;
    for (const promptId of promptIds) {
      if (!index.has(promptId)) index.set(promptId, []);
      index.get(promptId).push(phaseId);
    }
  }

  return index;
}

function normalizeMode(value) {
  const match = String(value || '').match(MODE_PATTERN);
  return match ? match[1] : null;
}

function nextNonEmptyLine(lines, startIndex) {
  for (let i = startIndex; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function parsePromptMetadata(promptPath) {
  const text = safeReadText(promptPath);
  const lines = text.split(/\r?\n/).slice(0, 120);
  const metadata = {
    type: null,
    mode: null,
    purpose: null
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();

    const blockType = line.match(/^>\s*\*\*Type\*\*:\s*(.+)$/);
    if (blockType && !metadata.type) {
      metadata.type = blockType[1].trim();
    }

    const blockMode = line.match(/^>\s*\*\*Mode\*\*:\s*(.+)$/);
    if (blockMode && !metadata.mode) {
      metadata.mode = normalizeMode(blockMode[1]);
    }

    const blockPurpose = line.match(/^>\s*\*\*(Purpose|Goal|Objective)\*\*:\s*(.+)$/);
    if (blockPurpose && !metadata.purpose) {
      metadata.purpose = blockPurpose[2].trim();
    }

    if (/^##\s+Mode\b/i.test(line) && !metadata.mode) {
      metadata.mode = normalizeMode(nextNonEmptyLine(lines, i + 1));
    }

    if (/^##\s+(Goal|Objective|Purpose)\b/i.test(line) && !metadata.purpose) {
      metadata.purpose = nextNonEmptyLine(lines, i + 1);
    }
  }

  return metadata;
}

function resolveFrameworkPrompt(projectRoot, frameworkId, promptId) {
  const framework = loadFrameworkManifest(projectRoot, frameworkId);
  const promptIndex = buildPromptPhaseIndex(framework.manifest);
  const phaseIds = promptIndex.get(promptId) || [];
  const promptPath = path.join(framework.frameworkRoot, 'prompts', `${promptId}.md`);
  const promptExists = fs.existsSync(promptPath);

  return {
    frameworkId: framework.frameworkId,
    frameworkRoot: framework.frameworkRoot,
    manifestPath: framework.manifestPath,
    manifest: framework.manifest,
    promptId,
    phaseIds,
    promptPath,
    promptExists,
    metadata: promptExists ? parsePromptMetadata(promptPath) : { type: null, mode: null, purpose: null }
  };
}

function orchestrationNodeIndex(orchestration) {
  const index = new Map();
  if (!orchestration || typeof orchestration !== 'object' || !Array.isArray(orchestration.nodes)) {
    return index;
  }

  for (const node of orchestration.nodes) {
    if (!node || typeof node !== 'object' || !node.id) continue;
    index.set(String(node.id), node);
  }

  return index;
}

function orchestrationEdgeIndex(orchestration) {
  const index = new Map();
  if (!orchestration || typeof orchestration !== 'object' || !Array.isArray(orchestration.canonical_edges)) {
    return index;
  }

  for (const edge of orchestration.canonical_edges) {
    if (!edge || typeof edge !== 'object' || !edge.from || !edge.on || !edge.to) continue;
    index.set(`${edge.from}::${edge.on}::${edge.to}`, edge);
  }

  return index;
}

module.exports = {
  MODE_PATTERN,
  buildPromptPhaseIndex,
  frameworkRootForId,
  loadFrameworkOrchestration,
  loadFrameworkManifest,
  normalizeMode,
  orchestrationEdgeIndex,
  orchestrationNodeIndex,
  parsePromptMetadata,
  resolveFrameworkPrompt,
  safeReadJson,
  safeReadText
};
