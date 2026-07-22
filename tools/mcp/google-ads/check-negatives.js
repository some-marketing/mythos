'use strict';

const { loadGoogleAdsConfig } = require('./config');
const { createGoogleAdsClient } = require('./client');

async function main() {
  const config = loadGoogleAdsConfig();
  config.dryRun = false; 
  
  const client = createGoogleAdsClient(config);
  const customerId = '8560375238';

  const checks = [
    // Search - Car Sales - Test (23385402135)
    { campaignId: '23385402135', query: 'bad credit cars for sale' },
    { campaignId: '23385402135', query: 'used cars dartmouth' },
    { campaignId: '23385402135', query: 'cars for bad credit' },
    { campaignId: '23385402135', query: 'bad credit car loans halifax' },
    { campaignId: '23385402135', query: 'used cars sydney ns' },
    { campaignId: '23385402135', query: 'used cars for sale near me' },
    
    // Search - Car Loans - All (803619483)
    { campaignId: '803619483', query: 'car dealerships for bankruptcies' },
    { campaignId: '803619483', query: '$200 car payment' },
    { campaignId: '803619483', query: 'truck financing' },
    { campaignId: '803619483', query: 'cars for sale near me' }
  ];

  console.log(`Checking negative keywords for Customer ${customerId}...`);

  for (const check of checks) {
    const query = `
      SELECT
        campaign_criterion.keyword.text,
        campaign_criterion.keyword.match_type
      FROM campaign_criterion
      WHERE campaign_criterion.campaign = 'customers/${customerId}/campaigns/${check.campaignId}'
        AND campaign_criterion.negative = TRUE
        AND campaign_criterion.keyword.text = '${check.query.replace(/'/g, "\\'")}'
    `;

    try {
      const results = await client.search({ customerId, query: query.replace(/\s+/g, ' ').trim() });
      const rows = Array.isArray(results) ? (results[0]?.results || []) : (results.results || []);
      
      if (rows.length > 0) {
        console.log(`✅ [FOUND] ${check.campaignId}: "${check.query}"`);
      } else {
        console.log(`❌ [MISSING] ${check.campaignId}: "${check.query}"`);
      }
    } catch (error) {
      console.error(`Error checking ${check.query}: ${error.message}`);
    }
  }
}

main().catch(console.error);
