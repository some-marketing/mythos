'use strict';

/**
 * validate-dispatch.js
 *
 * Provider-neutral validation for dispatch results.
 *
 * This module contains the shared validation logic that applies to ANY
 * provider's response. Provider-specific validation (e.g., Gemini's
 * inline-style checks, Perplexity's citation checks) stays in the
 * provider modules or in validate-response.js.
 *
 * The shared checks answer the question: "Did the dispatch produce
 * something usable, regardless of which provider generated it?"
 *
 * Usage:
 *   const { validateDispatchResult } = require('./validate-dispatch');
 *   const result = validateDispatchResult(dispatchResult, expectations);
 *
 * Where expectations is an optional object describing what the caller
 * expected from the dispatch (e.g., { expect_html: true }).
 */

const { DISPATCH_STATUSES } = require('./dispatch-contract');

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

/**
 * Check 1: Response exists and is non-empty.
 */
function checkResponseExists(result) {
  if (!result.response) {
    return {
      id: 'response_exists',
      status: 'fail',
      severity: 'error',
      message: 'No response data in dispatch result'
    };
  }

  // Response can be an object with response_text, or a string, or an object with raw_text
  const text = typeof result.response === 'string'
    ? result.response
    : (result.response.response_text || result.response.raw_text || '');

  if (!text || text.trim().length === 0) {
    return {
      id: 'response_exists',
      status: 'fail',
      severity: 'error',
      message: 'Response is empty or contains only whitespace'
    };
  }

  return {
    id: 'response_exists',
    status: 'pass',
    severity: 'error',
    message: `Response present (${text.length} chars)`
  };
}

/**
 * Check 2: Response is parseable.
 * For JSON responses, verify they parse. For text responses, verify
 * they contain some structure (not just gibberish).
 */
function checkResponseParseable(result) {
  if (!result.response) {
    return {
      id: 'response_parseable',
      status: 'fail',
      severity: 'error',
      message: 'No response to parse'
    };
  }

  // If response is already an object (parsed JSON), it's parseable
  if (typeof result.response === 'object' && result.response !== null) {
    return {
      id: 'response_parseable',
      status: 'pass',
      severity: 'error',
      message: 'Response is a parsed object'
    };
  }

  // If response is a string, check if it's JSON or structured text
  if (typeof result.response === 'string') {
    // Try JSON parse
    try {
      JSON.parse(result.response);
      return {
        id: 'response_parseable',
        status: 'pass',
        severity: 'error',
        message: 'Response is valid JSON'
      };
    } catch {
      // Not JSON — check if it has some structure (lines, sections, code blocks)
      const lines = result.response.split('\n').filter(l => l.trim().length > 0);
      if (lines.length >= 1) {
        return {
          id: 'response_parseable',
          status: 'pass',
          severity: 'error',
          message: `Response is structured text (${lines.length} non-empty lines)`
        };
      }
      return {
        id: 'response_parseable',
        status: 'fail',
        severity: 'error',
        message: 'Response is not parseable as JSON or structured text'
      };
    }
  }

  return {
    id: 'response_parseable',
    status: 'fail',
    severity: 'error',
    message: `Unexpected response type: ${typeof result.response}`
  };
}

/**
 * Check 3: Response contains expected artifact markers.
 * When expectations specify artifact types, verify the response
 * contains indicators of those types.
 */
