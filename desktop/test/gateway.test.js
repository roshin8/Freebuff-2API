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

test('rejects a health response arriving after the readiness deadline', async (t) => {
  const fixture = await createGatewayFixture();
  const manager = new GatewayManager(fixture.options);
  t.after(async () => {
    await manager.stop();
    await fixture.cleanup();
  });
  await manager.start();
  assert.equal(await manager.waitUntilHealthy(3_000), true);
  fixture.delayHealth(750);

  const startedAt = Date.now();
  const healthy = await manager.waitUntilHealthy(100);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(healthy, false);
  assert.ok(elapsedMs < 500, `readiness exceeded its deadline by ${elapsedMs - 100}ms`);
});

test('waits for buffered child output to reach the log before shutdown completes', async (t) => {
  const fixture = await createGatewayFixture();
  fixture.bufferOutputOnShutdown(8 * 1024 * 1024);
  const manager = new GatewayManager(fixture.options);
  t.after(fixture.cleanup);
  await manager.start();
  assert.equal(await manager.waitUntilHealthy(3_000), true);

  await manager.stop();

  const log = fixture.readGatewayLog();
  assert.ok(log.length >= 8 * 1024 * 1024);
  assert.equal(log.subarray(-20).toString(), 'GATEWAY_LOG_DRAINED\n');
});
