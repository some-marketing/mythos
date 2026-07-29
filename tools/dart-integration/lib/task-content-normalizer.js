/**
 * task-content-normalizer.js -- Normalizes raw email/meeting content from Dart
 * tasks into clean, human-readable task descriptions.
 *
 * Strips forwarded-message headers, quoted reply chains, email signatures,
 * excessive whitespace, and HTML entities. Replaces raw email addresses with
 * display-name references. Produces a clean description with optional metadata
 * footer.
 *
 * Used by:
 *   - Signal normalization pipelines
 *   - Dart task cleanup workflows
 *
 * Privacy contract:
 *   - Never include raw email addresses in output artifacts
 *   - Use display names only in summaries
 */

'use strict';

const { stripEmails } = require('./landing-pad-classifier');

// ---- HTML entity decoding ----------------------------------------------------

const HTML_ENTITY_MAP = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&#39;': "'",
  '&quot;': '"'
};

const HTML_ENTITY_REGEX = /&(?:amp|lt|gt|nbsp|quot|#39);/g;

/**
 * Decode common HTML entities in a string.
 *
 * @param {string} text
 * @returns {string}
 */
function decodeHtmlEntities(text) {
  if (!text) return '';
  return text.replace(HTML_ENTITY_REGEX, (match) => HTML_ENTITY_MAP[match] || match);
}

// ---- Title cleanup -----------------------------------------------------------

const TAG_PREFIX_REGEX = /^\[(Email|Meeting)\]\s*/i;
const FWD_RE_PREFIX_REGEX = /^(Fwd|Re|FW)\s*:\s*/i;

/**
 * Clean up a task title by removing tag prefixes and forwarding/reply markers.
 *
 * @param {string} title
 * @returns {string}
 */
function cleanTitle(title) {
  if (!title) return '';

  const original = title;
  let cleaned = title;

  // Remove [Email] or [Meeting] tag prefix
  cleaned = cleaned.replace(TAG_PREFIX_REGEX, '');

  // Remove Fwd:/Re:/FW: prefixes (handle multiples like Fwd: Re: Fwd:)
  let prev = '';
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned.replace(FWD_RE_PREFIX_REGEX, '');
  }

  cleaned = cleaned.trim();

  // If result is empty or too short, keep original
  if (cleaned.length < 5) {
    return original.trim();
  }

  return cleaned;
}

// ---- Forwarded header removal ------------------------------------------------

const FORWARDED_DELIMITER = /^-{5,}\s*Forwarded message\s*-{5,}\s*$/m;
const FORWARDED_META_LINE = /^(From|Date|Subject|To)\s*:\s*.+$/;

/**
 * Strip forwarded message headers from text.
 *
 * Removes the `---------- Forwarded message ----------` delimiter and the
 * From/Date/Subject/To lines that follow it.
 *
 * @param {string} text
 * @returns {string}
 */
function stripForwardedHeaders(text) {
  if (!text) return '';

  const lines = text.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    if (FORWARDED_DELIMITER.test(lines[i])) {
      // Skip the delimiter line
      i++;
      // Skip subsequent From/Date/Subject/To metadata lines
      while (i < lines.length && FORWARDED_META_LINE.test(lines[i].trim())) {
        i++;
      }
      // Skip any blank lines immediately after the metadata block
      while (i < lines.length && lines[i].trim() === '') {
        i++;
      }
      continue;
    }
    result.push(lines[i]);
    i++;
  }

  return result.join('\n');
}

// ---- Quoted reply removal ----------------------------------------------------

const ATTRIBUTION_LINE_REGEX = /^On\s+.+\d{4}\s+at\s+\d{1,2}:\d{2}\s*(AM|PM)?\s+.+wrote:\s*$/i;

/**
 * Strip quoted reply chains from text.
 *
 * Removes lines starting with `>` and the attribution line before them
 * (e.g. "On Mon, Apr 7, 2026 at 3:30 PM Name <email> wrote:").
 *
 * @param {string} text
 * @returns {string}
 */
