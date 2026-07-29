'use strict';

const { chromium } = require('playwright');

/**
 * Run a dataLayer + beacon probe against a target URL.
 *
 * Returns an artifact:
 *   {
 *     url, title,
 *     gtmIds, scriptDetectors,
 *     fieldProbes: [{ label, fields: [...] }],
 *     dataLayerSnapshots: [{ label, events: [...] }],
 *     pushLog: [{ ts, payload }],
 *     beaconLog: [{ ts, host, kind, url, method, params, body }],
 *     walkLog: [...],
 *     submitted, intercepted,
 *     errors: [...]
 *   }
 *
 * Config shape — see configs/*.json and README.md.
 *
 * Network capture:
 *   - googleadservices.com  → Google Ads conversion pings (value/currency live in URL)
 *   - google-analytics.com  → GA4 /g/collect (POST body urlencoded)
 *   - googletagmanager.com  → gtm.js/gtag.js loads, debug heartbeats
 *
 * Submit interception (--intercept-submit / config.interceptSubmit):
 *   Monkey-patches fetch and XHR so that any POST to an admin-ajax-shaped URL
 *   returns a fake WPForms confirmation HTML. This triggers the snippet's
 *   MutationObserver chain (which fires lead_submit_*) without producing a
 *   real lead in the downstream CRM.
 */
