/**
 * @file main.js
 * @description Electron main process entry point for Nova Client.
 *              Thin orchestrator: creates window, sets CSP, initializes services,
 *              and registers IPC handlers. All business logic lives in src/main/services/.
 */

'use strict';

const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs-extra');

// ---- Utils ----
const log = require('./src/main/utils/logger');
const cryptoUtil = require('./src/main/utils/crypto');

// ---- Services ----
const settingsService = require('./src/main/services/settingsService');
const javaService = require('./src/main/services/javaService');
const launchService = require('./src/main/services/launchService');
const fabricService = require('./src/main/services/fabricService');
const modService = require('./src/main/services/modService');
const updateService = require('./src/main/services/updateService');

// ---- IPC Router ----
const ipcRouter = require('./src/main/ipc');

// ---- Constants ----
const GAME_DIR = path.join(app.getPath('appData'), '.nova-client');
fs.ensureDirSync(GAME_DIR);

const CURRENT_VERSION = require('./package.json').version;

/** @type {BrowserWindow|null} */
let mainWindow = null;

// ---- Initialize all services ----
function initServices() {
  log.init(GAME_DIR);
  cryptoUtil.init(GAME_DIR);
  settingsService.init(GAME_DIR);

  // Helper to send events to renderer safely
  const send = (channel, data) => {
    mainWindow?.webContents.send(channel, data);
  };

  javaService.init({
    gameDir: GAME_DIR,
    currentVersion: CURRENT_VERSION,
    tempDir: app.getPath('temp'),
    sendProgress: (data) => send('game:progress', data),
    sendLog: (msg) => send('game:log', msg),
  });

  launchService.init({
    gameDir: GAME_DIR,
    sendToRenderer: {
      progress: (data) => send('game:progress', data),
      log: (msg) => send('game:log', msg),
      closed: (code) => send('game:closed', code),
      error: (msg) => send('game:error', msg),
    },
  });

  fabricService.init({
    gameDir: GAME_DIR,
    currentVersion: CURRENT_VERSION,
    sendProgress: (data) => send('fabric:progress', data),
    sendLog: (msg) => send('game:log', msg),
  });

  modService.init({
    gameDir: GAME_DIR,
    currentVersion: CURRENT_VERSION,
    sendProgress: (data) => send('mods:progress', data),
  });

  updateService.init({
    currentVersion: CURRENT_VERSION,
    tempDir: app.getPath('temp'),
    appDir: path.dirname(require.main.filename),
    sendProgress: (data) => send('update:progress', data),
    restartApp: () => { app.relaunch(); app.exit(0); },
  });

  log.info(`Services initialized — v${CURRENT_VERSION}`);
}

// ---- Window creation ----
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 860,
    minHeight: 560,
    frame: false,
    transparent: false,
    backgroundColor: '#0d1117',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // CSP headers
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "img-src 'self' data: https:; " +
          "connect-src 'self' https://launchermeta.mojang.com https://piston-meta.mojang.com https://piston-data.mojang.com https://resources.download.minecraft.net " +
          "https://api.modrinth.com https://cdn.modrinth.com " +
          "https://api.github.com https://github.com https://objects.githubusercontent.com https://raw.githubusercontent.com " +
          "https://*.fabricmc.net https://maven.fabricmc.net " +
          "https://api.adoptium.net"
        ],
      },
    });
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---- Window controls (simple IPC, stays in main.js) ----
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => app.quit());
ipcMain.on('folder:open', () => shell.openPath(GAME_DIR));

// ---- App lifecycle ----
app.whenReady().then(() => {
  initServices();
  ipcRouter.register();
  createWindow();
  log.info('App ready');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
