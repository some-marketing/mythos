'use strict';

/**
 * Escapes a field for CSV, handling commas, newlines, and quotes.
 */
function escapeField(field) {
  if (field === null || field === undefined) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Converts an array of objects to a CSV string based on defined columns.
 */
function buildCsv(columns, dataRows) {
  const header = columns.map(escapeField).join(',') + '\n';
  const rows = dataRows.map(row => {
    return columns.map(col => escapeField(row[col])).join(',');
  }).join('\n') + '\n';
  return header + rows;
}

module.exports = {
  escapeField,
  buildCsv
};
