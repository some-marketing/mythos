#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { noticeForPayload } = require('../userpromptsubmit-ambient-router.cjs');
const { phrases } = require('../../../commands/__tests__/route-fixtures.cjs');

for (const fixture of phrases) {
  const notice = noticeForPayload({ prompt: fixture.text, session_id: 'route-test' });
  assert.ok(notice.includes('[route]'), fixture.text);
  assert.ok(notice.includes(fixture.command), fixture.text);
  assert.ok(notice.includes('no execution'), fixture.text);
}

const slashNotice = noticeForPayload({ prompt: '/run-plan operator-ux-improvements', session_id: 'route-test' });
assert.equal(slashNotice, '');

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-route-tier-'));
fs.writeFileSync(
  path.join(stateDir, 'frontier-route-test.json'),
  JSON.stringify({ schema: 'ProcessTierStamp/1.0', session_id: 'frontier-route-test', tier: 'frontier' })
);
const shedNotice = noticeForPayload(
  { prompt: 'remember this', session_id: 'frontier-route-test' },
  {
    stateDir,
    rule: {
      tiers: [
        {
          tier: 'frontier',
          sheds: ['ambient-router injections']
        }
      ]
    }
  }
);
assert.equal(shedNotice, '');

console.log('userprompt submit route tests passed');
