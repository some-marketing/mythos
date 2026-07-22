'use strict';

const fs = require('fs');
const path = require('path');

function splitArgs(argsText) {
  return String(argsText || '').match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }
    return token;
  }) || [];
}

function parseArgs(argsText) {
  const tokens = splitArgs(argsText);
  const opts = {
    slug: '',
    toPolicy: false,
    approvedProposal: '',
    promotedTo: '',
    approvedBy: '',
    approvedAt: '',
    approvalReference: '',
    nextCommand: ''
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--to-policy') {
      opts.toPolicy = true;
    } else if (token === '--approved-proposal') {
      opts.approvedProposal = tokens[++i] || '';
    } else if (token === '--promoted-to') {
      opts.promotedTo = tokens[++i] || '';
    } else if (token === '--approved-by') {
      opts.approvedBy = tokens[++i] || '';
    } else if (token === '--approved-at') {
      opts.approvedAt = tokens[++i] || '';
    } else if (token === '--approval-reference') {
      opts.approvalReference = tokens[++i] || '';
    } else if (token === '--next-command') {
      opts.nextCommand = tokens[++i] || '';
    } else if (token.startsWith('--to-')) {
      opts.unsupportedTarget = token;
    } else if (!token.startsWith('--') && !opts.slug) {
      opts.slug = token;
    }
  }

  return opts;
}

function rel(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function resolveConcept(projectRoot, slug) {
  const conceptsDir = path.join(projectRoot, '_dev', 'concepts');
  const flatPath = path.join(conceptsDir, slug + '.md');
  const bundleDir = path.join(conceptsDir, slug);
  const bundleConceptPath = path.join(bundleDir, 'concept.md');

  if (fs.existsSync(bundleConceptPath)) {
    return {
      kind: 'bundle',
      slug,
      conceptPath: bundleConceptPath,
      bundleDir,
      statusPath: path.join(bundleDir, 'status.json')
    };
  }

  if (fs.existsSync(flatPath)) {
    return {
      kind: 'flat',
      slug,
      conceptPath: flatPath,
      bundleDir: null,
      statusPath: null
    };
  }

  return null;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function findExistingProposal(concept) {
  if (!concept || !concept.bundleDir) return '';
  const promotionDir = path.join(concept.bundleDir, 'promotion');
  if (!fs.existsSync(promotionDir)) return '';
  const candidates = fs.readdirSync(promotionDir)
    .filter((name) => name.endsWith('.md'))
    .sort();
  if (candidates.length === 0) return '';
  return path.join(promotionDir, candidates[candidates.length - 1]);
}

function resolveProjectPath(projectRoot, ref) {
  if (!ref) return '';
  return path.isAbsolute(ref) ? ref : path.resolve(projectRoot, ref);
}

function conceptPromote(projectRoot, argsText, options = {}) {
  const args = parseArgs(argsText);
  if (!args.slug) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Usage: /concept-promote <slug> --to-policy --approved-proposal <path> --promoted-to <ref>'
    };
  }
  if (args.unsupportedTarget) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Deterministic /concept-promote currently supports --to-policy only; received ${args.unsupportedTarget}.`
    };
  }
  if (!args.toPolicy) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: 'Deterministic /concept-promote currently requires --to-policy.'
    };
  }

  const concept = resolveConcept(projectRoot, args.slug);
  if (!concept) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Concept not found: ${args.slug}`
    };
  }
  if (concept.kind !== 'bundle') {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Policy promotion requires a concept bundle with status.json: ${rel(projectRoot, concept.conceptPath)}`
    };
  }

  const existingProposal = findExistingProposal(concept);
  if (!args.approvedProposal || !args.promotedTo) {
    const payload = {
      ok: false,
      status: 'approval_required',
      concept: args.slug,
      concept_path: rel(projectRoot, concept.conceptPath),
      existing_proposal: existingProposal ? rel(projectRoot, existingProposal) : null,
      required_next_command: `/concept-promote ${args.slug} --to-policy --approved-proposal <path> --promoted-to <canonical-ref>`
    };
    return {
      exitCode: 2,
      stdout: options.json === false
        ? `Approval required for policy promotion. Proposal: ${payload.existing_proposal || '(none found)'}`
        : JSON.stringify(payload, null, 2),
      stderr: ''
    };
  }

  const proposalPath = resolveProjectPath(projectRoot, args.approvedProposal);
  if (!fs.existsSync(proposalPath)) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Approved proposal not found: ${args.approvedProposal}`
    };
  }
  if (!args.approvedBy || !args.approvedAt) {
    const payload = {
      ok: false,
      status: 'approval_metadata_required',
      concept: args.slug,
      required_flags: ['--approved-by', '--approved-at'],
      optional_flags: ['--approval-reference'],
      reason: 'Policy promotion status updates require explicit approval metadata; defaults are not accepted.'
    };
    return {
      exitCode: 2,
      stdout: options.json === false
        ? 'Explicit --approved-by and --approved-at are required for policy promotion.'
        : JSON.stringify(payload, null, 2),
      stderr: ''
    };
  }

  const status = safeReadJson(concept.statusPath);
  const next = {
    ...status,
    slug: status.slug || args.slug,
    stage: 'promoted',
    promoted_to: args.promotedTo,
    promotion_proposal: rel(projectRoot, proposalPath),
    approved_by: args.approvedBy,
    approved_at: args.approvedAt
  };
  if (args.approvalReference) next.approval_reference = args.approvalReference;
  if (args.nextCommand) next.next_command = args.nextCommand;

  const payload = {
    ok: true,
    status: 'promoted',
    concept: args.slug,
    status_path: rel(projectRoot, concept.statusPath),
    promoted_to: args.promotedTo,
    promotion_proposal: rel(projectRoot, proposalPath),
    approval_reference: args.approvalReference || null,
    dry_run: options.write === false
  };
  if (options.write === false) {
    payload.would_write = {
      path: rel(projectRoot, concept.statusPath),
      status: next
    };
    return {
      exitCode: 0,
      stdout: options.json === false
        ? `Would promote ${args.slug} to ${args.promotedTo}`
        : JSON.stringify(payload, null, 2),
      stderr: ''
    };
  }

  fs.writeFileSync(concept.statusPath, JSON.stringify(next, null, 2) + '\n');
  return {
    exitCode: 0,
    stdout: options.json === false
      ? `Promoted ${args.slug} to ${args.promotedTo}`
      : JSON.stringify(payload, null, 2),
    stderr: ''
  };
}

module.exports = {
  conceptPromote,
  parseArgs,
  resolveConcept
};
