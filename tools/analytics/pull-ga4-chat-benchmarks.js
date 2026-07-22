#!/usr/bin/env node

/**
 * pull-ga4-chat-benchmarks.js
 * 
 * Reusable tool to pull 12-month GA4 historical benchmarks for a site chat-widget
 * launch. Segments: Total Visitors, Chat Opens, Chat Conversions by Device Category.
 * 
 * Usage:
 *   node tools/analytics/pull-ga4-chat-benchmarks.js --property-id <GA4_PROPERTY_ID>
 * 
 * Requirements:
 *   npm install @google-analytics/data
 */

const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const fs = require('fs');
const path = require('fs');

async function runReport(propertyId) {
  // Initialize client (looks for GOOGLE_APPLICATION_CREDENTIALS in env)
  const analyticsDataClient = new BetaAnalyticsDataClient();

  console.log(`Querying 12-month baseline for GA4 Property: ${propertyId}...`);

  try {
    const [response] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [
        {
          startDate: '365daysAgo',
          endDate: 'today',
        },
      ],
      dimensions: [
        { name: 'eventName' },
        { name: 'deviceCategory' },
      ],
      metrics: [
        { name: 'activeUsers' },
        { name: 'eventCount' },
      ],
      // Filter for relevant events
      dimensionFilter: {
        orGroup: {
          expressions: [
            { filter: { fieldName: 'eventName', stringFilter: { value: 'session_start' } } },
            { filter: { fieldName: 'eventName', stringFilter: { value: 'chat_open' } } },        // Adjust to match your chat widget's event name
            { filter: { fieldName: 'eventName', stringFilter: { value: 'chat_lead_convert' } } }, // Adjust to match your chat widget's lead event
            { filter: { fieldName: 'eventName', stringFilter: { value: 'submit_lead_form' } } }   // Adjust to match site lead event
          ]
        }
      }
    });

    const results = [];
    response.rows.forEach(row => {
      results.push({
        eventName: row.dimensionValues[0].value,
        deviceCategory: row.dimensionValues[1].value,
        activeUsers: parseInt(row.metricValues[0].value, 10),
        eventCount: parseInt(row.metricValues[1].value, 10),
      });
    });

    // Output raw result
    const outPath = `./_dev/reports/analysis/benchmarks/raw-ga4-${propertyId}.json`;
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`✔ Raw benchmarks saved to ${outPath}`);

    // Synthesize comparative metrics
    synthesizeBenchmarks(results, propertyId);

  } catch (err) {
    console.error('❌ GA4 Query Failed:', err.message);
    console.log('\nTIP: Ensure GOOGLE_APPLICATION_CREDENTIALS points to your active GCP service-account key JSON.');
  }
}

function synthesizeBenchmarks(data, propertyId) {
  const summary = {
    desktop: { visitors: 0, chats_opened: 0, leads: 0 },
    mobile: { visitors: 0, chats_opened: 0, leads: 0 },
    tablet: { visitors: 0, chats_opened: 0, leads: 0 }
  };

  data.forEach(item => {
    const device = item.deviceCategory;
    if (!summary[device]) return;

    if (item.eventName === 'session_start') {
      summary[device].visitors += item.activeUsers;
    } else if (item.eventName === 'chat_open') {
      summary[device].chats_opened += item.eventCount;
    } else if (item.eventName === 'chat_lead_convert' || item.eventName === 'submit_lead_form') {
      summary[device].leads += item.eventCount;
    }
  });

  const mdLines = [
    `# GA4 12-Month Performance Synthesis — Property ${propertyId}`,
    `Generated on: ${new Date().toISOString()}`,
    `Date range: 365 Days Ago to Today`,
    '',
    '| Device Segment | Total Visitors | Chats Opened | Chat Open Rate (CTA %) | Lead Conversions | Chat Lead Conv. Rate |',
    '|---|---|---|---|---|---|'
  ];

  Object.keys(summary).forEach(device => {
    const s = summary[device];
    const ctaRate = s.visitors > 0 ? ((s.chats_opened / s.visitors) * 100).toFixed(2) + '%' : '0.00%';
    const convRate = s.chats_opened > 0 ? ((s.leads / s.chats_opened) * 100).toFixed(2) + '%' : '0.00%';

    mdLines.push(`| ${device.toUpperCase()} | ${s.visitors.toLocaleString()} | ${s.chats_opened.toLocaleString()} | ${ctaRate} | ${s.leads.toLocaleString()} | ${convRate} |`);
  });

  const mdOutPath = `./_dev/reports/analysis/benchmarks/chat-widget-benchmarks-${propertyId}.md`;
  fs.writeFileSync(mdOutPath, mdLines.join('\n'));
  console.log(`✔ Markdown baseline synthesis saved to ${mdOutPath}`);
}

const args = process.argv.slice(2);
const propIdx = args.indexOf('--property-id');
if (propIdx === -1 || !args[propIdx + 1]) {
  console.log('Usage: node tools/analytics/pull-ga4-chat-benchmarks.js --property-id <GA4_PROPERTY_ID>');
  process.exit(1);
}

runReport(args[propIdx + 1]);
