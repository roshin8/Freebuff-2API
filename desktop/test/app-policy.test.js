const test = require('node:test');
const assert = require('node:assert/strict');
const { navigationDecision } = require('../app-policy');

test('keeps the local dashboard in-app', () => {
  assert.deepEqual(navigationDecision('http://127.0.0.1:47821/ui', 47821), { action: 'allow' });
  assert.deepEqual(navigationDecision('http://127.0.0.1:49152/ui#accounts', 49152), { action: 'allow' });
});

test('opens normal HTTPS links externally and blocks unsafe schemes', () => {
  assert.deepEqual(navigationDecision('https://github.com/lza6/Freebuff-2API', 47821), {
    action: 'external', url: 'https://github.com/lza6/Freebuff-2API',
  });
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,test',
    'http://example.com/', 'mailto:user@example.com', 'not a URL']) {
    assert.deepEqual(navigationDecision(url, 47821), { action: 'deny' }, url);
  }
});

test('rejects other local origins, misleading hosts, and embedded credentials', () => {
  for (const url of ['http://localhost:47821/ui', 'http://127.0.0.1:47822/ui',
    'http://127.0.0.1.evil.example:47821/ui', 'http://127.0.0.1:47821@evil.example/ui',
    'http://user:password@127.0.0.1:47821/ui', 'https://user:password@example.com/']) {
    assert.deepEqual(navigationDecision(url, 47821), { action: 'deny' }, url);
  }
});

test('does not allow a local dashboard with an invalid port', () => {
  for (const port of [undefined, null, 0, -1, 65536, 47821.5, '47821']) {
    assert.deepEqual(navigationDecision('http://127.0.0.1:47821/ui', port), { action: 'deny' });
  }
});
