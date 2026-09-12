const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function loadUpstreamManifest(manifestPath) {
  const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!/^https:\/\/github\.com\/lza6\/Freebuff-2API$/.test(value.repository)) throw new Error('unexpected upstream repository');
  if (!/^v\d+\.\d+\.\d+$/.test(value.tag)) throw new Error('invalid upstream tag');
  if (!/^[0-9a-f]{40}$/.test(value.commit)) throw new Error('invalid upstream commit');
  return value;
}

function assertPinnedCheckout(manifest, checkoutDir, exec = execFileSync) {
  const actual = String(exec('git', ['-C', checkoutDir, 'rev-parse', 'HEAD'])).trim();
  if (actual !== manifest.commit) throw new Error(`checkout ${actual} does not match pinned commit ${manifest.commit}`);
}

module.exports = { loadUpstreamManifest, assertPinnedCheckout };
