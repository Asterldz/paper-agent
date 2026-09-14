'use strict';

const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { isSafeExternalUrl, isSameOrigin, serverRoot, waitForHttp, waitForServerProcess } = require('./runtime.cjs');

let mainWindow = null;
let serverProcess = null;
let localUrl = null;
let booting = false;

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();

function stopServer() {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  serverProcess = null;
}

async function startLocalServer() {
  if (localUrl && serverProcess && serverProcess.exitCode === null) return localUrl;
  const developmentUrl = !app.isPackaged && process.env.PAPER_AGENT_DEV_URL;
  if (developmentUrl) {
    await waitForHttp(developmentUrl);
    return developmentUrl;
  }
  const root = serverRoot(app);
  const entry = path.join(root, 'server.js');
  // IndexedDB is origin-scoped: changing the port on each launch hides history.
  const port = 43187;
  const url = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, [entry], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const child = serverProcess;
  let startupError;
  child.once('error', (error) => { startupError = error; });
  serverProcess.once('exit', (code) => {
    if (code && mainWindow && !mainWindow.isDestroyed()) {
      void dialog.showMessageBox(mainWindow, { type: 'error', title: 'Paper Agent', message: '本地服务意外停止，请重新启动应用。' });
    }
  });
  await waitForServerProcess(child);
  child.stdout.resume();
  child.stderr.resume();
  await waitForHttp(url, 30_000, async (...args) => {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error('本地端口 43187 被占用或服务启动失败。');
    return fetch(...args);
  });
  localUrl = url;
  return url;
}

function createWindow(appUrl) {
  const origin = new URL(appUrl).origin;
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#f4f1ea',
    title: 'Paper Agent',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url, origin)) { void window.loadURL(url); return { action: 'deny' }; }
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isSameOrigin(url, origin)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
  void window.loadURL(appUrl).catch(showStartupError);
  return window;
}

async function boot() {
  if (booting || !ownsInstance) return;
  booting = true;
  try {
    const appUrl = await startLocalServer();
    mainWindow = createWindow(appUrl);
  } finally { booting = false; }
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});
app.on('before-quit', stopServer);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) void boot().catch(showStartupError); });

function showStartupError(error) {
  dialog.showErrorBox('Paper Agent 启动失败', error instanceof Error ? error.message : String(error));
  app.quit();
}

if (ownsInstance) app.whenReady().then(boot).catch(showStartupError);
