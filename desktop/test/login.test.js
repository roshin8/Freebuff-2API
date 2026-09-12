const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const {
  buildCookieHeader,
  createLoginController,
  isAllowedLoginUrl,
  postCookie,
} = require('../login');

async function withImportServer(run, { status = 200, body = '{"added":1}' } = {}) {
  let resolveReceived;
  const received = new Promise((resolve) => { resolveReceived = resolve; });
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      resolveReceived({
        method: request.method,
        path: request.url,
        host: request.headers.host,
        authorization: request.headers.authorization,
        json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      });
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    await run(server.address().port);
    return await received;
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function createElectronFixture(cookies) {
  const windows = [];
  const cookieQueries = [];
  const dialogCalls = [];
  const dialogShown = [];
  const partitions = [];
  const loginSession = {
    cookies: {
      async get(query) {
        cookieQueries.push(query);
        return cookies;
      },
    },
  };

  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (handler) => {
        this.windowOpenHandler = handler;
      };
      this.loadedUrls = [];
      this.closed = false;
      this.shown = false;
      windows.push(this);
    }

    loadURL(url) {
      this.loadedUrls.push(url);
    }

    show() {
      this.shown = true;
    }

    close() {
      this.closed = true;
      this.emit('closed');
    }
  }

  const session = {
    fromPartition(partition) {
      partitions.push(partition);
      return loginSession;
    },
  };
  const dialog = {
    async showMessageBox(window, options) {
      dialogCalls.push({ window, options });
      for (const resolve of dialogShown.splice(0)) resolve();
      return { response: 0 };
    },
  };

  return {
    BrowserWindow: FakeBrowserWindow,
    cookieQueries,
    dialog,
    dialogCalls,
    loginSession,
    partitions,
    session,
    waitForDialog() {
      if (dialogCalls.length > 0) return Promise.resolve();
      return new Promise((resolve) => dialogShown.push(resolve));
    },
    windows,
  };
}

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
  assert.equal(isAllowedLoginUrl('https://notfreebuff.com/web'), false);
  assert.equal(isAllowedLoginUrl('http://freebuff.com/chat'), false);
  assert.equal(isAllowedLoginUrl('not a URL'), false);
});

test('posts credentials only to a real loopback server', async () => {
  let expectedPort;
  const received = await withImportServer(async (port) => {
    expectedPort = port;
    const result = await postCookie({ cookie: 'session-token=secret', port, apiKey: 'local-key' });
    assert.deepEqual(result, { ok: true, status: 200, body: '{"added":1}' });
  });
  assert.deepEqual(received, {
    method: 'POST',
    path: '/api/tokens/import',
    host: `127.0.0.1:${expectedPort}`,
    authorization: 'Bearer local-key',
    json: { cookie: 'session-token=secret' },
  });
});

test('rejects an invalid port before asking the HTTP boundary for a socket', async () => {
  let requested = false;
  const socketBoundary = {
    request() {
      requested = true;
      throw new Error('must not request');
    },
  };

  await assert.rejects(postCookie({ cookie: 'secret', port: 0, http: socketBoundary }), {
    name: 'RangeError',
  });
  assert.equal(requested, false);
});

test('opens one persistent, isolated login window and blocks disallowed navigation', () => {
  const fixture = createElectronFixture([]);
  const controller = createLoginController({
    BrowserWindow: fixture.BrowserWindow,
    session: fixture.session,
    dialog: fixture.dialog,
    logger: { info() {}, error() {} },
    port: 47821,
  });

  const firstWindow = controller.openLoginWindow();
  const secondWindow = controller.openLoginWindow();

  assert.equal(firstWindow, secondWindow);
  assert.equal(fixture.windows.length, 1);
  assert.deepEqual(fixture.partitions, ['persist:freebuff-login']);
  assert.equal(firstWindow.options.webPreferences.partition, 'persist:freebuff-login');
  assert.equal(firstWindow.options.webPreferences.session, fixture.loginSession);
  assert.equal(firstWindow.options.webPreferences.nodeIntegration, false);
  assert.equal(firstWindow.options.webPreferences.contextIsolation, true);
  assert.deepEqual(firstWindow.loadedUrls, ['https://freebuff.com/']);
  assert.equal(firstWindow.shown, true);

  let prevented = false;
  firstWindow.webContents.emit('will-navigate', {
    preventDefault() { prevented = true; },
  }, 'https://freebuff.com.evil.example/chat');
  assert.equal(prevented, true);
  assert.deepEqual(firstWindow.windowOpenHandler({ url: 'https://evil.example/' }), { action: 'deny' });
  assert.deepEqual(firstWindow.windowOpenHandler({ url: 'https://sub.freebuff.com/account' }), { action: 'allow' });
});

