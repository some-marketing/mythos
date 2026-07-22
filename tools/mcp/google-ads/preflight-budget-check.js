'use strict';

const { loadGoogleAdsConfig } = require('./config');
const { createGoogleAdsClient } = require('./client');

async function main() {
  const config = loadGoogleAdsConfig();
  // We need real data for pre-flight, but the user authorized it
  config.dryRun = false; 
  
  const client = createGoogleAdsClient(config);
  const customerId = '8560375238';

  const budgetIds = [
    '15240530127',
    '349682959',
    '13336138482',
    '14521459615',
    '1191365652'
  ];

  console.log(`Pre-flight: Checking budgets for Customer ${customerId}...`);

  const query = `
    SELECT
      campaign_budget.id,
      campaign_budget.name,
      campaign_budget.amount_micros,
      campaign_budget.status
    FROM campaign_budget
    WHERE campaign_budget.id IN (${budgetIds.join(',')})
  `;

  try {
    const results = await client.search({
      customerId,
      query: query.replace(/\\s+/g, ' ').trim()
    });

    console.log('RAW RESULTS:', JSON.stringify(results, null, 2));

    if (!results) {
      console.log('No results returned.');
      return;
    }

    const rows = Array.isArray(results) ? results : (results.results || []);
    
    if (rows.length === 0) {
      console.log('No matching budgets found.');
      // Fallback: list all budgets to see what we have
      console.log('Listing all budgets to diagnose...');
      const all = await client.search({
        customerId,
        query: 'SELECT campaign_budget.id, campaign_budget.name FROM campaign_budget LIMIT 20'
      });
      console.log(JSON.stringify(all, null, 2));
      return;
    }

    console.log('\nCurrent Budget States:');
    console.log('ID'.padEnd(15) + 'Name'.padEnd(40) + 'Current ($)'.padStart(15));
    console.log('-'.repeat(70));

    rows.forEach(r => {
      const b = r.campaign_budget;
      if (!b) return;
      console.log(
        String(b.id).padEnd(15) + 
        String(b.name).padEnd(40) + 
        String(Number(b.amount_micros) / 1000000).padStart(15)
      );
    });

  } catch (error) {
    console.error(`❌ Pre-flight failed: ${error.message}`);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

main().catch(console.error);
