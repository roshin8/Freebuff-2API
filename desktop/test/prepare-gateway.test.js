const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gatewayBuildPlan, prepareGateway } = require('../../scripts/prepare-gateway');

const pinnedCommit = '506240d7deef1272ed05313ed72f7d9f11785e89';

function createGatewayFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebuff-gateway-'));
  const upstreamDir = path.join(directory, 'upstream');
  const resourcesDir = path.join(directory, 'resources');
  const source = path.join(upstreamDir, 'target', 'release', 'freebuff2api');
  const manifestPath = path.join(directory, 'upstream.json');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'gateway executable');
  fs.writeFileSync(manifestPath, JSON.stringify({
    repository: 'https://github.com/lza6/Freebuff-2API',
    tag: 'v0.7.3',
    commit: pinnedCommit,
  }));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { manifestPath, resourcesDir, source, upstreamDir };
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
    if (command === 'git') return Buffer.from(`${pinnedCommit}\n`);
    if (command === 'cargo') return Buffer.alloc(0);
    if (command === 'file') return Buffer.from(`${args[0]}: Mach-O 64-bit executable arm64`);
    throw new Error(`unexpected command: ${command}`);
  };

  const plan = prepareGateway({ ...fixture, platform: 'darwin', arch: 'arm64', exec });

  assert.equal(fs.readFileSync(plan.destination, 'utf8'), fs.readFileSync(fixture.source, 'utf8'));
  assert.equal(fs.statSync(plan.destination).mode & 0o777, 0o755);
  assert.deepEqual(commands.map(({ command }) => command), ['git', 'cargo', 'file']);
  assert.deepEqual(commands[1].args, ['build', '--release', '--locked']);
  assert.equal(commands[1].options.cwd, fixture.upstreamDir);
  assert.equal(commands[1].options.env.CARGO_HTTP_PROXY, '');
  assert.equal(commands[1].options.env.HTTP_PROXY, '');
  assert.equal(commands[1].options.env.HTTPS_PROXY, '');
  assert.equal(commands[1].options.env.ALL_PROXY, '');
});

test('rejects a prepared gateway with the wrong architecture', (t) => {
  const fixture = createGatewayFixture(t);
  const exec = (command, args) => {
    if (command === 'git') return Buffer.from(`${pinnedCommit}\n`);
    if (command === 'cargo') return Buffer.alloc(0);
    if (command === 'file') return Buffer.from(`${args[0]}: Mach-O 64-bit executable x86_64`);
    throw new Error(`unexpected command: ${command}`);
  };

  assert.throws(
    () => prepareGateway({ ...fixture, platform: 'darwin', arch: 'arm64', exec }),
    /not arm64/
  );
});
