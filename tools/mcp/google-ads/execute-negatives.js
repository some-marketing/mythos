'use strict';

const { loadGoogleAdsConfig } = require('./config');
const { createGoogleAdsClient } = require('./client');

async function main() {
  const config = loadGoogleAdsConfig();
  config.dryRun = false; 

  const client = createGoogleAdsClient(config);
  const customerId = '8560375238';

  const negatives = [
    { campaignId: '23385402135', keyword: 'chevy bolt', type: 'EXACT' },
    { campaignId: '23385402135', keyword: '0 finance', type: 'EXACT' },
    { campaignId: '23385402135', keyword: 'service', type: 'PHRASE' },
    { campaignId: '23385402135', keyword: 'repair', type: 'PHRASE' },
    { campaignId: '23385402135', keyword: 'parts', type: 'PHRASE' },
    { campaignId: '803619483', keyword: 'service', type: 'PHRASE' },
    { campaignId: '803619483', keyword: 'repair', type: 'PHRASE' },
    { campaignId: '803619483', keyword: 'parts', type: 'PHRASE' }
  ];

  console.log(`Starting negative keyword addition for Customer ${customerId}...`);

  for (const neg of negatives) {
    console.log(`Adding negative "${neg.keyword}" (${neg.type}) to Campaign ${neg.campaignId}...`);
    try {
      const result = await client.mutateCampaignNegativeKeyword({
        customerId,
        campaignId: neg.campaignId,
        keywordText: neg.keyword,
        matchType: neg.type
      });
      console.log(`✅ Success: ${JSON.stringify(result)}`);
    } catch (error) {
      console.error(`❌ Failed: ${neg.keyword}: ${error.message}`);
    }
  }

  console.log('Negative addition complete.');
}

main().catch(console.error);
