const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadUpstreamManifest, assertPinnedCheckout } = require('./upstream');

function gatewayBuildPlan({ platform, arch, upstreamDir, resourcesDir }) {
  if (platform !== 'darwin') throw new Error('gateway preparation is macOS only');
  if (arch !== 'arm64' && arch !== 'x64') throw new Error(`unsupported macOS architecture: ${arch}`);

  const binaryName = 'freebuff2api';
  return {
    binaryName,
    source: path.join(upstreamDir, 'target', 'release', binaryName),
    destination: path.join(resourcesDir, 'bin', binaryName),
  };
}

function prepareGateway({
  upstreamDir = process.env.FREEBUFF_UPSTREAM_DIR,
  resourcesDir = path.join(__dirname, '..', 'desktop', 'generated'),
  platform = process.platform,
  arch = process.arch,
  manifestPath = path.join(__dirname, '..', 'upstream.json'),
  exec = execFileSync,
} = {}) {
  if (!upstreamDir || !path.isAbsolute(upstreamDir)) {
    throw new Error('FREEBUFF_UPSTREAM_DIR must be an absolute path');
  }

  const plan = gatewayBuildPlan({ platform, arch, upstreamDir, resourcesDir });
  const manifest = loadUpstreamManifest(manifestPath);
  assertPinnedCheckout(manifest, upstreamDir, exec);
  exec('cargo', ['build', '--release', '--locked'], {
    cwd: upstreamDir,
    env: {
      ...process.env,
      CARGO_HTTP_PROXY: '',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
    },
  });
  fs.mkdirSync(path.dirname(plan.destination), { recursive: true });
  fs.copyFileSync(plan.source, plan.destination);
  fs.chmodSync(plan.destination, 0o755);

  const architecture = arch === 'arm64' ? 'arm64' : 'x86_64';
  const fileOutput = String(exec('file', [plan.destination])).trim();
  if (!fileOutput.includes(architecture)) {
    throw new Error(`prepared gateway is not ${architecture}: ${fileOutput}`);
  }

  return plan;
}

if (require.main === module) prepareGateway();

module.exports = { gatewayBuildPlan, prepareGateway };
