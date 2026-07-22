#!/usr/bin/env node
const tls = require('tls');
const { loadHomeSecrets } = require('./lib/instance-secrets');

function escapeImapString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function createImapClient({ host, port }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: host,
      minVersion: 'TLSv1.2',
    });
    socket.setEncoding('utf8');
    socket.once('secureConnect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function readUntil(socket, matcher, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for IMAP response: ${matcher}\nPartial response:\n${buffer}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    }

    function onData(chunk) {
      buffer += chunk;
      if ((matcher instanceof RegExp && matcher.test(buffer)) || (typeof matcher === 'string' && buffer.includes(matcher))) {
        cleanup();
        resolve(buffer);
      }
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onClose() {
      cleanup();
      reject(new Error('IMAP socket closed before expected response'));
    }

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

async function command(socket, tag, commandText) {
  socket.write(`${tag} ${commandText}\r\n`);
  return readUntil(socket, new RegExp(`(?:^|\\r?\\n)${tag} (OK|NO|BAD)`, 'i'));
}

async function main() {
  const { values } = loadHomeSecrets();
  const email = values.GOOGLE_HOME_EMAIL;
  const password = values.GOOGLE_HOME_APP_PASSWORD;
  if (!email || !password) {
    throw new Error('Missing GOOGLE_HOME_EMAIL or GOOGLE_HOME_APP_PASSWORD in local secret file');
  }

  const socket = await createImapClient({ host: 'imap.gmail.com', port: 993 });
  try {
    await readUntil(socket, /\* OK/i);

    const loginResponse = await command(
      socket,
      'A1',
      `LOGIN ${escapeImapString(email)} ${escapeImapString(password)}`
    );
    if (!/\r?\nA1 OK/i.test(loginResponse)) {
      throw new Error(`IMAP login failed:\n${loginResponse}`);
    }

    const statusResponse = await command(socket, 'A2', 'STATUS INBOX (MESSAGES UNSEEN)');
    const statusMatch = statusResponse.match(/\* STATUS INBOX \(MESSAGES (\d+) UNSEEN (\d+)\)/i);
    const messages = statusMatch ? Number(statusMatch[1]) : null;
    const unseen = statusMatch ? Number(statusMatch[2]) : null;

    await command(socket, 'A3', 'LOGOUT');

    const summary = {
      ok: true,
      host: 'imap.gmail.com',
      mailbox: 'INBOX',
      messages,
      unseen,
      checked_at: new Date().toISOString(),
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    socket.end();
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