test('imports captured session cookies through loopback after a completed login navigation', async () => {
  const received = await withImportServer(async (port) => {
    const fixture = createElectronFixture([
      { name: '__Secure-next-auth.session-token', value: 'secret' },
      { name: '__Host-next-auth.csrf-token', value: 'csrf' },
    ]);
    const controller = createLoginController({
      BrowserWindow: fixture.BrowserWindow,
      session: fixture.session,
      dialog: fixture.dialog,
      logger: { info() {}, error() {} },
      port,
    });
    const loginWindow = controller.openLoginWindow();

    loginWindow.webContents.emit('did-navigate', {}, 'https://freebuff.com/chat');
    await new Promise((resolve) => loginWindow.once('closed', resolve));

    assert.deepEqual(fixture.cookieQueries, [{ url: 'https://freebuff.com' }]);
    assert.equal(fixture.dialogCalls.length, 0);
  });
  assert.deepEqual(received.json, {
    cookie: '__Secure-next-auth.session-token=secret; __Host-next-auth.csrf-token=csrf',
  });
});

test('keeps the login window open and shows a specific dialog when the session cookie is missing', async () => {
  const fixture = createElectronFixture([{ name: 'theme', value: 'dark' }]);
  const controller = createLoginController({
    BrowserWindow: fixture.BrowserWindow,
    session: fixture.session,
    dialog: fixture.dialog,
    logger: { info() {}, error() {} },
    port: 47821,
  });
  const loginWindow = controller.openLoginWindow();

  loginWindow.webContents.emit('did-navigate', {}, 'https://freebuff.com/account');
  await fixture.waitForDialog();

  assert.equal(loginWindow.closed, false);
  assert.equal(fixture.dialogCalls.length, 1);
  assert.equal(fixture.dialogCalls[0].window, loginWindow);
  assert.deepEqual(fixture.dialogCalls[0].options, {
    type: 'warning',
    title: 'Login not complete',
    message: 'No Freebuff session cookie was found.',
    detail: 'Complete the login in this window. Cookie capture will run again after Freebuff opens /chat, /account, or /web.',
    buttons: ['Continue Waiting'],
  });
});

test('keeps the login window open and exposes a real gateway rejection', async () => {
  await withImportServer(async (port) => {
    const fixture = createElectronFixture([
      { name: '__Secure-next-auth.session-token', value: 'secret' },
    ]);
    const controller = createLoginController({
      BrowserWindow: fixture.BrowserWindow,
      session: fixture.session,
      dialog: fixture.dialog,
      logger: { info() {}, error() {} },
      port,
    });
    const loginWindow = controller.openLoginWindow();

    loginWindow.webContents.emit('did-navigate', {}, 'https://freebuff.com/web');
    await fixture.waitForDialog();

    assert.equal(loginWindow.closed, false);
    assert.deepEqual(fixture.dialogCalls[0].options, {
      type: 'error',
      title: 'Cookie import rejected',
      message: 'The local gateway rejected the Freebuff session cookie.',
      detail: 'HTTP 401: {"error":"not authorized"}',
      buttons: ['Continue Waiting'],
    });
  }, { status: 401, body: '{"error":"not authorized"}' });
});
