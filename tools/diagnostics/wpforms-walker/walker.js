'use strict';

// wpforms-walker — generic multi-page WPForms walker.
//
// Strategy: on each visible page, fill any required fields not yet filled, then
// click .wpforms-page-next. Stop when the next button is gone or .wpforms-submit
// becomes visible. Return a log of every page traversed and every field touched.
//
// Designed to run inside a Playwright page already created by the caller. Does
// NOT instantiate the browser. Pairs with datalayer-probe for instrumentation.
//
// Answer policy (precedence):
//   1. config.answers[fieldId]            → explicit per-field answer
//   2. config.answersByPage[pageIdx][...] → per-page answer list
//   3. config.choiceFor[fieldId]          → "first" | "last" | numeric index | string label
//   4. default placeholders               → safe synthetic data
//
// Stop policy: walks at most config.maxPages (default 30) pages. Submits only
// if config.submit === true (intercept submit elsewhere if you don't want a
// real lead created).

const DEFAULT_PLACEHOLDERS = {
  text: 'Test',
  email: 'test+wpwalker@example.com',
  tel: '5555555555',
  number: '1500',
  textarea: 'Test entry from wpforms-walker',
  url: 'https://example.com',
  date: '2026-01-01',
};

// Number-field labels that suggest money / income / amount semantics. The
// generic number placeholder (1500) covers these too, but we keep this seam
// so callers can shadow specific labels with values their form expects.
const NUMBER_LABEL_HEURISTICS = [
  { match: /(income|salary|pay|gross|monthly|weekly|amount|cost|price|payment|rent|mortgage)/i, value: '4500' },
  { match: /(age|year|years)/i, value: '35' },
  { match: /(zip|postal)/i, value: '12345' },
];

async function walkForm(page, config = {}) {
  const formId = String(config.formId || '61');
  const maxPages = config.maxPages || 30;
  const maxStallsPerPage = config.maxStallsPerPage || 1; // tolerate 1 retry before giving up
  const verbose = !!config.verbose;
  const submit = config.submit === true;
  const answers = config.answers || {};
  const answersByPage = config.answersByPage || {};
  const choiceFor = config.choiceFor || {};
  const log = [];
  const stallByPage = {};

  for (let i = 0; i < maxPages; i++) {
    const before = await currentPageInfo(page, formId);
    log.push({ kind: 'page-enter', idx: before.visibleIdx, total: before.totalPages, calc: before.calcSnapshot });
    if (before.totalPages === 0) {
      log.push({ kind: 'no-form', formId });
      break;
    }

    // Fill fields on visible page
    const fillReport = await fillVisiblePage(page, formId, {
      answers,
      perPage: answersByPage[String(before.visibleIdx)] || {},
      choiceFor,
    });
    log.push({ kind: 'fill', idx: before.visibleIdx, ...fillReport });

    // Decide: next or submit
    const decision = await decideNextOrSubmit(page, formId);
    log.push({ kind: 'decide', idx: before.visibleIdx, decision });

    if (decision === 'next') {
      // Fire blur on focused field so WPForms' internal validation runs before
      // we click next. Some calc fields recompute on blur, not on input.
      await page.evaluate(() => { try { document.activeElement && document.activeElement.blur(); } catch (_) {} });
      await page.waitForTimeout(200);
      const clickedNext = await clickNext(page, formId);
      if (!clickedNext.ok) { log.push({ kind: 'next-failed', detail: clickedNext.reason }); break; }
      // Poll for page advance up to ~3s rather than a single fixed sleep.
      let advanced = false;
      for (let waitTries = 0; waitTries < 12; waitTries++) {
        await page.waitForTimeout(250);
        const probe = await currentPageInfo(page, formId);
        if (probe.visibleIdx !== before.visibleIdx) { advanced = true; break; }
      }

      // Stall detection: did the visible page actually advance?
      const after = await currentPageInfo(page, formId);
      if (after.visibleIdx === before.visibleIdx) {
        stallByPage[before.visibleIdx] = (stallByPage[before.visibleIdx] || 0) + 1;
        log.push({
          kind: 'stall',
          idx: before.visibleIdx,
          stallCount: stallByPage[before.visibleIdx],
          maxStalls: maxStallsPerPage,
          reason: 'page-did-not-advance-after-next',
          hint: 'Form validation likely failed silently. Inspect required fields on this page — supply realistic value via config.answers["<field_id>"].',
        });
        if (stallByPage[before.visibleIdx] >= maxStallsPerPage) {
          log.push({ kind: 'stop', idx: before.visibleIdx, reason: 'stall-ceiling-reached' });
          break;
        }
        // try once more with a fresh fill cycle next iteration
      }
      continue;
    }
    if (decision === 'submit') {
      if (submit) {
        const r = await clickSubmit(page, formId);
        log.push({ kind: 'submit-clicked', ...r });
        await page.waitForTimeout(2500);
      } else {
        // simulate capture without submitting
        const r = await page.evaluate((fid) => {
          const btn = document.querySelector('#wpforms-form-' + fid + ' .wpforms-submit');
          if (!btn) return { ok: false, reason: 'no-submit' };
          btn.click();
          return { ok: true, simulated: true };
        }, formId);
        log.push({ kind: 'submit-simulated', ...r });
        await page.waitForTimeout(500);
      }
      break;
    }
    log.push({ kind: 'stop', reason: 'no-decision' });
    break;
  }

  const finalCalc = await calcSnapshot(page, formId);
  return { log, finalCalc };
}

