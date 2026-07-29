'use strict';

// GTM container DOM readers — pure logic, runs as `page.evaluate` strings
// against the operator's authenticated tagmanager.google.com tab.
//
// Validated against container {GTM_CONTAINER_ID} on 2026-05-27. GTM's Angular Material
// markup changes; selectors here are best-effort and tolerate small reshuffles.
//
// Readers return serializable JSON. Each is async-friendly (wraps in Promise
// to allow a settle delay before reading, since GTM's Angular needs a beat to
// render after route changes).

const READ_TRIGGERS_LIST = `
new Promise(r => setTimeout(r, 1800)).then(() => {
  const rows = [...document.querySelectorAll('tr, [role="row"]')];
  return {
    rowCount: rows.length,
    headers: [...document.querySelectorAll('th, [role="columnheader"]')].map(h => (h.textContent || '').trim()),
    rows: rows.slice(1).map(r => (r.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean),
  };
})
`;

const READ_TAGS_LIST = `
new Promise(r => setTimeout(r, 1800)).then(() => {
  const rows = [...document.querySelectorAll('tr, [role="row"]')];
  return {
    rowCount: rows.length,
    headers: [...document.querySelectorAll('th, [role="columnheader"]')].map(h => (h.textContent || '').trim()),
    rows: rows.slice(1).map(r => (r.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean),
  };
})
`;

const READ_VARIABLES_LIST = `
new Promise(r => setTimeout(r, 1800)).then(() => {
  const rows = [...document.querySelectorAll('tr, [role="row"]')];
  return {
    rowCount: rows.length,
    headers: [...document.querySelectorAll('th, [role="columnheader"]')].map(h => (h.textContent || '').trim()),
    rows: rows.slice(1).map(r => (r.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean),
  };
})
`;

// Reads a specific trigger detail: navigates by clicking the row, then captures
// the event-name field value, match-type radio selection, and any filter rules.
// Takes the trigger's row text prefix (e.g. "dle - t1") so it can be located.
function READ_TRIGGER_DETAIL(rowPrefix) {
  return `
(() => {
  const wanted = ${JSON.stringify(String(rowPrefix))};
  const rows = [...document.querySelectorAll('tr, [role="row"]')];
  const row = rows.find(r => ((r.textContent || '').trim()).toLowerCase().startsWith(wanted.toLowerCase()));
  if (!row) return Promise.resolve({ ok: false, error: 'no-row', rows: rows.slice(0, 5).map(r => (r.textContent || '').slice(0, 80)) });
  const clickable = row.querySelector('a, [role="link"], [role="button"], button') || row;
  clickable.click();
  return new Promise(r => setTimeout(r, 1800)).then(() => ({
    ok: true,
    urlHash: location.hash,
    eventNameInputs: [...document.querySelectorAll('input[type="text"], input:not([type])')].map(i => ({
      aria: i.getAttribute('aria-label') || '',
      placeholder: i.placeholder || '',
      value: i.value,
    })).filter(x => x.value || (x.aria && !/search|filter/i.test(x.aria))),
    radioLabels: [...document.querySelectorAll('label, .mat-radio-label, [role="radio"]')].map(l => (l.textContent || '').trim()).filter(t => t && t.length < 60),
    selectedRadios: [...document.querySelectorAll('[role="radio"][aria-checked="true"], input[type="radio"]:checked')].map(r => (r.getAttribute('aria-label') || r.value || (r.closest('label')?.textContent || '').trim() || '').slice(0, 80)),
    headings: [...document.querySelectorAll('h1, h2, h3')].map(h => (h.textContent || '').trim()).filter(Boolean),
  }));
})()
`;
}

const GTM_HASH_PATHS = {
  overview: (acct, ctr, ws) => `#/container/accounts/${acct}/containers/${ctr}/workspaces/${ws}`,
  triggers: (acct, ctr, ws) => `#/container/accounts/${acct}/containers/${ctr}/workspaces/${ws}/triggers`,
  tags:     (acct, ctr, ws) => `#/container/accounts/${acct}/containers/${ctr}/workspaces/${ws}/tags`,
  variables:(acct, ctr, ws) => `#/container/accounts/${acct}/containers/${ctr}/workspaces/${ws}/variables`,
};

module.exports = {
  READ_TRIGGERS_LIST,
  READ_TAGS_LIST,
  READ_VARIABLES_LIST,
  READ_TRIGGER_DETAIL,
  GTM_HASH_PATHS,
};
