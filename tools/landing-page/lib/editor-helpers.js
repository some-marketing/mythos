/**
 * editor-helpers.js
 *
 * Playwright helpers for interacting with WordPress editor fields,
 * including TinyMCE rich text editors and plain textareas.
 */

/**
 * Fill a WordPress editor field (auto-detects TinyMCE vs plain textarea).
 *
 * For TinyMCE fields: switches to HTML mode, fills textarea, dispatches events.
 * For plain fields: fills directly via Playwright .fill().
 *
 * @param {import('playwright').Page} page
 * @param {string} fieldId - The DOM id of the field (e.g. '_clienta_landing_content')
 * @param {string} value - The content to set (HTML or plain text)
 * @returns {Promise<{ok: boolean, isTinyMCE: boolean, error?: string}>}
 */
async function fillEditorField(page, fieldId, value) {
  if (!value) return { ok: true, isTinyMCE: false, skipped: true };

  // 1. Detect TinyMCE
  const isTinyMCE = await page.evaluate((id) => {
    return !!document.querySelector(`#wp-${id}-wrap`);
  }, fieldId);

  if (isTinyMCE) {
    // 2. Click the HTML tab button directly (more reliable than JS API)
    const htmlTab = await page.$(`#${fieldId}-html`);
    if (htmlTab) {
      await htmlTab.click();
      await page.waitForTimeout(800);
    } else {
      // Fallback: try switchEditors JS API
      await page.evaluate((id) => {
        if (window.switchEditors) switchEditors.go(id, 'html');
      }, fieldId);
      await page.waitForTimeout(800);
    }

    // Verify textarea is visible (HTML mode shows the raw textarea)
    const isVisible = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      return el.offsetHeight > 0;
    }, fieldId);

    if (!isVisible) {
      // Force-show as last resort
      await page.evaluate((id) => {
        const el = document.getElementById(id);
        if (el) { el.style.display = 'block'; el.style.height = '200px'; }
      }, fieldId);
      await page.waitForTimeout(300);
    }
  }

  // 4. Fill the textarea
  const textarea = await page.$(`#${fieldId}`);
  if (!textarea) {
    return { ok: false, isTinyMCE, error: `Element #${fieldId} not found` };
  }

  try {
    await textarea.fill(value);
  } catch (e) {
    return { ok: false, isTinyMCE, error: `fill() failed: ${e.message}` };
  }

  // 5. Dispatch events so WP tracks the change
  await textarea.evaluate(el => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  return { ok: true, isTinyMCE, length: value.length };
}

/**
 * Read the current value of a WordPress editor field.
 *
 * Checks both the raw textarea and the TinyMCE API.
 *
 * @param {import('playwright').Page} page
 * @param {string} fieldId
 * @returns {Promise<{value: string|null, source: string}>}
 */
async function readEditorField(page, fieldId) {
  return page.evaluate((id) => {
    // Try textarea first (works when in HTML mode or plain field)
    const textarea = document.getElementById(id);
    if (textarea && textarea.value) {
      return { value: textarea.value, source: 'textarea' };
    }

    // Try TinyMCE API (works when in Visual mode)
    const editor = window.tinymce?.get(id);
    if (editor && editor.initialized) {
      return { value: editor.getContent(), source: 'tinymce' };
    }

    return { value: textarea?.value || null, source: 'textarea-empty' };
  }, fieldId);
}

/**
 * Verify an editor field contains expected content after save.
 *
 * @param {import('playwright').Page} page
 * @param {string} fieldId
 * @param {Object} expected
 * @param {string} [expected.substring] - A substring that must be present
 * @param {boolean} [expected.hasHTML] - Whether HTML tags should be present
 * @param {number} [expected.minLength] - Minimum content length
 * @returns {Promise<{pass: boolean, checks: Object}>}
 */
async function verifyEditorField(page, fieldId, expected = {}) {
  const { value, source } = await readEditorField(page, fieldId);
  const checks = {
    found: value !== null,
    source,
    length: value?.length || 0,
    hasHTML: value?.includes('<') || false,
    hasSubstring: expected.substring ? (value?.includes(expected.substring) || false) : null,
    meetsMinLength: expected.minLength ? (value?.length >= expected.minLength) : null
  };

  const pass = checks.found
    && (expected.hasHTML === undefined || checks.hasHTML === expected.hasHTML)
    && (checks.hasSubstring !== false)
    && (checks.meetsMinLength !== false);

  return { pass, checks };
}

module.exports = { fillEditorField, readEditorField, verifyEditorField };