async function currentPageInfo(page, formId) {
  return await page.evaluate((fid) => {
    const pages = [...document.querySelectorAll('#wpforms-form-' + fid + ' .wpforms-page')];
    const visibleIdx = pages.findIndex(p => p.offsetParent !== null);
    const calcEls = [...document.querySelectorAll('#wpforms-form-' + fid + ' input[title*="calculation" i]')];
    return {
      totalPages: pages.length,
      visibleIdx,
      calcSnapshot: Object.fromEntries(calcEls.map(el => [el.id, el.value])),
    };
  }, formId);
}

async function calcSnapshot(page, formId) {
  return await page.evaluate((fid) => {
    const calcEls = [...document.querySelectorAll('#wpforms-form-' + fid + ' input[title*="calculation" i]')];
    return Object.fromEntries(calcEls.map(el => [el.id, el.value]));
  }, formId);
}

async function fillVisiblePage(page, formId, ctx) {
  const filled = await page.evaluate((args) => {
    const { fid, answers, perPage, choiceFor, placeholders, numberLabelHeuristics } = args;
    const pages = [...document.querySelectorAll('#wpforms-form-' + fid + ' .wpforms-page')];
    const page = pages.find(p => p.offsetParent !== null);
    if (!page) return { filled: [], skipped: 'no-visible-page' };

    const filled = [];

    function pickChoice(group, pref) {
      if (pref == null) return group[0];
      if (typeof pref === 'number') return group[pref] || group[0];
      if (pref === 'first') return group[0];
      if (pref === 'last') return group[group.length - 1];
      // string match by label or value
      const m = group.find(r => (r.value === pref) || ((r.parentElement?.textContent || '').trim() === pref) || ((document.querySelector('label[for="' + r.id + '"]')?.textContent || '').trim() === pref));
      return m || group[0];
    }

    // Group radios by name
    const radioGroups = {};
    [...page.querySelectorAll('input[type="radio"]')].forEach(r => {
      const nm = r.name; if (!radioGroups[nm]) radioGroups[nm] = [];
      radioGroups[nm].push(r);
    });
    for (const [nm, group] of Object.entries(radioGroups)) {
      if (group.some(r => r.checked)) continue;
      // resolve field id from name like wpforms[fields][25]
      const m = nm.match(/\[fields\]\[(\d+)\]/);
      const fldId = m ? m[1] : null;
      let pref = (fldId && answers[fldId]) ?? (fldId && perPage[fldId]) ?? (fldId && choiceFor[fldId]);
      const target = pickChoice(group, pref);
      if (target) {
        target.click();
        filled.push({ field: fldId, kind: 'radio', value: target.value });
      }
    }

    // Checkbox groups — if at least one not checked, check the first one only if required
    [...page.querySelectorAll('input[type="checkbox"]')].forEach(cb => {
      if (cb.required && !cb.checked) { cb.click(); filled.push({ field: cb.name, kind: 'checkbox', value: cb.value }); }
    });

    // Selects (single + multi)
    [...page.querySelectorAll('select')].forEach(sel => {
      const isMulti = sel.multiple;
      if (isMulti) {
        if ([...sel.options].some(o => o.selected && o.value)) return;
        const firstValue = [...sel.options].find(o => o.value);
        if (firstValue) {
          firstValue.selected = true;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          // Many WPForms multi-selects use Choices.js — also try to trigger its
          // change-listener by dispatching addItem on the rendered widget.
          const choicesWrap = sel.closest('.choices');
          if (choicesWrap) {
            const item = document.createElement('div');
            item.className = 'choices__item';
            item.textContent = firstValue.textContent;
            const inner = choicesWrap.querySelector('.choices__list--multiple, .choices__list');
            if (inner) inner.appendChild(item);
          }
          filled.push({ field: sel.id || sel.name, kind: 'select-multiple', value: firstValue.value });
        }
      } else {
        if (sel.value) return;
        const opts = [...sel.options].filter(o => o.value);
        if (opts.length > 0) {
          sel.value = opts[0].value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          filled.push({ field: sel.id || sel.name, kind: 'select', value: sel.value });
        }
      }
    });

    // Text-like inputs (skip hidden/calculated)
    [...page.querySelectorAll('input, textarea')].forEach(input => {
      const type = (input.type || input.tagName).toLowerCase();
      if (['hidden', 'radio', 'checkbox', 'submit', 'button', 'file'].includes(type)) return;
      if ((input.title || '').toLowerCase().includes('calculation')) return;
      if (input.value && input.value.trim()) return;
      const m = (input.name || '').match(/\[fields\]\[(\d+)\]/);
      const fldId = m ? m[1] : null;
      let v = (fldId && answers[fldId]) || (fldId && perPage[fldId]) || null;
      if (!v) {
        // Heuristic: for number fields, peek at the field's label/description
        // text and apply a labelled placeholder if the label suggests money/age/etc.
        if (type === 'number' && numberLabelHeuristics && numberLabelHeuristics.length) {
          const labelEl = input.id ? document.querySelector('label[for="' + input.id + '"]') : null;
          const wrapper = input.closest('.wpforms-field, [class*="wpforms-field"]');
          const labelTxt = (labelEl?.textContent || '') + ' ' + (wrapper?.textContent || '').slice(0, 200);
          for (const rule of numberLabelHeuristics) {
            const re = new RegExp(rule.match.source, rule.match.flags);
            if (re.test(labelTxt)) { v = rule.value; break; }
          }
        }
        if (!v) v = placeholders[type] || placeholders.text;
      }
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      filled.push({ field: fldId || input.id || input.name, kind: type, value: typeof v === 'string' && v.length > 40 ? v.slice(0, 40) + '…' : v });
    });

    return { filled };
  }, {
    fid: formId,
    answers: ctx.answers || {},
    perPage: ctx.perPage || {},
    choiceFor: ctx.choiceFor || {},
    placeholders: DEFAULT_PLACEHOLDERS,
    numberLabelHeuristics: NUMBER_LABEL_HEURISTICS.map(r => ({ match: { source: r.match.source, flags: r.match.flags }, value: r.value })),
  });
  return filled;
}

