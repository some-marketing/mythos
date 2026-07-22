/**
 * landing-pad-classifier.js -- Shared classification library for the landing-pad sorter.
 *
 * Classifies tasks on the General/Tasks fallback board and suggests routing
 * to the correct client dartboard. Phase 1 is read-only (dry-run only).
 *
 * Used by:
 *   - watch-landing-pad.js (hourly dry-run listener)
 *
 * Privacy contract:
 *   - Never include raw email addresses in output artifacts
 *   - Use display names only in summaries
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---- Forwarded-body extraction (inline to avoid circular dep with normalizer) --

const FORWARDED_BOUNDARY_DELIMITER = /^-{2,3}\s*$/;
const FORWARDED_HEADER_LINE = /^\*{0,2}(From|Sent|Date|Subject|To)\*{0,2}\s*:\s*.+$/i;

/**
 * Extract the forwarded email body from text that contains a forward boundary.
 * When an email is forwarded, the actionable content is after the `---` +
 * From:/Sent:/Date: boundary — everything before that is wrapper noise.
 *
 * @param {string} text
 * @returns {string|null} Forwarded body or null if no boundary detected
 */
function extractForwardedBody(text) {
  if (!text) return null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (FORWARDED_BOUNDARY_DELIMITER.test(lines[i].trim())) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && FORWARDED_HEADER_LINE.test(lines[j].trim())) {
        // Include the forwarded header lines (From, Sent, etc.) so email
        // domains in the sender line are available for classification.
        // The classifier needs the domain from the From: line.
        while (j < lines.length && (FORWARDED_HEADER_LINE.test(lines[j].trim()) || lines[j].trim() === '')) j++;
        const body = lines.slice(j).join('\n').trim();
        if (!body) return null;
        // Prepend the From: line (first forwarded header) for domain extraction
        for (let k = i + 1; k < lines.length; k++) {
          const line = lines[k].trim();
          if (line === '') continue;
          if (/^\*{0,2}From\*{0,2}\s*:\s*.+$/i.test(line)) {
            return line + '\n' + body;
          }
          if (FORWARDED_HEADER_LINE.test(line)) continue;
          break;
        }
        return body;
      }
    }
  }
  return null;
}

// ---- Privacy helpers -------------------------------------------------------

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/**
 * Strip email addresses from a string, replacing with display-name references.
 *
 * @param {string} text
 * @returns {string}
 */
