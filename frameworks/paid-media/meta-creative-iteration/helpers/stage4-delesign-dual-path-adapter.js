'use strict';
//
// Stage 4 — Delesign Dual-Path Adapter
//
// API mode: composes with tools/mcp/delesign/ — calls the existing brief-generator
// and submits via the MCP server (currently blocked by vendor 500 as of 2026-05-01).
//
// Chrome-MCP fallback mode: returns a structured action list the orchestrator
// passes to the claude-in-chrome MCP tools to fill the form at
// https://go.delesign.com/designs/create/2 — operator clicks Create Project.
//
// Both modes produce the same brief payload from the same brief generator.
// The only difference is who delivers the bytes to Delesign: the API or the
// operator's authenticated browser session.

const fs = require('fs');
const path = require('path');

function deriveModeFromHealth(delesignHealth, override) {
  if (override === 'api' || override === 'chrome-mcp-fallback') {
    return override;
  }
  if (delesignHealth && delesignHealth.api_available === true) {
    return 'api';
  }
  return 'chrome-mcp-fallback';
}

// Build an API-mode submit plan. The orchestrator runs this against the Delesign MCP.
function buildApiSubmitPlan(briefPayload) {
  return {
    mode: 'api',
    operator_action_required: true,
    operator_action: 'approve the brief, then run delesign_create_project via the Delesign MCP',
    mcp_call: {
      tool: 'delesign_create_project',
      // Field names match Delesign API schema.
      args: {
        title: briefPayload.title,
        category: briefPayload.category,
        description: briefPayload.description,
        dimension: briefPayload.dimension,
        target_audience: briefPayload.target_audience,
        timeframe: briefPayload.timeframe,
        inspiration: briefPayload.inspiration
      }
    },
    notes: 'API submit returns a project_id when Delesign accepts. Asset retrieval shape is still pending vendor confirmation (see _dev/concepts/algo-aware-meta-creative-iteration-framework/concept.md and the open Delesign support ticket).'
  };
}

// Build a Chrome-MCP fallback plan. The orchestrator drives the browser tools.
// Stops at Create Project — operator clicks.
function buildChromeFallbackPlan(briefPayload) {
  // ref ids map to the form discovered 2026-05-01 at https://go.delesign.com/designs/create/2
  // for Social Media Posts and Ads category. The orchestrator must verify refs by
  // calling read_page first; UI changes will surface as ref mismatches.
  const formActions = [
    {
      step: 'navigate',
      url: 'https://go.delesign.com/designs/create',
      note: 'Land on the category picker first; the URL /designs/create/2 redirects when no auth/session.'
    },
    {
      step: 'click_subcategory',
      target_label: 'Social Media Posts and Ads',
      note: 'Resolve via read_page; ref_id will vary per session.'
    },
    {
      step: 'fill_field',
      field_label: 'Project Title',
      value: briefPayload.title
    },
    {
      step: 'fill_field',
      field_label: 'Target Audience',
      value: briefPayload.target_audience
    },
    {
      step: 'fill_field',
      field_label: 'File size or dimension',
      value: briefPayload.dimension
    },
    {
      step: 'fill_richtext',
      field_label: 'Description',
      value: briefPayload.description,
      note: 'CKEditor5 instance — type into editing area; toolbar buttons for formatting available but not required.'
    },
    {
      step: 'fill_richtext',
      field_label: 'Inspiration',
      value: briefPayload.inspiration
    },
    {
      step: 'select_file_types',
      values: ['PNG', 'JPG'],
      note: 'Default for social-media static deliverables.'
    },
    {
      step: 'STOP_FOR_OPERATOR',
      target_label: 'Create Project',
      note: 'Framework refuses to click Submit; operator clicks the Create Project button. Operator may also attach mockup files at this point if Stage 3 produced them.'
    }
  ];

  return {
    mode: 'chrome-mcp-fallback',
    operator_action_required: true,
    operator_action: 'review filled form and click Create Project; framework never automates this click',
    chrome_mcp_actions: formActions,
    notes: 'Chrome-MCP fallback exists because of the documented Delesign API 500 (see clients/{CLIENT_CODE}/projects/delesign-integration/delesign-support-ticket.txt). When the API returns to spec, switch back to mode=api by removing delesign_mode_override or setting it to api.'
  };
}