async function runProbe(config, opts = {}) {
  const headless = opts.headless !== undefined ? opts.headless : true;
  const interceptSubmit = !!(opts.interceptSubmit ?? config.interceptSubmit);
  const captureBeacons = (opts.captureBeacons ?? config.captureBeacons) !== false; // default ON

  const artifact = {
    config: config.id || config.url,
    url: config.url,
    startedAt: new Date().toISOString(),
    title: null,
    gtmIds: [],
    scriptDetectors: {},
    fieldProbes: [],
    dataLayerSnapshots: [],
    pushLog: [],
    beaconLog: [],
    walkLog: [],
    submitted: false,
    intercepted: interceptSubmit,
    errors: [],
  };

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ userAgent: config.userAgent });
  const page = await context.newPage();

  // 1. Instrument dataLayer.push BEFORE any page script runs.
  await page.addInitScript(() => {
    window.__probePushLog = [];
    let realDl = [];
    Object.defineProperty(window, 'dataLayer', {
      configurable: true,
      get() { return realDl; },
      set(v) {
        realDl = v;
        const origPush = v.push.bind(v);
        v.push = function (...args) {
          try {
            window.__probePushLog.push({ ts: Date.now(), args: JSON.parse(JSON.stringify(args)) });
          } catch (e) {
            window.__probePushLog.push({ ts: Date.now(), args: args.map(a => String(a).slice(0, 200)), serializationError: true });
          }
          return origPush(...args);
        };
      },
    });
    realDl = [];
  });

  // 2. Submit-intercept patches (only if requested).
  if (interceptSubmit) {
    await page.addInitScript(() => {
      const fakeConfirmationHTML = (formId) =>
        `<div class="wpforms-confirmation-container-full" id="wpforms-confirmation-${formId}">Thanks for your interest — a representative will be in touch.</div>`;

      const formIdFromUrl = () => null; // detected via body inspection

      const isWpformsSubmit = (url, body) => {
        try {
          const u = String(url);
          if (!u.includes('admin-ajax') && !u.includes('wpforms')) return false;
          const b = body ? String(body) : '';
          if (b.includes('wpforms') || u.includes('wpforms')) return true;
        } catch (_) {}
        return false;
      };

      const installConfirmation = (formEl) => {
        if (!formEl) return;
        formEl.insertAdjacentHTML('afterend', fakeConfirmationHTML(formEl.id.replace('wpforms-form-', '')));
      };

      // fetch patch
      const origFetch = window.fetch;
      window.fetch = async function (...args) {
        try {
          const [input, init] = args;
          const url = typeof input === 'string' ? input : (input && input.url);
          const body = init && init.body ? init.body : null;
          if (isWpformsSubmit(url, body)) {
            window.__probeInterceptedFetch = (window.__probeInterceptedFetch || 0) + 1;
            const formMatch = String(body || '').match(/wpforms\[id\]=(\d+)/);
            const formId = formMatch ? formMatch[1] : '61';
            const form = document.querySelector('#wpforms-form-' + formId);
            installConfirmation(form);
            return new Response(JSON.stringify({ success: true, data: { confirmation: fakeConfirmationHTML(formId) } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        } catch (e) { /* fall through */ }
        return origFetch.apply(this, args);
      };

      // XHR patch
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__probeUrl = url;
        this.__probeMethod = method;
        return origOpen.apply(this, [method, url, ...rest]);
      };
      XMLHttpRequest.prototype.send = function (body) {
        if (isWpformsSubmit(this.__probeUrl, body)) {
          window.__probeInterceptedXhr = (window.__probeInterceptedXhr || 0) + 1;
          const formMatch = String(body || '').match(/wpforms\[id\]=(\d+)/);
          const formId = formMatch ? formMatch[1] : '61';
          const fakeResponse = JSON.stringify({ success: true, data: { confirmation: fakeConfirmationHTML(formId) } });
          // simulate async readyState progression
          setTimeout(() => {
            try {
              Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
              Object.defineProperty(this, 'status', { value: 200, configurable: true });
              Object.defineProperty(this, 'responseText', { value: fakeResponse, configurable: true });
              Object.defineProperty(this, 'response', { value: fakeResponse, configurable: true });
              if (this.onreadystatechange) this.onreadystatechange();
              if (this.onload) this.onload();
              // also fire confirmation insertion in case page doesn't
              const form = document.querySelector('#wpforms-form-' + formId);
              installConfirmation(form);
            } catch (_) {}
          }, 50);
          return;
        }
        return origSend.apply(this, [body]);
      };
    });
  }

  // 3. Network beacon capture
  if (captureBeacons) {
    page.on('request', (req) => {
      try {
        const u = req.url();
        if (!/googleadservices\.com|google-analytics\.com|googletagmanager\.com|analytics\.google\.com/i.test(u)) return;
        let host = new URL(u).host;
        const kind = classifyBeacon(u);
        const params = paramsFromUrl(u);
        let body = null;
        if (req.method() === 'POST') {
          body = req.postData() || null;
          if (body && body.length < 4000) body = decodeUrlEncoded(body);
        }
        artifact.beaconLog.push({ ts: Date.now(), host, kind, url: u.slice(0, 300), method: req.method(), params, body });
      } catch (_) {}
    });
  }

  page.on('pageerror', (e) => artifact.errors.push({ kind: 'pageerror', message: e.message }));

  try {
    await page.goto(config.url, { waitUntil: 'networkidle', timeout: 45000 });
    artifact.title = await page.title();

    artifact.scriptDetectors = await page.evaluate((detectors) => {
      const scripts = [...document.querySelectorAll('script:not([src])')].map(s => s.textContent);
      const result = {};
      for (const [name, pattern] of Object.entries(detectors)) {
        const re = new RegExp(pattern);
        result[name] = scripts.filter(t => re.test(t)).length;
      }
      return result;
    }, config.scriptDetectors || {});

    artifact.gtmIds = await page.evaluate(() => {
      const ids = new Set();
      [...document.querySelectorAll('script[src*="googletagmanager.com"]')].forEach(s => {
        const m = s.src.match(/[?&]id=(GTM-[A-Z0-9]+|AW-\d+|G-[A-Z0-9]+)/);
        if (m) ids.add(m[1]);
      });
      (document.documentElement.innerHTML.match(/GTM-[A-Z0-9]+|AW-\d+/g) || []).forEach(i => ids.add(i));
      return [...ids];
    });

    artifact.dataLayerSnapshots.push(await snapshot(page, 'after-load'));
    artifact.fieldProbes.push(await probeFields(page, config.fieldProbes || [], 'after-load'));

    for (const step of (config.walk || [])) {
      try { await runStep(page, step, artifact); }
      catch (e) {
        artifact.walkLog.push({ step: step.id || step.action, action: step.action, error: String(e.message).slice(0, 300) });
      }
    }

    if (config.submit === true) {
      const submitSel = config.submitSelector || ('#wpforms-form-' + (config.wpformsId || '') + ' .wpforms-submit');
      try {
        await page.click(submitSel, { timeout: 5000 });
        await page.waitForTimeout(3000);
        artifact.submitted = true;
      } catch (e) {
        artifact.errors.push({ kind: 'submit', message: e.message });
      }
      artifact.dataLayerSnapshots.push(await snapshot(page, 'after-submit'));
    } else if (config.captureProbeSelector) {
      try {
        await page.evaluate((sel) => { const btn = document.querySelector(sel); if (btn) btn.click(); }, config.captureProbeSelector);
        await page.waitForTimeout(500);
        artifact.walkLog.push({ step: 'capture-probe', action: 'simulated-click', selector: config.captureProbeSelector });
      } catch (e) {
        artifact.errors.push({ kind: 'capture-probe', message: e.message });
      }
    }

    artifact.fieldProbes.push(await probeFields(page, config.fieldProbes || [], 'final'));
    artifact.pushLog = await page.evaluate(() => (window.__probePushLog || []).map(e => ({
      ts: e.ts,
      args: e.args.map(a => {
        if (!a || typeof a !== 'object') return a;
        const cloned = Array.isArray(a) ? [] : {};
        for (const [k, v] of Object.entries(a)) {
          if (typeof v === 'string' && (v.includes('=') || v.length > 200)) {
            cloned[k] = '[redacted len=' + v.length + ']';
          } else {
            cloned[k] = v;
          }
        }
        return cloned;
      }),
    })));

    artifact.interceptStats = await page.evaluate(() => ({
      fetch: window.__probeInterceptedFetch || 0,
      xhr: window.__probeInterceptedXhr || 0,
    }));
  } finally {
    await browser.close();
  }

  artifact.finishedAt = new Date().toISOString();
  return artifact;
}

function classifyBeacon(url) {
  if (url.includes('googleadservices.com/pagead/conversion')) return 'google-ads-conversion';
  if (url.includes('google-analytics.com/g/collect')) return 'ga4-collect';
  if (url.includes('google-analytics.com/collect')) return 'ga-classic-collect';
  if (url.includes('googletagmanager.com/gtm.js')) return 'gtm-loader';
  if (url.includes('googletagmanager.com/gtag/js')) return 'gtag-loader';
  if (url.includes('googletagmanager.com/a')) return 'gtm-heartbeat';
  return 'other';
}

function paramsFromUrl(url) {
  try {
    const u = new URL(url);
    const out = {};
    for (const [k, v] of u.searchParams.entries()) {
      if (v.length > 120) out[k] = '[len=' + v.length + ']';
      else out[k] = v;
    }
    return out;
  } catch (_) {
    return null;
  }
}

function decodeUrlEncoded(body) {
  try {
    const out = {};
    for (const pair of String(body).split('&')) {
      const [k, v] = pair.split('=');
      const kk = decodeURIComponent(k || '');
      const vv = decodeURIComponent((v || '').replace(/\+/g, ' '));
      out[kk] = vv.length > 120 ? '[len=' + vv.length + ']' : vv;
    }
    return out;
  } catch (_) {
    return body.slice(0, 500);
  }
}

async function snapshot(page, label) {
  const events = await page.evaluate(() => (window.dataLayer || []).map(e => {
    if (Array.isArray(e)) return { kind: 'gtag-args', head: String(e[0] || '') };
    if (e && typeof e === 'object') return { kind: 'event', name: e.event || null, keys: Object.keys(e) };
    return { kind: 'other', value: String(e).slice(0, 80) };
  }));
  return { label, events };
}

async function probeFields(page, probes, label) {
  return {
    label,
    fields: await page.evaluate((sels) => sels.map(p => {
      const el = document.querySelector(p.selector);
      if (!el) return { ...p, exists: false };
      return {
        ...p,
        exists: true,
        tag: el.tagName,
        type: el.type || null,
        value: (el.value || '').slice(0, 100),
        hidden: el.type === 'hidden' || el.offsetParent === null,
        calculated: /calculation/i.test(el.title || ''),
      };
    }), probes),
  };
}

async function runStep(page, step, artifact) {
  switch (step.action) {
    case 'wait':     await page.waitForTimeout(step.ms || 500); break;
    case 'click':    await page.click(step.selector, { timeout: 5000 }); break;
    case 'fill':     await page.fill(step.selector, step.value); break;
    case 'check':    await page.check(step.selector, { timeout: 5000 }); break;
    case 'select':   await page.selectOption(step.selector, step.value); break;
    case 'eval':     await page.evaluate(step.script); break;
    case 'snapshot':
      artifact.dataLayerSnapshots.push(await snapshot(page, step.label || step.id || 'snapshot'));
      artifact.fieldProbes.push(await probeFields(page, step.probes || [], step.label || step.id || 'snapshot'));
      break;
    default: throw new Error('Unknown step action: ' + step.action);
  }
  artifact.walkLog.push({ step: step.id || step.action, action: step.action, note: step.note || '' });
}

module.exports = { runProbe };
