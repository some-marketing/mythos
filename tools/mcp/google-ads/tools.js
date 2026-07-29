'use strict';

const { createGoogleAdsClient } = require('./client');

function createGoogleAdsTools(config) {
  const client = createGoogleAdsClient(config);

  return [
    {
      name: 'google_ads_run_gaql',
      description: 'Run a Google Ads Query Language (GAQL) SELECT query against a customer account. Queries are validated against an allowlist of approved resources. Only SELECT queries are permitted.',
      inputSchema: {
        type: 'object',
        required: ['customer_id', 'query'],
        properties: {
          customer_id: { type: 'string' },
          query: { type: 'string' }
        }
      },
      handler: async (args) => {
        return client.runGaql({
          customerId: args.customer_id,
          query: collapseWhitespace(args.query)
        });
      }
    },
    {
      name: 'google_ads_list_campaigns',
      description: 'List campaigns and attached budget resources for a Google Ads customer.',
      inputSchema: {
        type: 'object',
        properties: {
          customer_id: { type: 'string' },
          limit: { type: 'number' }
        }
      },
      handler: async (args) => {
        const limit = Number(args.limit || 25);
        const query = `
          SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.campaign_budget,
            campaign_budget.id,
            campaign_budget.name,
            campaign_budget.amount_micros
          FROM campaign
          ORDER BY campaign.id DESC
          LIMIT ${limit}
        `;

        return client.search({
          customerId: args.customer_id,
          query: collapseWhitespace(query)
        });
      }
    },
    {
      name: 'google_ads_list_conversion_actions',
      description: 'Inspect conversion actions for a Google Ads customer.',
      inputSchema: {
        type: 'object',
        properties: {
          customer_id: { type: 'string' },
          limit: { type: 'number' }
        }
      },
      handler: async (args) => {
        const limit = Number(args.limit || 50);
        const query = `
          SELECT
            conversion_action.id,
            conversion_action.name,
            conversion_action.status,
            conversion_action.type,
            conversion_action.category,
            conversion_action.primary_for_goal
          FROM conversion_action
          ORDER BY conversion_action.id DESC
          LIMIT ${limit}
        `;

        return client.search({
          customerId: args.customer_id,
          query: collapseWhitespace(query)
        });
      }
    },
    {
      name: 'google_ads_export_campaign_report',
      description: 'Export a simple campaign performance report for a Google Ads customer.',
      inputSchema: {
        type: 'object',
        properties: {
          customer_id: { type: 'string' },
          date_range: { type: 'string' },
          limit: { type: 'number' }
        }
      },
      handler: async (args) => {
        const limit = Number(args.limit || 100);
        const dateRange = args.date_range || 'LAST_30_DAYS';
        const query = `
          SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions
          FROM campaign
          WHERE segments.date DURING ${dateRange}
          ORDER BY metrics.cost_micros DESC
          LIMIT ${limit}
        `;

        return client.search({
          customerId: args.customer_id,
          query: collapseWhitespace(query)
        });
      }
    },
    {
      name: 'google_ads_update_campaign_status',
      description: 'Update a Google Ads campaign status. Dry-run by default.',
      inputSchema: {
        type: 'object',
        required: ['customer_id', 'campaign_id', 'status'],
        properties: {
          customer_id: { type: 'string' },
          campaign_id: { type: 'string' },
          status: { type: 'string' }
        }
      },
      handler: async (args) => {
        return client.mutateCampaignStatus({
          customerId: args.customer_id,
          campaignId: args.campaign_id,
          status: args.status
        });
      }
    },
    {
      name: 'google_ads_update_campaign_budget',
      description: 'Update a Google Ads campaign budget by budget resource ID. Dry-run by default.',
      inputSchema: {
        type: 'object',
        required: ['customer_id', 'budget_id', 'amount_micros'],
        properties: {
          customer_id: { type: 'string' },
          budget_id: { type: 'string' },
          amount_micros: { type: ['string', 'number'] }
        }
      },
      handler: async (args) => {
        return client.mutateCampaignBudget({
          customerId: args.customer_id,
          budgetId: args.budget_id,
          amountMicros: args.amount_micros
        });
      }
    },
    {
      name: 'google_ads_create_campaign_negative_keyword',
      description: 'Add a negative keyword to a campaign. Dry-run by default. Accepts a numeric campaign ID.',
      inputSchema: {
        type: 'object',
        required: ['customer_id', 'campaign_id', 'keyword_text', 'match_type'],
        properties: {
          customer_id: { type: 'string' },
          campaign_id: { type: 'string' },
          keyword_text: { type: 'string' },
          match_type: { type: 'string', enum: ['EXACT', 'PHRASE', 'BROAD'], description: 'Match type for the negative keyword' }
        }
      },
      handler: async (args) => {
        return client.mutateCampaignNegativeKeyword({
          customerId: args.customer_id,
          campaignId: args.campaign_id,
          keywordText: args.keyword_text,
          matchType: args.match_type
        });
      }
    },
    {
      name: 'google_ads_create_shared_negative_keyword',
      description: 'Add a negative keyword to a shared set for reuse across campaigns. Dry-run by default.',
      inputSchema: {
        type: 'object',
        required: ['customer_id', 'shared_set_id', 'keyword_text', 'match_type'],
        properties: {
          customer_id: { type: 'string' },
          shared_set_id: { type: 'string' },
          keyword_text: { type: 'string' },
          match_type: { type: 'string', enum: ['EXACT', 'PHRASE', 'BROAD'], description: 'Match type for the negative keyword' }
        }
      },
      handler: async (args) => {
        return client.mutateSharedNegativeKeyword({
          customerId: args.customer_id,
          sharedSetId: args.shared_set_id,
          keywordText: args.keyword_text,
          matchType: args.match_type
        });
      }
    },
    {
      name: 'google_ads_list_campaign_criteria',
      description: 'List campaign-level criteria (negative keywords, location targets, etc.) for a specific campaign.',
      inputSchema: {
        type: 'object',
        required: ['customer_id', 'campaign_id'],
        properties: {
          customer_id: { type: 'string' },
          campaign_id: { type: 'string' },
          limit: { type: 'number' }
        }
      },
      handler: async (args) => {
        const limit = Number(args.limit || 200);
        const query = `
          SELECT
            campaign_criterion.criterion_id,
            campaign_criterion.type,
            campaign_criterion.negative,
            campaign_criterion.status,
            campaign_criterion.keyword.text,
            campaign_criterion.keyword.match_type
          FROM campaign_criterion
          WHERE campaign_criterion.campaign = 'customers/${String(args.customer_id).replace(/-/g, '')}/campaigns/${args.campaign_id}'
          LIMIT ${limit}
        `;

        return client.search({
          customerId: args.customer_id,
          query: collapseWhitespace(query)
        });
      }
    },
    {
      name: 'google_ads_export_search_term_report',
      description: 'Export a search term / search query report showing query-level performance across campaigns for a date range.',
      inputSchema: {
        type: 'object',
        required: ['customer_id'],
        properties: {
          customer_id: { type: 'string' },
          date_range: { type: 'string' },
          campaign_id: { type: 'string' },
          limit: { type: 'number' }
        }
      },
      handler: async (args) => {
        const limit = Number(args.limit || 500);
        const dateRange = args.date_range || 'LAST_30_DAYS';
        const campaignFilter = args.campaign_id
          ? `AND campaign.id = '${String(args.campaign_id).replace(/-/g, '')}'`
          : '';
        const query = `
          SELECT
            search_term_view.search_term,
            search_term_view.ad_group_criterion.keyword.match_type,
            campaign.name,
            campaign.id,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions
          FROM search_term_view
          WHERE segments.date DURING ${dateRange}
          ${campaignFilter}
          ORDER BY metrics.cost_micros DESC
          LIMIT ${limit}
        `;

        return client.search({
          customerId: args.customer_id,
          query: collapseWhitespace(query)
        });
      }
    }
  ];
}

function collapseWhitespace(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

module.exports = {
  createGoogleAdsTools
};
