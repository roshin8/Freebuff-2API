const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { gatewayBuildPlan, prepareGateway } = require('../../scripts/prepare-gateway');

const pinnedCommit = 'ef15ebcf7db7e53c6f32ae56bd4a4357fb91db68';

function createGatewayFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebuff-gateway-'));
  const upstreamDir = path.join(directory, 'upstream');
  const resourcesDir = path.join(directory, 'resources');
  const source = path.join(upstreamDir, 'target', 'release', 'freebuff2api');
  const manifestPath = path.join(directory, 'upstream.json');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'gateway executable');
  const patchDir = path.join(directory, 'patch');
  fs.mkdirSync(patchDir);
  fs.mkdirSync(path.join(upstreamDir, 'src'));
  fs.writeFileSync(path.join(upstreamDir, 'src/web.rs'), 'Chinese dashboard\n');
  fs.writeFileSync(path.join(patchDir, 'english-dashboard.patch'), 'diff --git a/src/web.rs b/src/web.rs\n--- a/src/web.rs\n+++ b/src/web.rs\n@@ -1 +1 @@\n-Chinese dashboard\n+English dashboard\n');
  const hash = text => createHash('sha256').update(text).digest('hex');
  fs.writeFileSync(path.join(patchDir, 'manifest.json'), JSON.stringify({ commit: pinnedCommit, files: { 'src/web.rs': {
    original: hash('Chinese dashboard\n'), patched: hash('English dashboard\n'),
  } } }));
  execFileSync('git', ['init', '--quiet', upstreamDir]);
  fs.writeFileSync(manifestPath, JSON.stringify({
    repository: 'https://github.com/lza6/Freebuff-2API',
    tag: 'v0.8.0',
    commit: pinnedCommit,
  }));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { manifestPath, resourcesDir, source, upstreamDir, patchDir };
}

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

test('plans an x64 macOS gateway resource', () => {
  const plan = gatewayBuildPlan({ platform: 'darwin', arch: 'x64', upstreamDir: '/src/upstream', resourcesDir: '/src/wrapper/desktop/generated' });
  assert.equal(plan.binaryName, 'freebuff2api');
});

test('rejects unsupported Darwin architectures before preparation', () => {
  assert.throws(() => gatewayBuildPlan({ platform: 'darwin', arch: 'ia32', upstreamDir: '/x', resourcesDir: '/y' }), /unsupported macOS architecture/);
});

test('requires an absolute upstream path before running commands', () => {
  const commands = [];
  assert.throws(
    () => prepareGateway({ upstreamDir: 'relative/upstream', exec: (...args) => commands.push(args) }),
    /must be an absolute path/
  );
  assert.deepEqual(commands, []);
});

test('validates the pin before running Cargo', (t) => {
  const fixture = createGatewayFixture(t);
  const commands = [];
  const exec = (command, args) => {
    commands.push([command, args]);
    if (command === 'git') return Buffer.from('1111111111111111111111111111111111111111\n');
    throw new Error(`unexpected command: ${command}`);
  };

  assert.throws(
    () => prepareGateway({ ...fixture, platform: 'darwin', arch: 'arm64', exec }),
    /does not match pinned commit/
  );
  assert.deepEqual(commands, [['git', ['-C', fixture.upstreamDir, 'rev-parse', 'HEAD']]]);
});

test('copies a verified gateway with executable mode and cleared proxy environment', (t) => {
  const fixture = createGatewayFixture(t);
  const commands = [];
  const exec = (command, args, options) => {
    commands.push({ args, command, options });
    if (command === 'git') return args.includes('rev-parse') ? Buffer.from(`${pinnedCommit}\n`) : execFileSync(command, args, options);
    if (command === 'cargo') {
      assert.equal(fs.readFileSync(path.join(fixture.upstreamDir, 'src/web.rs'), 'utf8'), 'English dashboard\n');
      return Buffer.alloc(0);
    }
    if (command === 'file') return Buffer.from(`${args[0]}: Mach-O 64-bit executable arm64`);
    throw new Error(`unexpected command: ${command}`);
  };

  const plan = prepareGateway({ ...fixture, platform: 'darwin', arch: 'arm64', exec });

  assert.equal(fs.readFileSync(plan.destination, 'utf8'), fs.readFileSync(fixture.source, 'utf8'));
  assert.equal(fs.statSync(plan.destination).mode & 0o777, 0o755);
  const cargo = commands.find(({ command }) => command === 'cargo');
  assert.deepEqual(cargo.args, ['build', '--release', '--locked']);
  assert.equal(cargo.options.cwd, fixture.upstreamDir);
  assert.equal(cargo.options.env.CARGO_HTTP_PROXY, '');
  assert.equal(cargo.options.env.HTTP_PROXY, '');
  assert.equal(cargo.options.env.HTTPS_PROXY, '');
  assert.equal(cargo.options.env.ALL_PROXY, '');
  prepareGateway({ ...fixture, platform: 'darwin', arch: 'arm64', exec });
  fs.appendFileSync(path.join(fixture.upstreamDir, 'src/web.rs'), 'drift\n');
  assert.throws(() => prepareGateway({ ...fixture, platform: 'darwin', arch: 'arm64', exec }), /drift/);
});

test('rejects a prepared gateway with the wrong architecture', (t) => {
  const fixture = createGatewayFixture(t);
  const exec = (command, args) => {
    if (command === 'git') return args.includes('rev-parse') ? Buffer.from(`${pinnedCommit}\n`) : execFileSync(command, args);
    if (command === 'cargo') return Buffer.alloc(0);
    if (command === 'file') return Buffer.from(`${args[0]}: Mach-O 64-bit executable x86_64`);
    throw new Error(`unexpected command: ${command}`);
  };

  assert.throws(
    () => prepareGateway({ ...fixture, platform: 'darwin', arch: 'arm64', exec }),
    /not arm64/
  );
});
