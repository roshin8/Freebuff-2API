const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, session, dialog, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { GatewayManager } = require('./gateway');
const { createLoginController, isAllowedLoginUrl } = require('./login');
const { gatewayPath, dataPathDescription } = require('./platform');
const { navigationDecision } = require('./app-policy');

app.setName('Freebuff2API');

let gateway;
let login;
let mainWindow = null;
let tray;
let dashboardOpening = null;
let gatewayStarted = false;
let quitting = false;
let shutdownComplete = false;

function showFailure(title, error) {
  dialog.showErrorBox(title, `${String(error)}\n\nConfiguration: ${gateway.configPath}\nLogs: ${gateway.logPath}`);
}

function runAction(action) {
  void Promise.resolve().then(action).catch((error) => showFailure('Freebuff2API', error));
}

function openExternal(url) {
  const decision = navigationDecision(url, gateway.port());
  if (decision.action === 'external') runAction(() => shell.openExternal(decision.url));
}

function handleExternalNavigation(url) {
  if (isAllowedLoginUrl(url)) login.openLoginWindow();
  else openExternal(url);
}

async function openDashboard() {
  if (quitting) return;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  if (dashboardOpening) return dashboardOpening;
  dashboardOpening = (async () => {
    if (!gatewayStarted) throw new Error('The gateway could not be started. Check the configuration and logs, then restart Freebuff2API.');
    if (!await gateway.waitUntilHealthy(15_000)) {
      throw new Error(`The gateway did not respond within 15 seconds at http://127.0.0.1:${gateway.port()}. Check whether port ${gateway.port()} is occupied and edit listen_addr in the configuration if needed.`);
    }
    if (quitting || mainWindow) return;

    const window = new BrowserWindow({
      width: 1200,
      height: 820,
      title: 'Freebuff2API',
      icon: path.join(__dirname, 'icons', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mainWindow = window;
    const guardNavigation = (event, url) => {
      const decision = navigationDecision(url, gateway.port());
      if (decision.action === 'allow') return;
      event.preventDefault();
      if (decision.action === 'external') handleExternalNavigation(decision.url);
    };
    window.webContents.on('will-navigate', guardNavigation);
    window.webContents.on('will-redirect', guardNavigation);
    window.webContents.setWindowOpenHandler(({ url }) => {
      const decision = navigationDecision(url, gateway.port());
      if (decision.action === 'allow') runAction(() => window.loadURL(url));
      if (decision.action === 'external') handleExternalNavigation(decision.url);
      return { action: 'deny' };
    });
    window.on('closed', () => {
      if (mainWindow === window) mainWindow = null;
    });
    await window.loadURL(`http://127.0.0.1:${gateway.port()}/ui`);
  })();
  try {
    await dashboardOpening;
  } finally {
    dashboardOpening = null;
  }
}

function requireDashboard(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents
    || event.senderFrame !== mainWindow.webContents.mainFrame
    || navigationDecision(event.senderFrame?.url, gateway.port()).action !== 'allow') {
    throw new Error('Login operations are available only to the local dashboard.');
  }
}

function installLoginHandlers() {
  ipcMain.handle('open-login', (event) => {
    requireDashboard(event);
    login.openLoginWindow();
    return { ok: true };
  });
  ipcMain.handle('capture-cookie', (event) => {
    requireDashboard(event);
    return login.captureCookies();
  });
}

async function openPath(target) {
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icons', 'icon.png')).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('Freebuff2API');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => runAction(openDashboard) },
    { label: 'Login New Account', click: () => runAction(() => {
      if (!login) throw new Error('The gateway must start before logging in. Restart Freebuff2API after checking the configuration.');
      login.openLoginWindow();
    }) },
    { type: 'separator' },
    { label: 'Diagnostics', click: () => runAction(async () => {
      const healthy = gatewayStarted && await gateway.waitUntilHealthy(1_000);
      await dialog.showMessageBox({
        type: 'info', title: 'Freebuff2API Diagnostics',
        message: healthy ? 'The gateway is responding.' : 'The gateway is unavailable.',
        detail: `Dashboard: http://127.0.0.1:${gateway.port()}/ui\nConfiguration: ${gateway.configPath}\nLogs: ${gateway.logPath}\n${dataPathDescription(gateway.userDataDir)}`,
        buttons: ['OK'],
      });
    }) },
    { label: 'Open Logs', click: () => runAction(() => openPath(path.dirname(gateway.logPath))) },
    { label: 'Open Configuration', click: () => runAction(() => openPath(gateway.configPath)) },
    { label: 'Open Data Directory', click: () => runAction(() => openPath(gateway.userDataDir)) },
    { type: 'separator' },
    { label: 'Check for Updates', click: () => runAction(() => shell.openExternal('https://github.com/roshin8/Freebuff-2API/releases/latest')) },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('double-click', () => runAction(openDashboard));
}

app.whenReady().then(async () => {
  if (quitting) return;
  const resourcesPath = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'generated');
  gateway = new GatewayManager({ app, spawn, http, fs, resourcesPath, logger: console });
  gateway.on('permanentFailure', (failure) => {
    gatewayStarted = false;
    showFailure('Gateway stopped', `The gateway exceeded its restart limit. Restart Freebuff2API after checking the logs.\n${failure instanceof Error ? failure.message : JSON.stringify(failure)}`);
  });
  createTray();
  fs.accessSync(gatewayPath(resourcesPath), fs.constants.X_OK);
  gateway.start();
  gatewayStarted = true;
  login = createLoginController({
    BrowserWindow, session, dialog, logger: console,
    port: gateway.port(), apiKey: gateway.config?.api_keys?.[0],
  });
  installLoginHandlers();
  await openDashboard();
}).catch((error) => showFailure('Freebuff2API could not start', error));

app.on('activate', () => {
  if (gateway) runAction(openDashboard);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void (async () => {
    try {
      if (gateway) await gateway.stop();
    } catch (error) {
      showFailure('Gateway shutdown failed', error);
    } finally {
      shutdownComplete = true;
      app.quit();
    }
  })();
});
