'use strict';

// Moxie CRM provider. Reads (v1, confirmed) + write lane (v1.1, inert by
// construction — see the WRITES note below).
//
// PROVIDER SHAPE: any CRM provider added to this lane in future (HoneyBook,
// Dubsado, HubSpot, etc.) should export a factory returning an object with the
// same methods (READ_METHODS + WRITE_METHODS = PROVIDER_SHAPE). Reads resolve
// to an array of raw provider objects (or, in dry-run, the request descriptor).
// Nothing outside this file should special-case "moxie" by name; callers hold a
// `provider` object satisfying this shape.
//
// CONFIRMED READ SHAPES (live read-only probe, 2026-07-08): the read endpoint
// paths and response envelope were confirmed against the real Moxie public API
// (X-API-KEY auth, per-workspace base URL ending /api/public/). See
// _dev/reports/analysis/moxie-live-probe-findings__20260708.md. Findings:
//   - List/search endpoints return a BARE JSON ARRAY, not a paginated
//     envelope. There is no { data, meta } wrapper and no meta.has_more.
//     page/per_page query params are accepted but ignored — do NOT loop pages.
//   - action/clients/list, action/users/list → full list (no params needed).
//   - action/contacts/search, action/projects/search → full list; an empty
//     `query` returns all rows.
//   - action/payableInvoices/search returns ONLY currently-payable
//     (outstanding) invoices; it does NOT expose invoice history. Every
//     documented status value returned [] against this workspace. Historical
//     billing must come from the logged-in web app (browser lane), not here.
//   - The six read endpoints added in v1.1 (formNames, taskStages,
//     pipelineStages, emailTemplates, invoiceTemplates, vendors) are listed by
//     the community OpenAPI (secondary evidence); their response envelope is
//     assumed bare-array like the others and confirmed at first live read.
//
// WRITES (v1.1, PROVISIONAL + INERT): every write method below POSTs via
// `client.post()`, which is gated by TWO switches (CRM_DRY_RUN off AND
// CRM_WRITE_ENABLED on) and otherwise returns an inert descriptor with NO
// network call. Write endpoint paths come from the community OpenAPI (secondary
// evidence) and their request-body shapes are UNVERIFIED — treat every write
// payload as provisional until confirmed at the first operator-gated live call.
// There is no write CLI runner by design.

const READ_METHODS = Object.freeze([
  'listClients',
  'listContacts',
  'listProjects',
  'listInvoices',
  'listUsers',
  'listFormNames',
  'listTaskStages',
  'listPipelineStages',
  'listEmailTemplates',
  'listInvoiceTemplates',
  'listVendors'
]);

const WRITE_METHODS = Object.freeze([
  'createInvoice',
  'applyPayment',
  'createClient',
  'createContact',
  'createProject',
  'createTask',
  'createTimeEntry',
  'createExpense',
  'createOpportunity',
  'createFormSubmission'
]);

const PROVIDER_SHAPE = Object.freeze([...READ_METHODS, ...WRITE_METHODS]);

// Fetches a single list/search endpoint via `client.get(pathname, query)` and
// normalizes the result to an array. Moxie returns a bare array; older/other
// providers might wrap rows in `{ data: [...] }`, so this accepts either form
// defensively. It does NOT paginate — the probe confirmed Moxie ignores
// page/per_page and exposes no has_more cursor. In dry-run mode client.get()
// returns a request descriptor instead of data, which is passed through as-is
// (no live call, no fake array).
async function fetchList(client, pathname, query = {}) {
  const response = await client.get(pathname, query);

  if (response && response.dry_run) {
    return response;
  }

  if (Array.isArray(response)) {
    return response;
  }

  if (response && Array.isArray(response.data)) {
    return response.data;
  }

  return [];
}

