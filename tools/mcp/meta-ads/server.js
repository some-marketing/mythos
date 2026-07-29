#!/usr/bin/env node
'use strict';

const { createMcpServer } = require('../shared/mcp-stdio');
const { loadMetaAdsConfig } = require('./config');
const { createMetaAdsTools } = require('./tools');

function main() {
  const config = loadMetaAdsConfig();
  const server = createMcpServer({
    name: 'mythos-meta-ads',
    version: '0.1.0',
    tools: createMetaAdsTools(config)
  });

  server.start();
}

main();
