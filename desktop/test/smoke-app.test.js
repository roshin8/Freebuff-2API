const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('packaged smoke ignores inherited gateway storage paths and runtime overrides', {
  skip: process.platform !== 'darwin' || !process.env.SMOKE_APP_PATH,
  timeout: 120_000,
}, (t) => {
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'freebuff-external-sentinel-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const sentinel = path.join(external, 'untouched.txt');
  fs.writeFileSync(sentinel, 'synthetic external data');
  const overrides = {
    SQLITE_PATH: path.join(external, 'usage.sqlite'),
    TOKENS_PATH: path.join(external, 'tokens.json'),
    TELEMETRY_PATH: path.join(external, 'telemetry.sqlite'),
    MEMORY_PATH: path.join(external, 'memory.sqlite'),
    CRED_META_PATH: path.join(external, 'cred_meta.json'),
    ACCOUNT_HISTORY_PATH: path.join(external, 'account_history.jsonl'),
    WEB_THREADS_PATH: path.join(external, 'web_threads.json'),
    SKILLS_DIR: path.join(external, 'skills'),
    WEB_DIR: external,
    LISTEN_ADDR: '127.0.0.1:0',
    UPSTREAM_BASE_URL: 'http://127.0.0.1:9',
    AUTH_TOKENS: 'synthetic-token-must-not-be-used',
    API_KEYS: 'synthetic-key-must-not-be-used',
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    MEMORY_ENABLED: 'true',
    SKILLS_INJECT_MODE: 'full',
    TOKEN_SAVER: 'true',
  };
  const result = spawnSync(path.resolve(__dirname, '../../scripts/smoke-app.sh'),
    [process.env.SMOKE_APP_PATH], {
      env: { ...process.env, ...overrides }, encoding: 'utf8', timeout: 100_000,
    });

  assert.deepEqual(fs.readdirSync(external), ['untouched.txt'],
    `gateway escaped the temporary app profile\n${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'synthetic external data');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Clean shutdown/);
});
