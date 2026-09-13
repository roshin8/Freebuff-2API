const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { applyEnglishDashboard } = require('../../scripts/prepare-gateway');

const patchDir = path.resolve(__dirname, '../../patches/upstream-v0.7.3');
const upstreamDir = process.env.FREEBUFF_UPSTREAM_DIR;
const commit = '506240d7deef1272ed05313ed72f7d9f11785e89';

test('ships the audited English patch and source integrity manifest', () => {
  assert.ok(fs.existsSync(path.join(patchDir, 'english-dashboard.patch')), 'English dashboard patch is missing');
  assert.equal(JSON.parse(fs.readFileSync(path.join(patchDir, 'manifest.json'))).commit, commit);
});

test('localizes the exact pinned dashboard and rejects source drift', { skip: !upstreamDir }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebuff-english-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const file of Object.keys(JSON.parse(fs.readFileSync(path.join(patchDir, 'manifest.json'))).files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), execFileSync('git', ['-C', upstreamDir, 'show', `${commit}:${file}`]));
  }
  execFileSync('git', ['init', '--quiet', directory]);
  assert.equal(typeof applyEnglishDashboard, 'function', 'preparation must apply the English patch');
  assert.equal(applyEnglishDashboard({ upstreamDir: directory }), 'applied');
  for (const [file, message] of [
    ['src/skills/store.rs', 'Skill not found:'],
    ['src/web_protocol.rs', 'Could not parse upstream JSON response:'],
  ]) assert.ok(fs.readFileSync(path.join(directory, file), 'utf8').includes(message), file);
  const localized = fs.readFileSync(path.join(directory, 'src/web.rs'), 'utf8');
  assert.equal(applyEnglishDashboard({ upstreamDir: directory }), 'already-applied');
  assert.equal(fs.readFileSync(path.join(directory, 'src/web.rs'), 'utf8'), localized);
  const html = localized.match(/r##"([\s\S]*)"##;/)[1];
  assert.doesNotMatch(html, /\p{Script=Han}/u);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Freebuff2API Dashboard<\/title>/);
  for (const label of ['Overview', 'Accounts', 'Skills', 'Memory', 'Live logs', 'Diagnostics', 'Client setup', 'Add account']) {
    assert.ok(html.includes(label), `missing English UI: ${label}`);
  }
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  new vm.Script(script); // Translation must not break JavaScript quoting.
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { style: {}, value: '', textContent: '', innerHTML: '' }); return elements.get(id); };
  const context = vm.createContext({
    document: { getElementById: element },
    window: { addEventListener() {} },
    localStorage: { getItem: () => '' },
    location: { origin: 'http://127.0.0.1:47821', hash: '' },
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {},
  });
  // Startup requests are covered by packaged smoke; exercise actual rendering functions here.
  vm.runInContext(script.slice(0, script.lastIndexOf('\nrefreshOverview();')), context);
  vm.runInContext('fillGuide({models_count: 1, models_sample: ["test-model"]}); newSkill(); newMemory(); renderLogs();', context);
  assert.match(html, /OpenCode/);
  assert.match(html, /\.config\/opencode\/opencode\.jsonc/);
  assert.match(element('g-opencode').textContent, /@ai-sdk\/openai-compatible/);
  assert.match(element('g-opencode').textContent, /"baseURL": "http:\/\/127\.0\.0\.1:47821\/v1"/);
  assert.match(element('g-opencode').textContent, /"apiKey": "sk-local"/);
  assert.match(element('g-opencode').textContent, /"test-model"/);
  assert.match(element('g-py').textContent, /Hello/);
  assert.match(element('skill-editor-title').textContent, /New skill/);
  assert.match(element('logbox').innerHTML, /No logs/);
  assert.match(vm.runInContext('explain({error_kind: "no_account"})', context), /account/i);
  assert.match(vm.runInContext('renderOverview({})', context), /account/i);
  assert.equal(vm.runInContext('skillDisplayName({id: "git-guru", builtin: true, name: "Git 专家"})', context), 'Git expert');
  assert.equal(vm.runInContext('skillDisplayName({id: "git-guru", builtin: false, name: "My skill"})', context), 'My skill');
  for (const value of elements.values()) assert.doesNotMatch(value.innerHTML + value.textContent, /\p{Script=Han}/u);
  // Even drift outside the patch hunks must fail before a build can use it.
  fs.appendFileSync(path.join(directory, 'src/web.rs'), '\n// unexpected local edit\n');
  assert.throws(() => applyEnglishDashboard({ upstreamDir: directory }), /drift/);
});
