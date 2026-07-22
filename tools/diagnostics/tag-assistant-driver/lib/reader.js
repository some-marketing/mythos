'use strict';

// Tag Assistant DOM readers.
//
// Pure logic — works both inside Playwright (page.evaluate) and inside
// claude-in-chrome MCP eval. Each reader is a function STRING that runs in
// the page context and returns serializable JSON.
//
// DOM structure (tagassistant.google.com, post-event view):
//   - Left rail "Summary" list contains each captured event as a row.
//   - Clicking a row swaps the right panel between tabs:
//       Tags fired on this event | Tags not fired | Variables | Data Layer | Errors
//   - Each row exposes the event name, hit type (page view, click, custom), and
//     a relative timestamp.
//
// These readers are best-effort: Tag Assistant ships obfuscated Angular Material
// markup and the class names change quarterly. Selectors are layered with
// fallbacks to survive small reshuffles.

const READ_EVENT_LIST = `
(() => {
  function looksLikeEventRow(el) {
    if (!el || !el.textContent) return false;
    const txt = el.textContent.trim();
    if (!txt) return false;
    return /^[\\d]+\\s+|[A-Za-z]/.test(txt);
  }
  const candidateSelectors = [
    '[role="listbox"] [role="option"]',
    '.summary-list .summary-list-item',
    'mat-list-item',
    'div[id^="event-"]',
    '[aria-label*="event" i]'
  ];
  let rows = [];
  for (const sel of candidateSelectors) {
    rows = [...document.querySelectorAll(sel)].filter(looksLikeEventRow);
    if (rows.length > 0) break;
  }
  return {
    selectorUsed: rows[0] ? rows[0].matches('[role="option"]') ? 'role=option' : 'other' : null,
    count: rows.length,
    events: rows.map((r, idx) => {
      const txt = r.textContent.replace(/\\s+/g, ' ').trim();
      return {
        idx,
        text: txt.slice(0, 160),
        id: r.id || null,
        selected: r.getAttribute('aria-selected') === 'true' || r.classList.contains('selected'),
      };
    }),
  };
})()
`;

const READ_DATALAYER_TAB = `
(() => {
  const containers = [
    ...document.querySelectorAll('[aria-label*="data layer" i], [aria-label*="dataLayer" i]'),
    ...document.querySelectorAll('.data-layer, .data-layer-panel, .datalayer-panel'),
    ...document.querySelectorAll('mat-tab-body'),
  ];
  function harvest(root) {
    const text = (root.textContent || '').replace(/\\s+/g, ' ').trim();
    return text.slice(0, 4000);
  }
  return containers.map((c, i) => ({ idx: i, sample: harvest(c) })).filter(x => x.sample.length > 0);
})()
`;

const READ_TAGS_FIRED = `
(() => {
  const sectionTitles = ['Tags Fired', 'Tags Not Fired', 'Tags fired on this event', 'Tags not fired'];
  const out = { firedSectionFound: false, tags: [] };
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,.section-title,.mat-card-title')];
  for (const h of headings) {
    const t = (h.textContent || '').trim();
    if (sectionTitles.some(s => t.toLowerCase().includes(s.toLowerCase()))) {
      out.firedSectionFound = true;
      let sib = h.parentElement;
      // Try to find a list near this heading
      const list = sib && sib.querySelector('ul, ol, .list, [role="list"]');
      if (list) {
        out.tags = [...list.children].map(li => (li.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200));
      }
      break;
    }
  }
  return out;
})()
`;

const READ_CONTAINER_INFO = `
(() => {
  const txt = document.body.textContent || '';
  const m = txt.match(/(GTM-[A-Z0-9]+)/);
  return {
    containerId: m ? m[1] : null,
    url: location.href,
    title: document.title,
    hashParams: Object.fromEntries(new URLSearchParams(location.hash.replace(/^#/, '').replace(/^\\?/, ''))),
  };
})()
`;

const CLICK_EVENT_BY_INDEX = (idx) => `
(() => {
  const candidateSelectors = [
    '[role="listbox"] [role="option"]',
    '.summary-list .summary-list-item',
    'mat-list-item',
    'div[id^="event-"]',
  ];
  let rows = [];
  for (const sel of candidateSelectors) {
    rows = [...document.querySelectorAll(sel)];
    if (rows.length > 0) break;
  }
  const target = rows[${idx}];
  if (!target) return { clicked: false, reason: 'no-such-row', total: rows.length };
  target.click();
  return { clicked: true, idx: ${idx}, text: (target.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160) };
})()
`;

const CLICK_TAB_BY_NAME = (name) => `
(() => {
  const wanted = ${JSON.stringify(String(name))}.toLowerCase();
  const tabs = [...document.querySelectorAll('[role="tab"], mat-tab-label, .mdc-tab')];
  for (const t of tabs) {
    const txt = (t.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    if (txt.includes(wanted)) {
      t.click();
      return { clicked: true, label: txt.slice(0, 80) };
    }
  }
  return { clicked: false, available: tabs.map(t => (t.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase()).slice(0, 12) };
})()
`;

module.exports = {
  READ_EVENT_LIST,
  READ_DATALAYER_TAB,
  READ_TAGS_FIRED,
  READ_CONTAINER_INFO,
  CLICK_EVENT_BY_INDEX,
  CLICK_TAB_BY_NAME,
};
