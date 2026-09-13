const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

async function launch({ executable = true } = {}) {
  const windows = [];
  const external = [];
  const errors = [];
  const handlers = new Map();
  let menu;
  let loginCount = 0;
  let stopResolve;
  let quitCount = 0;
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false, setName() {}, getPath: () => '/tmp/Freebuff2API',
    whenReady: () => Promise.resolve(),
    quit() { quitCount += 1; this.emit('before-quit', { preventDefault() {} }); },
  });
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: 'http://127.0.0.1:47821/ui' },
        setWindowOpenHandler(handler) { this.openHandler = handler; },
      });
      windows.push(this);
    }
    async loadURL(url) { this.url = url; }
    show() { this.visible = true; }
    focus() { this.focused = true; }
    isMinimized() { return false; }
    isDestroyed() { return false; }
  }
  class Gateway extends EventEmitter {
    constructor() {
      super();
      this.configPath = '/tmp/Freebuff2API/config.yaml';
      this.logPath = '/tmp/Freebuff2API/logs/gateway.log';
      this.config = { api_keys: ['local-key'] };
      this.userDataDir = '/tmp/Freebuff2API';
    }
    start() { this.started = true; }
    port() { return 47821; }
    async waitUntilHealthy() { return true; }
    stop() { return new Promise((resolve) => { stopResolve = resolve; }); }
  }
  const electron = {
    app, BrowserWindow: Window, session: {},
    dialog: { showErrorBox: (...args) => errors.push(args), showMessageBox: async () => ({ response: 0 }) },
    shell: { openExternal: async (url) => external.push(url), openPath: async () => '' },
    ipcMain: { handle(channel, handler) {
      assert.equal(handlers.has(channel), false, 'IPC handlers must be installed only once');
      handlers.set(channel, handler);
    } },
    nativeImage: { createFromPath: () => ({ resize() { return this; } }) },
    Menu: { buildFromTemplate: (template) => { menu = template; return template; } },
    Tray: class extends EventEmitter { setToolTip() {} setContextMenu() {} },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  vm.runInNewContext(source, {
    __dirname: path.join(__dirname, '..'), process: { platform: 'darwin' }, console,
    require(id) {
      if (id === 'electron') return electron;
      if (id === './gateway') return { GatewayManager: Gateway };
      if (id === './login') return {
        ...require('../login'),
        createLoginController: () => ({
          openLoginWindow: () => { loginCount += 1; return windows[0]; },
          captureCookies: async () => ({ cookieStr: 'secret', result: { ok: true, status: 200, body: '{}' } }),
        }),
      };
      if (id === 'node:fs') return { ...fs, accessSync() { if (!executable) throw new Error('missing executable'); } };
      if (id.startsWith('./')) return require(path.join(__dirname, '..', id));
      return require(id);
    },
  });
  await new Promise(setImmediate);
  return { app, windows, external, errors, handlers, get menu() { return menu; },
    get loginCount() { return loginCount; }, get quitCount() { return quitCount; },
    finishStop: () => stopResolve(),
  };
}

test('dashboard has isolated preload, exact-origin navigation, and dedicated Freebuff login', async () => {
  const state = await launch();
  const window = state.windows[0];
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.url, 'http://127.0.0.1:47821/ui');
  let prevented = false;
  window.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'file:///etc/passwd');
  assert.equal(prevented, true);
  assert.equal(window.webContents.openHandler({ url: 'https://example.com/' }).action, 'deny');
  await new Promise(setImmediate);
  assert.deepEqual(state.external, ['https://example.com/']);
  window.webContents.openHandler({ url: 'https://freebuff.com/' });
  assert.equal(state.loginCount, 1);
  assert.deepEqual(state.external, ['https://example.com/']);
});

test('login IPC rejects foreign windows, subframes, and navigated-away frames', async () => {
  const state = await launch();
  const contents = state.windows[0].webContents;
  const handler = state.handlers.get('open-login');
  for (const event of [
    { sender: {}, senderFrame: contents.mainFrame },
    { sender: contents, senderFrame: { url: contents.mainFrame.url } },
  ]) await assert.rejects(async () => handler(event), /dashboard/i);
  contents.mainFrame.url = 'https://example.com/';
  await assert.rejects(async () => handler({ sender: contents, senderFrame: contents.mainFrame }), /dashboard/i);
  contents.mainFrame.url = 'http://127.0.0.1:47821/ui';
  await handler({ sender: contents, senderFrame: contents.mainFrame });
  assert.equal(state.loginCount, 1);
  const captured = await state.handlers.get('capture-cookie')({ sender: contents, senderFrame: contents.mainFrame });
  assert.equal(captured.result.ok, true);
  assert.equal(captured.cookieStr, 'secret');
});

test('macOS activation recreates dashboard without duplicating IPC registration', async () => {
  const state = await launch();
  state.windows[0].emit('closed');
  state.app.emit('window-all-closed');
  assert.equal(state.quitCount, 0);
  state.app.emit('activate');
  await new Promise(setImmediate);
  assert.equal(state.windows.length, 2);
  assert.equal(state.handlers.size, 2);
});

test('tray includes operational entries and opens wrapper release page for updates', async () => {
  const state = await launch();
  assert.deepEqual(Array.from(state.menu.filter((entry) => entry.label), (entry) => entry.label), [
    'Open Dashboard', 'Login New Account', 'Diagnostics', 'Open Logs', 'Open Configuration',
    'Open Data Directory', 'Check for Updates', 'Quit',
  ]);
  await state.menu.find((entry) => entry.label === 'Check for Updates').click();
  assert.deepEqual(state.external, ['https://github.com/roshin8/Freebuff-2API/releases/latest']);
});

test('missing executable shows real config and log paths without opening dashboard', async () => {
  const state = await launch({ executable: false });
  assert.equal(state.windows.length, 0);
  assert.match(state.errors[0][1], /\/tmp\/Freebuff2API\/config.yaml/);
  assert.match(state.errors[0][1], /\/tmp\/Freebuff2API\/logs\/gateway.log/);
});

test('before-quit waits for gateway shutdown and guards repeated quit requests', async () => {
  const state = await launch();
  let prevented = 0;
  state.app.emit('before-quit', { preventDefault() { prevented += 1; } });
  state.app.emit('before-quit', { preventDefault() { prevented += 1; } });
  assert.equal(prevented, 2);
  assert.equal(state.quitCount, 0);
  state.finishStop();
  await new Promise(setImmediate);
  assert.equal(state.quitCount, 1);
});
