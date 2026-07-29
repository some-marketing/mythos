'use strict';

const http = require('http');
const https = require('https');

function redactHeaders(headers = {}) {
  const redacted = {};
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === 'authorization') {
      redacted[key] = '[REDACTED]';
      continue;
    }
    redacted[key] = value;
  }
  return redacted;
}

function buildUrl(baseUrl, pathname, query = {}) {
  const url = new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function requestJson({ method = 'GET', url, headers = {}, body, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const target = typeof url === 'string' ? new URL(url) : url;
    const mod = target.protocol === 'https:' ? https : http;
    const rawBody = body === undefined ? null : JSON.stringify(body);

    const req = mod.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method,
        headers: {
          Accept: 'application/json',
          ...(rawBody ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(rawBody) } : {}),
          ...headers
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          if (data) {
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = null;
            }
          }

          const response = {
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: res.headers,
            data: parsed,
            raw: data
          };

          if (!response.ok) {
            const error = new Error(`Request failed with status ${res.statusCode}`);
            error.response = response;
            reject(error);
            return;
          }

          resolve(response);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });

    req.on('error', reject);

    if (rawBody) req.write(rawBody);
    req.end();
  });
}

module.exports = {
  buildUrl,
  redactHeaders,
  requestJson
};
