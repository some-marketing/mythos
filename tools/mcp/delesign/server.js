#!/usr/bin/env node
'use strict';

const { createMcpServer } = require('../shared/mcp-stdio');
const { loadDelesignConfig } = require('./config');
const { createDelesignTools } = require('./tools');

function main() {
  const config = loadDelesignConfig();
  const server = createMcpServer({
    name: 'mythos-delesign',
    version: '0.1.0',
    tools: createDelesignTools(config)
  });

  server.start();
}

main();
