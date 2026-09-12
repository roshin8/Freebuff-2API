# Freebuff2API macOS Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish an independent unsigned macOS Electron wrapper for the pinned Freebuff2API v0.7.3 gateway, with native Apple Silicon and Intel release artifacts.

**Architecture:** A small CommonJS Electron application delegates platform decisions, gateway lifecycle, and login-cookie capture to separately tested modules. A pinned upstream manifest and preparation script compile the Rust gateway from an explicit local checkout or an exact CI commit, while GitHub Actions package architecture-specific DMG/ZIP artifacts and publish checksums.

**Tech Stack:** Electron 33, electron-builder 25, Node.js 20 built-in test runner, Rust 1.95, GitHub Actions, macOS `file`, `lipo`, `shasum`, and `xattr` tools.

**Spec:** `docs/superpowers/specs/2026-09-12-macos-wrapper-design.md`

## Global Constraints

- The GitHub repository is an independent public repository at `roshin8/Freebuff-2API`, not a GitHub fork.
- Upstream is pinned to tag `v0.7.3` and commit `506240d7deef1272ed05313ed72f7d9f11785e89`.
- The upstream Rust source is not committed to the wrapper repository.
- The wrapper supports only macOS `arm64` and `x64` in this phase.
- The app is unsigned and unnotarized; signing discovery must be disabled in every package build.
- The gateway listens on `127.0.0.1` by default and captured cookies may only be posted to loopback.
- Product name is `Freebuff2API`; application identifier is `com.roshin8.freebuff2api`.
- Wrapper version begins at `0.1.0`; upstream and wrapper versions remain distinct.
- All production behavior is introduced test-first. Configuration-only workflow files are verified by executable smoke scripts.

---

### Task 1: Bootstrap metadata and enforce the upstream pin

**Files:**
- Create: `LICENSE`
- Create: `NOTICE.md`
- Create: `upstream.json`
- Create: `.gitignore`
- Create: `desktop/package.json`
- Create: `scripts/upstream.js`
- Create: `desktop/test/upstream.test.js`
- Create: `desktop/package-lock.json` via `npm install --package-lock-only`

**Interfaces:**
- Produces: `loadUpstreamManifest(manifestPath) -> {repository, tag, commit}`
- Produces: `assertPinnedCheckout(manifest, checkoutDir, execFileSync?) -> void`
- Produces: npm scripts `test`, `start`, `prepare:gateway`, `dist:mac`, and `smoke:bundle`

- [ ] **Step 1: Write the failing upstream-pin tests**

```js
// desktop/test/upstream.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadUpstreamManifest, assertPinnedCheckout } = require('../../scripts/upstream');

test('loads the exact audited upstream release', () => {
  const manifest = loadUpstreamManifest(path.join(__dirname, '../../upstream.json'));
  assert.deepEqual(manifest, {
    repository: 'https://github.com/lza6/Freebuff-2API',
    tag: 'v0.7.3',
    commit: '506240d7deef1272ed05313ed72f7d9f11785e89',
  });
});

test('rejects a checkout whose HEAD differs from the pin', () => {
  const exec = () => Buffer.from('1111111111111111111111111111111111111111\n');
  assert.throws(
    () => assertPinnedCheckout({ commit: '506240d7deef1272ed05313ed72f7d9f11785e89' }, '/tmp/upstream', exec),
    /does not match pinned commit/
  );
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test desktop/test/upstream.test.js`

Expected: FAIL with `Cannot find module '../../scripts/upstream'`.

- [ ] **Step 3: Add the manifest and minimal validator**

```json
{
  "repository": "https://github.com/lza6/Freebuff-2API",
  "tag": "v0.7.3",
  "commit": "506240d7deef1272ed05313ed72f7d9f11785e89"
}
```

```js
// scripts/upstream.js
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
```

- [ ] **Step 4: Add package metadata, attribution, ignore rules, and lockfile**

Use `desktop/package.json` with `main: "main.js"`, version `0.1.0`, Electron `^33.0.0`, electron-builder `^25.1.8`, YAML parser `yaml` at `^2.6.1`, and scripts:

