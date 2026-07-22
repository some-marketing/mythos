'use strict';

const { buildUrl, requestJson } = require('../shared/http');
const { findNearDuplicate, recordProject } = require('./lib/project-registry');

// Delesign API returns JSON with invalid `\'` escapes (apostrophe escaped
// inside double-quoted strings — meaningless in JSON spec but Delesign emits
// it). Strict JSON.parse fails silently in the shared HTTP layer (data: null).
// Re-parse from raw with the invalid escape stripped when data is null but the
// body looks like JSON.
function tolerantParse(response) {
  if (response.data !== null || !response.raw) return response.data;
  const raw = response.raw.trim();
  if (!raw.startsWith('{') && !raw.startsWith('[')) return null;
  // \' has no meaning in JSON; the apostrophe doesn't require escaping inside
  // a double-quoted string. Strip the backslash and retry.
  const cleaned = response.raw.replace(/\\'/g, "'");
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function createDelesignClient(config) {
  function getBaseUrl() {
    return `${config.baseUrl.replace(/\/$/, '')}/${config.apiVersion}/`;
  }

  function ensureLiveAccess() {
    if (!config.accessToken) {
      throw new Error('DELESIGN_API_TOKEN is required when DELESIGN_DRY_RUN=false');
    }
  }

  async function get(pathname, query = {}) {
    if (config.dryRun) {
      return {
        dry_run: true,
        method: 'GET',
        url: buildUrl(getBaseUrl(), pathname, query).toString()
      };
    }
    ensureLiveAccess();
    const url = buildUrl(getBaseUrl(), pathname, query);
    const response = await requestJson({
      method: 'GET',
      url,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: 'application/json'
      }
    });
    return tolerantParse(response);
  }

  async function post(pathname, body = {}) {
    if (config.dryRun) {
      return {
        dry_run: true,
        method: 'POST',
        url: buildUrl(getBaseUrl(), pathname).toString(),
        body
      };
    }
    ensureLiveAccess();
    const url = buildUrl(getBaseUrl(), pathname);
    const response = await requestJson({
      method: 'POST',
      url,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body
    });
    return tolerantParse(response);
  }

  return {
    authorize() {
      return get('authorize');
    },

    getAccount() {
      return get('account');
    },

    listProjects({ status, type, limit, page } = {}) {
      const query = {};
      if (status) query.status = status;
      if (type) query.type = type;
      if (limit !== undefined) query.limit = limit;
      if (page !== undefined) query.page = page;
      return get('projects/lists', query);
    },

    viewProject({ projectId }) {
      if (!projectId) throw new Error('projectId is required');
      return get(`projects/view/${encodeURIComponent(projectId)}`);
    },

    createProject(brief, opts = {}) {
      // brief: { title, category, description, dimension, target_audience, timeframe, inspiration }
      // opts.client: string   — client code used for registry fingerprint (e.g. 'ACME')
      // opts.confirmNotDuplicate: boolean — skip dup-guard when operator has
      //   explicitly confirmed this is not a duplicate project.
      // No file uploads in v1.
      if (!brief || !brief.title || !brief.category || !brief.description) {
        throw new Error('createProject requires title, category, description');
      }

      // ── Dup-project guard ──────────────────────────────────────────────────
      // Compares client+title+brief against the local created-projects.json
      // registry. Near-identical (Jaccard ≥ 0.8) → throws unless
      // opts.confirmNotDuplicate is true. The listProjects API is unreliable
      // for recent IDs so we maintain our own registry.
      if (!opts.confirmNotDuplicate) {
        const { match, similarity } = findNearDuplicate(opts.client || '', brief);
        if (match) {
          // Return a rejected Promise so callers using async/await or .catch()
          // get consistent async error handling (sync throw from an otherwise-async
          // method is confusing).
          return Promise.reject(new Error(
            `[dup-project-guard] Near-duplicate project detected (similarity ${similarity.toFixed(2)} ≥ 0.80). ` +
            `Existing: projectId=${match.projectId} title="${match.title}" createdAt=${match.createdAt}. ` +
            `Pass opts.confirmNotDuplicate=true (or --confirm-not-duplicate on CLI) if this is intentionally distinct.`
          ));
        }
      }

      // Wrap the post call so we can record the new project on success
      return post('projects/create', brief).then((res) => {
        // Record in local registry regardless of dry-run (dry returns a stub object)
        const projectId = (res && (res.project_id || res.id)) || 'unknown';
        try {
          recordProject(projectId, opts.client || '', brief);
        } catch (e) {
          // Non-fatal — log but don't fail the create
          console.warn(`[project-registry] WARN: failed to record project (non-fatal): ${e.message}`);
        }
        return res;
      });
    },

    editProject({ projectId, ...patch }) {
      if (!projectId) throw new Error('projectId is required');
      return post(`projects/edit/${encodeURIComponent(projectId)}`, patch);
    },

    sendMessage({ projectId, body }) {
      if (!projectId) throw new Error('projectId is required');
      if (!body) throw new Error('message body is required');
      // Delesign API requires the field name `message` (not `body`); a `body`
      // payload 422s with "Missing required parameter: message" (confirmed 2026-06-15).
      return post(`messages/create/${encodeURIComponent(projectId)}`, { message: body });
    }

    // delete intentionally NOT exposed
  };
}

module.exports = {
  createDelesignClient
};
