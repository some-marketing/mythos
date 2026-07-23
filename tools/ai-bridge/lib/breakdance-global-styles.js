/**
 * breakdance-global-styles.js
 *
 * Reusable Playwright helpers for reading/writing Breakdance Global Styles CSS.
 * Proven during the CLIENTA landing page v8 CSS rollout (2026-04-02).
 *
 * Architecture:
 *   - Reads/writes CSS via the Vuex store (reliable, avoids CM6 focus issues)
 *   - Saves via the Breakdance Save button + admin-ajax POST verification
 *   - Falls back to CM6 EditorView only when Vuex is unavailable
 *
 * Usage:
 *   const { openGlobalStyles, getStylesheetCode, setStylesheetCode, saveGlobalStyles } = require('./breakdance-global-styles');
 *   const page = await browser.newPage();
 *   await openGlobalStyles(page, 'https://example.com');
 *   const css = await getStylesheetCode(page, 2);  // 3rd stylesheet (0-indexed)
 *   await setStylesheetCode(page, 2, newCss);
 *   await saveGlobalStyles(page);
 *
 * Prerequisites:
 *   - Page must be logged into WordPress admin
 *   - Breakdance builder must be installed and active
 */

'use strict';

const VUEX_PATH = 'Breakdance.stores.globalStore.store.state.global.globalSettings.settings.code.stylesheets';

/**
 * Navigate to Breakdance Global Styles builder mode.
 * @param {import('playwright').Page} page - Playwright page (must be logged in)
 * @param {string} siteUrl - WordPress site URL (e.g., 'https://example.com')
 * @param {object} [opts]
 * @param {number} [opts.timeout=30000] - Navigation timeout in ms
 */
async function openGlobalStyles(page, siteUrl, opts = {}) {
  const timeout = opts.timeout || 30000;
  const base = siteUrl.replace(/\/+$/, '');
  const url = `${base}/wp-admin/admin.php?page=breakdance_settings&tab=global_styles`;

  await page.goto(url, { waitUntil: 'networkidle', timeout });

  // Click "Launch Breakdance" to open the builder
  const launchBtn = page.locator('a:has-text("Launch Breakdance"), button:has-text("Launch Breakdance")').first();
  if (await launchBtn.count() > 0) {
    await launchBtn.click();
    await page.waitForLoadState('networkidle', { timeout });
  }

  // Wait for Breakdance Vue app to initialize
  await page.waitForFunction('typeof window.Breakdance !== "undefined" && Breakdance.stores', { timeout });
}

/**
 * Get the number of stylesheets in Global Styles.
 * @param {import('playwright').Page} page
 * @returns {Promise<number>}
 */
async function getStylesheetCount(page) {
  return page.evaluate(`(() => {
    try {
      const sheets = ${VUEX_PATH};
      return Array.isArray(sheets) ? sheets.length : 0;
    } catch { return 0; }
  })()`);
}

/**
 * Read CSS from a Global Styles stylesheet via Vuex store.
 * @param {import('playwright').Page} page
 * @param {number} index - Zero-based stylesheet index
 * @returns {Promise<string>} CSS content
 */
async function getStylesheetCode(page, index) {
  const code = await page.evaluate(`(() => {
    try {
      const sheet = ${VUEX_PATH}[${index}];
      return sheet ? (sheet.code || '') : null;
    } catch { return null; }
  })()`);
  if (code === null) {
    throw new Error(`Stylesheet at index ${index} not found in Vuex store`);
  }
  return code;
}

/**
 * Write CSS to a Global Styles stylesheet via Vuex store mutation.
 * This does NOT save — call saveGlobalStyles() after.
 * @param {import('playwright').Page} page
 * @param {number} index - Zero-based stylesheet index
 * @param {string} css - New CSS content
 */
async function setStylesheetCode(page, index, css) {
  const escaped = css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  const success = await page.evaluate(`(() => {
    try {
      const sheets = ${VUEX_PATH};
      if (!sheets || !sheets[${index}]) return false;
      sheets[${index}].code = \`${escaped}\`;
      return true;
    } catch { return false; }
  })()`);
  if (!success) {
    throw new Error(`Failed to set stylesheet code at index ${index}`);
  }
}

/**
 * Save Global Styles by clicking the Save button and verifying the admin-ajax POST.
 * @param {import('playwright').Page} page
 * @param {object} [opts]
 * @param {number} [opts.timeout=15000] - Timeout for save operation
 * @returns {Promise<{status: number, ok: boolean}>} Save response info
 */
async function saveGlobalStyles(page, opts = {}) {
  const timeout = opts.timeout || 15000;

  // Set up response listener for admin-ajax
  const ajaxPromise = page.waitForResponse(
    resp => resp.url().includes('admin-ajax.php') && resp.request().method() === 'POST',
    { timeout }
  );

  // Click save button
  const saveBtn = page.locator('button:has-text("Save")').first();
  if (await saveBtn.count() === 0) {
    throw new Error('Save button not found in Breakdance builder');
  }
  await saveBtn.click();

  // Wait for the ajax response
  const response = await ajaxPromise;
  const status = response.status();

  return { status, ok: status === 200 };
}

/**
 * Access the CodeMirror 6 EditorView for a stylesheet editor.
 * Use this only when Vuex store access is unavailable.
 * @param {import('playwright').Page} page
 * @param {number} editorIndex - Zero-based index of .cm-editor elements on the page
 * @returns {Promise<boolean>} Whether CM6 view was found
 */
async function hasCM6View(page, editorIndex = 0) {
  return page.evaluate(`(() => {
    const editors = document.querySelectorAll('.cm-editor .cm-content');
    const el = editors[${editorIndex}];
    if (!el || !el.cmView) return false;
    let node = el.cmView;
    while (node && !node.view?.state) node = node.parent;
    return !!(node && node.view?.state);
  })()`);
}

/**
 * Read CSS from a CM6 editor instance (fallback when Vuex unavailable).
 * @param {import('playwright').Page} page
 * @param {number} editorIndex - Zero-based index of .cm-editor elements
 * @returns {Promise<string>} CSS content from the editor
 */
async function getCM6Code(page, editorIndex = 0) {
  return page.evaluate(`(() => {
    const editors = document.querySelectorAll('.cm-editor .cm-content');
    const el = editors[${editorIndex}];
    if (!el || !el.cmView) return null;
    let node = el.cmView;
    while (node && !node.view?.state) node = node.parent;
    if (!node?.view?.state) return null;
    return node.view.state.doc.toString();
  })()`);
}

/**
 * Replace all content in a CM6 editor instance (fallback when Vuex unavailable).
 * @param {import('playwright').Page} page
 * @param {number} editorIndex - Zero-based index of .cm-editor elements
 * @param {string} css - New CSS content
 */
async function setCM6Code(page, editorIndex, css) {
  const escaped = css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  const success = await page.evaluate(`(() => {
    const editors = document.querySelectorAll('.cm-editor .cm-content');
    const el = editors[${editorIndex}];
    if (!el || !el.cmView) return false;
    let node = el.cmView;
    while (node && !node.view?.state) node = node.parent;
    if (!node?.view) return false;
    const view = node.view;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: \`${escaped}\` }
    });
    return true;
  })()`);
  if (!success) {
    throw new Error(`CM6 editor at index ${editorIndex} not accessible`);
  }
}

module.exports = {
  openGlobalStyles,
  getStylesheetCount,
  getStylesheetCode,
  setStylesheetCode,
  saveGlobalStyles,
  hasCM6View,
  getCM6Code,
  setCM6Code
};
