'use strict';

/**
 * session.cjs — Authenticated-session storageState helper.
 */

const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.resolve(__dirname, '../../sessions');

function getStorageStatePath(providerName) {
  const envVarName = `STOCK_SCOUT_${providerName.toUpperCase()}_SESSION_PATH`;
  if (process.env[envVarName]) {
    return path.resolve(process.env[envVarName]);
  }
  return path.join(SESSION_DIR, `${providerName}-state.json`);
}

function ensureSessionDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
  const gitignorePath = path.join(SESSION_DIR, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '*\n!.gitignore\n', 'utf8');
  }
}

function hasSession(providerName) {
  const sessionPath = getStorageStatePath(providerName);
  return fs.existsSync(sessionPath);
}

async function saveSession(page, providerName) {
  ensureSessionDir();
  const sessionPath = getStorageStatePath(providerName);
  await page.context().storageState({ path: sessionPath });
  return sessionPath;
}

async function loadSession(providerName) {
  const sessionPath = getStorageStatePath(providerName);
  if (fs.existsSync(sessionPath)) {
    return sessionPath;
  }
  return null;
}

async function performManualLogin(playwright, providerName, startUrl, checkSessionFn, timeoutMs = 120000) {
  console.log(`Launching headed browser for manual login to ${providerName}...`);
  console.log(`Please log in manually on the browser window.`);
  console.log(`Checking for logged-in signals periodically for up to ${timeoutMs / 1000}s...`);

  const browser = await playwright.chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto(startUrl);

  const startTime = Date.now();
  let loggedIn = false;
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const status = await checkSessionFn(page);
      if (status.logged_in) {
        loggedIn = true;
        console.log('Logged-in signals detected!');
        break;
      }
    } catch (e) {
      // Ignore check errors during manual login loop
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  if (loggedIn) {
    const savedPath = await saveSession(page, providerName);
    console.log(`Successfully saved authenticated session state to: ${savedPath}`);
    await browser.close();
    return true;
  } else {
    await browser.close();
    throw new Error('Manual login timed out or failed to detect authenticated signals.');
  }
}

module.exports = {
  getStorageStatePath,
  ensureSessionDir,
  hasSession,
  saveSession,
  loadSession,
  performManualLogin
};
