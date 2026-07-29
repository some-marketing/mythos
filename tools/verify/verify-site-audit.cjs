#!/usr/bin/env node
/**
 * verify-site-audit.cjs — Validates competitive analysis evidence and reports.
 *
 * Uses the VerificationSignal/1.0 contract via shared signal library.
 *
 * Usage: node verify-site-audit.cjs [base_path] [--output=path]
 * Default base_path: playwright_phased_runner/testcases/_competitive_analysis/
 * Default output: temp directory (ephemeral)
 *
 * Exit code 0 = PASS/WARN, 1 = FAIL
 */

const fs = require('fs');
const path = require('path');
const { createSignal, addCheck, writeSignal, printSummary, printJsonOutput } = require('./lib/signal.cjs');
const checks = require('./lib/checks.cjs');

const baseArg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const basePath = baseArg || path.resolve(__dirname, '..', '..', 'frameworks', 'wordpress', 'design-research');
const outputArg = process.argv.find(a => a.startsWith('--output='));
const defaultOut = path.join(__dirname, '..', '..', '_dev', 'reports', 'signals', 'verify-site-audit.signal.json');
const outputPath = outputArg ? outputArg.split('=')[1] : defaultOut;

if (!fs.existsSync(basePath)) {
  console.error('CRITICAL: Base path not found:', basePath);
  process.exit(1);
}

const signal = createSignal('verify-site-audit', 'competitive analysis evidence completeness');

// ─── Constants ──────────────────────────────────────────────────────────────

const REQUIRED_SCREENSHOTS = [
  '01_listing_full.png',
  '02_filters.png',
  '03_vehicle_card.png',
  '04_sort_options.png',
  '05_pagination.png',
  '06_mobile.png'
];

const REQUIRED_ANALYSIS_KEYS = [
  'filters.categories',
  'filters.filter_types',
  'vehicle_card.data_points',
  'vehicle_card.has_price',
  'schema.types_found',
  'seo.title',
  'seo.has_canonical',
  'pagination.type',
  'sort_options',
  'mobile.is_responsive'
];

const REQUIRED_SUMMARY_SECTIONS = [
  '## 100% Required Features',
  '## Common but Optional Features',
  '## Differentiators',
  '## Vehicle Data Taxonomy',
  '## Schema Markup Landscape',
  '## Filter Organization Patterns',
  '## Per-Site Strengths & Weaknesses',
  '## SEO Observations',
  '## UX Observations',
  '## Key Takeaways'
];

const NAME_MAP = {
  autotrader_ca: 'AutoTrader', clutch_ca: 'Clutch', cargurus_ca: 'CarGurus',
  kijiji_autos_ca: 'Kijiji', carpages_ca: 'Carpages', canadadrives_ca: 'Canada Drives',
  cars_com: 'Cars.com', hgreg_com: 'HGreg'
};

// ─── Top-Level Structure ────────────────────────────────────────────────────

addCheck(signal, checks.fileExists(
  path.join(basePath, 'sites.json'),
  { id: 'structure.sites_json', category: 'structure', message: 'sites.json exists' }
));

addCheck(signal, checks.jsonValid(
  path.join(basePath, 'sites.json'),
  { id: 'structure.sites_json_valid', category: 'structure', message: 'sites.json is valid JSON' }
));

addCheck(signal, checks.fileExists(
  path.join(basePath, 'ANALYSIS_MANIFEST.json'),
  { id: 'structure.manifest', category: 'structure', message: 'ANALYSIS_MANIFEST.json exists' }
));

addCheck(signal, checks.jsonValid(
  path.join(basePath, 'ANALYSIS_MANIFEST.json'),
  { id: 'structure.manifest_valid', category: 'structure', message: 'ANALYSIS_MANIFEST.json is valid JSON' }
));

// ─── Per-Site Checks ────────────────────────────────────────────────────────

