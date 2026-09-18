const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadUpstreamManifest, assertPinnedCheckout } = require('../../scripts/upstream');

test('loads the exact audited upstream release', () => {
  const manifest = loadUpstreamManifest(path.join(__dirname, '../../upstream.json'));
  assert.deepEqual(manifest, {
    repository: 'https://github.com/lza6/Freebuff-2API',
    tag: 'v0.8.0',
    commit: 'ef15ebcf7db7e53c6f32ae56bd4a4357fb91db68',
  });
});

test('rejects a checkout whose HEAD differs from the pin', () => {
  const exec = () => Buffer.from('1111111111111111111111111111111111111111\n');
  assert.throws(
    () => assertPinnedCheckout({ commit: 'ef15ebcf7db7e53c6f32ae56bd4a4357fb91db68' }, '/tmp/upstream', exec),
    /does not match pinned commit/
  );
});
