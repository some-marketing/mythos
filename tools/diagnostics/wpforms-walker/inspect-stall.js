#!/usr/bin/env node
'use strict';

// inspect-stall — diagnostic. Walks the {CLIENT_CODE} form to a target page, then
// dumps full page state including validation errors and field details so we
// can understand why the walker stalls.

const { chromium } = require('playwright');
const { walkForm } = require('./walker');

(async () => {
  const targetIdx = Number(process.argv[2] || '6');
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('https://apply.example-dealership.com/', { waitUntil: 'networkidle', timeout: 60000 });

  // Walk to (but not past) target page using a tiny tweak of walkForm
  // — capped at targetIdx so we land on it and stop.
  await walkForm(page, {
    formId: '61',
    submit: false,
    maxPages: targetIdx, // stops BEFORE submitting from page-(targetIdx-1)
    choiceFor: { '25': 'first' },
  });

  // Snapshot full visible-page state
  const snap = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('#wpforms-form-61 .wpforms-page')];
    const vis = pages.find(p => p.offsetParent !== null);
    if (!vis) return { error: 'no-visible-page' };
    return {
      pageIdx: pages.indexOf(vis),
      pageClass: vis.className,
      allFieldsIncludingInvisible: [...vis.querySelectorAll('input, textarea, select')].length,
      allFields: [...vis.querySelectorAll('input, textarea, select')].map(el => ({
        id: el.id,
        type: el.type || el.tagName,
        name: el.name,
        value: (el.value || '').slice(0, 60),
        required: el.required,
        title: (el.title || '').slice(0, 100),
        visible: el.offsetParent !== null,
        min: el.min,
        max: el.max,
        step: el.step,
        pattern: el.pattern,
        ariaInvalid: el.getAttribute('aria-invalid'),
        ariaDescribedBy: el.getAttribute('aria-describedby'),
      })),
      errorEls: [...vis.querySelectorAll('.wpforms-error, .wpforms-field-required, [role="alert"]')].map(el => ({
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        css: el.tagName + (el.id ? '#' + el.id : '') + '.' + String(el.className).split(' ').filter(Boolean).slice(0, 3).join('.'),
        visible: el.offsetParent !== null,
      })),
      nextButtonState: (() => {
        const nb = vis.querySelector('.wpforms-page-next');
        if (!nb) return { exists: false };
        return { exists: true, disabled: nb.disabled, visible: nb.offsetParent !== null, text: (nb.textContent || '').trim() };
      })(),
      labelsAndHeadings: [...vis.querySelectorAll('label, h2, h3, h4, .wpforms-field-label, .wpforms-field-description')].map(el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 15),
    };
  });

  console.log(JSON.stringify(snap, null, 2));

  // Now try clicking next and capture what happens
  const beforeAdvance = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('#wpforms-form-61 .wpforms-page')];
    return pages.findIndex(p => p.offsetParent !== null);
  });
  await page.click('.wpforms-page .wpforms-page-next', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  const afterAdvance = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('#wpforms-form-61 .wpforms-page')];
    const visibleIdx = pages.findIndex(p => p.offsetParent !== null);
    const errs = [...document.querySelectorAll('.wpforms-error, [role="alert"]')]
      .filter(e => e.offsetParent !== null)
      .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200));
    const focused = document.activeElement ? { id: document.activeElement.id, tag: document.activeElement.tagName } : null;
    return { visibleIdx, visibleErrors: errs, focused };
  });
  console.error('\nADVANCE ATTEMPT:');
  console.error('  before idx:', beforeAdvance);
  console.error('  after idx :', afterAdvance.visibleIdx);
  console.error('  errors    :', JSON.stringify(afterAdvance.visibleErrors));
  console.error('  focused   :', JSON.stringify(afterAdvance.focused));

  await page.waitForTimeout(3000);
  await browser.close();
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
