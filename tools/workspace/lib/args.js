function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) {
      const key = token.slice(2, eq).replace(/-/g, '_');
      const val = token.slice(eq + 1);
      out[key] = val === '' ? true : val;
      continue;
    }
    const key = token.slice(2).replace(/-/g, '_');
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

module.exports = { parseArgs };

