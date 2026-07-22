#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { loadHomeSecrets } = require('./lib/instance-secrets');

async function clickIfVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        if (await locator.isVisible({ timeout: 500 })) {
          await locator.click({ timeout: 1000 });
          return true;
        }
      } catch (_) {}
    }
  }
  return false;
}

async function main() {
  const { values } = loadHomeSecrets();
  const email = values.GOOGLE_HOME_EMAIL;
  const password = values.GOOGLE_HOME_APP_PASSWORD;
  if (!email || !password) {
    throw new Error('Missing GOOGLE_HOME_EMAIL or GOOGLE_HOME_APP_PASSWORD in local secret file');
  }
  const profileDir = process.env.GOOGLE_HOME_CHROME_PROFILE_DIR
    ? path.resolve(process.env.GOOGLE_HOME_CHROME_PROFILE_DIR)
    : path.resolve(process.cwd(), 'secrets/browser-profiles/google-home');
  fs.mkdirSync(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1440, height: 960 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(15000);

  await page.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded' });

  await clickIfVisible(page, [
    'button:has-text("Sign in")',
    'a:has-text("Sign in")',
    '[data-testid="signin"]',
  ]);

  await page.waitForLoadState('domcontentloaded');

  const emailField = page.locator('input[type="email"], input[name="identifier"]').first();
  await emailField.waitFor({ state: 'visible' });
  await emailField.fill(email);
  await page.getByRole('button', { name: /next/i }).click();

  await page.waitForLoadState('domcontentloaded');

  const passwordField = page.locator('input[type="password"]').first();
  await passwordField.waitFor({ state: 'visible' });
  await passwordField.fill(password);
  await page.getByRole('button', { name: /next/i }).click();

  await page.waitForTimeout(5000);
  const url = page.url();

  if (/challenge|signin\/v2\/challenge/i.test(url)) {
    console.log(`LOGIN_REQUIRES_INTERACTIVE_STEP:${url}`);
    return;
  }

  if (/myaccount\.google\.com|accounts\.google\.com\/.*\/myaccount|mail\.google\.com/i.test(url)) {
    console.log(`LOGIN_SUCCESS:${url}`);
    return;
  }

  console.log(`LOGIN_UNKNOWN_STATE:${url}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