```json
{
  "test": "node --test test/*.test.js",
  "start": "electron .",
  "prepare:gateway": "node ../scripts/prepare-gateway.js",
  "dist:mac": "electron-builder --mac dmg zip --publish never",
  "smoke:bundle": "node ../scripts/smoke-bundle.js"
}
```

Copy the upstream MIT license verbatim into `LICENSE`, preserving `Copyright (c) 2026 Quorinex`. In `NOTICE.md`, identify the pinned upstream project, tag, commit, Quorinex copyright, MIT license, and state that this repository supplies an independent macOS wrapper maintained by `roshin8`.

Run: `cd desktop && npm install --package-lock-only --ignore-scripts && cd ..`

- [ ] **Step 5: Run tests and commit**

Run: `node --test desktop/test/upstream.test.js`

Expected: 2 tests pass.

```bash
git add LICENSE NOTICE.md upstream.json .gitignore desktop/package.json desktop/package-lock.json desktop/test/upstream.test.js scripts/upstream.js
git commit -m "chore: bootstrap pinned wrapper project"
```

---

### Task 2: Prepare a verified native gateway resource

**Files:**
- Create: `scripts/prepare-gateway.js`
- Create: `desktop/test/prepare-gateway.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `loadUpstreamManifest`, `assertPinnedCheckout`
- Produces: `gatewayBuildPlan({platform, arch, upstreamDir, resourcesDir}) -> {binaryName, source, destination}`
- Produces: CLI reading `FREEBUFF_UPSTREAM_DIR`, compiling with Cargo, and copying to `desktop/generated/bin/freebuff2api`

- [ ] **Step 1: Write failing build-plan tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { gatewayBuildPlan } = require('../../scripts/prepare-gateway');

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
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test desktop/test/prepare-gateway.test.js`

Expected: FAIL because `scripts/prepare-gateway.js` does not exist.

- [ ] **Step 3: Implement the preparation module and CLI**

Implement `gatewayBuildPlan` as the pure function tested above. When executed directly, the script must:

1. Require an absolute `FREEBUFF_UPSTREAM_DIR`.
2. Load `upstream.json` and verify the checkout SHA.
3. Run `cargo build --release --locked` in that checkout with `CARGO_HTTP_PROXY`, `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` set to empty strings.
4. Copy the produced binary to `desktop/generated/bin/freebuff2api`.
5. Apply mode `0o755`.
6. Run `file` on the destination and require `arm64` when `process.arch === 'arm64'`, otherwise require `x86_64`.
7. Export `gatewayBuildPlan` and a `prepareGateway(options)` function so the CLI and tests share behavior.

- [ ] **Step 4: Verify the real pinned local checkout**

```bash
FREEBUFF_UPSTREAM_DIR="/Users/zeus/Documents/Codex/2026-09-12/https-github-com-lza6-freebuff-2api/work/Freebuff-2API" node scripts/prepare-gateway.js
file desktop/generated/bin/freebuff2api
test -x desktop/generated/bin/freebuff2api
```

Expected: `file` reports a Mach-O 64-bit arm64 executable and `test -x` exits 0.

- [ ] **Step 5: Run tests and commit**

Run: `node --test desktop/test/upstream.test.js desktop/test/prepare-gateway.test.js`

```bash
git add .gitignore scripts/prepare-gateway.js desktop/test/prepare-gateway.test.js
git commit -m "build: prepare pinned gateway resource"
```

---

### Task 3: Implement platform paths and safe defaults

**Files:**
- Create: `desktop/platform.js`
- Create: `desktop/test/platform.test.js`

**Interfaces:**
- Produces: `gatewayPath(resourcesPath) -> string`
- Produces: `initialConfig(userDataDir) -> object`
- Produces: `configuredPort(config, fallback = 47821) -> number`
- Produces: `isLoopbackDashboardUrl(rawUrl, port) -> boolean`
- Produces: `dataPathDescription(userDataDir) -> string`

- [ ] **Step 1: Write failing behavior tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const platform = require('../platform');

test('resolves the bundled macOS gateway', () => {
  assert.equal(platform.gatewayPath('/App/Contents/Resources'), path.join('/App/Contents/Resources', 'bin', 'freebuff2api'));
});

