'use strict';

const { loadGoogleAdsConfig } = require('./config');
const { createGoogleAdsClient } = require('./client');

async function main() {
  // FORCE dryRun to false for this execution as authorized by user
  const config = loadGoogleAdsConfig();
  config.dryRun = false; 

  const client = createGoogleAdsClient(config);
  const customerId = '8560375238';

  const updates = [
    { name: 'Search - Car Sales - Test', budgetId: '15240530127', amount: 380000000 },
    { name: 'Search - Branded - NS', budgetId: '349682959', amount: 135000000 },
    { name: 'Performance Max - VLA - Maritimes', budgetId: '13336138482', amount: 150000000 },
    { name: 'Search - Car Loans - All', budgetId: '14521459615', amount: 120000000 },
    { name: 'Search - Branded - NB', budgetId: '1191365652', amount: 35000000 }
  ];

  console.log(`Starting budget redistribution for Customer ${customerId}...`);

  for (const update of updates) {
    console.log(`Updating ${update.name} (Budget ${update.budgetId}) to $${update.amount / 1000000}/day...`);
    try {
      const result = await client.mutateCampaignBudget({
        customerId,
        budgetId: update.budgetId,
        amountMicros: update.amount
      });
      console.log(`✅ Success: ${JSON.stringify(result)}`);
    } catch (error) {
      console.error(`❌ Failed: ${update.name}: ${error.message}`);
    }
  }

  console.log('Redistribution complete.');
}

main().catch(console.error);
