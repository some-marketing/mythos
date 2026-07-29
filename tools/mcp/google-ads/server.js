#!/usr/bin/env node
'use strict';

const { createMcpServer } = require('../shared/mcp-stdio');
const { loadGoogleAdsConfig } = require('./config');
const { createGoogleAdsTools } = require('./tools');

function main() {
  const config = loadGoogleAdsConfig();
  const server = createMcpServer({
    name: 'mythos-google-ads',
    version: '0.1.0',
    tools: createGoogleAdsTools(config)
  });

  server.start();
}

main();
