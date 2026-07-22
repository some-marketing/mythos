'use strict';

const { createMetaAdsClient } = require('./client');
const { runCompliancePreflight } = require('./compliance-preflight');

function createMetaAdsTools(config) {
  const client = createMetaAdsClient(config);

  return [
    {
      name: 'meta_list_campaigns',
      description: 'List Meta campaigns for an ad account.',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          limit: { type: 'number' },
          fields: { type: 'string' }
        }
      },
      handler: async (args) => {
        return client.listCampaigns({
          accountId: args.account_id,
          limit: args.limit,
          fields: args.fields
        });
      }
    },
    {
      name: 'meta_list_ad_sets',
      description: 'List Meta ad sets for an ad account.',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          limit: { type: 'number' },
          fields: { type: 'string' }
        }
      },
      handler: async (args) => {
        return client.listAdSets({
          accountId: args.account_id,
          limit: args.limit,
          fields: args.fields
        });
      }
    },
    {
      name: 'meta_list_ads',
      description: 'List Meta ads for an ad account.',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          limit: { type: 'number' },
          fields: { type: 'string' }
        }
      },
      handler: async (args) => {
        return client.listAds({
          accountId: args.account_id,
          limit: args.limit,
          fields: args.fields
        });
      }
    },
    {
      name: 'meta_export_insights',
      description: 'Export Meta performance metrics for an ad account.',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          level: { type: 'string' },
          date_preset: { type: 'string' },
          limit: { type: 'number' },
          fields: { type: 'string' }
        }
      },
      handler: async (args) => {
        return client.exportInsights({
          accountId: args.account_id,
          level: args.level,
          datePreset: args.date_preset,
          limit: args.limit,
          fields: args.fields
        });
      }
    },
    {
      name: 'meta_update_ad_status',
      description: 'Update the status of a specific Meta ad. Dry-run by default.',
      inputSchema: {
        type: 'object',
        required: ['ad_id', 'status'],
        properties: {
          ad_id: { type: 'string' },
          status: { type: 'string' }
        }
      },
      handler: async (args) => {
        return client.updateAdStatus({
          adId: args.ad_id,
          status: args.status
        });
      }
    },
    {
      name: 'meta_update_ad_set_budget',
      description: 'Update the daily budget of a specific Meta ad set. Dry-run by default.',
      inputSchema: {
        type: 'object',
        required: ['ad_set_id', 'daily_budget'],
        properties: {
          ad_set_id: { type: 'string' },
          daily_budget: { type: ['string', 'number'] }
        }
      },
      handler: async (args) => {
        return client.updateAdSetBudget({
          adSetId: args.ad_set_id,
          dailyBudget: args.daily_budget
        });
      }
    },
    {
      name: 'meta_update_ad_text',
      description: 'Scaffold-only tool for validating intended Meta ad text updates. Live text mutation is not enabled yet. Runs compliance preflight before any (future) live mutation path.',
      inputSchema: {
        type: 'object',
        required: ['ad_id', 'ad_account_id', 'compliance'],
        properties: {
          ad_id: { type: 'string' },
          ad_account_id: { type: 'string', description: 'Ad account this ad belongs to. Required so compliance posture can be resolved against client project.json.' },
          primary_text: { type: 'string' },
          headline: { type: 'string' },
          description: { type: 'string' },
          compliance: {
            type: 'object',
            description: 'Compliance assertions. Required for any creative-write call. Fields: ai_generated_or_altered, ai_disclosure_present, special_ad_category_acknowledged, contains_testimonial, testimonial_attribution_documented, contains_endorsement, endorsement_documented, targeting_uses_protected_class, targeting_uses_protected_class_proxy, override_reason.',
            properties: {
              ai_generated_or_altered: { type: 'boolean' },
              ai_disclosure_present: { type: 'boolean' },
              special_ad_category_acknowledged: { type: 'boolean' },
              contains_testimonial: { type: 'boolean' },
              testimonial_attribution_documented: { type: 'boolean' },
              contains_endorsement: { type: 'boolean' },
              endorsement_documented: { type: 'boolean' },
              targeting_uses_protected_class: { type: 'boolean' },
              targeting_uses_protected_class_proxy: { type: 'boolean' },
              override_reason: { type: ['string', 'null'] }
            }
          },
          actor: { type: 'string', description: 'Optional actor label recorded in the compliance verdict.' }
        }
      },
      handler: async (args) => {
        const verdict = runCompliancePreflight(
          {
            ad_account_id: args.ad_account_id,
            creative: {
              primary_text: args.primary_text || null,
              headline: args.headline || null,
              description: args.description || null
            },
            compliance: args.compliance || {}
          },
          { actor: args.actor || null }
        );

        if (verdict.decision === 'block') {
          return {
            scaffold_only: true,
            dry_run: true,
            target: { ad_id: args.ad_id, ad_account_id: args.ad_account_id },
            intended_update: {
              primary_text: args.primary_text || null,
              headline: args.headline || null,
              description: args.description || null
            },
            mutation_attempted: false,
            compliance_verdict: verdict,
            note: 'Compliance preflight BLOCKED this creative write. Address the failures listed in compliance_verdict.failures or supply compliance.override_reason to override (override is recorded; the underlying failures remain in the verdict for audit).'
          };
        }

        return {
          scaffold_only: true,
          dry_run: true,
          target: { ad_id: args.ad_id, ad_account_id: args.ad_account_id },
          intended_update: {
            primary_text: args.primary_text || null,
            headline: args.headline || null,
            description: args.description || null
          },
          mutation_attempted: false,
          compliance_verdict: verdict,
          note: 'Meta creative text mutation is intentionally left as scaffold-only until the live mutation path is validated against actual asset shapes. Compliance preflight passed (or override applied); when the live path is enabled, this verdict will be the gate.'
        };
      }
    },
    {
      name: 'meta_create_campaign',
      description: 'Create a Meta campaign. Dry-run unless META_ADS_DRY_RUN=false and live=true.',
      inputSchema: {
        type: 'object',
        required: ['account_id', 'name', 'objective'],
        properties: {
          account_id: { type: 'string' },
          name: { type: 'string' },
          objective: { type: 'string' },
          status: { type: 'string' },
          special_ad_categories: { type: 'array', items: { type: 'string' } },
          live: { type: 'boolean' }
        }
      },
      handler: (args) => client.createCampaign({
        accountId: args.account_id,
        name: args.name,
        objective: args.objective,
        status: args.status,
        specialAdCategories: args.special_ad_categories,
        live: args.live === true
      })
    },
    {
      name: 'meta_create_ad_set',
      description: 'Create a Meta ad set. Dry-run unless META_ADS_DRY_RUN=false and live=true.',
      inputSchema: {
        type: 'object',
        required: ['account_id', 'campaign_id', 'name', 'optimization_goal', 'billing_event', 'targeting'],
        properties: {
          account_id: { type: 'string' },
          campaign_id: { type: 'string' },
          name: { type: 'string' },
          optimization_goal: { type: 'string' },
          billing_event: { type: 'string' },
          bid_strategy: { type: 'string' },
          daily_budget: { type: ['string', 'number'] },
          targeting: { type: 'object' },
          promoted_object: { type: 'object' },
          status: { type: 'string' },
          live: { type: 'boolean' }
        }
      },
      handler: (args) => client.createAdSet({
        accountId: args.account_id,
        campaignId: args.campaign_id,
        name: args.name,
        optimizationGoal: args.optimization_goal,
        billingEvent: args.billing_event,
        bidStrategy: args.bid_strategy,
        dailyBudget: args.daily_budget,
        targeting: args.targeting,
        promotedObject: args.promoted_object,
        status: args.status,
        live: args.live === true
      })
    },
    {
      name: 'meta_upload_image',
      description: 'Upload an image to a Meta ad account. Dry-run validates file path and intended multipart request.',
      inputSchema: {
        type: 'object',
        required: ['account_id', 'file_path'],
        properties: {
          account_id: { type: 'string' },
          file_path: { type: 'string' },
          live: { type: 'boolean' }
        }
      },
      handler: (args) => client.uploadImage({
        accountId: args.account_id,
        filePath: args.file_path,
        live: args.live === true
      })
    },
    {
      name: 'meta_upload_video',
      description: 'Upload a video to a Meta ad account. Dry-run validates file path and intended multipart request.',
      inputSchema: {
        type: 'object',
        required: ['account_id', 'file_path'],
        properties: {
          account_id: { type: 'string' },
          file_path: { type: 'string' },
          name: { type: 'string' },
          live: { type: 'boolean' }
        }
      },
      handler: (args) => client.uploadVideo({
        accountId: args.account_id,
        filePath: args.file_path,
        name: args.name,
        live: args.live === true
      })
    },
    {
      name: 'meta_create_ad_creative',
      description: 'Create a Meta ad creative. Healthcare compliance preflight is hard-blocking in live mode.',
      inputSchema: {
        type: 'object',
        required: ['account_id', 'name', 'object_story_spec', 'compliance'],
        properties: {
          account_id: { type: 'string' },
          name: { type: 'string' },
          object_story_spec: { type: 'object' },
          degrees_of_freedom_spec: { type: 'object' },
          compliance: { type: 'object' },
          targeting: { type: 'object' },
          actor: { type: 'string' },
          live: { type: 'boolean' }
        }
      },
      handler: async (args) => {
        const verdict = creativeWritePreflight(args, extractCreativeFromStorySpec(args.object_story_spec));
        if (isHardBlocked(config, args, verdict)) return blockedCreativeWrite('meta_create_ad_creative', args, verdict);
        const result = await client.createAdCreative({
          accountId: args.account_id,
          name: args.name,
          objectStorySpec: args.object_story_spec,
          degreesOfFreedomSpec: args.degrees_of_freedom_spec,
          live: args.live === true
        });
        return { ...result, compliance_verdict: verdict };
      }
    },
    {
      name: 'meta_create_ad',
      description: 'Create a Meta ad. Healthcare compliance preflight is hard-blocking in live mode.',
      inputSchema: {
        type: 'object',
        required: ['ad_set_id', 'name', 'creative_id', 'account_id', 'compliance'],
        properties: {
          ad_set_id: { type: 'string' },
          name: { type: 'string' },
          creative_id: { type: 'string' },
          account_id: { type: 'string' },
          creative: { type: 'object' },
          targeting: { type: 'object' },
          compliance: { type: 'object' },
          actor: { type: 'string' },
          status: { type: 'string' },
          live: { type: 'boolean' }
        }
      },
      handler: async (args) => {
        const verdict = creativeWritePreflight(args, args.creative || {});
        if (isHardBlocked(config, args, verdict)) return blockedCreativeWrite('meta_create_ad', args, verdict);
        const result = await client.createAd({
          accountId: args.account_id,
          adSetId: args.ad_set_id,
          name: args.name,
          creativeId: args.creative_id,
          status: args.status,
          live: args.live === true
        });
        return { ...result, compliance_verdict: verdict };
      }
    }
  ];
}

function creativeWritePreflight(args, creative) {
  return runCompliancePreflight(
    {
      ad_account_id: args.account_id,
      creative,
      targeting: args.targeting || null,
      compliance: args.compliance || {}
    },
    { actor: args.actor || null }
  );
}

function isHardBlocked(config, args, verdict) {
  return config.dryRun === false && args.live === true && verdict.decision === 'block';
}

function blockedCreativeWrite(toolName, args, verdict) {
  return {
    tool: toolName,
    dry_run: false,
    live_requested: args.live === true,
    mutation_attempted: false,
    compliance_verdict: verdict,
    note: 'Healthcare compliance preflight BLOCKED this creative write before any live Meta API call.'
  };
}

function extractCreativeFromStorySpec(spec) {
  const linkData = spec && spec.link_data ? spec.link_data : {};
  const videoData = spec && spec.video_data ? spec.video_data : {};
  return {
    primary_text: linkData.message || videoData.message || null,
    headline: linkData.name || videoData.title || null,
    description: linkData.description || videoData.link_description || null
  };
}

module.exports = {
  createMetaAdsTools
};