function buildSubmitPlan({ briefPayload, delesignHealth, override }) {
  if (!briefPayload || !briefPayload.title || !briefPayload.category || !briefPayload.description || !briefPayload.dimension) {
    throw new Error('briefPayload requires title, category, description, dimension (use tools/mcp/delesign/brief-generator.js)');
  }
  const mode = deriveModeFromHealth(delesignHealth, override);
  if (mode === 'api') return buildApiSubmitPlan(briefPayload);
  return buildChromeFallbackPlan(briefPayload);
}

function validateBriefPacket(packetPath, packet) {
  const rootKeys = new Set(['timestamp', 'briefs']);
  const briefKeys = new Set([
    'framework_id',
    'hypothesis_id',
    'delesign_payload',
    'mockup_paths',
    'mode_used',
    'submit_timestamp',
    'delesign_project_id'
  ]);
  const payloadKeys = new Set([
    'title',
    'category',
    'description',
    'dimension',
    'target_audience',
    'timeframe',
    'inspiration'
  ]);
  const errors = [];
  for (const key of Object.keys(packet || {})) {
    if (!rootKeys.has(key)) errors.push(`root has unsupported property "${key}"`);
  }
  if (!packet || typeof packet.timestamp !== 'string') errors.push('timestamp is required');
  if (!packet || !Array.isArray(packet.briefs)) errors.push('briefs must be an array');

  (packet && Array.isArray(packet.briefs) ? packet.briefs : []).forEach((brief, index) => {
    for (const key of Object.keys(brief || {})) {
      if (!briefKeys.has(key)) errors.push(`briefs[${index}] has unsupported property "${key}"`);
    }
    for (const key of ['framework_id', 'hypothesis_id', 'delesign_payload', 'mockup_paths', 'mode_used']) {
      if (brief[key] === undefined) errors.push(`briefs[${index}].${key} is required`);
    }
    if (!['api', 'chrome-mcp-fallback'].includes(brief.mode_used)) {
      errors.push(`briefs[${index}].mode_used must be api or chrome-mcp-fallback`);
    }
    if (!Array.isArray(brief.mockup_paths)) errors.push(`briefs[${index}].mockup_paths must be an array`);
    const payload = brief.delesign_payload || {};
    for (const key of Object.keys(payload)) {
      if (!payloadKeys.has(key)) errors.push(`briefs[${index}].delesign_payload has unsupported property "${key}"`);
    }
    for (const key of ['title', 'category', 'description', 'dimension']) {
      if (typeof payload[key] !== 'string' || payload[key].length === 0) {
        errors.push(`briefs[${index}].delesign_payload.${key} is required`);
      }
    }
  });

  if (errors.length > 0) {
    throw new Error(`Invalid Stage 4 brief packet at ${packetPath}: ${errors.join('; ')}`);
  }
}

function buildSubmitPlansFromPacket(packetPath, delesignHealth, override) {
  if (!packetPath) {
    throw new Error('packetPath is required');
  }
  const resolvedPacketPath = path.resolve(packetPath);
  const packet = JSON.parse(fs.readFileSync(resolvedPacketPath, 'utf8'));
  validateBriefPacket(resolvedPacketPath, packet);

  return {
    packet_path: resolvedPacketPath,
    submit_plans: packet.briefs.map((brief, index) => ({
      index,
      framework_id: brief.framework_id,
      hypothesis_id: brief.hypothesis_id,
      mockup_paths: brief.mockup_paths,
      mode_used: deriveModeFromHealth(delesignHealth, override),
      submit_plan: buildSubmitPlan({
        briefPayload: brief.delesign_payload,
        delesignHealth,
        override
      })
    }))
  };
}

module.exports = {
  buildSubmitPlan,
  buildSubmitPlansFromPacket,
  buildApiSubmitPlan,
  buildChromeFallbackPlan,
  deriveModeFromHealth
};