function createMoxieProvider(client) {
  return {
    id: 'moxie',
    name: 'Moxie',

    listClients(opts = {}) {
      return fetchList(client, 'action/clients/list', opts);
    },

    listContacts(opts = {}) {
      // Empty query returns all contacts (confirmed by probe).
      return fetchList(client, 'action/contacts/search', opts);
    },

    listProjects(opts = {}) {
      // Empty query returns all projects (confirmed by probe).
      return fetchList(client, 'action/projects/search', opts);
    },

    listUsers(opts = {}) {
      return fetchList(client, 'action/users/list', opts);
    },

    // Returns ONLY currently-payable (outstanding) invoices — NOT invoice
    // history. Accepts optional { query, status } filters, but the 2026-07-08
    // probe found this endpoint returned [] for every status value tried and
    // exposes no paid/historical invoices at all. For historical billing, use
    // the logged-in web app (browser lane), not this method.
    listInvoices(opts = {}) {
      const query = {};
      if (opts.query !== undefined) query.query = opts.query;
      if (opts.status !== undefined) query.status = opts.status;
      return fetchList(client, 'action/payableInvoices/search', query);
    },

    // --- reads added in v1.1 (bare-array assumed; confirm at first live read) ---

    listFormNames(opts = {}) {
      return fetchList(client, 'action/formNames/list', opts);
    },

    listTaskStages(opts = {}) {
      return fetchList(client, 'action/taskStages/list', opts);
    },

    listPipelineStages(opts = {}) {
      return fetchList(client, 'action/pipelineStages/list', opts);
    },

    listEmailTemplates(opts = {}) {
      return fetchList(client, 'action/emailTemplates/list', opts);
    },

    listInvoiceTemplates(opts = {}) {
      return fetchList(client, 'action/invoiceTemplates/list', opts);
    },

    listVendors(opts = {}) {
      return fetchList(client, 'action/vendors/list', opts);
    },

    // --- writes (v1.1) --------------------------------------------------------
    // Each POSTs via client.post(), which is inert unless BOTH CRM_DRY_RUN=false
    // AND CRM_WRITE_ENABLED=true. In any other state these return an inert
    // descriptor and make NO network call. Every `body` shape is PROVISIONAL
    // (community-OpenAPI-derived, unverified) — confirm the exact payload at the
    // first operator-gated live call before trusting any of these for real data.

    // @param {object} body Invoice payload. PROVISIONAL shape.
    createInvoice(body = {}) {
      return client.post('action/invoices/create', body);
    },

    // @param {object} body Payment-application payload (invoice id + amount).
    //   PROVISIONAL shape.
    applyPayment(body = {}) {
      return client.post('action/invoices/applyPayment', body);
    },

    // @param {object} body Client payload. PROVISIONAL shape.
    createClient(body = {}) {
      return client.post('action/clients/create', body);
    },

    // @param {object} body Contact payload (clientId + contact fields).
    //   PROVISIONAL shape.
    createContact(body = {}) {
      return client.post('action/contacts/create', body);
    },

    // @param {object} body Project payload. PROVISIONAL shape.
    createProject(body = {}) {
      return client.post('action/projects/create', body);
    },

    // @param {object} body Task payload. PROVISIONAL shape.
    createTask(body = {}) {
      return client.post('action/tasks/create', body);
    },

    // @param {object} body Time-entry payload. PROVISIONAL shape. Endpoint is
    //   action/timeWorked/create (matches the read-side timeWorked naming).
    createTimeEntry(body = {}) {
      return client.post('action/timeWorked/create', body);
    },

    // @param {object} body Expense payload. PROVISIONAL shape.
    createExpense(body = {}) {
      return client.post('action/expenses/create', body);
    },

    // @param {object} body Opportunity payload. PROVISIONAL shape.
    createOpportunity(body = {}) {
      return client.post('action/opportunities/create', body);
    },

    // @param {object} body Form-submission payload. PROVISIONAL shape. Note:
    //   submissions are writable but form RESPONSES are not readable via the
    //   public API, and form DESIGN is UI-only (see probe findings).
    createFormSubmission(body = {}) {
      return client.post('action/formSubmissions/create', body);
    }
  };
}

module.exports = {
  createMoxieProvider,
  fetchList,
  READ_METHODS,
  WRITE_METHODS,
  PROVIDER_SHAPE
};
