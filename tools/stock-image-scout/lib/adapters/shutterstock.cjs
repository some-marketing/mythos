'use strict';

/**
 * shutterstock.cjs — Shutterstock stub provider adapter.
 */

function getInfo() {
  return {
    name: 'shutterstock',
    type: 'stub',
    description: 'Shutterstock Stub Provider'
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
  throw new Error('Shutterstock adapter search is not yet implemented.');
}

module.exports = {
  getInfo,
  checkSession,
  search
};
