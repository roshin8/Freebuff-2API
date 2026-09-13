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

async function withImportServer(run, { status = 200, body = '{"added":1}', respond } = {}) {
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
      if (respond) {
        respond(request, response);
        return;
      }
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
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function settlesWithin(promise, timeoutMs = 2_500) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`operation did not settle within ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
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

test('reports a real loopback response abort instead of hanging', async () => {
  await withImportServer(async (port) => {
    const result = await settlesWithin(postCookie({ cookie: 'session-token=secret', port }));

    assert.deepEqual(result, {
      ok: false,
      status: 0,
      body: 'Gateway response aborted',
    });
  }, {
    respond(_request, response) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"add');
      setImmediate(() => response.destroy());
    },
  });
});

test('stops a trickled loopback response at the absolute request deadline', async () => {
  await withImportServer(async (port) => {
    const startedAt = Date.now();
    const result = await settlesWithin(postCookie({ cookie: 'session-token=secret', port }));
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.match(result.body, /timed out/);
    assert.ok(elapsedMs < 2_000, `request exceeded its deadline by ${elapsedMs - 1_000}ms`);
  }, {
    respond(_request, response) {
      response.writeHead(200, { 'content-type': 'application/json' });
      const interval = setInterval(() => response.write(' '), 100);
      response.once('close', () => clearInterval(interval));
    },
  });
});

test('opens one persistent, isolated login window and blocks disallowed top-level navigation', () => {
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
});

test('denies every child window so no popup can escape the navigation guards', () => {
  const fixture = createElectronFixture([]);
  const controller = createLoginController({
    BrowserWindow: fixture.BrowserWindow,
    session: fixture.session,
    dialog: fixture.dialog,
    logger: { info() {}, error() {} },
    port: 47821,
  });
  const loginWindow = controller.openLoginWindow();

  assert.deepEqual(loginWindow.windowOpenHandler({ url: 'https://evil.example/' }), { action: 'deny' });
  assert.deepEqual(loginWindow.windowOpenHandler({ url: 'https://sub.freebuff.com/account' }), { action: 'deny' });
  assert.deepEqual(loginWindow.loadedUrls, [
    'https://freebuff.com/',
    'https://sub.freebuff.com/account',
  ]);
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

test('imports after an allowed main-frame SPA login transition only', async () => {
  const received = await withImportServer(async (port) => {
    const fixture = createElectronFixture([
      { name: '__Secure-next-auth.session-token', value: 'spa-secret' },
    ]);
    const controller = createLoginController({
      BrowserWindow: fixture.BrowserWindow,
      session: fixture.session,
      dialog: fixture.dialog,
      logger: { info() {}, error() {} },
      port,
    });
    const loginWindow = controller.openLoginWindow();

    loginWindow.webContents.emit('did-navigate-in-page', {}, 'https://freebuff.com/chat', false);
    loginWindow.webContents.emit('did-navigate-in-page', {}, 'https://freebuff.com.evil.example/chat', true);
    loginWindow.webContents.emit('did-navigate-in-page', {}, 'https://freebuff.com/chatty', true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fixture.cookieQueries.length, 0);

    loginWindow.webContents.emit(
      'did-navigate-in-page',
      {},
      'https://sub.freebuff.com/account/settings',
      true
    );
    await settlesWithin(new Promise((resolve) => loginWindow.once('closed', resolve)));
  });

  assert.deepEqual(received.json, {
    cookie: '__Secure-next-auth.session-token=spa-secret',
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

test('shows an aborted-import failure and permits a later capture attempt', async () => {
  let attempts = 0;
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

    loginWindow.webContents.emit('did-navigate', {}, 'https://freebuff.com/chat');
    await settlesWithin(fixture.waitForDialog());
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(loginWindow.closed, false);
    assert.equal(fixture.dialogCalls[0].options.title, 'Gateway unavailable');
    assert.match(fixture.dialogCalls[0].options.detail, /Gateway response aborted/);

    loginWindow.webContents.emit('did-navigate', {}, 'https://freebuff.com/chat');
    await settlesWithin(new Promise((resolve) => loginWindow.once('closed', resolve)));
    assert.equal(attempts, 2);
  }, {
    respond(_request, response) {
      attempts += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      if (attempts === 1) {
        response.write('{"add');
        setImmediate(() => response.destroy());
        return;
      }
      response.end('{"added":1}');
    },
  });
});
