'use strict';

// Billing interchange schema (v1).
//
// The Moxie PUBLIC API does not expose issued-invoice history or payments (see
// _dev/reports/analysis/moxie-live-probe-findings__20260708.md — the 404 wall).
// That transactional data is harvested from the logged-in Moxie web app (the
// browser lane) and written into THIS neutral shape, which the billing export
// (./export.js) consumes. Keeping a provider-neutral interchange shape means:
//   - the export/CSV code never depends on Moxie's raw field names, and
//   - a future CRM (HoneyBook, Dubsado, …) can populate the same shape.
//
// This is a Mythos-defined shape, NOT a mirror of any confirmed Moxie payload —
// Moxie's real invoice/payment field shapes were never observed (the endpoints
// 404 / returned empty during the probe). When the browser harvest reveals the
// real fields, add a normalizer that maps them INTO this shape; do not bend
// this shape to guessed Moxie internals.
//
// Money fields are decimal amounts in the invoice's own currency (e.g. 1300.50),
// NOT integer cents. Dates are ISO calendar dates (YYYY-MM-DD).
//
// @typedef {Object} BillingInvoice
// @property {string}  id           Stable invoice id (provider id or synthesized).
// @property {string} [number]      Human invoice number, if any.
// @property {string} [clientId]    Provider client id (join key to clients).
// @property {string} [clientName]  Denormalized client name for the CSV.
// @property {string} [projectId]   Provider project id, if attributable.
// @property {string}  status       e.g. "Draft" | "Sent" | "Late" | "Paid".
// @property {string}  currency     e.g. "CAD" | "USD".
// @property {string}  issueDate    ISO date the invoice was issued.
// @property {string} [dueDate]     ISO date payment is due.
// @property {number} [subtotal]    Pre-tax amount.
// @property {number} [tax]         Tax amount.
// @property {number}  total        Invoice total (tax inclusive).
// @property {number} [amountPaid]  Amount paid to date.
// @property {number} [amountDue]   Outstanding balance.
//
// @typedef {Object} BillingPayment
// @property {string}  id           Stable payment id.
// @property {string} [invoiceId]   Invoice this payment applies to.
// @property {string} [clientId]    Provider client id.
// @property {string} [clientName]  Denormalized client name for the CSV.
// @property {string}  currency     e.g. "CAD" | "USD".
// @property {string}  date         ISO date the payment was received.
// @property {number}  amount       Payment amount.
// @property {string} [method]      e.g. "Stripe" | "e-transfer" | "cheque".
//
// @typedef {Object} BillingDataset
// @property {string}  [_source]    Provenance, e.g. "moxie-web-harvest 2026-07-08".
// @property {string}  [_note]      Free-form provenance / caveats.
// @property {BillingInvoice[]} invoices
// @property {BillingPayment[]} payments

const EMPTY_DATASET = Object.freeze({ invoices: [], payments: [] });

// Coerces an arbitrary parsed JSON blob into a well-formed dataset (arrays
// guaranteed present) without inventing rows. Used by the CLI so a missing or
// partial harvest file degrades to empty, header-only CSVs instead of throwing.
function coerceDataset(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_DATASET };
  return {
    _source: raw._source,
    _note: raw._note,
    invoices: Array.isArray(raw.invoices) ? raw.invoices : [],
    payments: Array.isArray(raw.payments) ? raw.payments : []
  };
}

module.exports = {
  EMPTY_DATASET,
  coerceDataset
};
