#!/usr/bin/env node
'use strict';
// Tiny shim invoked from cli.sh to write audit entries.
// Usage: node lib/audit-emit.cjs <type> <draft_id> [extra]
const audit = require('./audit.cjs');
const [, , type, draftId, extra] = process.argv;
audit.append({ type, draft_id: draftId, extra: extra || null, source: 'cli.sh' });