async function decideNextOrSubmit(page, formId) {
  return await page.evaluate((fid) => {
    const root = document.querySelector('#wpforms-form-' + fid);
    if (!root) return 'no-form';
    const visiblePage = [...root.querySelectorAll('.wpforms-page')].find(p => p.offsetParent !== null);
    if (!visiblePage) return 'no-page';
    const hasNext = !!visiblePage.querySelector('.wpforms-page-next:not([disabled])') ||
                    !!visiblePage.querySelector('.wpforms-page-button[data-action="next"]:not([disabled])');
    if (hasNext) return 'next';
    if (root.querySelector('.wpforms-submit')) return 'submit';
    return 'unknown';
  }, formId);
}

async function clickNext(page, formId) {
  return await page.evaluate((fid) => {
    const root = document.querySelector('#wpforms-form-' + fid);
    const visiblePage = [...root.querySelectorAll('.wpforms-page')].find(p => p.offsetParent !== null);
    const btn = visiblePage.querySelector('.wpforms-page-next, .wpforms-page-button[data-action="next"]');
    if (!btn) return { ok: false, reason: 'no-next-btn' };
    btn.click();
    return { ok: true };
  }, formId);
}

async function clickSubmit(page, formId) {
  return await page.evaluate((fid) => {
    const btn = document.querySelector('#wpforms-form-' + fid + ' .wpforms-submit');
    if (!btn) return { ok: false, reason: 'no-submit-btn' };
    btn.click();
    return { ok: true };
  }, formId);
}

module.exports = { walkForm, calcSnapshot, currentPageInfo };