function stripEmails(text) {
  if (!text) return '';
  return text.replace(EMAIL_REGEX, (match) => {
    const local = match.split('@')[0];
    // Convert "dave.barrow" or "dave_barrow" to "Dave Barrow"
    const displayName = local
      .replace(/[._]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return `[${displayName}]`;
  });
}

// ---- Informational / no-work detection -------------------------------------

const NO_WORK_PATTERNS = [
  /\bfyi\b/i,
  /\bnewsletter\b/i,
  /\bauto[- ]?reply\b/i,
  /\bout[- ]?of[- ]?office\b/i,
  /\booo\b/i,
  /\bdo not reply\b/i,
  /\bnoreply\b/i,
  /\bunsubscribe\b/i,
  /\bnotification\b/i,
  /\bweekly report\b/i,
  /\bmonthly report\b/i,
  /\bdigest\b/i,
  /\breceipt\b/i,
  /\binvoice\b/i,
  /\bconfirmation\b/i,
  /\bpayment received\b/i,
  /\bdelivery notification\b/i,
  /\bsubscription\b/i,
  /\bautomated message\b/i
];

/**
 * Detect whether a task is informational-only (no real work needed).
 *
 * @param {string} title
 * @param {string} description
 * @returns {boolean}
 */
function isInformationalOnly(title, description) {
  const combined = `${title} ${description}`;
  return NO_WORK_PATTERNS.some((pattern) => pattern.test(combined));
}

// ---- Routing table construction --------------------------------------------

/**
 * Load and merge routing data from client-routing.json and all
 * clients/{code}/client.json files into a unified routing table.
 *
 * The routing table has three lookup maps:
 *   - domainToClient: email domain -> { code, name, dartboard }
 *   - keywordToClient: meeting keyword -> { code, name, dartboard }
 *   - clientToDartboard: client code -> { code, name, dartboard, allBoards }
 *
 * @param {string} projectRoot - Absolute path to project root
 * @returns {object} Routing table
 */
function loadRoutingTable(projectRoot) {
  const routingPath = path.join(projectRoot, 'tools/dart-integration/client-routing.json');
  const clientsDir = path.join(projectRoot, 'clients');

  const table = {
    domainToClient: {},
    keywordToClient: {},
    clientToDartboard: {}
  };

  // 1. Load client-routing.json
  let routingData = { clients: {} };
  try {
    routingData = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
  } catch {
    // If routing file is missing, continue with empty data
  }

  for (const [code, entry] of Object.entries(routingData.clients || {})) {
    const defaultBoard = (entry.dartboards && entry.dartboards.default) || null;
    const clientInfo = {
      code,
      name: entry.name || code,
      dartboard: defaultBoard
    };

    // Map email domains
    for (const domain of entry.emailDomains || []) {
      table.domainToClient[domain.toLowerCase()] = { ...clientInfo };
    }

    // Map contact emails (extract domain)
    for (const email of entry.contactEmails || []) {
      const domain = email.split('@')[1];
      if (domain) {
        table.domainToClient[domain.toLowerCase()] = { ...clientInfo };
      }
    }

    // Map meeting keywords
    for (const keyword of entry.meetingKeywords || []) {
      table.keywordToClient[keyword.toLowerCase()] = { ...clientInfo };
    }

    // Map client code to dartboard info
    table.clientToDartboard[code] = {
      ...clientInfo,
      allBoards: entry.dartboards || {}
    };
  }

  // 2. Enrich with client.json files (may have more dart board detail)
  try {
    const dirs = fs.readdirSync(clientsDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      if (dir.name.startsWith('_') || dir.name.startsWith('.')) continue;

      const clientJsonPath = path.join(clientsDir, dir.name, 'client.json');
      if (!fs.existsSync(clientJsonPath)) continue;

      try {
        const clientData = JSON.parse(fs.readFileSync(clientJsonPath, 'utf8'));
        const code = clientData.code || dir.name;
        const existing = table.clientToDartboard[code];

        // Extract dartboard from client.json (handles both schema variants)
        let dartboardFull = null;
        if (clientData.dart) {
          if (clientData.dart.dartboard_full) {
            dartboardFull = clientData.dart.dartboard_full;
          } else if (Array.isArray(clientData.dart.dartboards) && clientData.dart.dartboards.length > 0) {
            dartboardFull = clientData.dart.dartboards[0].full || null;
          }
        }

        if (existing) {
          // If client-routing.json had null but client.json has a board, use it
          if (!existing.dartboard && dartboardFull) {
            existing.dartboard = dartboardFull;
            // Also update domain and keyword maps
            for (const [domain, info] of Object.entries(table.domainToClient)) {
              if (info.code === code && !info.dartboard) {
                info.dartboard = dartboardFull;
              }
            }
            for (const [keyword, info] of Object.entries(table.keywordToClient)) {
              if (info.code === code && !info.dartboard) {
                info.dartboard = dartboardFull;
              }
            }
          }
        } else {
          // Client exists in clients/ but not in client-routing.json
          table.clientToDartboard[code] = {
            code,
            name: clientData.name || code,
            dartboard: dartboardFull,
            allBoards: {}
          };
        }
      } catch {
        // Skip malformed client.json
      }
    }
  } catch {
    // clients/ dir missing or unreadable
  }

  return table;
}

// ---- Email domain extraction -----------------------------------------------

/**
 * Extract email domains from a block of text.
 *
 * @param {string} text
 * @returns {string[]} Unique lowercase domains found
 */
function extractEmailDomains(text) {
  if (!text) return [];
  const matches = text.match(EMAIL_REGEX) || [];
  const domains = new Set();
  for (const email of matches) {
    const domain = email.split('@')[1].toLowerCase();
    domains.add(domain);
  }
  return [...domains];
}

// ---- Keyword matching ------------------------------------------------------

/**
 * Check whether any meeting keywords appear in a text string.
 * Returns all matching entries from the keyword map.
 *
 * @param {string} text
 * @param {object} keywordMap - keyword -> client info
 * @returns {Array<{ keyword: string, code: string, name: string, dartboard: string|null }>}
 */
function matchKeywords(text, keywordMap) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const matches = [];
  for (const [keyword, info] of Object.entries(keywordMap)) {
    if (lower.includes(keyword)) {
      matches.push({ keyword, ...info });
    }
  }
  return matches;
}

// ---- Tag extraction --------------------------------------------------------

/**
 * Extract the tag prefix from a task title (e.g. [Email], [Meeting]).
 *
 * @param {string} title
 * @returns {{ tag: string|null, rest: string }}
 */
function extractTag(title) {
  const tagMatch = (title || '').match(/^\[([^\]]+)\]\s*/);
  if (!tagMatch) return { tag: null, rest: title || '' };
  return { tag: tagMatch[1], rest: title.slice(tagMatch[0].length) };
}

// ---- Parent candidate detection --------------------------------------------

/**
 * Find potential parent tasks from a routing table for a given client code.
 * In Phase 1, this is a placeholder that returns the board name as context.
 *
 * @param {string} clientCode
 * @param {object} routingTable
 * @returns {Array<{ id: string, title: string, score: number }>}
 */
