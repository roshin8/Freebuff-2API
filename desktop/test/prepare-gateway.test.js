const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { gatewayBuildPlan } = require('../../scripts/prepare-gateway');

test('plans an arm64 macOS gateway resource', () => {
  const plan = gatewayBuildPlan({ platform: 'darwin', arch: 'arm64', upstreamDir: '/src/upstream', resourcesDir: '/src/wrapper/desktop/generated' });
  assert.deepEqual(plan, {
    binaryName: 'freebuff2api',
    source: path.join('/src/upstream', 'target', 'release', 'freebuff2api'),
    destination: path.join('/src/wrapper/desktop/generated', 'bin', 'freebuff2api'),
  });
});

test('rejects non-macOS preparation', () => {
  assert.throws(() => gatewayBuildPlan({ platform: 'win32', arch: 'x64', upstreamDir: '/x', resourcesDir: '/y' }), /macOS only/);
});
