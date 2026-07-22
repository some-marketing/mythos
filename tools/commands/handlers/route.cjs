'use strict';

const { routeIntent } = require('../lib/operator-route.cjs');

function routeCommand(projectRoot, argsText, options = {}) {
  const prompt = String(argsText || '').trim();
  if (!prompt) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Usage: /route <operator intent>'
    };
  }

  const route = routeIntent(projectRoot, prompt, { allowNative: true });
  const ok = Boolean(route.matched && route.validation && route.validation.ok);
  const payload = {
    ok,
    mode: 'advisory',
    input: prompt,
    route,
    executed: false
  };

  return {
    exitCode: ok ? 0 : 2,
    stdout: options.json === false
      ? (ok ? `${route.command} — ${route.reason}` : `No route found: ${route.reason}`)
      : JSON.stringify(payload, null, 2),
    stderr: ''
  };
}

module.exports = {
  routeCommand
};
