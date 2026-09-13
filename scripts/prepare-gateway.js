const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { loadUpstreamManifest, assertPinnedCheckout } = require('./upstream');

const defaultPatchDir = path.join(__dirname, '..', 'patches', 'upstream-v0.7.3');

function applyEnglishDashboard({ upstreamDir, patchDir = defaultPatchDir, exec = execFileSync, commit } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(patchDir, 'manifest.json'), 'utf8'));
  if (commit && manifest.commit !== commit) throw new Error('English patch does not match pinned commit');
  const states = Object.entries(manifest.files).map(([file, hashes]) => {
    const hash = createHash('sha256').update(fs.readFileSync(path.join(upstreamDir, file))).digest('hex');
    if (hash === hashes.original) return 'original';
    if (hash === hashes.patched) return 'patched';
    throw new Error(`upstream source drift in ${file}; use a clean pinned checkout or the exact English patch`);
  });
  if (!states.length || !states.every(state => state === states[0])) {
    throw new Error('upstream source drift: English patch is only partially applied');
  }
  const patch = path.join(patchDir, 'english-dashboard.patch');
  if (states[0] === 'patched') {
    exec('git', ['-C', upstreamDir, 'apply', '--reverse', '--check', patch]);
    return 'already-applied';
  }
  exec('git', ['-C', upstreamDir, 'apply', '--check', patch]);
  exec('git', ['-C', upstreamDir, 'apply', patch]);
  for (const [file, hashes] of Object.entries(manifest.files)) {
    const hash = createHash('sha256').update(fs.readFileSync(path.join(upstreamDir, file))).digest('hex');
    if (hash !== hashes.patched) throw new Error(`English patch integrity check failed for ${file}`);
  }
  return 'applied';
}

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
  patchDir = defaultPatchDir,
  exec = execFileSync,
} = {}) {
  if (!upstreamDir || !path.isAbsolute(upstreamDir)) {
    throw new Error('FREEBUFF_UPSTREAM_DIR must be an absolute path');
  }

  const plan = gatewayBuildPlan({ platform, arch, upstreamDir, resourcesDir });
  const manifest = loadUpstreamManifest(manifestPath);
  assertPinnedCheckout(manifest, upstreamDir, exec);
  applyEnglishDashboard({ upstreamDir, patchDir, exec, commit: manifest.commit });
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

module.exports = { gatewayBuildPlan, prepareGateway, applyEnglishDashboard };