function stripQuotedReplies(text) {
  if (!text) return '';

  const lines = text.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    // Check if this is an attribution line followed by quoted text
    if (ATTRIBUTION_LINE_REGEX.test(lines[i].trim())) {
      // Look ahead to confirm quoted lines follow
      let j = i + 1;
      while (j < lines.length && (lines[j].trim().startsWith('>') || lines[j].trim() === '')) {
        j++;
      }
      // If we found at least one quoted line, skip the attribution and all quoted lines
      if (j > i + 1 && lines.slice(i + 1, j).some((l) => l.trim().startsWith('>'))) {
        i = j - 1;
        continue;
      }
    }

    // Skip standalone quoted lines (may appear without attribution)
    if (lines[i].trimStart().startsWith('>')) {
      continue;
    }

    result.push(lines[i]);
  }

  return result.join('\n');
}

// ---- Signature removal -------------------------------------------------------

const SIG_DELIMITER_REGEX = /^-{2,3}\s*$/;
const SENT_FROM_REGEX = /^Sent from my\s+(iPhone|iPad|Galaxy|Samsung|Pixel|Android)/i;
const GET_OUTLOOK_REGEX = /^Get Outlook for\s+/i;
const COMPANY_SIG_REGEX = /^[\s]*(\+?\d[\d\s\-().]{7,}|\d{3}[-.\s]\d{3}[-.\s]\d{4})\s*$/;

// Detects forwarded-email boundary lines: the content after `---` in a
// forwarded email is actionable content, not a signature block.
// Dart API renders these as `**From:**` (bold markdown), standard clients
// use `From:`, `Sent:`, `Date:`, `Subject:`, `To:`.
const FORWARDED_BOUNDARY_LINE = /^\*{0,2}(From|Sent|Date|Subject|To)\*{0,2}\s*:\s*.+$/i;

/**
 * Check whether a `---` delimiter is a forwarded-email boundary rather than
 * a signature delimiter. Returns true if the next non-blank line after
 * line index `delimiterIdx` matches a forwarded-email header pattern.
 *
 * @param {string[]} lines
 * @param {number} delimiterIdx
 * @returns {boolean}
 */
function isForwardedBoundary(lines, delimiterIdx) {
  for (let j = delimiterIdx + 1; j < lines.length; j++) {
    const next = lines[j].trim();
    if (next === '') continue;
    return FORWARDED_BOUNDARY_LINE.test(next);
  }
  return false;
}

/**
 * Strip email signatures from text.
 *
 * Removes content after `--` or `---` signature delimiters, and catches
 * common patterns like "Sent from my iPhone" and "Get Outlook for".
 *
 * Does NOT cut at `---` when the following line is a forwarded-email
 * header (From, Sent, Date, Subject, To) — that's actionable content
 * from a forwarded message, not a signature block.
 *
 * @param {string} text
 * @returns {string}
 */
function stripSignature(text) {
  if (!text) return '';

  const lines = text.split('\n');
  let cutIndex = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Standard sig delimiter (-- or ---) — but skip if it's a forwarded-email boundary
    if (SIG_DELIMITER_REGEX.test(trimmed) && !isForwardedBoundary(lines, i)) {
      cutIndex = i;
      break;
    }

    // "Sent from my iPhone/iPad/Galaxy"
    if (SENT_FROM_REGEX.test(trimmed)) {
      cutIndex = i;
      break;
    }

    // "Get Outlook for iOS/Android"
    if (GET_OUTLOOK_REGEX.test(trimmed)) {
      cutIndex = i;
      break;
    }
  }

  // Also scan from the end for trailing phone-number/address blocks (company sigs)
  if (cutIndex === lines.length) {
    let trailingStart = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (trimmed === '') {
        // Allow blank lines in trailing block
        continue;
      }
      if (COMPANY_SIG_REGEX.test(trimmed)) {
        trailingStart = i;
      } else {
        break;
      }
    }
    // Only treat as sig if we found at least one phone-number line
    if (trailingStart < lines.length) {
      cutIndex = trailingStart;
    }
  }

  return lines.slice(0, cutIndex).join('\n');
}

// ---- Metadata extraction -----------------------------------------------------

const FROM_LINE_REGEX = /^From\s*:\s*(.+)$/im;
const DATE_LINE_REGEX = /^Date\s*:\s*(.+)$/im;

/**
 * Extract sender and date metadata from raw description text before cleanup.
 *
 * @param {string} text
 * @returns {{ from: string|null, date: string|null }}
 */
