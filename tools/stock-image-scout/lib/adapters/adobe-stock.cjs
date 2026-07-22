'use strict';

/**
 * adobe-stock.cjs — Adobe Stock stub provider adapter.
 */

function getInfo() {
  return {
    name: 'adobe-stock',
    type: 'stub',
    description: 'Adobe Stock Stub Provider'
  };
}

async function checkSession(context) {
  return {
    logged_in: false,
    signals: {
      stub: true
    }
  };
}

async function search(context, params = {}) {
  throw new Error('Adobe Stock adapter search is not yet implemented.');
}

module.exports = {
  getInfo,
  checkSession,
  search
};
