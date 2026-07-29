'use strict';

// ---------------------------------------------------------------------------
// Status renderer
// ---------------------------------------------------------------------------
// Takes a status-report object (from status-report.js) and renders it as
// compact markdown suitable for human consumption.
// ---------------------------------------------------------------------------

/**
 * Render a status report object as compact markdown.
 *
 * Output structure:
 *   ## Status: {plan_id}
 *   _Generated: {report_ts}_
 *
 *   {summary lines as bullet list}
 *
 *   > Filter: {log_filter}
 *
 *   **Escalation**: {reason} (if any)
 *
 * @param {object} report - Status report object from generateStatusReport.
 * @returns {string} Markdown string.
 */
function renderStatus(report) {
  if (!report || typeof report !== 'object') {
    return '## Status\n\nNo report data available.';
  }

  var parts = [];

  // Header
  parts.push('## Status: ' + (report.plan_id || 'unknown'));
  parts.push('_Generated: ' + (report.report_ts || 'unknown') + '_');
  parts.push('');

  // Summary lines as bullets
  var lines = report.summary_lines;
  if (Array.isArray(lines) && lines.length > 0) {
    for (var i = 0; i < lines.length; i++) {
      parts.push('- ' + lines[i]);
    }
  } else {
    parts.push('- No summary data.');
  }

  parts.push('');

  // Token count and bounds
  var meta = [];
  if (typeof report.token_count === 'number') {
    meta.push('~' + report.token_count + ' tokens');
  }
  if (report.bounded) {
    meta.push('truncated');
  }
  if (meta.length > 0) {
    parts.push('> ' + meta.join(' | '));
  }

  // Filter
  if (report.log_filter) {
    parts.push('> Filter: ' + report.log_filter);
  }

  // Escalation
  if (report.escalation) {
    parts.push('');
    parts.push('**Escalation**: ' + (report.escalation.reason || 'unknown'));
    if (report.escalation.token_count) {
      parts.push('Token count ' + report.escalation.token_count +
        ' exceeded limit of ' + (report.escalation.max_tokens || '?') + '.');
    }
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  renderStatus: renderStatus
};
