const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inspectBundle } = require('../../scripts/smoke-bundle');

function createBundle(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebuff-bundle-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const appPath = path.join(directory, 'Freebuff2API.app');
  const gatewayPath = path.join(appPath, 'Contents', 'Resources', 'bin', 'freebuff2api');
  fs.mkdirSync(path.dirname(gatewayPath), { recursive: true });
  fs.writeFileSync(gatewayPath, 'fixture gateway', { mode: 0o755 });
  return { appPath, gatewayPath };
}

function fileOutput(gatewayPath, architecture) {
  return (command, args) => {
    assert.equal(command, 'file');
    assert.deepEqual(args, [gatewayPath]);
    return Buffer.from(`${gatewayPath}: Mach-O 64-bit executable ${architecture}\n`);
  };
}

test('inspects the executable arm64 gateway in an app bundle', (t) => {
  const { appPath, gatewayPath } = createBundle(t);
  assert.deepEqual(inspectBundle({ appPath, expectedArch: 'arm64', execFileSync: fileOutput(gatewayPath, 'arm64') }), {
    gatewayPath,
    architecture: 'arm64',
  });
});

test('accepts the file tool x86_64 architecture for an x64 bundle', (t) => {
  const { appPath, gatewayPath } = createBundle(t);
  assert.deepEqual(inspectBundle({ appPath, expectedArch: 'x64', execFileSync: fileOutput(gatewayPath, 'x86_64') }), {
    gatewayPath,
    architecture: 'x64',
  });
});

test('rejects a bundle missing its gateway', (t) => {
  const { appPath, gatewayPath } = createBundle(t);
  fs.unlinkSync(gatewayPath);
  assert.throws(() => inspectBundle({ appPath, expectedArch: 'arm64' }), /gateway.*executable/i);
});

test('rejects a gateway without executable permission', (t) => {
  const { appPath, gatewayPath } = createBundle(t);
  fs.chmodSync(gatewayPath, 0o644);
  assert.throws(() => inspectBundle({ appPath, expectedArch: 'arm64' }), /gateway.*executable/i);
});

test('rejects a directory in place of the gateway', (t) => {
  const { appPath, gatewayPath } = createBundle(t);
  fs.unlinkSync(gatewayPath);
  fs.mkdirSync(gatewayPath);
  assert.throws(() => inspectBundle({ appPath, expectedArch: 'arm64' }), /gateway.*executable/i);
});

test('rejects a gateway built for the other architecture', (t) => {
  const { appPath, gatewayPath } = createBundle(t);
  assert.throws(() => inspectBundle({ appPath, expectedArch: 'arm64', execFileSync: fileOutput(gatewayPath, 'x86_64') }), /architecture.*arm64/i);
});

test('rejects an unsupported expected architecture', (t) => {
  const { appPath } = createBundle(t);
  assert.throws(() => inspectBundle({ appPath, expectedArch: 'ia32' }), /unsupported.*architecture/i);
});

test('requires APP_PATH and EXPECTED_ARCH in the CLI', () => {
  const env = { ...process.env };
  delete env.APP_PATH;
  delete env.EXPECTED_ARCH;
  const result = spawnSync(process.execPath, [path.join(__dirname, '../../scripts/smoke-bundle.js')], { env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /APP_PATH.*EXPECTED_ARCH/);
});

test('CLI exits nonzero when the gateway is not a Mach-O executable', (t) => {
  const { appPath } = createBundle(t);
  const result = spawnSync(process.execPath, [path.join(__dirname, '../../scripts/smoke-bundle.js')], {
    env: { ...process.env, APP_PATH: appPath, EXPECTED_ARCH: 'arm64' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /architecture.*arm64/i);
});
