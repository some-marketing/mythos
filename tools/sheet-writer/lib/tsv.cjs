'use strict';

/**
 * tsv.cjs — Tab-separated block builder for clipboard paste into Google Sheets.
 *
 * SIBLING to ../sheet-builder/lib/csv.cjs. Same no-silent-failures ethos, but a
 * CRITICAL DIFFERENCE in escaping:
 *
 *   CSV (the file format) can carry embedded tabs/newlines inside a *quoted*
 *   cell. A clipboard PASTE into the Sheets grid CANNOT: the grid interprets a
 *   raw TAB as "move to next column" and a NEWLINE as "move to next row", with
 *   no quoting escape hatch. So a value containing \t or \n would silently spill
 *   across cells/rows and misalign the whole block.
 *
 * Therefore every cell value MUST be sanitized before it enters the TSV:
 *   - embedded TAB        -> single space
 *   - embedded NEWLINE    -> ' / '   (CR, LF, CRLF all collapse to one ' / ')
 *   - null/undefined      -> ''
 * Quotes and commas are NOT special in TSV and pass through literally (no
 * doubling, no wrapping) — that is the whole point of using TSV over CSV here.
 */

/**
 * Sanitize a single cell value for tab-separated clipboard paste.
 * @param {*} v
 * @returns {string}
 */
function sanitizeCell(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/\t/g, ' ')        // tabs would break column alignment
    .replace(/\r\n?|\n/g, ' / '); // any newline form would break row alignment
}

/**
 * Build a tab-separated data block (NO header row) from rows conforming to the
 * declared column contract.
 *
 * Fails LOUD: if any row has keys that don't match `columns` exactly (extra or
 * missing keys), throws — never silently misaligns. Empty/undefined cells are
 * allowed and become ''.
 *
 * @param {string[]} columns - ordered column contract (the existing sheet schema)
 * @param {Array<Object>} rows - data rows keyed by column name
 * @param {Object} [opts]
 * @param {boolean} [opts.includeHeader=false] - prepend the header row
 * @returns {string} tab-separated, newline-delimited block (no trailing newline)
 */
function buildTsv(columns, rows, opts = {}) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('buildTsv: `columns` must be a non-empty array');
  }
  if (!Array.isArray(rows)) {
    throw new Error('buildTsv: `rows` must be an array');
  }

  const colSet = new Set(columns);
  if (colSet.size !== columns.length) {
    throw new Error('buildTsv: `columns` contains duplicate column names');
  }

  const lines = [];
  if (opts.includeHeader) {
    lines.push(columns.map(sanitizeCell).join('\t'));
  }

  rows.forEach((row, i) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`buildTsv: row ${i} is not a plain object`);
    }
    // Fail loud on any key the contract does not declare. A row whose keys do
    // not match the declared columns means the caller's data is misaligned with
    // the sheet schema — pasting it would corrupt the block.
    const extraKeys = Object.keys(row).filter((k) => !colSet.has(k));
    if (extraKeys.length > 0) {
      throw new Error(
        `buildTsv: row ${i} has keys not in the column contract: ` +
          `${JSON.stringify(extraKeys)} (declared columns: ${JSON.stringify(columns)})`
      );
    }
    lines.push(columns.map((col) => sanitizeCell(row[col])).join('\t'));
  });

  return lines.join('\n');
}

module.exports = {
  sanitizeCell,
  buildTsv,
};
