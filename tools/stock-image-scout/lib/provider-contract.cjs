'use strict';

/**
 * provider-contract.cjs — Provider capability and execution contract for Stock scouting.
 */

const { validateCandidate } = require('./candidate.cjs');

const providerRegistry = {};

function registerProvider(name, adapter) {
  if (!name || typeof name !== 'string') {
    throw new Error('registerProvider requires a string name');
  }
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('registerProvider requires an adapter object');
  }

  const requiredMethods = ['getInfo', 'checkSession', 'search'];
  for (const method of requiredMethods) {
    if (typeof adapter[method] !== 'function') {
      throw new Error(`Provider adapter "${name}" must implement ${method}()`);
    }
  }

  providerRegistry[name] = adapter;
}

function getProvider(name) {
  return providerRegistry[name] || null;
}

function listRegisteredProviders() {
  return Object.keys(providerRegistry);
}

function clearRegistry() {
  for (const key of Object.keys(providerRegistry)) {
    delete providerRegistry[key];
  }
}

async function checkSession(name, context) {
  const adapter = getProvider(name);
  if (!adapter) {
    throw new Error(`Provider "${name}" is not registered`);
  }
  return await adapter.checkSession(context);
}

async function checkProviderHealth(name, context) {
  const adapter = getProvider(name);
  if (!adapter) {
    return {
      reachable: false,
      error: `Provider "${name}" is not registered`
    };
  }
  try {
    const sessionStatus = await adapter.checkSession(context);
    return {
      reachable: true,
      logged_in: sessionStatus.logged_in,
      signals: sessionStatus.signals,
      checked_at: new Date().toISOString()
    };
  } catch (err) {
    return {
      reachable: false,
      error: err.message,
      checked_at: new Date().toISOString()
    };
  }
}

async function search(name, context, params) {
  const adapter = getProvider(name);
  if (!adapter) {
    throw new Error(`Provider "${name}" is not registered`);
  }

  const results = await adapter.search(context, params);
  if (!Array.isArray(results)) {
    throw new Error(`Provider "${name}" search must return an array of candidates`);
  }

  return results.map(candidate => validateCandidate(candidate, name));
}

module.exports = {
  registerProvider,
  getProvider,
  listRegisteredProviders,
  clearRegistry,
  checkSession,
  checkProviderHealth,
  search
};
