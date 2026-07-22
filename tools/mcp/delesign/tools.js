'use strict';

const { createDelesignClient } = require('./client');

// Sanitization: keep raw project bodies, message threads, and user PII out of
// conversation context. Tools return the smallest credential-safe summary
// needed for the next step in the pipeline; raw responses are reachable via
// dry-run URL inspection or by calling the underlying client directly when
// the operator has explicitly approved deeper read.

function summarizeAccount(raw) {
  if (!raw || raw.dry_run) return raw;
  const data = raw.data || raw;
  return {
    account_id: data.id || data.account_id || null,
    account_status: data.status || data.account_status || null,
    project_counts: data.project_counts || data.projectCounts || null,
    subscription_active: Boolean(data.subscription || data.subscriptionStatus === 'active' || data.is_active)
  };
}

function summarizeProjectListItem(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: item.id || item.project_id || null,
    title: item.title || null,
    status: item.status || null,
    category: item.category || null,
    created_at: item.created_at || item.createdAt || null,
    updated_at: item.updated_at || item.updatedAt || null,
    has_deliverables: Boolean(item.file_url || item.file_attachment || item.designs || item.project_link)
  };
}

function summarizeProjectView(raw) {
  if (!raw || raw.dry_run) return raw;
  const data = raw.data || raw;
  // Probe the candidate asset-bearing fields without dumping full content.
  const observed = {
    file_url_present: data.file_url !== undefined,
    file_attachment_present: data.file_attachment !== undefined,
    designs_present: Array.isArray(data.designs) ? data.designs.length : (data.designs !== undefined ? 'object' : false),
    project_link_present: data.project_link !== undefined,
    messages_present: Array.isArray(data.messages) ? data.messages.length : false,
    other_top_level_keys: Object.keys(data).filter((k) =>
      !['file_url', 'file_attachment', 'designs', 'project_link', 'messages', 'description', 'title', 'id', 'status', 'category', 'created_at', 'updated_at'].includes(k)
    )
  };
  return {
    id: data.id || null,
    title: data.title || null,
    status: data.status || null,
    category: data.category || null,
    created_at: data.created_at || null,
    updated_at: data.updated_at || null,
    asset_field_probe: observed
  };
}

function createDelesignTools(config) {
  const client = createDelesignClient(config);

  return [
    {
      name: 'delesign_authorize',
      description: 'Validate the Delesign API token. Read-only.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => client.authorize()
    },
    {
      name: 'delesign_get_account',
      description: 'Get account details. Returns sanitized summary (no PII or full project content).',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => summarizeAccount(await client.getAccount())
    },
    {
      name: 'delesign_list_projects',
      description: 'List projects. Returns sanitized list-item summaries.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          type: { type: 'string' },
          limit: { type: 'number' },
          page: { type: 'number' }
        }
      },
      handler: async (args) => {
        const raw = await client.listProjects(args || {});
        if (raw && raw.dry_run) return raw;
        const data = raw.data || raw;
        const items = Array.isArray(data) ? data : data.projects || data.items || [];
        return {
          count: items.length,
          items: items.map(summarizeProjectListItem)
        };
      }
    },
    {
      name: 'delesign_view_project',
      description: 'View a project. Returns sanitized summary + an asset_field_probe so we can discover where deliverables surface; full description, messages, and file URLs are intentionally NOT echoed.',
      inputSchema: {
        type: 'object',
        required: ['project_id'],
        properties: {
          project_id: { type: 'string' }
        }
      },
      handler: async (args) => summarizeProjectView(await client.viewProject({ projectId: args.project_id }))
    },
    {
      name: 'delesign_create_project',
      description: 'Submit a brief to Delesign. Live mutation — operator should have approved the brief before invoking. Text-only in v1; no file attachments.',
      inputSchema: {
        type: 'object',
        required: ['title', 'category', 'description'],
        properties: {
          title: { type: 'string' },
          category: { type: 'string' },
          description: { type: 'string' },
          dimension: { type: 'string' },
          target_audience: { type: 'string' },
          timeframe: { type: 'string' },
          inspiration: { type: 'string' }
        }
      },
      handler: async (args) => {
        const raw = await client.createProject(args);
        if (raw && raw.dry_run) return raw;
        const data = raw.data || raw;
        return {
          id: data.id || data.project_id || null,
          status: data.status || null,
          title: data.title || null,
          created_at: data.created_at || null
        };
      }
    },
    {
      name: 'delesign_edit_project',
      description: 'Edit a project. Live mutation. Bounded — only operator-approved fields should be passed.',
      inputSchema: {
        type: 'object',
        required: ['project_id'],
        properties: {
          project_id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          dimension: { type: 'string' },
          target_audience: { type: 'string' },
          timeframe: { type: 'string' },
          inspiration: { type: 'string' }
        }
      },
      handler: async (args) => {
        const { project_id, ...patch } = args;
        const raw = await client.editProject({ projectId: project_id, ...patch });
        if (raw && raw.dry_run) return raw;
        const data = raw.data || raw;
        return { id: data.id || project_id, status: data.status || null, updated_at: data.updated_at || null };
      }
    },
    {
      name: 'delesign_send_message',
      description: 'Send a message on a project (revision feedback). Live mutation. Operator should have approved the message body before invoking.',
      inputSchema: {
        type: 'object',
        required: ['project_id', 'body'],
        properties: {
          project_id: { type: 'string' },
          body: { type: 'string' }
        }
      },
      handler: async (args) => {
        const raw = await client.sendMessage({ projectId: args.project_id, body: args.body });
        if (raw && raw.dry_run) return raw;
        const data = raw.data || raw;
        return { id: data.id || null, sent_at: data.created_at || null };
      }
    }

    // delesign_delete_project: intentionally NOT exposed (destructive; deferred)
    // delesign_upload_attachment: intentionally NOT exposed (multipart filesystem complexity; deferred)
  ];
}

module.exports = {
  createDelesignTools,
  summarizeAccount,
  summarizeProjectListItem,
  summarizeProjectView
};
