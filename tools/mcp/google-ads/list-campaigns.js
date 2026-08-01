'use strict';

const { loadGoogleAdsConfig } = require('./config');
const { createGoogleAdsClient } = require('./client');

async function main() {
  const config = loadGoogleAdsConfig();
  config.dryRun = false; 
  
  const client = createGoogleAdsClient(config);
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) {
    throw new Error('GOOGLE_ADS_CUSTOMER_ID is required from ignored local configuration');
  }

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status
    FROM campaign
    WHERE campaign.status = 'ENABLED'
  `;

  try {
    const results = await client.search({ customerId, query: query.replace(/\\s+/g, ' ').trim() });
    
    if (!results) {
      console.log('No results.');
      return;
    }

    const rows = Array.isArray(results) ? results : (results.results || results[0]?.results || []);
    
    if (rows.length === 0) {
      console.log('No active campaigns found.');
      return;
    }

    console.log('DEBUG First Row:', JSON.stringify(rows[0], null, 2));

    console.log('\\nActive Campaigns:');
    console.log('ID'.padEnd(20) + 'Name');
    console.log('-'.repeat(60));

    rows.forEach(r => {
      const c = r.campaign;
      if (!c) return;
      console.log(String(c.id).padEnd(20) + c.name);
    });

  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

main().catch(console.error);
