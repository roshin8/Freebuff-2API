const nodeHttp = require('node:http');

const LOGIN_PARTITION = 'persist:freebuff-login';
const LOGIN_URL = 'https://freebuff.com/';
const COOKIE_URL = 'https://freebuff.com';
const SESSION_COOKIE = '__Secure-next-auth.session-token';

function buildCookieHeader(cookies) {
  return cookies
    .filter((cookie) => cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function isAllowedLoginUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' &&
      (url.hostname === 'freebuff.com' || url.hostname.endsWith('.freebuff.com'));
  } catch {
    return false;
  }
}

function postCookie({ cookie, port, apiKey, http = nodeHttp }) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return Promise.reject(new RangeError('port must be an integer from 1 to 65535'));
  }

  return new Promise((resolve) => {
    const data = JSON.stringify({ cookie });
    const headers = {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(data),
    };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/tokens/import',
      method: 'POST',
      headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const status = response.statusCode || 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    request.once('error', (error) => {
      resolve({ ok: false, status: 0, body: String(error) });
    });
    request.end(data);
  });
}

function isCompletedLoginUrl(rawUrl) {
  if (!isAllowedLoginUrl(rawUrl)) return false;
  const { pathname } = new URL(rawUrl);
  return /^\/(chat|account|web)(?:\/|$)/.test(pathname);
}

function createLoginController({ BrowserWindow, session, dialog, logger, port, apiKey }) {
  let loginWindow = null;
  let loginSession = null;
  let captureInFlight = false;

  function getLoginSession() {
    if (!loginSession) loginSession = session.fromPartition(LOGIN_PARTITION);
    return loginSession;
  }

  async function captureCookies() {
    const cookies = await getLoginSession().cookies.get({ url: COOKIE_URL });
    const hasSessionCookie = cookies.some((cookie) =>
      cookie.name === SESSION_COOKIE && Boolean(cookie.value)
    );
    if (!hasSessionCookie) {
      return {
        cookieStr: '',
        result: { ok: false, status: 0, body: 'No Freebuff session cookie was found.' },
      };
    }

    const cookieStr = buildCookieHeader(cookies);
    const result = await postCookie({ cookie: cookieStr, port, apiKey });
    return { cookieStr, result };
  }

  function failureDialog(result) {
    if (result.body === 'No Freebuff session cookie was found.') {
      return {
        type: 'warning',
        title: 'Login not complete',
        message: 'No Freebuff session cookie was found.',
        detail: 'Complete the login in this window. Cookie capture will run again after Freebuff opens /chat, /account, or /web.',
        buttons: ['Continue Waiting'],
      };
    }
    if (result.status === 0) {
      return {
        type: 'error',
        title: 'Gateway unavailable',
        message: 'The Freebuff session cookie could not be imported.',
        detail: `The local gateway at 127.0.0.1:${port} did not respond. ${result.body}`,
        buttons: ['Continue Waiting'],
      };
    }
    return {
      type: 'error',
      title: 'Cookie import rejected',
      message: 'The local gateway rejected the Freebuff session cookie.',
      detail: `HTTP ${result.status}: ${result.body}`,
      buttons: ['Continue Waiting'],
    };
  }

  async function captureAfterNavigation(window) {
    if (captureInFlight) return;
    captureInFlight = true;
    try {
      const { result } = await captureCookies();
      if (!result.ok) {
        logger.error('Freebuff cookie import failed', {
          status: result.status,
        });
        await dialog.showMessageBox(window, failureDialog(result));
        return;
      }

      logger.info('Freebuff cookie import succeeded');
      if (loginWindow === window) window.close();
    } catch (error) {
      logger.error('Freebuff cookie capture failed', error);
      await dialog.showMessageBox(window, {
        type: 'error',
        title: 'Cookie capture failed',
        message: 'The Freebuff session cookie could not be read.',
        detail: String(error),
        buttons: ['Continue Waiting'],
      });
    } finally {
      captureInFlight = false;
    }
  }

  function openLoginWindow() {
    if (loginWindow) {
      loginWindow.show();
      return loginWindow;
    }

    const persistentSession = getLoginSession();
    const window = new BrowserWindow({
      width: 1000,
      height: 720,
      title: 'Freebuff Login',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: persistentSession,
        partition: LOGIN_PARTITION,
      },
    });
    loginWindow = window;

    const blockDisallowedNavigation = (event, url) => {
      if (!isAllowedLoginUrl(url)) event.preventDefault();
    };
    window.webContents.on('will-navigate', blockDisallowedNavigation);
    window.webContents.on('will-redirect', blockDisallowedNavigation);
    window.webContents.setWindowOpenHandler(({ url }) => ({
      action: isAllowedLoginUrl(url) ? 'allow' : 'deny',
    }));
    window.webContents.on('did-navigate', (_event, url) => {
      if (isCompletedLoginUrl(url)) void captureAfterNavigation(window);
    });
    window.on('closed', () => {
      if (loginWindow === window) loginWindow = null;
    });
    window.loadURL(LOGIN_URL);
    return window;
  }

  return { openLoginWindow, captureCookies };
}

module.exports = {
  buildCookieHeader,
  createLoginController,
  isAllowedLoginUrl,
  postCookie,
};