const sitesDir = path.join(basePath, 'sites');
if (!fs.existsSync(sitesDir)) {
  addCheck(signal, { id: 'structure.sites_dir', category: 'structure', severity: 'critical',
    status: 'FAIL', message: 'sites/ directory exists', fix_hint: 'Run the site audit to create evidence' });
} else {
  addCheck(signal, { id: 'structure.sites_dir', category: 'structure', severity: 'critical',
    status: 'PASS', message: 'sites/ directory exists' });

  const siteSlugs = fs.readdirSync(sitesDir).filter(f =>
    fs.statSync(path.join(sitesDir, f)).isDirectory()
  );

  const completeSlugs = [];

  for (const slug of siteSlugs) {
    const siteDir = path.join(sitesDir, slug);
    const metaPath = path.join(siteDir, 'meta.json');

    // meta.json existence and validity
    addCheck(signal, checks.fileExists(metaPath, {
      id: `site.${slug}.meta_exists`, category: 'per_site', message: `${slug}: meta.json exists`
    }));

    if (!fs.existsSync(metaPath)) continue;

    addCheck(signal, checks.jsonValid(metaPath, {
      id: `site.${slug}.meta_valid`, category: 'per_site', message: `${slug}: meta.json is valid JSON`
    }));

    let meta;
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { continue; }

    // Terminal status check
    const terminalStatuses = ['COMPLETE', 'BLOCKED', 'FAILED'];
    addCheck(signal, {
      id: `site.${slug}.terminal_status`, category: 'per_site', severity: 'critical',
      message: `${slug}: has terminal status`,
      status: terminalStatuses.includes(meta.status) ? 'PASS' : 'FAIL',
      detail: `status=${meta.status}`,
      fix_hint: `Set status in meta.json to COMPLETE, BLOCKED, or FAILED`
    });

    // If BLOCKED, skip evidence checks
    if (meta.status === 'BLOCKED') {
      addCheck(signal, {
        id: `site.${slug}.blocked_skip`, category: 'per_site', severity: 'info',
        status: 'SKIP', message: `${slug}: BLOCKED — skipping evidence checks`,
        detail: meta.block_reason || 'unknown'
      });
      continue;
    }

    if (meta.status === 'COMPLETE') completeSlugs.push(slug);

    // Screenshots
    for (const screenshot of REQUIRED_SCREENSHOTS) {
      const ssPath = path.join(siteDir, 'evidence', screenshot);
      addCheck(signal, checks.fileExists(ssPath, {
        id: `site.${slug}.screenshot.${screenshot}`, category: 'evidence',
        message: `${slug}: ${screenshot} exists`
      }));
      if (fs.existsSync(ssPath)) {
        addCheck(signal, checks.fileMinSize(ssPath, 1, {
          id: `site.${slug}.screenshot.${screenshot}.nonzero`, category: 'evidence',
          message: `${slug}: ${screenshot} is non-empty`
        }));
      }
    }

    // DOM snapshot
    addCheck(signal, checks.fileExists(path.join(siteDir, 'evidence', 'dom_snapshot.txt'), {
      id: `site.${slug}.dom`, category: 'evidence', message: `${slug}: dom_snapshot.txt exists`
    }));
    if (fs.existsSync(path.join(siteDir, 'evidence', 'dom_snapshot.txt'))) {
      addCheck(signal, checks.fileMinSize(path.join(siteDir, 'evidence', 'dom_snapshot.txt'), 100, {
        id: `site.${slug}.dom.size`, category: 'evidence', severity: 'warning',
        message: `${slug}: dom_snapshot.txt >= 100 bytes`
      }));
    }

    // SEO data
    const seoPath = path.join(siteDir, 'evidence', 'seo_data.json');
    addCheck(signal, checks.fileExists(seoPath, {
      id: `site.${slug}.seo_exists`, category: 'evidence', message: `${slug}: seo_data.json exists`
    }));
    if (fs.existsSync(seoPath)) {
      addCheck(signal, checks.jsonValid(seoPath, {
        id: `site.${slug}.seo_valid`, category: 'evidence', message: `${slug}: seo_data.json is valid JSON`
      }));
    }

    // Analysis JSON
    const analysisJsonPath = path.join(siteDir, 'derived', 'site_analysis.json');
    addCheck(signal, checks.fileExists(analysisJsonPath, {
      id: `site.${slug}.analysis_json`, category: 'analysis', message: `${slug}: site_analysis.json exists`
    }));
    if (fs.existsSync(analysisJsonPath)) {
      addCheck(signal, checks.jsonValid(analysisJsonPath, {
        id: `site.${slug}.analysis_json_valid`, category: 'analysis',
        message: `${slug}: site_analysis.json is valid JSON`
      }));
      addCheck(signal, checks.jsonHasKeys(analysisJsonPath, REQUIRED_ANALYSIS_KEYS, {
        id: `site.${slug}.analysis_keys`, category: 'analysis',
        message: `${slug}: site_analysis.json has required keys`
      }));
    }

    // Analysis markdown
    const analysisMdPath = path.join(siteDir, 'derived', 'site_analysis.md');
    addCheck(signal, checks.fileExists(analysisMdPath, {
      id: `site.${slug}.analysis_md`, category: 'analysis', message: `${slug}: site_analysis.md exists`
    }));
    if (fs.existsSync(analysisMdPath)) {
      addCheck(signal, checks.fileMinSize(analysisMdPath, 500, {
        id: `site.${slug}.analysis_md_size`, category: 'analysis', severity: 'warning',
        message: `${slug}: site_analysis.md >= 500 bytes`
      }));
    }
  }

  // ─── Cross-Site Checks ──────────────────────────────────────────────────

  // Feature Matrix
  const matrixPath = path.join(basePath, 'derived', 'FEATURE_MATRIX.md');
  addCheck(signal, checks.fileExists(matrixPath, {
    id: 'cross_site.feature_matrix', category: 'cross_site', message: 'FEATURE_MATRIX.md exists'
  }));

  if (fs.existsSync(matrixPath) && completeSlugs.length > 0) {
    const matrixContent = fs.readFileSync(matrixPath, 'utf8');
    for (const slug of completeSlugs) {
      const name = NAME_MAP[slug] || slug;
      const found = matrixContent.includes(slug) ||
        matrixContent.includes(slug.replace(/_/g, ' ')) ||
        matrixContent.includes(name);
      addCheck(signal, {
        id: `cross_site.matrix_has.${slug}`, category: 'cross_site', severity: 'critical',
        message: `FEATURE_MATRIX.md includes ${slug}`,
        status: found ? 'PASS' : 'FAIL',
        fix_hint: `Add ${name} (${slug}) to FEATURE_MATRIX.md`
      });
    }
  }

  // Competitive Summary
  const summaryPath = path.join(basePath, 'derived', 'COMPETITIVE_SUMMARY.md');
  addCheck(signal, checks.fileExists(summaryPath, {
    id: 'cross_site.summary', category: 'cross_site', message: 'COMPETITIVE_SUMMARY.md exists'
  }));

  if (fs.existsSync(summaryPath)) {
    addCheck(signal, checks.fileMinSize(summaryPath, 1000, {
      id: 'cross_site.summary_size', category: 'cross_site', severity: 'warning',
      message: 'COMPETITIVE_SUMMARY.md >= 1000 bytes'
    }));

    const summaryContent = fs.readFileSync(summaryPath, 'utf8');
    for (const section of REQUIRED_SUMMARY_SECTIONS) {
      addCheck(signal, {
        id: `cross_site.summary_section.${section.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}`,
        category: 'cross_site', severity: 'critical',
        message: `COMPETITIVE_SUMMARY.md has "${section}"`,
        status: summaryContent.includes(section) ? 'PASS' : 'FAIL',
        fix_hint: `Add section "${section}" to COMPETITIVE_SUMMARY.md`
      });
    }
  }

  // No pending sites
  const pendingSlugs = siteSlugs.filter(slug => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(sitesDir, slug, 'meta.json'), 'utf8'));
      return !['COMPLETE', 'BLOCKED', 'FAILED'].includes(meta.status);
    } catch { return true; }
  });

  addCheck(signal, {
    id: 'cross_site.no_pending', category: 'cross_site', severity: 'warning',
    message: 'No sites in PENDING status',
    status: pendingSlugs.length === 0 ? 'PASS' : 'WARN',
    detail: pendingSlugs.length > 0 ? `Pending: ${pendingSlugs.join(', ')}` : 'All sites have terminal status'
  });
}

// ─── Finalize and Output ──────────────────────────────────────────────────

if (!printJsonOutput(signal)) {
  writeSignal(signal, outputPath);
  printSummary(signal);
  console.log(`\nSignal: ${outputPath}`);
}

process.exit(signal.gate_decision.proceed ? 0 : 1);
