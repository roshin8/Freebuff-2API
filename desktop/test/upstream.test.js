const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadUpstreamManifest, assertPinnedCheckout } = require('../../scripts/upstream');

test('loads the exact audited upstream release', () => {
  const manifest = loadUpstreamManifest(path.join(__dirname, '../../upstream.json'));
  assert.deepEqual(manifest, {
    repository: 'https://github.com/lza6/Freebuff-2API',
    tag: 'v0.7.3',
    commit: '506240d7deef1272ed05313ed72f7d9f11785e89',
  });
});

test('rejects a checkout whose HEAD differs from the pin', () => {
  const exec = () => Buffer.from('1111111111111111111111111111111111111111\n');
  assert.throws(
    () => assertPinnedCheckout({ commit: '506240d7deef1272ed05313ed72f7d9f11785e89' }, '/tmp/upstream', exec),
    /does not match pinned commit/
  );
});
