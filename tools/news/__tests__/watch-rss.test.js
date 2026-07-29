const assert = require('node:assert/strict');
const test = require('node:test');

const { matchesConfig, parseFeed } = require('../watch-rss');

test('parseFeed reads RSS item title, link, description, and date', () => {
  const items = parseFeed('sample', `
    <rss><channel><item>
      <title>Cursor harness source leaked on GitHub</title>
      <link>https://example.com/cursor</link>
      <description><![CDATA[Repository mirrors Anysphere source code.]]></description>
      <pubDate>Thu, 30 Apr 2026 00:00:00 GMT</pubDate>
      <guid>abc</guid>
    </item></channel></rss>
  `);

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Cursor harness source leaked on GitHub');
  assert.equal(items[0].link, 'https://example.com/cursor');
  assert.equal(items[0].summary, 'Repository mirrors Anysphere source code.');
});

test('matchesConfig requires Cursor/Anysphere, trigger terms, and repo-like evidence', () => {
  const config = {
    required_terms: ['cursor', 'anysphere'],
    trigger_terms: ['source code', 'harness', 'leaked'],
    repo_like_terms: ['github.com', 'repository'],
    signal_requires_repo_like: true,
    negative_terms: ['mouse cursor']
  };

  assert.equal(matchesConfig({
    title: 'Anysphere Cursor harness source code leaked',
    summary: 'Public repository now at https://github.com/example/cursor-harness',
    link: 'https://news.example/item'
  }, config), true);

  assert.equal(matchesConfig({
    title: 'Cursor users hit by malicious npm package',
    summary: 'Credential theft campaign, no source repository.',
    link: 'https://news.example/item'
  }, config), false);

  assert.equal(matchesConfig({
    title: 'CSS mouse cursor source code examples',
    summary: 'A repository of UI snippets',
    link: 'https://news.example/item'
  }, config), false);
});