function findParentCandidates(clientCode, routingTable) {
  // Phase 1: no live Dart queries, return empty
  // Future phases will search the target board for parent tasks
  return [];
}

// ---- Core classifier -------------------------------------------------------

/**
 * Classify a single landing-pad task and produce a routing recommendation.
 *
 * Classification logic:
 *   1. Extract email domains from description, match against routing table
 *   2. Extract meeting keywords from title/description
 *   3. Parse [Email] / [Meeting] tag for client reference
 *   4. Score confidence based on match quality
 *   5. Detect informational-only (no-work) tasks
 *   6. Build privacy-safe summary
 *
 * @param {object} task - Normalized Dart task { id, title, status, description, assignee, priority }
 * @param {object} routingTable - From loadRoutingTable()
 * @returns {object} Classification result
 */
function classifyLandingPadTask(task, routingTable) {
  const title = task.title || '';
  const rawDescription = task.description || '';

  // Extract forwarded body: when the email is a forward, the body after
  // the --- boundary is the actionable content; the wrapper is routing noise.
  const forwardedBody = extractForwardedBody(rawDescription);

  // For classification, use the forwarded body if available; otherwise the full description.
  const description = forwardedBody || rawDescription;
  const combined = `${title} ${description}`;

  // Collect all client matches with their sources
  const clientMatches = new Map(); // code -> { code, name, dartboard, sources[] }

  // 1. Email domain matching
  const domains = extractEmailDomains(description);
  for (const domain of domains) {
    const match = routingTable.domainToClient[domain];
    if (match) {
      const existing = clientMatches.get(match.code) || { ...match, sources: [] };
      existing.sources.push(`email_domain:${domain}`);
      clientMatches.set(match.code, existing);
    }
  }

  // Also check title for email domains (some forwarded emails include sender in title)
  const titleDomains = extractEmailDomains(title);
  for (const domain of titleDomains) {
    const match = routingTable.domainToClient[domain];
    if (match) {
      const existing = clientMatches.get(match.code) || { ...match, sources: [] };
      if (!existing.sources.some((s) => s === `email_domain:${domain}`)) {
        existing.sources.push(`email_domain:${domain}`);
      }
      clientMatches.set(match.code, existing);
    }
  }

  // 2. Meeting keyword matching
  const keywordMatches = matchKeywords(combined, routingTable.keywordToClient);
  for (const km of keywordMatches) {
    const existing = clientMatches.get(km.code) || { code: km.code, name: km.name, dartboard: km.dartboard, sources: [] };
    existing.sources.push(`keyword:${km.keyword}`);
    // Prefer non-null dartboard
    if (km.dartboard && !existing.dartboard) {
      existing.dartboard = km.dartboard;
    }
    clientMatches.set(km.code, existing);
  }

  // 3. Tag-based matching
  const { tag, rest } = extractTag(title);
  if (tag) {
    const tagLower = tag.toLowerCase();
    if (tagLower === 'email' || tagLower === 'meeting') {
      // The rest of the title might contain a client reference
      const tagKeywordMatches = matchKeywords(rest, routingTable.keywordToClient);
      for (const km of tagKeywordMatches) {
        const existing = clientMatches.get(km.code) || { code: km.code, name: km.name, dartboard: km.dartboard, sources: [] };
        existing.sources.push(`tag_${tagLower}:${km.keyword}`);
        if (km.dartboard && !existing.dartboard) {
          existing.dartboard = km.dartboard;
        }
        clientMatches.set(km.code, existing);
      }
    }
  }

  // 4. Determine classification and confidence
  const matchArray = [...clientMatches.values()];
  const uniqueClients = matchArray.length;

  let classification = 'retain';
  let confidence = { tier: 'low', score: 0, rationale: 'No client match found' };
  let routing = { target_board: null, target_client: null };
  let workDecision = 'action_required';

  // Check for informational-only / no-work
  if (isInformationalOnly(title, description)) {
    workDecision = 'informational_only';
  }

  if (uniqueClients === 1) {
    const match = matchArray[0];
    if (match.dartboard) {
      // High confidence: single client match with known dartboard
      const sourceCount = match.sources.length;
      const score = Math.min(0.8 + (sourceCount - 1) * 0.05, 1.0);
      classification = 'route_to_board';
      confidence = {
        tier: 'high',
        score,
        rationale: `Single client match: ${match.name} via ${match.sources.join(', ')}`
      };
      routing = { target_board: match.dartboard, target_client: match.code };
    } else {
      // Medium confidence: client matched but no dartboard configured
      classification = 'needs_review';
      confidence = {
        tier: 'medium',
        score: 0.6,
        rationale: `Client matched (${match.name}) but dartboard is null — board not configured`
      };
      routing = { target_board: null, target_client: match.code };
    }
  } else if (uniqueClients > 1) {
    // Medium confidence: multiple client matches, ambiguous
    const names = matchArray.map((m) => m.name).join(', ');
    classification = 'needs_review';
    confidence = {
      tier: 'medium',
      score: 0.5,
      rationale: `Multiple client matches: ${names}`
    };
    // Pick the match with the most sources as best guess
    const bestMatch = matchArray.reduce((best, m) =>
      m.sources.length > best.sources.length ? m : best, matchArray[0]);
    routing = { target_board: bestMatch.dartboard, target_client: bestMatch.code };
  }
  // uniqueClients === 0: stays as retain / low confidence

  // Override classification for no-work items
  if (workDecision === 'informational_only') {
    classification = 'no_work';
  }

  // 5. Brief vs deliverable heuristic
  let briefOrDeliverable = null;
  if (classification === 'route_to_board' || classification === 'needs_review') {
    const lowerCombined = combined.toLowerCase();
    if (lowerCombined.includes('please') || lowerCombined.includes('request')
        || lowerCombined.includes('need') || lowerCombined.includes('want')
        || lowerCombined.includes('update') || lowerCombined.includes('change')
        || lowerCombined.includes('fix') || lowerCombined.includes('add')
        || lowerCombined.includes('create') || lowerCombined.includes('build')) {
      briefOrDeliverable = 'brief';
    } else if (lowerCombined.includes('report') || lowerCombined.includes('notes')
        || lowerCombined.includes('summary') || lowerCombined.includes('minutes')) {
      briefOrDeliverable = 'deliverable';
    }
  }

  // 6. Parent candidates
  const parentCandidates = routing.target_client
    ? findParentCandidates(routing.target_client, routingTable)
    : [];

  // 7. Build privacy-safe summary
  const privacySafeSummary = stripEmails(
    `${title}${description ? ' -- ' + description.slice(0, 200) : ''}`
  );

  return {
    task_id: task.id,
    title: task.title,
    status: task.status || '',
    classification,
    confidence,
    routing,
    parent_candidates: parentCandidates,
    work_decision: workDecision,
    brief_or_deliverable: briefOrDeliverable,
    privacy_safe_summary: privacySafeSummary
  };
}