test('creates loopback-only privacy-preserving defaults', () => {
  const cfg = platform.initialConfig('/Users/test/Library/Application Support/Freebuff2API');
  assert.equal(cfg.listen_addr, '127.0.0.1:47821');
  assert.deepEqual(cfg.auth_tokens, []);
  assert.deepEqual(cfg.api_keys, []);
  assert.equal(cfg.http_proxy, '');
  assert.equal(cfg.memory_enabled, false);
  assert.equal(cfg.skip_upstream_check, true);
});

test('accepts only valid TCP ports from config', () => {
  assert.equal(platform.configuredPort({ listen_addr: '127.0.0.1:47822' }), 47822);
  assert.equal(platform.configuredPort({ listen_addr: '127.0.0.1:70000' }), 47821);
  assert.equal(platform.configuredPort({ listen_addr: '0.0.0.0:9000' }), 47821);
});

test('allows only the configured loopback dashboard origin', () => {
  assert.equal(platform.isLoopbackDashboardUrl('http://127.0.0.1:47821/ui', 47821), true);
  assert.equal(platform.isLoopbackDashboardUrl('https://evil.example/ui', 47821), false);
  assert.equal(platform.isLoopbackDashboardUrl('http://127.0.0.1:9999/ui', 47821), false);
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test desktop/test/platform.test.js`

Expected: FAIL because `desktop/platform.js` does not exist.

- [ ] **Step 3: Implement the tested functions**

Use `path.join(resourcesPath, 'bin', 'freebuff2api')`; generate configuration paths beneath `userDataDir`; parse `listen_addr` with an exact `127.0.0.1:<port>` or `localhost:<port>` match; and parse navigation URLs with the built-in `URL` class rather than prefix matching.

- [ ] **Step 4: Run tests and commit**

Run: `npm test --prefix desktop`

```bash
git add desktop/platform.js desktop/test/platform.test.js
git commit -m "feat: add macOS paths and safe defaults"
```

---

### Task 4: Manage the gateway lifecycle with bounded restarts

**Files:**
- Create: `desktop/gateway.js`
- Create: `desktop/test/gateway.test.js`
- Create: `desktop/test/fixtures/fake-gateway.js`

**Interfaces:**
- Consumes: `gatewayPath`, `initialConfig`, `configuredPort`
- Produces: `RestartWindow({limit, windowMs, now?}).record() -> boolean`
- Produces: `GatewayManager({app, spawn, http, fs, resourcesPath, logger})`
- Produces methods: `ensureConfig()`, `start()`, `waitUntilHealthy(timeoutMs)`, `stop()`, `port()`, and event `permanentFailure`

- [ ] **Step 1: Write failing restart and lifecycle tests**

```js
test('allows three failures in sixty seconds and rejects the fourth', () => {
  let now = 0;
  const window = new RestartWindow({ limit: 3, windowMs: 60_000, now: () => now });
  assert.equal(window.record(), true);
  assert.equal(window.record(), true);
  assert.equal(window.record(), true);
  assert.equal(window.record(), false);
  now = 60_001;
  assert.equal(window.record(), true);
});

test('writes safe initial config and stops its real child process', async () => {
  const fixture = await createGatewayFixture();
  const manager = new GatewayManager(fixture.options);
  const config = manager.ensureConfig();
  assert.equal(config.listen_addr, `127.0.0.1:${fixture.port}`);
  await manager.start();
  assert.equal(await manager.waitUntilHealthy(3_000), true);
  await manager.stop();
  assert.equal(await fixture.isListening(), false);
});
```

The fixture must launch a real Node HTTP child process from a temporary executable file and expose `createGatewayFixture()` plus cleanup. It substitutes only the external Rust binary, while all wrapper lifecycle behavior remains real.

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test desktop/test/gateway.test.js`

Expected: FAIL because `GatewayManager` and `RestartWindow` do not exist.

- [ ] **Step 3: Implement the lifecycle manager**

Use `spawn(executable, ['--config', absoluteConfigPath], { cwd: userDataDir, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })`. Create directories recursively, create config only when absent, append stdout/stderr to `logs/gateway.log`, poll `/healthz` every 500 ms with a one-second request timeout, and terminate with `SIGTERM` followed by `SIGKILL` after five seconds if necessary. Emit `permanentFailure` only after the restart window rejects another attempt.

- [ ] **Step 4: Run lifecycle and full tests**

Run: `node --test desktop/test/gateway.test.js`

Expected: both lifecycle behaviors pass and the fixture port closes after `stop()`.

Run: `npm test --prefix desktop`

- [ ] **Step 5: Commit**

```bash
git add desktop/gateway.js desktop/test/gateway.test.js desktop/test/fixtures/fake-gateway.js
git commit -m "feat: manage gateway lifecycle"
```

---

### Task 5: Add secure embedded login and cookie import

**Files:**
- Create: `desktop/login.js`
- Create: `desktop/test/login.test.js`

**Interfaces:**
- Produces: `buildCookieHeader(cookies) -> string`
- Produces: `isAllowedLoginUrl(rawUrl) -> boolean`
- Produces: `postCookie({cookie, port, apiKey?, http?}) -> Promise<{ok,status,body}>`
- Produces: `createLoginController({BrowserWindow, session, dialog, logger, port, apiKey})`

- [ ] **Step 1: Write failing cookie and real-loopback tests**

```js
test('builds a cookie header without empty values', () => {
  assert.equal(buildCookieHeader([
    { name: '__Secure-next-auth.session-token', value: 'secret' },
    { name: 'empty', value: '' },
    { name: 'theme', value: 'dark' },
  ]), '__Secure-next-auth.session-token=secret; theme=dark');
});

test('rejects lookalike login origins', () => {
  assert.equal(isAllowedLoginUrl('https://freebuff.com/chat'), true);
  assert.equal(isAllowedLoginUrl('https://sub.freebuff.com/account'), true);
  assert.equal(isAllowedLoginUrl('https://freebuff.com.evil.example/chat'), false);
  assert.equal(isAllowedLoginUrl('http://freebuff.com/chat'), false);
});

test('posts credentials only to a real loopback server', async () => {
  const received = await withImportServer(async (port) => {
    const result = await postCookie({ cookie: 'session-token=secret', port });
    assert.equal(result.ok, true);
  });
  assert.deepEqual(received, { cookie: 'session-token=secret' });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test desktop/test/login.test.js`

Expected: FAIL because `desktop/login.js` does not exist.

- [ ] **Step 3: Implement login behavior**

Use `new URL(rawUrl)` and require HTTPS with hostname exactly `freebuff.com` or ending in `.freebuff.com`. Use `http.request` with literal host `127.0.0.1`; reject invalid ports before opening a socket. The controller uses partition `persist:freebuff-login`, waits for `/chat`, `/account`, or `/web`, reads cookies for `https://freebuff.com`, requires `__Secure-next-auth.session-token`, imports them, and leaves the window open with a specific dialog on failure.

- [ ] **Step 4: Run tests and commit**

Run: `npm test --prefix desktop`

```bash
git add desktop/login.js desktop/test/login.test.js
git commit -m "feat: add secure embedded login"
```

---

### Task 6: Wire the Electron application and tray

**Files:**
- Create: `desktop/main.js`
- Create: `desktop/preload.js`
- Create: `desktop/app-policy.js`
- Create: `desktop/test/app-policy.test.js`
- Create: `desktop/icons/icon.png`
- Create: `desktop/icons/icon.icns`
- Modify: `desktop/package.json`

**Interfaces:**
- Consumes: `GatewayManager`, `createLoginController`, and platform functions
- Produces: `navigationDecision(url, dashboardPort) -> {action:'allow'} | {action:'external', url} | {action:'deny'}`
- Produces: complete Electron lifecycle and allowlisted `freebuffDesktop.openLogin()` / `captureCookie()` preload API

- [ ] **Step 1: Write failing navigation-policy tests**

```js
test('keeps the local dashboard in-app', () => {
  assert.deepEqual(navigationDecision('http://127.0.0.1:47821/ui', 47821), { action: 'allow' });
});

test('opens normal HTTPS links externally and blocks unsafe schemes', () => {
  assert.deepEqual(navigationDecision('https://github.com/lza6/Freebuff-2API', 47821), {
    action: 'external', url: 'https://github.com/lza6/Freebuff-2API'
  });
  assert.deepEqual(navigationDecision('file:///etc/passwd', 47821), { action: 'deny' });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test desktop/test/app-policy.test.js`

Expected: FAIL because `desktop/app-policy.js` does not exist.

- [ ] **Step 3: Implement the policy and Electron coordinator**

`main.js` must create a context-isolated window with Node integration disabled, apply the tested navigation policy to `will-navigate` and `setWindowOpenHandler`, start `GatewayManager`, display failures with the real config/log paths, create the specified tray entries, install login IPC handlers once, and stop the gateway during `before-quit`. On macOS, `activate` reopens the dashboard window and closing all windows keeps the tray process alive.

`preload.js` exposes only:

```js
contextBridge.exposeInMainWorld('freebuffDesktop', {
  openLogin: () => ipcRenderer.invoke('open-login'),
  captureCookie: () => ipcRenderer.invoke('capture-cookie'),
  isDesktop: true,
});
```

The update menu uses `shell.openExternal('https://github.com/roshin8/Freebuff-2API/releases/latest')`; do not initialize `electron-updater`.

- [ ] **Step 4: Generate and verify icon assets**

Use the upstream PNG as the visual source, create a standard `icon.iconset` containing 16, 32, 128, 256, 512, and 1024 pixel representations with `sips`, then run `iconutil -c icns`. Verify `iconutil` exits 0 and `file desktop/icons/icon.icns` reports an Apple icon image.

- [ ] **Step 5: Run tests and commit**

Run: `npm test --prefix desktop`

```bash
git add desktop/main.js desktop/preload.js desktop/app-policy.js desktop/test/app-policy.test.js desktop/icons desktop/package.json
git commit -m "feat: wire macOS desktop application"
```

---

### Task 7: Package and inspect unsigned architecture-specific bundles

**Files:**
- Create: `scripts/smoke-bundle.js`
- Create: `desktop/test/smoke-bundle.test.js`
- Modify: `desktop/package.json`

**Interfaces:**
- Produces: `inspectBundle({appPath, expectedArch, execFileSync?}) -> {gatewayPath, architecture}`
- Produces: electron-builder outputs `Freebuff2API-0.1.0-arm64.{dmg,zip}` and `Freebuff2API-0.1.0-x64.{dmg,zip}`

- [ ] **Step 1: Write the failing bundle-inspection test**

Create a temporary `.app/Contents/Resources/bin/freebuff2api` fixture with executable mode. Inject an `execFileSync` double that returns the complete real `file` output shape `Mach-O 64-bit executable arm64`, then assert `inspectBundle` returns the exact gateway path and `arm64`. Add cases for a missing executable and an architecture mismatch.

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test desktop/test/smoke-bundle.test.js`

Expected: FAIL because `scripts/smoke-bundle.js` does not exist.

- [ ] **Step 3: Implement bundle inspection and builder configuration**

Configure electron-builder with:

```json
{
  "appId": "com.roshin8.freebuff2api",
  "productName": "Freebuff2API",
  "asar": true,
  "files": ["main.js", "preload.js", "platform.js", "gateway.js", "login.js", "app-policy.js", "icons/**/*"],
  "extraResources": [{ "from": "generated/bin/freebuff2api", "to": "bin/freebuff2api" }],
  "mac": {
    "category": "public.app-category.developer-tools",
    "icon": "icons/icon.icns",
    "identity": null,
    "target": ["dmg", "zip"],
    "artifactName": "Freebuff2API-${version}-${arch}.${ext}"
  }
}
```

The smoke CLI accepts `APP_PATH` and `EXPECTED_ARCH`, requires an executable gateway, runs `file`, checks the expected architecture, and exits nonzero on any mismatch.

- [ ] **Step 4: Run tests and build the local arm64 package**

```bash
npm ci --prefix desktop --ignore-scripts
npm test --prefix desktop
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac --prefix desktop -- --arm64
APP_PATH="desktop/dist/mac-arm64/Freebuff2API.app" EXPECTED_ARCH=arm64 node scripts/smoke-bundle.js
shasum -a 256 desktop/dist/Freebuff2API-0.1.0-arm64.dmg desktop/dist/Freebuff2API-0.1.0-arm64.zip
```

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-bundle.js desktop/test/smoke-bundle.test.js desktop/package.json desktop/package-lock.json
git commit -m "build: package and inspect unsigned macOS app"
```

---

### Task 8: Add CI validation and dual-architecture releases

**Files:**
- Create: `.github/workflows/validate.yml`
- Create: `.github/workflows/release.yml`
- Create: `scripts/verify-workflows.js`
- Create: `desktop/test/workflows.test.js`

**Interfaces:**
- Produces: PR validation on `macos-15`
- Produces: tag release matrix on `macos-15` (`arm64`) and `macos-15-intel` (`x64`)
- Produces: release assets and `SHA256SUMS.txt`

- [ ] **Step 1: Write a failing workflow-contract test**

The test executes `node scripts/verify-workflows.js` and asserts exit 0. The verifier uses the `yaml` package to parse both workflows into objects, then checks their executable job graphs: exact upstream checkout repository/ref, SHA verification step, `cargo test --locked`, `npm ci`, `npm test`, signing disabled, bundle smoke step, checksum job, artifact dependency, and release upload. It must reject a parsed fixture in which the upstream checkout ref is changed to `main`.

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test desktop/test/workflows.test.js`

Expected: FAIL because workflows and verifier do not exist.

- [ ] **Step 3: Implement validation and release workflows**

`validate.yml` checks out the wrapper, checks out `lza6/Freebuff-2API` at the exact pinned SHA into `_upstream`, verifies `git rev-parse HEAD`, installs Rust 1.95, runs upstream Rust tests, prepares the gateway from `_upstream`, installs locked desktop dependencies, runs Node tests, builds an arm64 unsigned package, and inspects it.

`release.yml` triggers on tags matching `v*` and manual dispatch. Its matrix is exactly:

```yaml
include:
  - runner: macos-15
    arch: arm64
  - runner: macos-15-intel
    arch: x64
```

Each job uploads DMG/ZIP artifacts. A final `publish` job downloads both sets, generates `SHA256SUMS.txt`, and uses `softprops/action-gh-release@v2` to upload all five files with generated release notes.

- [ ] **Step 4: Run verification and commit**

Run: `npm test --prefix desktop`

Run: `node scripts/verify-workflows.js`

```bash
git add .github/workflows scripts/verify-workflows.js desktop/test/workflows.test.js
git commit -m "ci: build dual-architecture macOS releases"
```

---

### Task 9: Document installation, security, and upstream updates

**Files:**
- Create: `README.md`
- Create: `SECURITY.md`
- Create: `docs/DEVELOPMENT.md`
- Create: `docs/UPDATING-UPSTREAM.md`

**Interfaces:**
- Consumes: commands and paths implemented in Tasks 1–8
- Produces: user installation and contributor workflows

- [ ] **Step 1: Write the documentation from verified commands**

`README.md` must explain the independent-wrapper relationship, upstream v0.7.3 pin, Apple Silicon versus Intel downloads, SHA-256 verification, drag-to-Applications installation, right-click → Open, login flow, data directory, uninstall steps, and unsigned status. Include the quarantine-removal command only after the checksum warning.

`SECURITY.md` must explain loopback scope, cookie storage in the gateway's local data file, lack of Apple signing/notarization, checksum verification, vulnerability reporting through GitHub private security advisories, and the unofficial reverse-engineered upstream-service risk.

`docs/DEVELOPMENT.md` must give the exact local clone, `FREEBUFF_UPSTREAM_DIR`, preparation, test, start, package, and smoke-test commands.

`docs/UPDATING-UPSTREAM.md` must require reviewing the upstream diff, changing all three coordinates in `upstream.json`, running Rust and wrapper tests, locally packaging arm64, and merging via pull request before tagging a wrapper release.

- [ ] **Step 2: Execute every documented local command that does not publish**

Run the preparation, test, arm64 packaging, bundle inspection, health check, and checksum commands exactly as written in the documentation. Correct documentation if any command fails; do not weaken the command.

- [ ] **Step 3: Commit**

```bash
git add README.md SECURITY.md docs/DEVELOPMENT.md docs/UPDATING-UPSTREAM.md
git commit -m "docs: add macOS installation and maintenance guides"
```

---

### Task 10: Perform local app smoke testing

**Files:**
- Create: `scripts/smoke-app.sh`
- Modify: `README.md` only if observed first-launch behavior differs

**Interfaces:**
- Consumes: packaged arm64 `.app`
- Produces: verified launch, `/healthz`, dashboard HTTP 200, and child-process shutdown evidence

- [ ] **Step 1: Write the smoke script to fail before a package exists**

The script accepts one absolute `.app` path, copies it to a temporary directory, launches its Mach-O executable with `open --new`, waits up to 20 seconds for `http://127.0.0.1:47821/healthz`, requires JSON field `"ok":true`, requires HTTP 200 from `/ui`, quits the app with `osascript`, and confirms neither the app nor bundled gateway remains running. It installs an EXIT trap that always quits the temporary app and removes the temporary directory.

- [ ] **Step 2: Run and confirm RED against a nonexistent bundle**

Run: `scripts/smoke-app.sh /tmp/Freebuff2API-missing.app`

Expected: nonzero exit with `app bundle not found`.

- [ ] **Step 3: Run against the real local arm64 bundle**

```bash
scripts/smoke-app.sh "$PWD/desktop/dist/mac-arm64/Freebuff2API.app"
```

Expected: the script reports health OK, dashboard HTTP 200, and clean shutdown.

- [ ] **Step 4: Run the full local verification suite and commit**

```bash
npm test --prefix desktop
node scripts/verify-workflows.js
APP_PATH="$PWD/desktop/dist/mac-arm64/Freebuff2API.app" EXPECTED_ARCH=arm64 node scripts/smoke-bundle.js
scripts/smoke-app.sh "$PWD/desktop/dist/mac-arm64/Freebuff2API.app"
git diff --check
git status --short
```

```bash
git add scripts/smoke-app.sh README.md
git commit -m "test: verify packaged macOS application"
```

---

### Task 11: Publish the independent repository and first release

**Files:**
- Modify: none unless CI exposes a reproducible defect; any defect requires a failing local test before its fix

**Interfaces:**
- Produces: `https://github.com/roshin8/Freebuff-2API`
- Produces: GitHub Actions validation run and `v0.1.0` release

- [ ] **Step 1: Re-run the complete pre-publication gate**

```bash
npm test --prefix desktop
node scripts/verify-workflows.js
git diff --check
git status --short --branch
git log --oneline --decorate -12
```

Expected: all tests pass, no diff errors, and the working tree is clean.

- [ ] **Step 2: Create the public non-fork repository and push**

```bash
gh repo create roshin8/Freebuff-2API --public --source=. --remote=origin --push --description "Independent macOS wrapper for the Freebuff2API gateway"
gh repo view roshin8/Freebuff-2API --json nameWithOwner,isFork,visibility,url
```

Expected: `isFork` is `false`, visibility is `PUBLIC`, and the URL belongs to `roshin8`.

- [ ] **Step 3: Wait for validation and inspect failures**

```bash
gh run list --repo roshin8/Freebuff-2API --workflow validate.yml --limit 1
gh run watch --repo roshin8/Freebuff-2API --exit-status
```

If validation fails, inspect with `gh run view --log-failed`, reproduce locally, add a failing test, fix, rerun the complete gate, commit, and push.

- [ ] **Step 4: Tag and publish v0.1.0**

```bash
git tag -a v0.1.0 -m "Freebuff2API macOS wrapper v0.1.0"
git push origin v0.1.0
gh run watch --repo roshin8/Freebuff-2API --workflow release.yml --exit-status
```

- [ ] **Step 5: Verify the public release**

```bash
gh release view v0.1.0 --repo roshin8/Freebuff-2API --json url,assets,tagName
```

Require exactly the arm64 DMG/ZIP, x64 DMG/ZIP, and `SHA256SUMS.txt`. Download the arm64 assets into a new temporary directory, verify the checksum, mount the DMG, and rerun `scripts/smoke-app.sh` against the app copied from that downloaded release. Report the repository and release URLs only after these checks pass.