function checkArtifactMarkers(result, expectations) {
  if (!expectations) {
    return {
      id: 'artifact_markers',
      status: 'pass',
      severity: 'warning',
      message: 'No artifact expectations specified — skipped'
    };
  }

  const text = typeof result.response === 'string'
    ? result.response
    : (result.response?.response_text || result.response?.raw_text || '');

  const issues = [];

  if (expectations.expect_html) {
    const hasHtml = text.includes('</') || text.includes('style=') || text.includes('<div');
    if (!hasHtml) {
      issues.push('Expected HTML content but none found');
    }
  }

  if (expectations.expect_code_blocks) {
    const hasCodeBlocks = text.includes('```');
    if (!hasCodeBlocks) {
      issues.push('Expected code blocks but none found');
    }
  }

  if (expectations.expect_citations) {
    // Research-specific: look for URLs, [N] references, or "Source:" patterns
    const hasCitations = /\bhttps?:\/\//.test(text) || /\[\d+\]/.test(text) || /source:/i.test(text);
    if (!hasCitations) {
      issues.push('Expected citations/sources but none found');
    }
  }

  if (expectations.expect_structured_sections) {
    // Look for markdown headers or section markers
    const hasSections = /^#{1,3}\s/m.test(text) || /\n##\s/.test(text);
    if (!hasSections) {
      issues.push('Expected structured sections (markdown headers) but none found');
    }
  }

  if (issues.length > 0) {
    return {
      id: 'artifact_markers',
      status: 'warn',
      severity: 'warning',
      message: issues.join('; ')
    };
  }

  return {
    id: 'artifact_markers',
    status: 'pass',
    severity: 'warning',
    message: 'All expected artifact markers present'
  };
}

/**
 * Check 4: Dispatch status is valid.
 */
function checkDispatchStatus(result) {
  if (!result.status) {
    return {
      id: 'dispatch_status',
      status: 'fail',
      severity: 'error',
      message: 'No dispatch status in result'
    };
  }

  if (!DISPATCH_STATUSES.includes(result.status)) {
    return {
      id: 'dispatch_status',
      status: 'fail',
      severity: 'error',
      message: `Unknown dispatch status: "${result.status}"`
    };
  }

  if (result.status === 'error') {
    const msg = result.metadata?.error_message || 'Unknown error';
    return {
      id: 'dispatch_status',
      status: 'fail',
      severity: 'error',
      message: `Dispatch failed: ${msg}`
    };
  }

  if (result.status === 'not_implemented') {
    return {
      id: 'dispatch_status',
      status: 'fail',
      severity: 'error',
      message: `Provider "${result.provider}" is not yet implemented`
    };
  }

  return {
    id: 'dispatch_status',
    status: 'pass',
    severity: 'error',
    message: `Dispatch status: ${result.status}`
  };
}

// ---------------------------------------------------------------------------
// Main validation function
// ---------------------------------------------------------------------------

/**
 * Validate a DispatchResult against shared expectations.
 *
 * This runs provider-neutral checks only. Provider-specific validation
 * (inline styles for Gemini, citations for Perplexity, etc.) is handled
 * by the provider's own validation logic.
 *
 * @param {object} result - A DispatchResult object
 * @param {object} [expectations] - Optional expectations
 * @param {boolean} [expectations.expect_html] - Expect HTML in response
 * @param {boolean} [expectations.expect_code_blocks] - Expect fenced code blocks
 * @param {boolean} [expectations.expect_citations] - Expect citation markers
 * @param {boolean} [expectations.expect_structured_sections] - Expect markdown sections
 * @returns {{ passed: boolean, error_count: number, warning_count: number, checks: Array }}
 */
function validateDispatchResult(result, expectations) {
  if (!result || typeof result !== 'object') {
    return {
      passed: false,
      error_count: 1,
      warning_count: 0,
      checks: [{
        id: 'valid_result',
        status: 'fail',
        severity: 'error',
        message: 'DispatchResult is null or not an object'
      }]
    };
  }

  const checks = [
    checkDispatchStatus(result),
    checkResponseExists(result),
    checkResponseParseable(result),
    checkArtifactMarkers(result, expectations)
  ];

  const errorCount = checks.filter(c => c.status === 'fail' && c.severity === 'error').length;
  const warnCount = checks.filter(c => c.status === 'warn' || (c.status === 'fail' && c.severity === 'warning')).length;

  return {
    passed: errorCount === 0,
    error_count: errorCount,
    warning_count: warnCount,
    checks
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  validateDispatchResult,
  // Exposed for testing or composition
  checkResponseExists,
  checkResponseParseable,
  checkArtifactMarkers,
  checkDispatchStatus
};
