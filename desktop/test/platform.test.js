const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const platform = require('../platform');

test('resolves the bundled macOS gateway', () => {
  assert.equal(platform.gatewayPath('/App/Contents/Resources'), path.join('/App/Contents/Resources', 'bin', 'freebuff2api'));
});

test('creates loopback-only privacy-preserving defaults', () => {
  const userDataDir = '/Users/test/Library/Application Support/Freebuff2API';
  const cfg = platform.initialConfig(userDataDir);
  assert.equal(cfg.listen_addr, '127.0.0.1:47821');
  assert.deepEqual(cfg.auth_tokens, []);
  assert.deepEqual(cfg.api_keys, []);
  assert.equal(cfg.http_proxy, '');
  assert.equal(cfg.memory_enabled, false);
  assert.equal(cfg.skip_upstream_check, true);
  assert.equal(cfg.sqlite_path, path.join(userDataDir, 'data', 'freebuff2api.sqlite'));
  assert.equal(cfg.tokens_path, path.join(userDataDir, 'data', 'tokens.json'));
});

test('accepts only valid TCP ports from config', () => {
  assert.equal(platform.configuredPort({ listen_addr: '127.0.0.1:47822' }), 47822);
  assert.equal(platform.configuredPort({ listen_addr: 'localhost:47823' }), 47823);
  assert.equal(platform.configuredPort({ listen_addr: '127.0.0.1:70000' }), 47821);
  assert.equal(platform.configuredPort({ listen_addr: '0.0.0.0:9000' }), 47821);
});

test('allows only the configured loopback dashboard origin', () => {
  assert.equal(platform.isLoopbackDashboardUrl('http://127.0.0.1:47821/ui', 47821), true);
  assert.equal(platform.isLoopbackDashboardUrl('http://localhost:47821/ui', 47821), true);
  assert.equal(platform.isLoopbackDashboardUrl('https://evil.example/ui', 47821), false);
  assert.equal(platform.isLoopbackDashboardUrl('http://127.0.0.1:9999/ui', 47821), false);
  assert.equal(platform.isLoopbackDashboardUrl('http://127.0.0.1:47821.evil.example/ui', 47821), false);
});

test('describes the user data directory', () => {
  const userDataDir = '/Users/test/Library/Application Support/Freebuff2API';
  assert.equal(platform.dataPathDescription(userDataDir), `Configuration and data: ${userDataDir}`);
});
