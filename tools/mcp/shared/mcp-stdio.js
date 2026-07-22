'use strict';

function createMcpServer({ name, version, tools }) {
  if (!name) throw new Error('Server name is required');
  if (!version) throw new Error('Server version is required');
  if (!Array.isArray(tools)) throw new Error('Tools must be an array');

  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

  async function handleRequest(request) {
    const { id, method, params = {} } = request || {};

    try {
      if (method === 'initialize') {
        return success(id, {
          protocolVersion: params.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name, version }
        });
      }

      if (method === 'ping') {
        return success(id, {});
      }

      if (method === 'tools/list') {
        return success(id, {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        });
      }

      if (method === 'tools/call') {
        const tool = toolMap.get(params.name);
        if (!tool) {
          return failure(id, -32601, `Unknown tool: ${params.name}`);
        }

        const result = await tool.handler(params.arguments || {});
        return success(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ],
          structuredContent: result
        });
      }

      return failure(id, -32601, `Unsupported method: ${method}`);
    } catch (error) {
      return failure(id, -32000, error.message, {
        name: error.name,
        stack: process.env.MYTHOS_MCP_DEBUG ? error.stack : undefined
      });
    }
  }

  function start() {
    let buffer = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      buffer = processBuffer(buffer);
    });
    process.stdin.on('end', () => {
      process.exit(0);
    });
  }

  function processBuffer(currentBuffer) {
    let working = currentBuffer;

    while (working.length > 0) {
      const headerEnd = working.indexOf('\r\n\r\n');

      if (headerEnd !== -1) {
        const rawHeaders = working.slice(0, headerEnd);
        const match = rawHeaders.match(/Content-Length:\s*(\d+)/i);
        if (!match) break;

        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + length;
        if (working.length < bodyEnd) break;

        const body = working.slice(bodyStart, bodyEnd);
        working = working.slice(bodyEnd);
        handleChunk(body);
        continue;
      }

      const newline = working.indexOf('\n');
      if (newline === -1) break;
      const line = working.slice(0, newline).trim();
      working = working.slice(newline + 1);
      if (!line) continue;
      handleChunk(line);
    }

    return working;
  }

  function handleChunk(raw) {
    let request;
    try {
      request = JSON.parse(raw);
    } catch {
      writeMessage(failure(null, -32700, 'Invalid JSON payload'));
      return;
    }

    Promise.resolve(handleRequest(request)).then(writeMessage);
  }

  return { start };
}

function success(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result
  };
}

function failure(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data ? { data } : {})
    }
  };
}

function writeMessage(message) {
  const payload = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`);
}

module.exports = {
  createMcpServer
};
