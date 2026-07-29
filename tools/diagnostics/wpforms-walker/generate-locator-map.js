'use strict';

// generate-locator-map: walks a multi-page WPForms form once, snapshots each
// page's interactive elements and the resulting calc-field values, then emits
// a DRAFT locator_map.json conformant to the wordpress/qa framework schema.
//
// Output is a starting point — the operator is expected to hand-edit it for
// correctness, then commit it under
//   frameworks/wordpress/qa/testcases/<id>/locator_map.json
//
// Pairs with the existing walker.js for the page-traversal mechanics.

const { walkForm, currentPageInfo, calcSnapshot } = require('./walker');

async function generateLocatorMap(page, config) {
  const formId = String(config.formId || '61');
  const observations = [];

  const wrappedWalk = await walkForm(page, {
    formId,
    submit: false,
    maxPages: config.maxPages || 30,
    answers: config.answers || {},
    answersByPage: config.answersByPage || {},
    choiceFor: config.choiceFor || {},
    onBeforeFill: async () => {},
  });

  // walker.js already logged page-enter snapshots; reconstruct from the log
  for (const entry of wrappedWalk.log) {
    if (entry.kind !== 'page-enter') continue;
    const idx = entry.idx;
    if (idx < 0) continue;
    const pageSnapshot = await snapshotPage(page, formId, idx).catch(() => null);
    if (pageSnapshot) observations.push({ idx, calcAtEnter: entry.calc, ...pageSnapshot });
  }

  const submitInfo = await snapshotSubmit(page, formId);

  const locatorMap = {
    version: '1.0',
    metadata: {
      generated_at: new Date().toISOString(),
      generated_by: 'tools/diagnostics/wpforms-walker/generate-locator-map.js',
      source_url: page.url(),
      form_id: formId,
      notes: 'Draft — hand-edit before committing as a QA testcase locator_map. Calc-field values shown are post-walk; placeholder-driven walk may not match real user T-score paths.',
    },
    form: {
      root_css: `#wpforms-form-${formId}`,
      is_multipage: observations.length > 1,
    },
    pages: observations.map((o) => ({
      idx: o.idx,
      visible_marker: `#wpforms-form-${formId} .wpforms-page-${o.idx + 1}`,
      fields: o.fields,
      next_button_css: o.nextButton,
      calc_observed: o.calcAtEnter || {},
    })),
    submit: submitInfo,
    final_calc: wrappedWalk.finalCalc,
  };

  return { locatorMap, walkLog: wrappedWalk.log };
}

async function snapshotPage(page, formId, idx) {
  return await page.evaluate(({ fid, want }) => {
    const pages = [...document.querySelectorAll('#wpforms-form-' + fid + ' .wpforms-page')];
    const target = pages[want];
    if (!target) return null;
    const radioGroups = {};
    target.querySelectorAll('input[type="radio"]').forEach((r) => {
      const m = (r.name || '').match(/\[fields\]\[(\d+)\]/);
      const fldId = m ? m[1] : null;
      if (!fldId) return;
      if (!radioGroups[fldId]) radioGroups[fldId] = { field_id: fldId, kind: 'radio', name: r.name, choices: [] };
      const labelEl = target.querySelector(`label[for="${r.id}"]`);
      radioGroups[fldId].choices.push({ value: r.value, label: (labelEl?.textContent || '').trim().slice(0, 100), css: '#' + r.id });
    });
    const textFields = [];
    target.querySelectorAll('input, textarea, select').forEach((el) => {
      const type = (el.type || el.tagName).toLowerCase();
      if (['hidden', 'radio', 'checkbox', 'submit', 'button', 'file'].includes(type)) return;
      const m = (el.name || '').match(/\[fields\]\[(\d+)\]/);
      const fldId = m ? m[1] : null;
      if (!fldId) return;
      textFields.push({
        field_id: fldId,
        kind: type,
        name: el.name,
        css: '#' + el.id,
        required: el.required || false,
        title: (el.title || '').slice(0, 80) || null,
      });
    });
    const hiddenCalc = [];
    target.querySelectorAll('input[type="hidden"]').forEach((el) => {
      if (!/calculation/i.test(el.title || '')) return;
      const m = (el.name || '').match(/\[fields\]\[(\d+)\]/);
      const fldId = m ? m[1] : null;
      if (!fldId) return;
      hiddenCalc.push({ field_id: fldId, kind: 'calc-hidden', css: '#' + el.id, current_value: el.value });
    });
    return {
      fields: [
        ...Object.values(radioGroups),
        ...textFields,
        ...hiddenCalc,
      ],
      nextButton: (() => {
        const nb = target.querySelector('.wpforms-page-next, .wpforms-page-button[data-action="next"]');
        return nb ? (nb.id ? '#' + nb.id : '.wpforms-page-next') : null;
      })(),
    };
  }, { fid: formId, want: idx });
}

async function snapshotSubmit(page, formId) {
  return await page.evaluate((fid) => {
    const btn = document.querySelector(`#wpforms-form-${fid} .wpforms-submit`);
    const succ = document.querySelector('.wpforms-confirmation-container-full, .wpforms-confirmation-container, .wpforms-confirmation-message');
    return {
      button_css: btn ? (btn.id ? '#' + btn.id : `#wpforms-form-${fid} .wpforms-submit`) : `#wpforms-form-${fid} .wpforms-submit`,
      success: {
        css: '.wpforms-confirmation-container-full, .wpforms-confirmation-container, .wpforms-confirmation-message',
        expected_text_contains: '',
        expected_url_contains: '',
        seen_at_runtime: !!succ,
      },
      error_selectors: [
        { css: `#wpforms-form-${fid} .wpforms-error`, text_contains: '' },
      ],
    };
  }, formId);
}

module.exports = { generateLocatorMap };
