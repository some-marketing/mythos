#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const projectRoot = process.cwd();
  const dashboardPath = path.join(projectRoot, '_dev/reports/analysis/plan-visibility__current.html');
  const indexPath = path.join(projectRoot, '_dev/reports/analysis/plan-visibility__index.html');
  const screenshotPath = path.join(projectRoot, '_dev/reports/analysis/plan-visibility__current-smoke.png');

  if (!fs.existsSync(dashboardPath) || !fs.existsSync(indexPath)) {
    throw new Error('Run npm run plans:dashboard before dashboard smoke verification.');
  }

  let chromium;
  try {
    chromium = require('playwright').chromium;
  } catch (error) {
    throw new Error(`Playwright is not available: ${error.message}`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(pathToFileURL(indexPath).href);
    await page.getByText('Mythos Plan Visibility Dashboard').waitFor({ timeout: 5000 });
    const routeMapText = await page.locator('main').textContent();
    if (!routeMapText.includes('Route Map') || !routeMapText.includes('Follow a workstream') || !routeMapText.includes('Make a brief')) {
      throw new Error('Index does not render the operator route map.');
    }
    if (!routeMapText.includes('Dashboard Navigator') || !routeMapText.includes('parent/child/subtask relationships')) {
      throw new Error('Index does not render the dashboard section navigator.');
    }
    const sectionNavLinks = await page.locator('.section-nav a[href^="#"]').count();
    if (sectionNavLinks < 8) {
      throw new Error(`Index rendered only ${sectionNavLinks} dashboard navigator links.`);
    }
    const hierarchyNavLinks = await page.locator('.section-nav a[href="#subtask-hierarchy-spotlight"]').count();
    if (hierarchyNavLinks !== 1) {
      throw new Error('Index dashboard navigator does not link to Subtask Hierarchy Spotlight.');
    }
    if (!routeMapText.includes('Operator Question Router') || !routeMapText.includes('Where should I start?') || !routeMapText.includes('How do plans interconnect?')) {
      throw new Error('Index does not render the operator question router.');
    }
    const questionRouterLinks = await page.locator('#operator-question-router + .route-map a[href]').count();
    if (questionRouterLinks < 4) {
      throw new Error(`Index rendered only ${questionRouterLinks} operator question route links.`);
    }
    if (!routeMapText.includes('How To Read This Map') || !routeMapText.includes('Generated map') || !routeMapText.includes('Trust boundary')) {
      throw new Error('Index does not render the map-reading guide.');
    }
    if (!routeMapText.includes('Protocol Readiness') || !routeMapText.includes('Protocol-ready plans') || !routeMapText.includes('/amend-plan')) {
      throw new Error('Index does not render the protocol-readiness surface.');
    }
    if (!routeMapText.includes('Execution Readiness') || !routeMapText.includes('Ready To Route') || !routeMapText.includes('Protocol Repair First')) {
      throw new Error('Index does not render the execution-readiness surface.');
    }
    if (!routeMapText.includes('Routing Blockers') || !routeMapText.includes('Routeability')) {
      throw new Error('Index does not render the routing-blockers surface.');
    }
    if (!routeMapText.includes('First Repair Path') || !routeMapText.includes('Recommended first step')) {
      throw new Error('Index does not render the first-repair-path surface.');
    }
    if (!routeMapText.includes('Risk Gate Queue') || !routeMapText.includes('Gate summary')) {
      throw new Error('Index does not render the risk-gate queue surface.');
    }
    if (!routeMapText.includes('Orchestration Routing Board') || !routeMapText.includes('Repair Before Dispatch') || !routeMapText.includes('Codex Bridge')) {
      throw new Error('Index does not render the orchestration-routing board.');
    }
    if (!routeMapText.includes('Command Runbook') || !routeMapText.includes('Command groups')) {
      throw new Error('Index does not render the command-runbook surface.');
    }
    if (!routeMapText.includes('Plan Protocol Flow') || !routeMapText.includes('concept-init') || !routeMapText.includes('plan-task') || !routeMapText.includes('completion audit')) {
      throw new Error('Index does not render the plan protocol flow.');
    }
    if (!routeMapText.includes('Review Lane Routing') || !routeMapText.includes('Codex Bridge') || !routeMapText.includes('Missing Review Lane')) {
      throw new Error('Index does not render the review-lane routing overview.');
    }
    const reviewRouteCards = await page.locator('.review-route').count();
    if (reviewRouteCards < 2) {
      throw new Error(`Index rendered only ${reviewRouteCards} review-lane routing cards.`);
    }
    const codexReviewLinks = await page.locator('.review-route[href="plan-visibility__current.html#review=codex-bridge"]').count();
    if (codexReviewLinks < 1) {
      throw new Error('Index review-lane routing does not link to codex-bridge filtered plans.');
    }
    const missingReviewLinks = await page.locator('.review-route[href="plan-visibility__current.html#quality=missing_review_lane"]').count();
    if (missingReviewLinks < 1) {
      throw new Error('Index review-lane routing does not link to missing-review-lane repairs.');
    }
    const protocolFlowSvgCount = await page.locator('.protocol-flow svg').count();
    if (protocolFlowSvgCount !== 1) {
      throw new Error(`Index rendered ${protocolFlowSvgCount} plan protocol flow SVGs instead of one.`);
    }
    if (!routeMapText.includes('Priority Scan') || !routeMapText.includes('Suggested next in largest workstream')) {
      throw new Error('Index does not render the priority scan.');
    }
    const priorityCardCount = await page.locator('.priority-card').count();
    if (priorityCardCount < 1) {
      throw new Error('Index priority scan did not render any priority cards.');
    }
    if (!routeMapText.includes('Action Readiness Flow') || !routeMapText.includes('Visible action candidates')) {
      throw new Error('Index does not render the action-readiness flow.');
    }
    const actionFlowSvgCount = await page.locator('.action-flow svg').count();
    if (actionFlowSvgCount !== 1) {
      throw new Error(`Index rendered ${actionFlowSvgCount} action-readiness SVGs instead of one.`);
    }
    const actionFlowHrefs = await page.locator('.action-flow a[href*="plan-visibility__current.html"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    if (actionFlowHrefs.length < 1) {
      throw new Error('Index action-readiness flow does not link back to dashboard routes.');
    }
    if (!routeMapText.includes('Workstream Overview') || !routeMapText.includes('Top connected workstreams')) {
      throw new Error('Index does not render the workstream overview visual.');
    }
    const workstreamOverviewSvgCount = await page.locator('.workstream-overview svg').count();
    if (workstreamOverviewSvgCount !== 1) {
      throw new Error(`Index rendered ${workstreamOverviewSvgCount} workstream overview SVGs instead of one.`);
    }
    const overviewClusterHrefs = await page.locator('.workstream-overview a[href*="plan-visibility__current.html#cluster="]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    if (overviewClusterHrefs.length < 1) {
      throw new Error('Index workstream overview does not link to focused dashboard cluster views.');
    }
    if (!routeMapText.includes('Largest Workstream Breakdown') || !routeMapText.includes('Status mix') || !routeMapText.includes('Bridge plans')) {
      throw new Error('Index does not render the largest-workstream breakdown.');
    }
    if (!routeMapText.includes('Workstream Drilldowns') || !routeMapText.includes('Drilldown summary')) {
      throw new Error('Index does not render the workstream drilldowns.');
    }
    const largestBreakdownSvgCount = await page.locator('.workstream-breakdown svg').count();
    if (largestBreakdownSvgCount !== 1) {
      throw new Error(`Index rendered ${largestBreakdownSvgCount} largest-workstream breakdown SVGs instead of one.`);
    }
    const largestBreakdownHrefs = await page.locator('.workstream-breakdown a[href*="plan-visibility__current.html#cluster="]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    if (largestBreakdownHrefs.length < 1) {
      throw new Error('Index largest-workstream breakdown does not link to focused dashboard cluster views.');
    }
    if (!routeMapText.includes('Interconnection Paths') || !routeMapText.includes('feeds from:') || !routeMapText.includes('feeds into:')) {
      throw new Error('Index does not render interconnection path summaries.');
    }
    const interconnectionPathCards = await page.locator('.interconnection-path').count();
    if (interconnectionPathCards < 1) {
      throw new Error('Index rendered no interconnection path cards.');
    }
    const interconnectionPathHrefs = await page.locator('.interconnection-path[href*="plan-visibility__current.html#cluster="]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    if (interconnectionPathHrefs.length < 1) {
      throw new Error('Index interconnection paths do not link to focused dashboard routes.');
    }
    if (!routeMapText.includes('Dependency & Sequence Chains')) {
      throw new Error('Index does not render dependency and sequence chains.');
    }
    const dependencyChainHrefs = await page.locator('.dependency-chain[href^="plan-visibility__current.html#from="]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    if (dependencyChainHrefs.length < 1) {
      throw new Error('Index dependency chains do not link into the connection path finder.');
    }
    if (!routeMapText.includes('Connection Evidence Spotlight')) {
      throw new Error('Index does not render the connection evidence spotlight.');
    }
    const evidenceCards = await page.locator('.evidence-card').count();
    if (evidenceCards < 1) {
      throw new Error('Index rendered no connection evidence cards.');
    }
    const evidenceCardHrefs = await page.locator('.evidence-card[href*="plan-visibility__current.html#from="]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    if (evidenceCardHrefs.length < 1) {
      throw new Error('Index connection evidence cards do not link to connection-path routes.');
    }
    if (!routeMapText.includes('Subtask Hierarchy Spotlight')) {
      throw new Error('Index does not render the subtask hierarchy spotlight.');
    }
    const hierarchyCards = await page.locator('.hierarchy-card').count();
    if (hierarchyCards < 1) {
      throw new Error('Index rendered no subtask hierarchy cards.');
    }
    const hierarchyCardHrefs = await page.locator('.hierarchy-card[href*="intent=hierarchy"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    if (hierarchyCardHrefs.length < 1) {
      throw new Error('Index subtask hierarchy cards do not link to hierarchy-filtered dashboard routes.');
    }
    if (!routeMapText.includes('Bridge Plans') || !routeMapText.includes('Highly connected bridge plans')) {
      throw new Error('Index does not render the bridge-plan overview visual.');
    }
    const bridgeOverviewSvgCount = await page.locator('.bridge-overview svg').count();
    if (bridgeOverviewSvgCount !== 1) {
      throw new Error(`Index rendered ${bridgeOverviewSvgCount} bridge-plan overview SVGs instead of one.`);
    }
    const bridgePlanHrefs = await page.locator('.bridge-overview a[href*="plan-visibility__current.html#plan="]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    if (bridgePlanHrefs.length < 1) {
      throw new Error('Index bridge-plan overview does not link to selected-plan dashboard views.');
    }
    if (!routeMapText.includes('Relationship Types') || !routeMapText.includes('Relationship types detected in the plan map')) {
      throw new Error('Index does not render the relationship-type overview visual.');
    }
    const intentOverviewSvgCount = await page.locator('.intent-overview svg').count();
    if (intentOverviewSvgCount < 2) {
      throw new Error(`Index rendered ${intentOverviewSvgCount} relationship overview SVGs instead of at least two.`);
    }
    const intentHrefs = await page.locator('.intent-overview a[href*="plan-visibility__current.html#intent="]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    if (intentHrefs.length < 1) {
      throw new Error('Index relationship-type overview does not link to relationship-intent filters.');
    }
    if (!routeMapText.includes('Relationship Confidence') || !routeMapText.includes('Confidence labels distinguish declared metadata links')) {
      throw new Error('Index does not render the relationship-confidence overview visual.');
    }
    const confidenceHrefs = await page.locator('.intent-overview a[href*="plan-visibility__current.html#confidence="]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    if (confidenceHrefs.length < 1) {
      throw new Error('Index relationship-confidence overview does not link to confidence filters.');
    }
    if (!routeMapText.includes('Status Overview') || !routeMapText.includes('Plan status buckets')) {
      throw new Error('Index does not render the status overview visual.');
    }
    const statusOverviewSvgCount = await page.locator('.status-overview svg').count();
    if (statusOverviewSvgCount !== 1) {
      throw new Error(`Index rendered ${statusOverviewSvgCount} status overview SVGs instead of one.`);
    }
    const statusHrefs = await page.locator('.status-overview a[href*="plan-visibility__current.html#status="]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    if (statusHrefs.length < 1) {
      throw new Error('Index status overview does not link to status filters.');
    }
    if (!routeMapText.includes('Map Quality') || !routeMapText.includes('Map-quality gaps that reduce confidence')) {
      throw new Error('Index does not render the map-quality overview visual.');
    }
    const qualityOverviewSvgCount = await page.locator('.quality-overview svg').count();
    if (qualityOverviewSvgCount !== 1) {
      throw new Error(`Index rendered ${qualityOverviewSvgCount} map-quality overview SVGs instead of one.`);
    }
    const qualityHrefs = await page.locator('.quality-overview a[href*="plan-visibility__current.html#quality="]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    if (qualityHrefs.length < 1) {
      throw new Error('Index map-quality overview does not link to quality filters.');
    }
    if (!routeMapText.includes('Decision Guide') || !routeMapText.includes('Choose a slice') || !routeMapText.includes('Act from authority')) {
      throw new Error('Index does not render the operator decision guide.');
    }
    if (!routeMapText.includes('Quick Views') || !routeMapText.includes('Ready Plans') || !routeMapText.includes('Unlinked Plans') || !routeMapText.includes('Data Quality Gaps') || !routeMapText.includes('Suggested Next In Largest Cluster')) {
      throw new Error('Index does not render dashboard quick views.');
    }
    if (!routeMapText.includes('Workstream Routes') || !routeMapText.includes('Suggested next:') || !routeMapText.includes('Open map') || !routeMapText.includes('Open brief')) {
      throw new Error('Index does not render workstream route cards.');
    }
    if (!routeMapText.includes('Graph Health') || !routeMapText.includes('Coverage') || !routeMapText.includes('Weakest areas')) {
      throw new Error('Index does not render graph health.');
    }
    if (!routeMapText.includes('Map Confidence Actions') || !routeMapText.includes('Open filtered view')) {
      throw new Error('Index does not render map-confidence actions.');
    }
    if (!routeMapText.includes('Remediation Queue') || !routeMapText.includes('Open source')) {
      throw new Error('Index does not render remediation queue.');
    }
    if (!routeMapText.includes('Visual Flowcharts') || !routeMapText.includes('System overview flowcharts') || !routeMapText.includes('Open artifact')) {
      throw new Error('Index does not render visual flowchart inventory.');
    }
    const remediationSourceHrefs = await page.locator('a[href*="/task-plans/"][href$="__plan.json"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    if (remediationSourceHrefs.length < 1) {
      throw new Error('Index remediation queue does not link to source task plans.');
    }
    for (const href of remediationSourceHrefs.slice(0, 4)) {
      const sourcePath = path.resolve(path.dirname(indexPath), href);
      if (!sourcePath.startsWith(projectRoot) || !fs.existsSync(sourcePath)) {
        throw new Error(`Index remediation source link does not resolve inside the repo: ${href}`);
      }
    }
    const readyViewHref = await page.locator('a[href="plan-visibility__current.html#status=ready"]').first().getAttribute('href');
    if (readyViewHref !== 'plan-visibility__current.html#status=ready') {
      throw new Error('Index does not link to the ready-plans quick view.');
    }
    const unlinkedViewHref = await page.locator('a[href="plan-visibility__current.html#quality=unlinked"]').first().getAttribute('href');
    if (unlinkedViewHref !== 'plan-visibility__current.html#quality=unlinked') {
      throw new Error('Index does not link to the unlinked-plans quick view.');
    }
    const qualityGapHref = await page.locator('a[href="plan-visibility__current.html#quality=missing_review_lane"]').first().getAttribute('href');
    if (qualityGapHref !== 'plan-visibility__current.html#quality=missing_review_lane') {
      throw new Error('Index does not link to the data-quality-gap quick view.');
    }
    const suggestedViewHref = await page.locator('a[href*="#cluster="][href*="&plan="]').first().getAttribute('href');
    if (!suggestedViewHref) {
      throw new Error('Index does not link to the suggested-next cluster quick view.');
    }
    const currentHref = await page.locator('a[href="plan-visibility__current.html"]').first().getAttribute('href');
    if (currentHref !== 'plan-visibility__current.html') {
      throw new Error('Index does not link to system dashboard.');
    }
    const visualLibraryHref = await page.locator('a[href="visual-plans/index.html"]').first().getAttribute('href');
    if (visualLibraryHref !== 'visual-plans/index.html') {
      throw new Error('Index does not link to the focused visual brief library.');
    }
    const visualLibraryPath = path.resolve(path.dirname(indexPath), visualLibraryHref);
    if (!visualLibraryPath.startsWith(projectRoot) || !fs.existsSync(visualLibraryPath)) {
      throw new Error(`Focused visual brief library link does not resolve inside the repo: ${visualLibraryHref}`);
    }
    const visualLibraryMarkdownHref = await page.locator('a[href="visual-plans/index.md"]').first().getAttribute('href');
    if (visualLibraryMarkdownHref !== 'visual-plans/index.md') {
      throw new Error('Index does not link to the focused visual brief library Markdown.');
    }
    const visualLibraryMarkdownPath = path.resolve(path.dirname(indexPath), visualLibraryMarkdownHref);
    if (!visualLibraryMarkdownPath.startsWith(projectRoot) || !fs.existsSync(visualLibraryMarkdownPath)) {
      throw new Error(`Focused visual brief library Markdown link does not resolve inside the repo: ${visualLibraryMarkdownHref}`);
    }
    await page.goto(pathToFileURL(visualLibraryPath).href);
    const visualLibraryStats = await page.evaluate(() => {
      const data = JSON.parse(document.getElementById('visual-library-data').textContent);
      return {
        title: document.querySelector('h1')?.textContent || '',
        rows: data.rows.length,
        renderedRows: document.querySelectorAll('#rows tr').length,
        hasSearch: Boolean(document.querySelector('#search')),
        hasStatus: Boolean(document.querySelector('#status')),
        hasFramework: Boolean(document.querySelector('#framework')),
        text: document.body.textContent || ''
      };
    });
    if (visualLibraryStats.title !== 'Mythos Visual Brief Library' || visualLibraryStats.rows < 1 || visualLibraryStats.renderedRows !== visualLibraryStats.rows) {
      throw new Error(`Focused visual brief HTML library did not render all rows: ${JSON.stringify(visualLibraryStats)}`);
    }
    if (!visualLibraryStats.hasSearch || !visualLibraryStats.hasStatus || !visualLibraryStats.hasFramework || !visualLibraryStats.text.includes('Visible briefs')) {
      throw new Error('Focused visual brief HTML library is missing search/filter controls.');
    }
    await page.goto(pathToFileURL(indexPath).href);
    const adapterManifestHref = await page.locator('a[href="visual-plans/visual-plan-adapter-manifest.json"]').first().getAttribute('href');
    if (adapterManifestHref !== 'visual-plans/visual-plan-adapter-manifest.json') {
      throw new Error('Index does not link to the visual-plan adapter manifest.');
    }
    const adapterManifestPath = path.resolve(path.dirname(indexPath), adapterManifestHref);
    if (!adapterManifestPath.startsWith(projectRoot) || !fs.existsSync(adapterManifestPath)) {
      throw new Error(`Visual-plan adapter manifest link does not resolve inside the repo: ${adapterManifestHref}`);
    }
    const visualBriefHref = await page.locator('a[href="visual-plans/plan-visibility-surface.md"]').first().getAttribute('href');
    if (visualBriefHref !== 'visual-plans/plan-visibility-surface.md') {
      throw new Error('Index does not link to the focused plan visual brief.');
    }
    const visualBriefPath = path.resolve(path.dirname(indexPath), visualBriefHref);
    if (!visualBriefPath.startsWith(projectRoot) || !fs.existsSync(visualBriefPath)) {
      throw new Error(`Focused plan visual brief link does not resolve inside the repo: ${visualBriefHref}`);
    }
    const operatorBriefHref = await page.locator('a[href="plan-visibility__operator-brief.md"]').first().getAttribute('href');
    if (operatorBriefHref !== 'plan-visibility__operator-brief.md') {
      throw new Error('Index does not link to the operator brief.');
    }
    const operatorBriefPath = path.resolve(path.dirname(indexPath), operatorBriefHref);
    if (!operatorBriefPath.startsWith(projectRoot) || !fs.existsSync(operatorBriefPath)) {
      throw new Error(`Operator brief link does not resolve inside the repo: ${operatorBriefHref}`);
    }
    const workstreamBriefLinks = await page.locator('.workstreams a[href^="visual-plans/"][href$=".md"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    if (workstreamBriefLinks.length < 1) {
      throw new Error('Index workstream route cards do not link to focused visual briefs.');
    }
    for (const href of workstreamBriefLinks) {
      const briefPath = path.resolve(path.dirname(indexPath), href);
      if (!briefPath.startsWith(projectRoot) || !fs.existsSync(briefPath)) {
        throw new Error(`Index workstream brief link does not resolve inside the repo: ${href}`);
      }
    }

    await page.goto(pathToFileURL(dashboardPath).href);
    await page.locator('#plan-data').waitFor({ state: 'attached', timeout: 5000 });
    const stats = await page.evaluate(() => {
      const data = JSON.parse(document.getElementById('plan-data').textContent);
      return {
        plans: data.plans.length,
        relationships: data.relationships.length,
        rows: document.querySelectorAll('#plans tr').length,
        nextStepCells: document.querySelectorAll('#plans .next-step').length,
        briefingItems: document.querySelectorAll('#briefing li').length,
        modelBriefingItems: Array.isArray(data.briefing) ? data.briefing.length : 0,
        clusterCards: document.querySelectorAll('#clusters .cluster').length,
        clusterFocusButtons: document.querySelectorAll('#clusters button[data-cluster-id]').length,
        clusterBriefLinks: [...document.querySelectorAll('#clusters a[href^="visual-plans/"][href$=".md"]')].map((link) => link.getAttribute('href')),
        clusterSuggestedNextItems: [...document.querySelectorAll('#clusters .queue-reason')].filter((item) => item.textContent.includes('Suggested next:')).length,
        modelClusters: Array.isArray(data.relationship_clusters) ? data.relationship_clusters.length : 0,
        modelWorkstreamMatrix: Array.isArray(data.workstream_matrix) ? data.workstream_matrix.length : 0,
        workstreamMatrixRows: document.querySelectorAll('#workstreamMatrix tbody tr').length,
        workstreamMatrixText: document.querySelector('#workstreamMatrix')?.textContent || '',
        modelWorkstreamStories: Array.isArray(data.workstream_stories) ? data.workstream_stories.length : 0,
        modelWorkstreamDrilldowns: data.workstream_drilldowns && Array.isArray(data.workstream_drilldowns.drilldowns) ? data.workstream_drilldowns.drilldowns.length : 0,
        workstreamStoryRows: document.querySelectorAll('#workstreamStories tbody tr').length,
        workstreamStoryText: document.querySelector('#workstreamStories')?.textContent || '',
        hasStorySearch: Boolean(document.querySelector('#storySearch')),
        storyIntentOptions: document.querySelectorAll('#storyIntent option').length,
        hasStoryRelationshipMode: Boolean(document.querySelector('#storyRelationshipMode')),
        storySummaryText: document.querySelector('#storySummary')?.textContent || '',
        modelHubs: Array.isArray(data.relationship_hubs) ? data.relationship_hubs.length : 0,
        modelImpactHubRows: data.impact_hubs && Array.isArray(data.impact_hubs.rows) ? data.impact_hubs.rows.length : 0,
        impactHubRows: document.querySelectorAll('#impactHubs tbody tr').length,
        impactHubText: document.querySelector('#impactHubs')?.textContent || '',
        hubRows: document.querySelectorAll('#hubs tbody tr').length,
        hubText: document.querySelector('#hubs')?.textContent || '',
        modelActionPaths: Array.isArray(data.action_paths) ? data.action_paths.length : 0,
        modelDependencySequenceChains: Array.isArray(data.dependency_sequence_chains) ? data.dependency_sequence_chains.length : 0,
        modelOperatorQuestionRoutes: Array.isArray(data.operator_question_routes) ? data.operator_question_routes.length : 0,
        modelMapReadingGuideItems: data.map_reading_guide && Array.isArray(data.map_reading_guide.items) ? data.map_reading_guide.items.length : 0,
        modelProtocolReadinessReady: data.protocol_readiness && data.protocol_readiness.totals ? data.protocol_readiness.totals.protocol_ready : 0,
        modelProtocolReadinessRepairs: data.protocol_readiness && data.protocol_readiness.totals ? data.protocol_readiness.totals.needs_protocol_repair : 0,
        modelProtocolReadinessRows: data.protocol_readiness && Array.isArray(data.protocol_readiness.rows) ? data.protocol_readiness.rows.length : 0,
        modelExecutionReadinessLanes: data.execution_readiness && Array.isArray(data.execution_readiness.lanes) ? data.execution_readiness.lanes.length : 0,
        modelExecutionReadinessRows: data.execution_readiness && Array.isArray(data.execution_readiness.lanes) ? data.execution_readiness.lanes.reduce((total, lane) => total + (Array.isArray(lane.rows) ? lane.rows.length : 0), 0) : 0,
        modelRoutingBlockerRows: data.routing_blockers && Array.isArray(data.routing_blockers.blockers) ? data.routing_blockers.blockers.reduce((total, blocker) => total + (Number(blocker.count) || 0), 0) : 0,
        modelRoutingBlockerReady: data.routing_blockers ? data.routing_blockers.ready_to_route : null,
        modelFirstRepairPathSteps: data.first_repair_path && Array.isArray(data.first_repair_path.steps) ? data.first_repair_path.steps.length : 0,
        hasRiskGateQueue: Boolean(data.risk_gate_queue && Array.isArray(data.risk_gate_queue.rows)),
        riskGateQueueSummary: data.risk_gate_queue?.summary || '',
        riskGateQueueCandidates: data.risk_gate_queue?.totals ? Number(data.risk_gate_queue.totals.candidates || 0) : null,
        modelRiskGateQueueRows: data.risk_gate_queue && Array.isArray(data.risk_gate_queue.rows) ? data.risk_gate_queue.rows.length : 0,
        modelOrchestrationRoutingRows: data.orchestration_routing_board && Array.isArray(data.orchestration_routing_board.lanes) ? data.orchestration_routing_board.lanes.reduce((total, lane) => total + (Number(lane.count) || 0), 0) : 0,
        modelCommandRunbookRows: data.command_runbook && Array.isArray(data.command_runbook.groups) ? data.command_runbook.groups.reduce((total, group) => total + (Array.isArray(group.rows) ? group.rows.length : 0), 0) : 0,
        actionPathRows: document.querySelectorAll('#paths tbody tr').length,
        actionPathText: document.querySelector('#paths')?.textContent || '',
        visibleRelationshipRows: document.querySelectorAll('#visibleRelationships tbody tr').length,
        visibleRelationshipText: document.querySelector('#visibleRelationships')?.textContent || '',
        graphHealthCoverage: data.graph_health && data.graph_health.coverage_percent,
        graphHealthPanels: document.querySelectorAll('#graphHealth .overview-panel').length,
        graphHealthText: document.querySelector('#graphHealth')?.textContent || '',
        confidenceActionCount: data.graph_health && Array.isArray(data.graph_health.recommendations) ? data.graph_health.recommendations.length : 0,
        confidenceActionPanels: document.querySelectorAll('#confidenceActions .overview-panel').length,
        confidenceActionText: document.querySelector('#confidenceActions')?.textContent || '',
        remediationRows: Array.isArray(data.remediation_queue) ? data.remediation_queue.length : 0,
        visualFlowchartArtifacts: data.visual_flowcharts && Array.isArray(data.visual_flowcharts.items) ? data.visual_flowcharts.items.length : 0,
        visualFlowchartMermaidArtifacts: data.visual_flowcharts && Array.isArray(data.visual_flowcharts.items) ? data.visual_flowcharts.items.filter(item => Array.isArray(item.mermaid_blocks) && item.mermaid_blocks.length).length : 0,
        visualCoverageMissing: data.visual_coverage && Array.isArray(data.visual_coverage.queue) ? data.visual_coverage.queue.length : 0,
        visualCoverageRows: document.querySelectorAll('#visualCoverage tbody tr').length,
        visualCoverageText: document.querySelector('#visualCoverage')?.textContent || '',
        recentActivityItems: data.recent_activity && Array.isArray(data.recent_activity.items) ? data.recent_activity.items.length : 0,
        recentActivityRows: document.querySelectorAll('#recentActivity tbody tr').length,
        recentActivityText: document.querySelector('#recentActivity')?.textContent || '',
        planProgressTimelineItems: data.plan_progress_timeline && Array.isArray(data.plan_progress_timeline.items) ? data.plan_progress_timeline.items.length : 0,
        planProgressTimelineRows: document.querySelectorAll('#planProgressTimeline tbody tr').length,
        planProgressTimelineText: document.querySelector('#planProgressTimeline')?.textContent || '',
        planActionBoardLanes: data.plan_action_board && Array.isArray(data.plan_action_board.lanes) ? data.plan_action_board.lanes.length : 0,
        planActionBoardLaneLabels: data.plan_action_board && Array.isArray(data.plan_action_board.lanes) ? data.plan_action_board.lanes.map(lane => lane.label || '') : [],
        planActionBoardNonEmptyLanes: data.plan_action_board && Array.isArray(data.plan_action_board.lanes) ? data.plan_action_board.lanes.filter(lane => Array.isArray(lane.rows) && lane.rows.length).length : 0,
        planActionBoardRows: document.querySelectorAll('#planActionBoard tbody tr').length,
        planActionBoardText: document.querySelector('#planActionBoard')?.textContent || '',
        unlinkedPlanTriageItems: data.unlinked_plan_triage && Array.isArray(data.unlinked_plan_triage.rows) ? data.unlinked_plan_triage.rows.length : 0,
        unlinkedPlanTriageRows: document.querySelectorAll('#unlinkedPlanTriage tbody tr').length,
        unlinkedPlanTriageText: document.querySelector('#unlinkedPlanTriage')?.textContent || '',
        remediationRenderedRows: document.querySelectorAll('#remediationQueue tbody tr').length,
        remediationText: document.querySelector('#remediationQueue')?.textContent || '',
        graphNodes: document.querySelectorAll('#graph circle').length,
        graphLines: document.querySelectorAll('#graph line').length,
        graphDirectedLines: document.querySelectorAll('#graph line[marker-end]').length,
        graphEdgeTitles: document.querySelectorAll('#graph line title').length,
        hasGraphAll: Boolean(document.querySelector('#graphAll')),
        hasPathFrom: Boolean(document.querySelector('#pathFrom')),
        hasPathTo: Boolean(document.querySelector('#pathTo')),
        hasFindPath: Boolean(document.querySelector('#findPath')),
        pathResultText: document.querySelector('#pathResult')?.textContent || '',
        overviewPanels: document.querySelectorAll('#overview .overview-panel').length,
        qualityPanels: document.querySelectorAll('#quality .overview-panel').length,
        modelQualityItems: data.data_quality ? Object.keys(data.data_quality).length : 0,
        dependencyWatchVisible: document.querySelector('#overview')?.textContent.includes('Dependency Watch') || false,
        queueReasonItems: document.querySelectorAll('#overview .queue-reason').length,
        legendItems: document.querySelectorAll('#legend .legend-item').length,
        sourceLinks: document.querySelectorAll('a[data-source-link]').length,
        hasClientFilter: Boolean(document.querySelector('#client')),
        hasFrameworkFilter: Boolean(document.querySelector('#framework')),
        hasQualityFilter: Boolean(document.querySelector('#qualityFlag')),
        qualityOptions: document.querySelectorAll('#qualityFlag option').length,
        hasRelationshipIntentFilter: Boolean(document.querySelector('#relationshipIntent')),
        hasRelationshipConfidenceFilter: Boolean(document.querySelector('#relationshipConfidence')),
        relationshipConfidenceOptions: document.querySelectorAll('#relationshipConfidence option').length
      };
    });

    if (stats.plans < 1) throw new Error('Dashboard model contains no plans.');
    if (stats.rows < 1) throw new Error('Dashboard table rendered no rows.');
    if (stats.nextStepCells < stats.rows) throw new Error('Dashboard did not render next-step summaries for plan rows.');
    if (stats.modelBriefingItems < 1) throw new Error('Dashboard model contains no briefing items.');
    if (stats.briefingItems !== stats.modelBriefingItems) throw new Error('Dashboard briefing did not render every model briefing item.');
    if (stats.modelClusters < 1) throw new Error('Dashboard model contains no relationship clusters.');
    if (stats.clusterCards < 1) throw new Error('Dashboard rendered no relationship cluster cards.');
    if (stats.clusterFocusButtons < 1) throw new Error('Dashboard rendered no cluster focus buttons.');
    if (stats.clusterBriefLinks.length !== stats.clusterCards) {
      throw new Error(`Dashboard cluster brief link count mismatch: expected ${stats.clusterCards}, got ${stats.clusterBriefLinks.length}.`);
    }
    for (const href of stats.clusterBriefLinks) {
      const briefPath = path.resolve(path.dirname(dashboardPath), href);
      if (!briefPath.startsWith(projectRoot) || !fs.existsSync(briefPath)) {
        throw new Error(`Dashboard cluster brief link does not resolve inside the repo: ${href}`);
      }
    }
    if (stats.clusterSuggestedNextItems < 1) throw new Error('Dashboard rendered no suggested-next labels for relationship clusters.');
    if (stats.modelWorkstreamMatrix < 1) throw new Error('Dashboard model contains no workstream matrix rows.');
    if (stats.workstreamMatrixRows < 1) throw new Error('Dashboard rendered no workstream matrix rows.');
    if (stats.modelWorkstreamMatrix !== stats.modelClusters) {
      throw new Error(`Dashboard model workstream matrix does not cover every cluster: ${stats.modelWorkstreamMatrix} rows for ${stats.modelClusters} clusters.`);
    }
    if (stats.workstreamMatrixRows !== stats.modelWorkstreamMatrix) {
      throw new Error(`Dashboard rendered ${stats.workstreamMatrixRows} workstream matrix rows for ${stats.modelWorkstreamMatrix} model rows.`);
    }
    if (!stats.workstreamMatrixText.includes('Top intents') && !stats.workstreamMatrixText.includes('Suggested next')) {
      throw new Error('Dashboard workstream matrix did not render intent or suggested-next context.');
    }
    if (stats.modelWorkstreamStories < 1) throw new Error('Dashboard model contains no workstream connection stories.');
    if (stats.modelWorkstreamDrilldowns < 1) throw new Error('Dashboard model contains no workstream drilldowns.');
    if (stats.workstreamStoryRows !== stats.modelWorkstreamStories) {
      throw new Error(`Dashboard rendered ${stats.workstreamStoryRows} workstream story rows for ${stats.modelWorkstreamStories} model stories.`);
    }
    if (!stats.workstreamStoryText.includes('Example links') || !stats.workstreamStoryText.includes('Bridge plans')) {
      throw new Error('Dashboard workstream stories did not render example links and bridge plan context.');
    }
    if (!stats.hasStorySearch || stats.storyIntentOptions < 2 || !stats.hasStoryRelationshipMode) {
      throw new Error('Dashboard workstream stories are missing search or filter controls.');
    }
    if (!stats.storySummaryText.includes(`${stats.modelWorkstreamStories} of ${stats.modelWorkstreamStories}`)) {
      throw new Error('Dashboard workstream story summary did not render full coverage.');
    }
    const isolatedStoryStats = await page.evaluate(() => {
      const data = JSON.parse(document.getElementById('plan-data').textContent);
      const isolated = data.workstream_stories.filter(story => !story.relationship_examples || story.relationship_examples.length === 0).length;
      document.querySelector('#storyRelationshipMode').value = 'isolated';
      document.querySelector('#storyRelationshipMode').dispatchEvent(new Event('input', { bubbles: true }));
      return {
        isolated,
        rows: document.querySelectorAll('#workstreamStories tbody tr').length,
        summary: document.querySelector('#storySummary')?.textContent || '',
        text: document.querySelector('#workstreamStories')?.textContent || '',
        hash: window.location.hash
      };
    });
    if (isolatedStoryStats.rows !== isolatedStoryStats.isolated || !isolatedStoryStats.summary.includes(`${isolatedStoryStats.isolated} of ${stats.modelWorkstreamStories}`)) {
      throw new Error(`Dashboard isolated story filter mismatch: ${JSON.stringify(isolatedStoryStats)}`);
    }
    if (!isolatedStoryStats.text.includes('isolated plan') && !isolatedStoryStats.text.includes('isolated workstream')) {
      throw new Error('Dashboard isolated story filter did not render isolated-workstream wording.');
    }
    if (!isolatedStoryStats.hash.includes('storyMode=isolated')) {
      throw new Error(`Dashboard story filter did not persist in the URL hash: ${isolatedStoryStats.hash}`);
    }
    await page.goto(`${pathToFileURL(dashboardPath).href}#storyMode=isolated`);
    await page.locator('#plan-data').waitFor({ state: 'attached', timeout: 5000 });
    const restoredStoryStats = await page.evaluate(() => ({
      selectedMode: document.querySelector('#storyRelationshipMode')?.value || '',
      rows: document.querySelectorAll('#workstreamStories tbody tr').length,
      summary: document.querySelector('#storySummary')?.textContent || ''
    }));
    if (restoredStoryStats.selectedMode !== 'isolated' || restoredStoryStats.rows !== isolatedStoryStats.isolated) {
      throw new Error(`Dashboard story filter permalink did not restore: ${JSON.stringify(restoredStoryStats)}`);
    }
    if (stats.modelHubs < 1) throw new Error('Dashboard model contains no relationship hubs.');
    if (stats.modelImpactHubRows < 1) throw new Error('Dashboard model contains no impact hub rows.');
    if (stats.impactHubRows !== stats.modelImpactHubRows) {
      throw new Error(`Dashboard rendered ${stats.impactHubRows} impact hub rows for ${stats.modelImpactHubRows} model rows.`);
    }
    if (!stats.impactHubText.includes('Why it matters') || !stats.impactHubText.includes('Open map')) {
      throw new Error('Dashboard impact hubs did not render explanatory map context.');
    }
    if (stats.hubRows < 1) throw new Error('Dashboard rendered no connection hub rows.');
    if (!stats.hubText.includes('bridge') && !stats.hubText.includes('driver') && !stats.hubText.includes('convergence')) {
      throw new Error('Dashboard connection hubs did not render relationship roles.');
    }
    if (stats.modelActionPaths < 1) throw new Error('Dashboard model contains no action paths.');
    if (stats.actionPathRows < 1) throw new Error('Dashboard rendered no action path rows.');
    if (!stats.actionPathText.includes('Feeds from') && !stats.actionPathText.includes('Feeds into')) {
      throw new Error('Dashboard action paths did not render upstream/downstream labels.');
    }
    if (stats.relationships < 1) throw new Error('Dashboard model contains no relationships.');
    if (stats.visibleRelationshipRows !== stats.relationships) {
      throw new Error(`Visible Relationships table did not render every current relationship: expected ${stats.relationships}, got ${stats.visibleRelationshipRows}.`);
    }
    if (!stats.visibleRelationshipText.includes('Source') || !stats.visibleRelationshipText.includes('Target') || !stats.visibleRelationshipText.includes('Evidence')) {
      throw new Error('Visible Relationships table did not render source, target, and evidence columns.');
    }
    if (typeof stats.graphHealthCoverage !== 'number') throw new Error('Dashboard model contains no graph health coverage value.');
    if (stats.graphHealthPanels < 4) throw new Error('Dashboard did not render graph health panels.');
    if (!stats.graphHealthText.includes('Coverage') || !stats.graphHealthText.includes('Link density')) {
      throw new Error('Dashboard graph health section did not render coverage and density.');
    }
    if (stats.confidenceActionCount < 1) throw new Error('Dashboard model contains no map-confidence recommendations.');
    if (stats.confidenceActionPanels !== stats.confidenceActionCount) {
      throw new Error(`Dashboard map-confidence actions mismatch: expected ${stats.confidenceActionCount}, got ${stats.confidenceActionPanels}.`);
    }
    if (!stats.confidenceActionText.includes('Open filtered view')) {
      throw new Error('Dashboard map-confidence actions did not render filtered-view links.');
    }
    if (stats.remediationRows < 1) throw new Error('Dashboard model contains no remediation rows.');
    if (stats.modelDependencySequenceChains < 1) throw new Error('Dashboard model contains no dependency or sequence chains.');
    if (stats.modelOperatorQuestionRoutes < 4) throw new Error('Dashboard model contains too few operator question routes.');
    if (stats.modelMapReadingGuideItems < 4) throw new Error('Dashboard model contains too few map-reading guide items.');
    if (stats.modelProtocolReadinessRows < 1) throw new Error('Dashboard model contains no protocol-readiness repair rows.');
    if (stats.modelProtocolReadinessRepairs < 1) throw new Error('Dashboard model reports no protocol-readiness repair candidates.');
    if (stats.modelExecutionReadinessLanes < 3) throw new Error('Dashboard model contains too few execution-readiness lanes.');
    if (stats.modelExecutionReadinessRows < 1) throw new Error('Dashboard model contains no execution-readiness rows.');
    if (stats.modelRoutingBlockerReady === null) throw new Error('Dashboard model contains no routing-blocker ready-to-route count.');
    if (stats.modelRoutingBlockerRows < 1) throw new Error('Dashboard model contains no routing-blocker rows.');
    if (stats.modelFirstRepairPathSteps < 1) throw new Error('Dashboard model contains no first-repair-path steps.');
    if (!stats.hasRiskGateQueue) throw new Error('Dashboard model contains no risk-gate queue surface.');
    if (stats.riskGateQueueCandidates === null) throw new Error('Dashboard model contains no risk-gate queue totals.');
    if (!stats.riskGateQueueSummary.includes('ready or in-progress plans')) {
      throw new Error(`Dashboard risk-gate queue summary is missing ready/in-progress context: ${stats.riskGateQueueSummary}`);
    }
    if (stats.modelOrchestrationRoutingRows < 1) throw new Error('Dashboard model contains no orchestration-routing rows.');
    if (stats.modelCommandRunbookRows < 1) throw new Error('Dashboard model contains no command-runbook rows.');
    if (stats.visualFlowchartArtifacts < 1) throw new Error('Dashboard model contains no visual flowchart inventory.');
    if (stats.visualFlowchartMermaidArtifacts < 1) throw new Error('Dashboard model contains no Mermaid flowchart artifacts.');
    if (stats.remediationRenderedRows < 1) throw new Error('Dashboard did not render remediation rows.');
    if (!stats.remediationText.includes('Recommended fix') || !stats.remediationText.includes('Open filtered view')) {
      throw new Error('Dashboard remediation queue did not render fixes and filter links.');
    }
    if (stats.visualCoverageMissing > 0 && stats.visualCoverageRows !== stats.visualCoverageMissing) {
      throw new Error(`Dashboard visual coverage queue did not render every queued item: expected ${stats.visualCoverageMissing}, got ${stats.visualCoverageRows}.`);
    }
    if (stats.visualCoverageMissing === 0 && stats.visualCoverageRows !== 0) {
      throw new Error(`Dashboard visual coverage queue rendered rows despite complete coverage: got ${stats.visualCoverageRows}.`);
    }
    if (!stats.visualCoverageText.includes('workstreams have generated visual briefs') && !stats.visualCoverageText.includes('All detected workstreams have generated visual briefs')) {
      throw new Error('Dashboard visual coverage queue did not render a coverage summary.');
    }
    if (stats.visualCoverageMissing > 0 && !stats.visualCoverageText.includes('npm run plans:visual')) {
      throw new Error('Dashboard visual coverage queue did not render generate commands for missing briefs.');
    }
    if (stats.recentActivityItems < 1) throw new Error('Dashboard model contains no recent source activity items.');
    if (stats.recentActivityRows !== Math.min(stats.recentActivityItems, 12)) {
      throw new Error(`Dashboard recent activity did not render every model item: expected ${Math.min(stats.recentActivityItems, 12)}, got ${stats.recentActivityRows}.`);
    }
    if (!stats.recentActivityText.includes('Open source') || !stats.recentActivityText.includes('Modified')) {
      throw new Error('Dashboard recent activity did not render source links and modified-time context.');
    }
    if (stats.planProgressTimelineItems < 1) throw new Error('Dashboard model contains no plan progress timeline items.');
    if (stats.planProgressTimelineRows !== Math.min(stats.planProgressTimelineItems, 18)) {
      throw new Error(`Dashboard plan progress timeline did not render every model item: expected ${Math.min(stats.planProgressTimelineItems, 18)}, got ${stats.planProgressTimelineRows}.`);
    }
    if (!stats.planProgressTimelineText.includes('Next command') || !stats.planProgressTimelineText.includes('Next step')) {
      throw new Error('Dashboard plan progress timeline did not render next-step and next-command context.');
    }
    if (stats.planActionBoardLanes < 1) throw new Error('Dashboard model contains no plan action board lanes.');
    if (!stats.planActionBoardLaneLabels.includes('Runnable Now')) throw new Error('Dashboard model contains no Runnable Now action-board lane.');
    if (stats.planActionBoardNonEmptyLanes > 0 && stats.planActionBoardRows < 1) throw new Error('Dashboard rendered no plan action board rows.');
    if (stats.planActionBoardNonEmptyLanes === 0 && !stats.planActionBoardText.includes('No action lanes are available')) {
      throw new Error('Dashboard plan action board did not render an empty-state summary.');
    }
    if (stats.planActionBoardRows > 0 && (!stats.planActionBoardText.includes('Next') || !stats.planActionBoardText.includes('/amend-plan'))) {
      throw new Error('Dashboard plan action board did not render lane and command context.');
    }
    if (stats.unlinkedPlanTriageItems < 1) throw new Error('Dashboard model contains no unlinked plan triage items.');
    if (stats.unlinkedPlanTriageRows !== Math.min(stats.unlinkedPlanTriageItems, 24)) {
      throw new Error(`Dashboard unlinked plan triage did not render every model item: expected ${Math.min(stats.unlinkedPlanTriageItems, 24)}, got ${stats.unlinkedPlanTriageRows}.`);
    }
    if (!stats.unlinkedPlanTriageText.includes('Suggested repair') || !stats.unlinkedPlanTriageText.includes('Open map')) {
      throw new Error('Dashboard unlinked plan triage did not render repair guidance and map links.');
    }
    if (stats.graphNodes < 1) throw new Error('Dashboard graph rendered no nodes.');
    if (stats.graphDirectedLines < 1) throw new Error('Dashboard graph rendered no directed edges.');
    if (stats.graphEdgeTitles < 1) throw new Error('Dashboard graph rendered no edge hover titles.');
    if (!stats.hasGraphAll) throw new Error('Dashboard is missing the all-filtered graph toggle.');
    const allGraphStats = await page.evaluate(() => {
      document.querySelector('#graphAll').checked = true;
      document.querySelector('#graphAll').dispatchEvent(new Event('input', { bubbles: true }));
      return {
        plans: JSON.parse(document.getElementById('plan-data').textContent).plans.length,
        graphNodes: document.querySelectorAll('#graph circle').length,
        graphSummary: document.querySelector('#graphSummary')?.textContent || ''
      };
    });
    if (allGraphStats.graphNodes !== allGraphStats.plans || !allGraphStats.graphSummary.includes('all filtered plans')) {
      throw new Error(`All-filtered graph did not render every visible plan: ${JSON.stringify(allGraphStats)}`);
    }
    if (!stats.hasPathFrom || !stats.hasPathTo || !stats.hasFindPath) throw new Error('Dashboard is missing the connection path finder controls.');
    if (!stats.pathResultText.includes('Choose two plans')) throw new Error('Dashboard connection path finder did not render its empty state.');
    if (stats.overviewPanels !== 4) throw new Error('Dashboard overview did not render the expected four panels.');
    if (stats.modelQualityItems < 1) throw new Error('Dashboard model contains no data-quality items.');
    if (stats.qualityPanels !== stats.modelQualityItems) throw new Error(`Dashboard data-quality section did not render every model item: expected ${stats.modelQualityItems}, got ${stats.qualityPanels}.`);
    if (!stats.dependencyWatchVisible) throw new Error('Dashboard overview did not render Dependency Watch.');
    if (stats.queueReasonItems < 1) throw new Error('Dashboard overview rendered no queue reason labels.');
    if (stats.legendItems < 1) throw new Error('Dashboard relationship legend rendered no intent items.');
    if (stats.sourceLinks < stats.rows) throw new Error('Dashboard did not render source links for plan rows.');
    if (!stats.hasClientFilter || !stats.hasFrameworkFilter || !stats.hasRelationshipIntentFilter || !stats.hasRelationshipConfidenceFilter || !stats.hasQualityFilter || stats.qualityOptions < 2 || stats.relationshipConfidenceOptions < 2) {
      throw new Error('Dashboard filters are incomplete.');
    }

    const clusterStats = await page.evaluate(() => {
      const data = JSON.parse(document.getElementById('plan-data').textContent);
      const cluster = data.relationship_clusters.find((item) => item.size > 1) || data.relationship_clusters[0];
      focusCluster(cluster.id);
      const focusedRows = document.querySelectorAll('#plans tr').length;
      const focusText = document.querySelector('#clusterFocus')?.textContent || '';
      clearClusterFocus();
      const clearedRows = document.querySelectorAll('#plans tr').length;
      return { clusterId: cluster.id, clusterSize: cluster.size, focusedRows, clearedRows, focusText };
    });

    if (!clusterStats.focusText.includes(clusterStats.clusterId)) {
      throw new Error('Cluster focus banner did not name the focused cluster.');
    }
    if (clusterStats.focusedRows !== clusterStats.clusterSize) {
      throw new Error(`Cluster focus row count mismatch: expected ${clusterStats.clusterSize}, got ${clusterStats.focusedRows}.`);
    }
    if (clusterStats.clearedRows !== stats.rows) {
      throw new Error('Clearing cluster focus did not restore the full row count.');
    }

    const permalinkStats = await page.evaluate(() => {
      const data = JSON.parse(document.getElementById('plan-data').textContent);
      const planById = new Map(data.plans.map((plan) => [plan.task_id, plan]));
      let cluster = data.relationship_clusters.find((item) => (
        item.size > 1
        && item.plan_ids.some((id) => (planById.get(id)?.quality_flags || []).length > 0)
      )) || data.relationship_clusters.find((item) => item.size > 1) || data.relationship_clusters[0];
      let selectedPlan = null;
      let quality = '';
      for (const id of cluster.plan_ids) {
        const plan = planById.get(id);
        if (plan && (plan.quality_flags || []).length > 0) {
          selectedPlan = plan;
          quality = plan.quality_flags[0];
          break;
        }
      }
      if (!selectedPlan) selectedPlan = planById.get(cluster.sample_plans[0]);
      const planId = selectedPlan?.task_id || cluster.sample_plans[0];
      const status = selectedPlan?.status || '';
      const filteredSize = cluster.plan_ids
        .map((id) => planById.get(id))
        .filter((plan) => plan && plan.status === status && (!quality || (plan.quality_flags || []).includes(quality))).length;
      return { clusterId: cluster.id, clusterSize: cluster.size, planId, status, quality, filteredSize };
    });
    const permalinkHash = new URLSearchParams();
    permalinkHash.set('cluster', permalinkStats.clusterId);
    permalinkHash.set('plan', permalinkStats.planId);
    permalinkHash.set('status', permalinkStats.status);
    if (permalinkStats.quality) permalinkHash.set('quality', permalinkStats.quality);
    await page.goto(`${pathToFileURL(dashboardPath).href}?permalink-smoke=1#${permalinkHash.toString()}`);
    await page.locator('#plan-data').waitFor({ state: 'attached', timeout: 5000 });
    const restoredStats = await page.evaluate(() => ({
      restoredRows: document.querySelectorAll('#plans tr').length,
      restoredStatus: document.querySelector('#status')?.value || '',
      restoredQuality: document.querySelector('#qualityFlag')?.value || '',
      restoredFocusText: document.querySelector('#clusterFocus')?.textContent || '',
      restoredDetailText: document.querySelector('#detail')?.textContent || '',
      restoredHash: window.location.hash
    }));
    if (restoredStats.restoredStatus !== permalinkStats.status) {
      throw new Error(`Permalink did not restore the status filter: expected ${permalinkStats.status}, got ${restoredStats.restoredStatus}.`);
    }
    if (restoredStats.restoredQuality !== permalinkStats.quality) {
      throw new Error(`Permalink did not restore the quality filter: expected ${permalinkStats.quality}, got ${restoredStats.restoredQuality}.`);
    }
    if (restoredStats.restoredRows !== permalinkStats.filteredSize) {
      throw new Error(`Permalink quality filter did not restore the expected row count: expected ${permalinkStats.filteredSize}, got ${restoredStats.restoredRows}; hash ${restoredStats.restoredHash}; focus ${restoredStats.restoredFocusText}`);
    }
    if (!restoredStats.restoredFocusText.includes(permalinkStats.clusterId)) {
      throw new Error('Permalink did not restore the cluster focus banner.');
    }
    if (!restoredStats.restoredDetailText.includes(permalinkStats.planId)) {
      throw new Error('Permalink did not restore the selected plan detail.');
    }

    await page.goto(pathToFileURL(dashboardPath).href);
    await page.locator('#plan-data').waitFor({ state: 'attached', timeout: 5000 });
    const relatedTaskId = await page.evaluate(() => {
      const data = JSON.parse(document.getElementById('plan-data').textContent);
      const counts = new Map();
      for (const relationship of data.relationships) {
        const sourceCounts = counts.get(relationship.source) || { incoming: 0, outgoing: 0 };
        sourceCounts.outgoing += 1;
        counts.set(relationship.source, sourceCounts);
        const targetCounts = counts.get(relationship.target) || { incoming: 0, outgoing: 0 };
        targetCounts.incoming += 1;
        counts.set(relationship.target, targetCounts);
      }
      for (const plan of data.plans) {
        const count = counts.get(plan.task_id);
        if (count && count.incoming > 0 && count.outgoing > 0) return plan.task_id;
      }
      return data.relationships[0]?.source;
    });
    if (!relatedTaskId) throw new Error('Dashboard model has no relationship source to inspect.');
    await page.evaluate((taskId) => selectPlan(taskId), relatedTaskId);
    const selectedStats = await page.evaluate(() => ({
      hasNeighborhoodToggle: Boolean(document.querySelector('#neighborhood')),
      detailMentionsIncoming: document.querySelector('#detail')?.textContent.includes('Incoming') || false,
      detailMentionsOutgoing: document.querySelector('#detail')?.textContent.includes('Outgoing') || false,
      detailMentionsNextStep: document.querySelector('#detail')?.textContent.includes('Next step') || false,
      detailMentionsPlanContext: document.querySelector('#detail')?.textContent.includes('Plan Context') || false,
      detailMentionsWorkstream: document.querySelector('#detail')?.textContent.includes('Workstream') || false,
      detailMentionsActionPath: document.querySelector('#detail')?.textContent.includes('Action path') || false,
      detailMentionsLocalFlow: document.querySelector('#detail')?.textContent.includes('Local flow') || false,
      selectedFlowSvgCount: document.querySelectorAll('#detail .selected-flow svg').length,
      detailSourceHref: document.querySelector('#detail a[data-source-link]')?.getAttribute('href') || '',
      graphSummary: document.querySelector('#graphSummary')?.textContent || '',
      graphNodesAfterSelect: document.querySelectorAll('#graph circle').length
    }));

    if (!selectedStats.hasNeighborhoodToggle) throw new Error('Dashboard is missing the neighborhood graph toggle.');
    if (!selectedStats.detailMentionsIncoming || !selectedStats.detailMentionsOutgoing) {
      throw new Error('Selected plan detail does not split incoming and outgoing relationships.');
    }
    if (!selectedStats.detailMentionsNextStep) {
      throw new Error('Selected plan detail does not include next-step information.');
    }
    if (!selectedStats.detailMentionsPlanContext || !selectedStats.detailMentionsWorkstream || !selectedStats.detailMentionsActionPath) {
      throw new Error('Selected plan detail does not include plan context, workstream, and action-path information.');
    }
    if (!selectedStats.detailMentionsLocalFlow || selectedStats.selectedFlowSvgCount !== 1) {
      throw new Error(`Selected plan detail does not render exactly one local-flow SVG: ${JSON.stringify(selectedStats)}`);
    }
    if (!selectedStats.detailSourceHref) {
      throw new Error('Selected plan detail does not include a source artifact link.');
    }
    const detailSourcePath = path.resolve(path.dirname(dashboardPath), selectedStats.detailSourceHref);
    if (!detailSourcePath.startsWith(projectRoot) || !fs.existsSync(detailSourcePath)) {
      throw new Error(`Selected plan source link does not resolve inside the repo: ${selectedStats.detailSourceHref}`);
    }
    if (!selectedStats.graphSummary.includes('selected neighborhood')) {
      throw new Error('Graph summary did not switch to selected neighborhood mode.');
    }
    if (selectedStats.graphNodesAfterSelect < 1) {
      throw new Error('Dashboard graph rendered no nodes after selecting a plan.');
    }

    const pathFinderStats = await page.evaluate(() => {
      const data = JSON.parse(document.getElementById('plan-data').textContent);
      const relationship = data.relationships.find((item) => (
        data.plans.some((plan) => plan.task_id === item.source)
        && data.plans.some((plan) => plan.task_id === item.target)
      ));
      if (!relationship) return { hasRelationship: false };
      document.querySelector('#pathFrom').value = relationship.source;
      document.querySelector('#pathTo').value = relationship.target;
      document.querySelector('#findPath').click();
      return {
        hasRelationship: true,
        source: relationship.source,
        target: relationship.target,
        resultText: document.querySelector('#pathResult')?.textContent || '',
        graphSummary: document.querySelector('#graphSummary')?.textContent || '',
        graphNodes: document.querySelectorAll('#graph circle').length,
        graphLines: document.querySelectorAll('#graph line').length
      };
    });
    if (!pathFinderStats.hasRelationship) throw new Error('Dashboard model has no relationship for the path finder smoke.');
    if (!pathFinderStats.resultText.includes('Connection path') || !pathFinderStats.resultText.includes(pathFinderStats.source) || !pathFinderStats.resultText.includes(pathFinderStats.target)) {
      throw new Error('Dashboard connection path finder did not render a path result.');
    }
    if (!pathFinderStats.graphSummary.includes('connection path')) {
      throw new Error('Dashboard graph did not switch to connection-path mode.');
    }
    if (pathFinderStats.graphNodes < 2 || pathFinderStats.graphLines < 1) {
      throw new Error('Dashboard connection-path graph did not render path nodes and links.');
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(JSON.stringify({
      status: 'PASS',
      dashboard: path.relative(projectRoot, dashboardPath),
      screenshot: path.relative(projectRoot, screenshotPath),
      ...stats,
      ...clusterStats,
      permalink: permalinkStats,
      ...restoredStats,
      ...selectedStats,
      pathFinder: pathFinderStats
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