// ---- Routing artifact builder ----------------------------------------------

/**
 * Build a structured JSON artifact summarizing a classification run.
 *
 * @param {object[]} classifiedTasks - Array of classifyLandingPadTask() results
 * @param {object} config - The landing-pad-sorter config
 * @returns {object} Structured artifact
 */
function buildRoutingArtifact(classifiedTasks, config) {
  const counts = {
    route_to_board: 0,
    needs_review: 0,
    no_work: 0,
    retain: 0
  };
  for (const task of classifiedTasks) {
    if (counts[task.classification] != null) {
      counts[task.classification]++;
    }
  }

  const tierCounts = { high: 0, medium: 0, low: 0 };
  for (const task of classifiedTasks) {
    const tier = task.confidence.tier;
    if (tierCounts[tier] != null) {
      tierCounts[tier]++;
    }
  }

  const targetBoards = {};
  for (const task of classifiedTasks) {
    if (task.routing.target_board) {
      if (!targetBoards[task.routing.target_board]) {
        targetBoards[task.routing.target_board] = [];
      }
      targetBoards[task.routing.target_board].push(task.task_id);
    }
  }

  return {
    schema: 'LandingPadSortRun/1.0',
    timestamp: new Date().toISOString(),
    mode: config.mode || 'dry-run',
    source_board: config.source_board || 'General/Tasks',
    task_count: classifiedTasks.length,
    classification_counts: counts,
    confidence_tier_counts: tierCounts,
    target_boards: targetBoards,
    items: classifiedTasks.map((t) => ({
      task_id: t.task_id,
      title: t.title,
      status: t.status,
      classification: t.classification,
      confidence_tier: t.confidence.tier,
      confidence_score: t.confidence.score,
      confidence_rationale: t.confidence.rationale,
      target_board: t.routing.target_board,
      target_client: t.routing.target_client,
      work_decision: t.work_decision,
      brief_or_deliverable: t.brief_or_deliverable,
      privacy_safe_summary: t.privacy_safe_summary,
      normalized: t.normalized || null
    }))
  };
}

module.exports = {
  EMAIL_REGEX,
  stripEmails,
  isInformationalOnly,
  loadRoutingTable,
  extractEmailDomains,
  matchKeywords,
  extractTag,
  findParentCandidates,
  classifyLandingPadTask,
  buildRoutingArtifact
};
