const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('release notes identify both versions, architectures, trust guidance, attribution, and checksum commands', () => {
  const result = spawnSync(process.execPath, ['scripts/release-notes.js'], {
    cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', env: { ...process.env, GITHUB_REF_NAME: 'v0.1.4' },
  });
  assert.equal(result.status, 0, result.stderr);
  for (const text of ['0.1.4', 'v0.8.0', 'ef15ebcf7db7e53c6f32ae56bd4a4357fb91db68', 'arm64', 'x64', 'unsigned', 'unnotarized', 'Gatekeeper', 'Privacy & Security', 'lza6/Freebuff-2API', 'roshin8', 'SHA256SUMS.txt', 'shasum -a 256 -c -']) {
    assert.ok(result.stdout.includes(text), `Missing release guidance: ${text}`);
  }
});

test('release note generation refuses a tag that differs from the packaged version', () => {
  const result = spawnSync(process.execPath, ['scripts/release-notes.js'], {
    cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', env: { ...process.env, GITHUB_REF_NAME: 'v9.9.9' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version/);
});
