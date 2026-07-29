/**
 * SEO Validation Findings Report Generator
 *
 * Produces a structured summary object and a Markdown findings report
 * from crawl inventory, crawl summary, check results, and optional
 * mobile rendering results.
 *
 * Follows observational reporting: facts and evidence only,
 * no diagnoses, no recommendations, no code suggestions.
 */

// Checks whose failure always triggers 'critical' regardless of page percentage
const ALWAYS_CRITICAL_CHECKS = new Set([
  'canonical-presence',
  'h1-presence',
  'status-code',
]);

// ---------------------------------------------------------------------------
// Health computation
// ---------------------------------------------------------------------------

/**
 * Determine overall site health from check results.
 *
 * - 'critical': any check with status 'fail' affecting >10% of pages,
 *     OR any always-critical check fails
 * - 'needs-attention': any check has status 'fail' or 'warn'
 * - 'good': all checks pass
 *
 * @param {object[]} checks - Array of individual check result objects
 * @param {number} totalPages - Total pages crawled
 * @returns {'good' | 'needs-attention' | 'critical'}
 */
function computeHealth(checks, totalPages) {
  let hasFail = false;
  let hasWarn = false;

  for (const check of checks) {
    if (check.status === 'fail') {
      hasFail = true;

      if (ALWAYS_CRITICAL_CHECKS.has(check.check_id)) {
        return 'critical';
      }

      const affectedCount = check.affected_urls ? check.affected_urls.length : 0;
      if (totalPages > 0 && affectedCount / totalPages > 0.10) {
        return 'critical';
      }
    }

    if (check.status === 'warn') {
      hasWarn = true;
    }
  }

  if (hasFail || hasWarn) {
    return 'needs-attention';
  }

  return 'good';
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

/**
 * Build the structured summary object.
 */
function buildSummary(inventory, crawlSummary, checkResults, mobileResults) {
  const checks = checkResults.results || [];
  const totalPages = crawlSummary.successful || 0;

  const overallHealth = computeHealth(checks, totalPages);

  const criticalIssues = checks
    .filter(c => c.status === 'fail')
    .map(c => ({ check_id: c.check_id, summary: c.summary, affected_count: (c.affected_urls || []).length }));
  const warningsList = checks
    .filter(c => c.status === 'warn')
    .map(c => ({ check_id: c.check_id, summary: c.summary, affected_count: (c.affected_urls || []).length }));

  return {
    report_generated_at: new Date().toISOString(),
    site_url: inventory.site_url,
    pages_crawled: crawlSummary.successful,
    pages_failed: crawlSummary.failed,
    checks_run: checkResults.total_checks,
    checks_passed: checkResults.passed,
    checks_failed: checkResults.failed,
    checks_warned: checkResults.warned,
    mobile_tested: !!mobileResults,
    mobile_pages_tested: mobileResults?.pages_tested || 0,
    overall_health: overallHealth,
    critical_issues: criticalIssues,
    warnings: warningsList,
  };
}

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

/**
 * Format a date string for display.
 */
function formatDate(isoString) {
  return isoString ? isoString.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : 'unknown';
}

/**
 * Render an affected-pages list: first 5 URLs, with overflow note.
 */
function renderAffectedPages(pages) {
  if (!pages || pages.length === 0) return '0';

  const lines = [`${pages.length}`];
  const shown = pages.slice(0, 5);
  for (const url of shown) {
    lines.push(`- ${url}`);
  }
  if (pages.length > 5) {
    lines.push(`- *(see checks/${pages._checkId || 'check'}.json for full list)*`);
  }
  return lines.join('\n');
}

/**
 * Render a single check section (used for both critical issues and warnings).
 */
function renderCheckSection(check) {
  const lines = [];
  lines.push(`### ${check.check_name || check.check_id}`);
  lines.push(`**Observation:** ${check.summary || 'No description provided.'}`);

  const pages = check.affected_urls || [];
  if (pages.length > 0) {
    lines.push(`**Affected pages:** ${pages.length}`);
    const shown = pages.slice(0, 5);
    for (const url of shown) {
      lines.push(`- ${url}`);
    }
    if (pages.length > 5) {
      lines.push('- *(see `checks/' + check.check_id + '.json` for full list)*');
    }
  } else {
    lines.push('**Affected pages:** 0');
  }

  lines.push(`**Evidence:** \`checks/${check.check_id}.json\``);
  return lines.join('\n');
}

/**
 * Generate the overview sentence(s) for the summary section.
 */
function generateOverview(summary) {
  const parts = [];

  const healthLabel = {
    good: 'All checks passed with no issues detected.',
    'needs-attention': 'Some checks produced warnings or failures that may warrant review.',
    critical: 'Critical issues were detected that affect core SEO signals.',
  };

  parts.push(
    `The crawl covered ${summary.pages_crawled} pages on ${summary.site_url}.`
  );

  parts.push(healthLabel[summary.overall_health]);

  if (summary.checks_failed > 0) {
    parts.push(
      `${summary.checks_failed} of ${summary.checks_run} checks failed and ${summary.checks_warned} produced warnings.`
    );
  } else if (summary.checks_warned > 0) {
    parts.push(
      `All ${summary.checks_run} checks passed, though ${summary.checks_warned} produced warnings.`
    );
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Markdown report builder
// ---------------------------------------------------------------------------

/**
 * Build the full Markdown findings report.
 */
function buildMarkdown(inventory, crawlSummary, checkResults, mobileResults, summary) {
  const checks = checkResults.results || [];
  const lines = [];

  // Header
  lines.push('# SEO Validation Findings Report');
  lines.push('');
  lines.push(`**Site:** ${inventory.site_url}`);
  lines.push(`**Crawled:** ${formatDate(crawlSummary.crawled_at)}`);
  lines.push(`**Pages:** ${crawlSummary.successful} crawled, ${crawlSummary.failed} failed`);
  lines.push(`**Overall Health:** ${summary.overall_health}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(generateOverview(summary));
  lines.push('');

  // Critical Issues
  const criticalChecks = checks.filter(c => c.status === 'fail');
  lines.push('## Critical Issues');
  lines.push('');
  if (criticalChecks.length === 0) {
    lines.push('No critical issues detected.');
  } else {
    for (const check of criticalChecks) {
      lines.push(renderCheckSection(check));
      lines.push('');
    }
  }
  lines.push('');

  // Warnings
  const warnChecks = checks.filter(c => c.status === 'warn');
  lines.push('## Warnings');
  lines.push('');
  if (warnChecks.length === 0) {
    lines.push('No warnings.');
  } else {
    for (const check of warnChecks) {
      lines.push(renderCheckSection(check));
      lines.push('');
    }
  }
  lines.push('');

  // Passing Checks
  const passChecks = checks.filter(c => c.status === 'pass');
  lines.push('## Passing Checks');
  lines.push('');
  if (passChecks.length === 0) {
    lines.push('No passing checks.');
  } else {
    for (const check of passChecks) {
      lines.push(`- **${check.check_name || check.check_id}:** ${check.summary || 'Passed'}`);
    }
  }
  lines.push('');

  // Mobile Rendering (only if mobileResults present)
  if (mobileResults) {
    lines.push('## Mobile Rendering');
    lines.push('');
    lines.push(`**Devices:** ${(mobileResults.devices || []).join(', ') || 'none'}`);
    lines.push(`**Pages tested:** ${mobileResults.pages_tested || 0}`);
    lines.push('');

    // Horizontal Overflow
    lines.push('### Horizontal Overflow');
    const overflowCount = (mobileResults.summary && mobileResults.summary.pages_with_overflow) || 0;
    const overflowPages = (mobileResults.results || []).filter(r => r.horizontal_overflow).map(r => r.url);
    const uniqueOverflow = [...new Set(overflowPages)];
    if (uniqueOverflow.length > 0) {
      lines.push(`**Observation:** ${uniqueOverflow.length} page(s) exhibited horizontal overflow on one or more devices.`);
      for (const url of uniqueOverflow.slice(0, 5)) {
        lines.push(`- ${url}`);
      }
      if (uniqueOverflow.length > 5) {
        lines.push('- *(see `mobile/results.json` for full list)*');
      }
    } else {
      lines.push('**Observation:** No horizontal overflow detected on any tested page.');
    }
    lines.push('');

    // Undersized Tap Targets
    lines.push('### Undersized Tap Targets');
    const undersizedPages = (mobileResults.results || []).filter(r => r.tap_targets && r.tap_targets.undersized > 0).map(r => r.url);
    const uniqueUndersized = [...new Set(undersizedPages)];
    if (uniqueUndersized.length > 0) {
      lines.push(`**Observation:** ${uniqueUndersized.length} page(s) contained tap targets below the minimum size threshold.`);
      for (const url of uniqueUndersized.slice(0, 5)) {
        lines.push(`- ${url}`);
      }
      if (uniqueUndersized.length > 5) {
        lines.push('- *(see `mobile/results.json` for full list)*');
      }
    } else {
      lines.push('**Observation:** No undersized tap targets detected on any tested page.');
    }
    lines.push('');
  }

  // Crawl Notes
  lines.push('## Crawl Notes');
  lines.push('');

  // Pages that failed to load
  const crawlErrors = crawlSummary.errors || [];
  if (crawlErrors.length > 0) {
    lines.push(`- Pages that failed to load: ${crawlErrors.length}`);
    for (const err of crawlErrors) {
      lines.push(`  - ${err.url}: ${err.error}`);
    }
  } else {
    lines.push('- Pages that failed to load: none');
  }

  // Robots.txt issues
  const robotsIssues = [];
  if (!inventory.robots_txt || !inventory.robots_txt.raw) {
    robotsIssues.push('robots.txt not found or empty');
  }
  if (robotsIssues.length > 0) {
    lines.push(`- Robots.txt issues: ${robotsIssues.join('; ')}`);
  } else {
    lines.push('- Robots.txt issues: none');
  }

  // Sitemap issues
  const sitemapIssues = (inventory.sitemap_validation && inventory.sitemap_validation.issues) || [];
  if (sitemapIssues.length > 0) {
    lines.push(`- Sitemap issues: ${sitemapIssues.length}`);
    for (const issue of sitemapIssues) {
      lines.push(`  - ${issue}`);
    }
  } else {
    lines.push('- Sitemap issues: none');
  }
  lines.push('');

  // Evidence Locations
  lines.push('## Evidence Locations');
  lines.push('');
  lines.push('- Page inventory: `crawl/page-inventory.json`');
  lines.push('- Extracted data: `crawl/extracted/`');
  lines.push('- Check results: `checks/results.json`');
  lines.push('- Mobile results: `mobile/results.json`');
  lines.push('- Screenshots: `mobile/screenshots/`');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the final SEO validation findings report.
 *
 * @param {object} inventory      - Page inventory from the discovery phase
 * @param {object} crawlSummary   - Summary of the crawl phase (successful, failed, errors, etc.)
 * @param {object} checkResults   - Validation check results (total_checks, passed, failed, warned, checks[])
 * @param {object|null} mobileResults - Mobile rendering results, or null if mobile was not run
 * @returns {{ summary: object, markdown: string }}
 */
function generateReport(inventory, crawlSummary, checkResults, mobileResults) {
  const summary = buildSummary(inventory, crawlSummary, checkResults, mobileResults);
  const markdown = buildMarkdown(inventory, crawlSummary, checkResults, mobileResults, summary);

  return { summary, markdown };
}

module.exports = { generateReport };
