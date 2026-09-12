const test = require('node:test');
const assert = require('node:assert/strict');
const { GatewayManager, RestartWindow } = require('../gateway');
const { createGatewayFixture } = require('./fixtures/fake-gateway');

test('allows three failures in sixty seconds and rejects the fourth', () => {
  let now = 0;
  const window = new RestartWindow({ limit: 3, windowMs: 60_000, now: () => now });
  assert.equal(window.record(), true);
  assert.equal(window.record(), true);
  assert.equal(window.record(), true);
  assert.equal(window.record(), false);
  now = 60_001;
  assert.equal(window.record(), true);
});

test('writes safe initial config and stops its real child process', async (t) => {
  const fixture = await createGatewayFixture();
  t.after(fixture.cleanup);
  const manager = new GatewayManager(fixture.options);
  const config = manager.ensureConfig();
  assert.equal(config.listen_addr, `127.0.0.1:${fixture.port}`);
  await manager.start();
  assert.equal(await manager.waitUntilHealthy(3_000), true);
  await manager.stop();
  assert.equal(await fixture.isListening(), false);
});
