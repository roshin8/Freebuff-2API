const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');

const root = path.join(__dirname, '../..');

function workflows() {
  return Object.fromEntries(['validate', 'release'].map(name => [
    name, YAML.parse(fs.readFileSync(path.join(root, '.github/workflows', `${name}.yml`), 'utf8')),
  ]));
}

test('workflow verifier accepts the checked-in executable CI and release graphs', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-workflows.js'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('release publishes explicit generated notes and runs tests on the patched Rust source', () => {
  const fixture = workflows();
  const releaseStep = fixture.release.jobs.publish.steps.find(s => s.id === 'release');
  assert.equal(releaseStep.with.body_path, 'release/RELEASE_NOTES.md');
  assert.equal(fixture.release.jobs.publish.steps.find(s => s.id === 'notes')?.run, 'node scripts/release-notes.js > release/RELEASE_NOTES.md');
  for (const workflow of Object.values(fixture)) {
    const ids = workflow.jobs.build.steps.map(s => s.id);
    assert.ok(ids.indexOf('rust_tests') > ids.indexOf('prepare'));
  }
});

const step = (workflow, id) => workflow.jobs.build.steps.find(item => item.id === id);
const mutations = [
  ['moving upstream ref', w => { step(w.release, 'upstream').with.ref = 'main'; }],
  ['different upstream repository', w => { step(w.validate, 'upstream').with.repository = 'other/repo'; }],
  ['missing SHA verification', w => { w.validate.jobs.build.steps = w.validate.jobs.build.steps.filter(s => s.id !== 'verify_upstream'); }],
  ['commented Rust tests', w => { step(w.release, 'rust_tests').run = '# cargo test --locked'; }],
  ['unlocked desktop install', w => { step(w.validate, 'npm_install').run = 'npm install'; }],
  ['tests in a display name only', w => { step(w.validate, 'node_tests').name = 'npm test'; step(w.validate, 'node_tests').run = 'echo skipped'; }],
  ['conditional bundle inspection', w => { step(w.release, 'smoke').if = 'false'; }],
  ['ignored build failure', w => { w.release.jobs.build['continue-on-error'] = true; }],
  ['enabled signing', w => { w.release.jobs.build.env.CSC_IDENTITY_AUTO_DISCOVERY = 'true'; }],
  ['wrong Intel runner', w => { w.release.jobs.build.strategy.matrix.include[1].runner = 'macos-15'; }],
  ['missing architecture', w => { w.release.jobs.build.strategy.matrix.include.pop(); }],
  ['tests before dependency installation', w => {
    const steps = w.validate.jobs.build.steps;
    const install = steps.findIndex(s => s.id === 'npm_install');
    const tests = steps.findIndex(s => s.id === 'node_tests');
    [steps[install], steps[tests]] = [steps[tests], steps[install]];
  }],
  ['publish without build dependency', w => { delete w.release.jobs.publish.needs; }],
  ['publish without artifact download', w => { w.release.jobs.publish.steps.shift(); }],
  ['checksum command replaced by echo', w => { w.release.jobs.publish.steps.find(s => s.id === 'checksums').run = 'echo SHA256SUMS.txt'; }],
  ['release missing checksums', w => { w.release.jobs.publish.steps.find(s => s.id === 'release').with.files = 'release/*.dmg\nrelease/*.zip'; }],
  ['missing explicit release notes', w => { delete w.release.jobs.publish.steps.find(s => s.id === 'release').with.body_path; }],
  ['artifact silently absent', w => { step(w.release, 'upload').with['if-no-files-found'] = 'warn'; }],
];

for (const [name, mutate] of mutations) {
  test(`workflow verifier rejects ${name} in a parsed fixture`, () => {
    const { verifyWorkflows } = require('../../scripts/verify-workflows');
    const fixture = workflows();
    mutate(fixture);
    assert.throws(() => verifyWorkflows(fixture));
  });
}
