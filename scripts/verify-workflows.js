const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { loadUpstreamManifest } = require('./upstream');

const root = path.join(__dirname, '..');
const YAML = createRequire(path.join(root, 'desktop/package.json'))('yaml');

// Compare executable step objects, not names or YAML source text. Keeping the
// order and execution fields exact also rejects skipped/ignored required work.
function verifySteps(actual, expected, label) {
  const executable = actual.map(({ name, ...step }) => ({
    ...step,
    ...(typeof step.run === 'string' ? { run: step.run.trim() } : {}),
    ...(step.with?.path ? { with: { ...step.with, path: step.with.path.trim() } } : {}),
    ...(step.with?.files ? { with: { ...step.with, files: step.with.files.trim() } } : {}),
  }));
  assert.deepEqual(executable, expected, `${label}: executable steps differ from the required contract`);
}

function buildSteps(commit, release) {
  const arch = release ? '${{ matrix.arch }}' : 'arm64';
  const directory = release ? "${{ matrix.arch == 'arm64' && 'mac-arm64' || 'mac' }}" : 'mac-arm64';
  const steps = [
    { id: 'wrapper', uses: 'actions/checkout@v4' },
    { id: 'upstream', uses: 'actions/checkout@v4', with: {
      repository: 'lza6/Freebuff-2API', ref: commit, path: '_upstream', 'persist-credentials': false,
    } },
    { id: 'verify_upstream', run: `test "$(git -C _upstream rev-parse HEAD)" = "${commit}"` },
    { id: 'rust', uses: 'dtolnay/rust-toolchain@stable', with: { toolchain: '1.95.0' } },
    { id: 'rust_tests', 'working-directory': '_upstream', run: 'cargo test --locked' },
    { id: 'node', uses: 'actions/setup-node@v4', with: {
      'node-version': '22', cache: 'npm', 'cache-dependency-path': 'desktop/package-lock.json',
    } },
    { id: 'prepare', run: 'node scripts/prepare-gateway.js' },
    { id: 'npm_install', 'working-directory': 'desktop', run: 'npm ci' },
    { id: 'node_tests', 'working-directory': 'desktop', run: 'npm test' },
    { id: 'package', 'working-directory': 'desktop', run: `npm run dist:mac -- --${arch}` },
    { id: 'smoke', env: {
      APP_PATH: '${{ github.workspace }}/desktop/dist/' + directory + '/Freebuff2API.app',
      EXPECTED_ARCH: arch,
    }, run: 'node scripts/smoke-bundle.js' },
  ];
  if (release) steps.push({ id: 'upload', uses: 'actions/upload-artifact@v4', with: {
    name: 'macos-${{ matrix.arch }}',
    path: 'desktop/dist/Freebuff2API-*-${{ matrix.arch }}.dmg\ndesktop/dist/Freebuff2API-*-${{ matrix.arch }}.zip',
    'if-no-files-found': 'error',
  } });
  return steps;
}

function verifyWorkflows({ validate, release }) {
  const { commit } = loadUpstreamManifest(path.join(root, 'upstream.json'));
  assert.deepEqual(validate.on, { pull_request: null, push: { branches: ['main'] }, workflow_dispatch: null });
  assert.deepEqual(release.on, { push: { tags: ['v*'] }, workflow_dispatch: null });
  assert.deepEqual(Object.keys(validate.jobs), ['build']);
  assert.deepEqual(Object.keys(release.jobs), ['build', 'publish']);

  for (const [name, workflow] of Object.entries({ validate, release })) {
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.deepEqual(workflow.defaults, { run: { shell: 'bash' } });
    assert.equal(workflow.env, undefined, `${name}: workflow environment must not override execution`);
    const { steps, ...job } = workflow.jobs.build;
    const expected = {
      'runs-on': name === 'release' ? '${{ matrix.runner }}' : 'macos-15',
      env: {
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        FREEBUFF_UPSTREAM_DIR: '${{ github.workspace }}/_upstream',
      },
    };
    if (name === 'release') expected.strategy = {
      'fail-fast': false,
      matrix: { include: [
        { runner: 'macos-15', arch: 'arm64' },
        { runner: 'macos-15-intel', arch: 'x64' },
      ] },
    };
    assert.deepEqual(job, expected, `${name}: build job configuration differs`);
    verifySteps(steps, buildSteps(commit, name === 'release'), name);
  }

  const { steps, ...publish } = release.jobs.publish;
  assert.deepEqual(publish, {
    needs: 'build', if: "startsWith(github.ref, 'refs/tags/v')", 'runs-on': 'ubuntu-latest',
    permissions: { contents: 'write' },
  }, 'publish must wait for both successful builds and only publish version tags');
  verifySteps(steps, [
    { id: 'download', uses: 'actions/download-artifact@v4', with: {
      pattern: 'macos-*', path: 'release', 'merge-multiple': true,
    } },
    { id: 'checksums', 'working-directory': 'release', run:
      'shasum -a 256 Freebuff2API-*-arm64.dmg Freebuff2API-*-arm64.zip Freebuff2API-*-x64.dmg Freebuff2API-*-x64.zip > SHA256SUMS.txt\nshasum -a 256 -c SHA256SUMS.txt',
    },
    { id: 'release', uses: 'softprops/action-gh-release@v2', with: {
      generate_release_notes: true, fail_on_unmatched_files: true,
      files: 'release/Freebuff2API-*-arm64.dmg\nrelease/Freebuff2API-*-arm64.zip\nrelease/Freebuff2API-*-x64.dmg\nrelease/Freebuff2API-*-x64.zip\nrelease/SHA256SUMS.txt',
    } },
  ], 'publish');
}

if (require.main === module) {
  try {
    const workflows = Object.fromEntries(['validate', 'release'].map(name => [
      name, YAML.parse(fs.readFileSync(path.join(root, '.github/workflows', `${name}.yml`), 'utf8')),
    ]));
    verifyWorkflows(workflows);
    console.log('Workflow contracts verified.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { verifyWorkflows };