function extractMetadata(text) {
  if (!text) return { from: null, date: null };

  const fromMatch = text.match(FROM_LINE_REGEX);
  const dateMatch = text.match(DATE_LINE_REGEX);

  let from = fromMatch ? fromMatch[1].trim() : null;
  const date = dateMatch ? dateMatch[1].trim() : null;

  // Strip email from the from field, keep display name only
  if (from) {
    from = stripEmails(from).replace(/[<>\[\]]/g, '').trim();
    // If only whitespace remains after stripping, null it out
    if (!from) from = null;
  }

  return { from, date };
}

/**
 * Format a date string into a short display format (e.g. "Apr 7 2026").
 *
 * @param {string} dateStr
 * @returns {string}
 */
function formatDateShort(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

// ---- Whitespace normalization ------------------------------------------------

/**
 * Collapse excessive whitespace: 3+ consecutive newlines become 2.
 * Trims leading/trailing whitespace.
 *
 * @param {string} text
 * @returns {string}
 */
function collapseWhitespace(text) {
  if (!text) return '';
  return text
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- Forwarded body extraction ---------------------------------------------

const FORWARDED_BOUNDARY_DELIMITER = /^-{2,3}\s*$/;
const FORWARDED_HEADER_LINE = /^\*{0,2}(From|Sent|Date|Subject|To)\*{0,2}\s*:\s*.+$/i;

/**
 * Extract the forwarded email body from text that contains a forward boundary.
 *
 * When an email is forwarded (universal pattern for the landing pad),
 * the forwarder's signature/wrapper text is routing noise — the actionable
 * content is the forwarded body after the `---` + From:/Sent:/Date: boundary.
 *
 * Returns the forwarded body (everything after the boundary) if detected,
 * or null if no forwarded-email pattern is found.
 *
 * @param {string} text
 * @returns {string|null}
 */
function extractForwardedBody(text) {
  if (!text) return null;

  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Look for --- delimiter followed by a forwarded-email header line
    if (FORWARDED_BOUNDARY_DELIMITER.test(trimmed)) {
      // Skip blank lines after delimiter
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;

      // Check if next non-blank line is a forwarded header
      if (j < lines.length && FORWARDED_HEADER_LINE.test(lines[j].trim())) {
        // Skip the header block (From, Sent, Date, Subject, To)
        while (j < lines.length && (FORWARDED_HEADER_LINE.test(lines[j].trim()) || lines[j].trim() === '')) {
          j++;
        }
        // Return everything after the header block
        const body = lines.slice(j).join('\n').trim();
        if (!body) return null;
        // Prepend the From: line (first forwarded header) so email domains
        // in the sender line are available for classification
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

// ---- Core normalizer ---------------------------------------------------------

/**
 * Normalize a Dart task's title and description into clean, human-readable form.
 *
 * Strips forwarded headers, quoted replies, signatures, HTML entities, raw email
 * addresses, and excessive whitespace. Appends a metadata footer if sender/date
 * info was extracted.
 *
 * @param {object} task - Dart task object { id, title, description }
 * @returns {{ title: string, description: string, changed: boolean }}
 */
function normalizeTaskContent(task) {
  const originalTitle = task.title || '';
  const originalDescription = task.description || '';

  // 1. Clean title
  const newTitle = cleanTitle(originalTitle);

  // 2. Extract metadata before stripping (so we can build footer)
  const metadata = extractMetadata(originalDescription);

  // 3. Clean description through the pipeline
  let cleaned = originalDescription;
  cleaned = stripForwardedHeaders(cleaned);
  cleaned = stripQuotedReplies(cleaned);
  cleaned = stripSignature(cleaned);
  cleaned = decodeHtmlEntities(cleaned);
  cleaned = stripEmails(cleaned);
  cleaned = collapseWhitespace(cleaned);

  // 4. Append metadata footer if we have useful info
  if (metadata.from || metadata.date) {
    const fromPart = metadata.from ? `[${metadata.from}]` : '';
    const datePart = metadata.date ? formatDateShort(metadata.date) : '';
    const footerParts = [fromPart, datePart].filter(Boolean).join(', ');
    if (footerParts) {
      cleaned = cleaned + '\n\n---\n*From ' + footerParts + '*';
    }
  }

  // 5. Determine whether anything changed
  const changed = newTitle !== originalTitle || cleaned !== originalDescription;

  return {
    title: newTitle,
    description: cleaned,
    changed
  };
}

module.exports = {
  normalizeTaskContent,
  stripForwardedHeaders,
  stripQuotedReplies,
  stripSignature,
  extractForwardedBody,
  decodeHtmlEntities,
  cleanTitle
};
