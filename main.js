/**
 * @file main.js
 * @description Electron main process for Nova Client - Minecraft Launcher.
 *              Handles window management, Microsoft authentication, Minecraft
 *              game launching, version fetching, and IPC communication with
 *              the renderer process.
 */

const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { Auth } = require('msmc');
const { Client } = require('minecraft-launcher-core');

/** @type {Client} Minecraft launcher core instance */
const launcher = new Client();

/** @type {Auth} Microsoft authentication manager with account selection prompt */
const authManager = new Auth('select_account');

/** @type {BrowserWindow|null} Main application window reference */
let mainWindow;

/** @type {ChildProcess|null} Running Minecraft game process reference */
let gameProcess = null;

/**
 * Game data directory path.
 * Located at %APPDATA%/.nova-client on Windows.
 * @type {string}
 */
const GAME_DIR = path.join(app.getPath('appData'), '.nova-client');
fs.ensureDirSync(GAME_DIR);

/** Settings file path for session persistence */
const SETTINGS_FILE = path.join(GAME_DIR, 'settings.json');

/**
 * Derive an encryption key from machine-specific data.
 * Not unbreakable, but prevents casual file-copy credential theft.
 */
function getEncryptionKey() {
  const os = require('os');
  const seed = `nova-${os.hostname()}-${os.userInfo().username}-${GAME_DIR}`;
  return crypto.createHash('sha256').update(seed).digest();
}

const ENCRYPT_ALGO = 'aes-256-gcm';

function encryptToken(plaintext) {
  if (!plaintext) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPT_ALGO, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decryptToken(ciphertext) {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext;
  try {
    const key = getEncryptionKey();
    const [ivHex, tagHex, encrypted] = ciphertext.split(':');
    const decipher = crypto.createDecipheriv(ENCRYPT_ALGO, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return null; // Corrupted or wrong machine — force re-login
  }
}

function loadSettings() {
  try {
    if (fs.pathExistsSync(SETTINGS_FILE)) {
      const data = fs.readJsonSync(SETTINGS_FILE);
      // Decrypt sensitive fields
      if (data.profile && data.profile.accessToken) {
        data.profile.accessToken = decryptToken(data.profile.accessToken);
        if (!data.profile.accessToken) {
          // Decryption failed (different machine?) — clear profile
          delete data.profile;
        }
      }
      return data;
    }
  } catch (e) { /* ignore corrupt file */ }
  return {};
}

function saveSettings(data) {
  try {
    const current = loadSettings();
    const merged = { ...current, ...data };
    // Encrypt sensitive fields before writing
    const toSave = JSON.parse(JSON.stringify(merged));
    if (toSave.profile && toSave.profile.accessToken) {
      toSave.profile.accessToken = encryptToken(toSave.profile.accessToken);
    }
    fs.writeJsonSync(SETTINGS_FILE, toSave, { spaces: 2 });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Creates the main application window with frameless dark theme.
 * Window is 900x600 with context isolation enabled for security.
 * The window is hidden until ready to prevent white flash on startup.
 */
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
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // CSP headers for security — allow required external APIs and CDNs
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
        ]
      }
    });
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- Window controls ----
/** IPC handlers for frameless window controls (minimize, maximize/restore, close) */
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => app.quit());

/**
 * Handles offline/crack login. Creates a fake profile with a random UUID.
 * Allows playing on cracked servers without a Microsoft account.
 * @param {Electron.IpcMainInvokeEvent} event - IPC event
 * @param {string} username - Player display name chosen by the user
 * @returns {Promise<{success: boolean, profile?: Object, error?: string}>}
 */
ipcMain.handle('auth:offline', async (event, username) => {
  if (!username || username.trim().length < 3) {
    return { success: false, error: 'Tên phải có ít nhất 3 ký tự!' };
  }
  const trimmed = username.trim();
  if (trimmed.length > 16) {
    return { success: false, error: 'Tên tối đa 16 ký tự!' };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return { success: false, error: 'Tên chỉ được chứa a-z, 0-9, _ !' };
  }
  const uuid = crypto.randomUUID();
  const profile = {
    name: trimmed,
    uuid: uuid,
    accessToken: uuid,
    userType: 'legacy'
  };
  return { success: true, profile };
});

/**
 * Handles Microsoft authentication via MSMC library.
 * Opens an Electron browser window for Microsoft OAuth login,
 * then exchanges the Xbox token for a Minecraft access token.
 * @returns {Promise<{success: boolean, profile?: {name: string, uuid: string, accessToken: string, userType: string}, error?: string}>}
 */
ipcMain.handle('auth:login', async () => {
  try {
    const xboxManager = await authManager.launch('electron');
    const token = await xboxManager.getMinecraft();
    const profile = {
      name: token.profile.name,
      uuid: token.profile.id,
      accessToken: token.mclc().token,
      userType: 'msa'
    };
    return { success: true, profile };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Auto-detect Java installation path.
 * Checks JAVA_HOME, common paths, and system PATH.
 * @returns {Promise<string>} Java executable path
 */
async function findJavaPath() {
  const { execFile } = require('child_process');

  // 1. Check JAVA_HOME
  if (process.env.JAVA_HOME) {
    const javaHome = process.env.JAVA_HOME;
    const javaBin = process.platform === 'win32'
      ? path.join(javaHome, 'bin', 'javaw.exe')
      : path.join(javaHome, 'bin', 'java');
    if (await fs.pathExists(javaBin)) return javaBin;
  }

  // 2. Check common paths
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Java'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Java'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs\\Eclipse Adoptium'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Eclipse Adoptium'),
  ] : [
    '/usr/lib/jvm',
    '/usr/local/lib/jvm',
    '/Library/Java/JavaVirtualMachines',
  ];

  for (const dir of candidates) {
    if (!await fs.pathExists(dir)) continue;
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries.sort().reverse()) {
        const javaBin = process.platform === 'win32'
          ? path.join(dir, entry, 'bin', 'javaw.exe')
          : path.join(dir, entry, 'bin', 'java');
        // Also check nested Contents/Home for macOS
        const javaBinMac = path.join(dir, entry, 'Contents', 'Home', 'bin', 'java');
        if (await fs.pathExists(javaBin)) return javaBin;
        if (process.platform === 'darwin' && await fs.pathExists(javaBinMac)) return javaBinMac;
      }
    } catch (e) { /* ignore */ }
  }

  // 3. Check system PATH via which/where
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const target = process.platform === 'win32' ? 'javaw' : 'java';
  try {
    const result = await new Promise((resolve, reject) => {
      execFile(cmd, [target], (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim().split('\n')[0].trim());
      });
    });
    if (result) return result;
  } catch (e) { /* not found */ }

  // 4. Auto-download Java from Adoptium if not found
  mainWindow?.webContents.send('game:log', '[Nova] Java không tìm thấy, đang tải từ Adoptium...');
  try {
    const javaDir = await downloadAdoptiumJava();
    if (javaDir) return javaDir;
  } catch (e) {
    mainWindow?.webContents.send('game:log', '[Nova] Tải Java thất bại: ' + e.message);
  }

  // 5. Final fallback
  return process.platform === 'win32' ? 'javaw' : 'java';
}

/**
 * Download Java runtime from Adoptium API.
 * Caches in GAME_DIR/java-runtime/<version>/
 * @returns {Promise<string|null>} Path to java binary, or null on failure
 */
async function downloadAdoptiumJava() {
  const fetch = require('node-fetch');
  const AdmZip = require('adm-zip');
  const javaVersion = '21'; // LTS
  const javaBaseDir = path.join(GAME_DIR, 'java-runtime');
  await fs.ensureDir(javaBaseDir);

  // Check if already downloaded
  try {
    const existing = await fs.readdir(javaBaseDir);
    for (const dir of existing) {
      const javaBin = process.platform === 'win32'
        ? path.join(javaBaseDir, dir, 'bin', 'javaw.exe')
        : path.join(javaBaseDir, dir, 'bin', 'java');
      if (await fs.pathExists(javaBin)) return javaBin;
    }
  } catch (e) { /* continue to download */ }

  const osMap = { win32: 'windows', darwin: 'mac', linux: 'linux' };
  const archMap = { x64: 'x64', arm64: 'aarch64', ia32: 'x32' };
  const os = osMap[process.platform] || 'linux';
  const arch = archMap[process.arch] || 'x64';
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz';

  mainWindow?.webContents.send('game:progress', { type: 'java', task: 0, total: 100 });
  mainWindow?.webContents.send('game:log', `[Nova] Đang tải Java ${javaVersion} (${os}-${arch})...`);

  const apiUrl = `https://api.adoptium.net/v3/binary/latest/${javaVersion}/ga/${os}/${arch}/jre/hotspot/normal/eclipse?project=jdk`;
  const res = await fetch(apiUrl, {
    headers: { 'User-Agent': 'NovaClient/' + CURRENT_VERSION },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`Adoptium API HTTP ${res.status}`);

  const archivePath = path.join(app.getPath('temp'), `java-${javaVersion}.${ext}`);
  const contentLength = parseInt(res.headers.get('content-length') || '0');
  const fileStream = fs.createWriteStream(archivePath);
  let downloaded = 0;

  await new Promise((resolve, reject) => {
    res.body.on('data', (chunk) => {
      downloaded += chunk.length;
      if (contentLength > 0) {
        const pct = Math.round((downloaded / contentLength) * 100);
        mainWindow?.webContents.send('game:progress', { type: 'java', task: pct, total: 100 });
        mainWindow?.webContents.send('game:log', `[Nova] Tải Java: ${(downloaded / 1024 / 1024).toFixed(1)}MB / ${(contentLength / 1024 / 1024).toFixed(1)}MB`);
      }
    });
    res.body.pipe(fileStream);
    res.body.on('error', reject);
    fileStream.on('finish', resolve);
  });

  mainWindow?.webContents.send('game:log', '[Nova] Đang giải nén Java...');

  // Extract
  if (ext === 'zip') {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(javaBaseDir, true);
  } else {
    // tar.gz — use tar command
    const { execFile } = require('child_process');
    await new Promise((resolve, reject) => {
      execFile('tar', ['xzf', archivePath, '-C', javaBaseDir], (err) => {
        if (err) reject(new Error('Giải nén Java thất bại: ' + err.message));
        else resolve();
      });
    });
  }
  await fs.remove(archivePath);

  // Find the extracted java binary
  const dirs = await fs.readdir(javaBaseDir);
  for (const dir of dirs) {
    const javaBin = process.platform === 'win32'
      ? path.join(javaBaseDir, dir, 'bin', 'javaw.exe')
      : path.join(javaBaseDir, dir, 'bin', 'java');
    if (await fs.pathExists(javaBin)) {
      mainWindow?.webContents.send('game:log', `[Nova] Java đã cài: ${javaBin}`);
      return javaBin;
    }
  }
  return null;
}

/**
 * Launches Minecraft with the specified configuration.
 * Downloads required assets, libraries, and game files automatically via minecraft-launcher-core.
 * Sends progress, log, error, and close events back to the renderer process.
 *
 * @param {Electron.IpcMainInvokeEvent} event - IPC event
 * @param {Object} params - Launch parameters
 * @param {string} params.version - Minecraft version to launch (e.g., "1.21.4")
 * @param {Object} params.profile - Authenticated player profile
 * @param {string} params.profile.accessToken - Minecraft access token
 * @param {string} params.profile.uuid - Player UUID
 * @param {string} params.profile.name - Player display name
 * @param {string} params.ram - Maximum RAM allocation (e.g., "4G")
 * @param {string|null} params.server - Optional server address to auto-connect (host:port)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
ipcMain.handle('game:launch', async (event, { version, profile, ram, server }) => {
  if (gameProcess) {
    return { success: false, error: 'Game đang chạy rồi!' };
  }

  const javaPath = await findJavaPath();

  const opts = {
    authorization: {
      access_token: profile.accessToken,
      client_token: profile.uuid,
      uuid: profile.uuid,
      name: profile.name,
      user_properties: '{}',
      meta: { type: profile.userType === 'legacy' ? 'mojang' : 'msa', xuid: profile.uuid }
    },
    root: GAME_DIR,
    version: {
      number: version,
      type: 'release'
    },
    memory: {
      max: ram,
      min: '1G'
    },
    javaPath,
    // Nếu có server thì tự kết nối
    ...(server ? {
      server: {
        host: server.split(':')[0],
        port: parseInt(server.split(':')[1] || 25565)
      }
    } : {})
  };

  return new Promise((resolve) => {
    // Remove all listeners before re-registering (safe because we re-register all events below)
    launcher.removeAllListeners();

    launcher.on('debug', (msg) => {
      mainWindow?.webContents.send('game:log', msg);
    });

    launcher.on('data', (msg) => {
      mainWindow?.webContents.send('game:log', msg);
    });

    launcher.on('progress', (data) => {
      mainWindow?.webContents.send('game:progress', {
        type: data.type,
        task: data.task,
        total: data.total
      });
    });

    launcher.on('close', (code) => {
      gameProcess = null;
      mainWindow?.webContents.send('game:closed', code);
    });

    launcher.on('error', (err) => {
      gameProcess = null;
      mainWindow?.webContents.send('game:error', err.message);
    });

    launcher.launch(opts).then((proc) => {
      gameProcess = proc;
      resolve({ success: true });
    }).catch((err) => {
      resolve({ success: false, error: err.message });
    });
  });
});

/**
 * Kills the currently running Minecraft game process.
 * @returns {Promise<{success: boolean}>}
 */
ipcMain.handle('game:kill', async () => {
  if (gameProcess) {
    gameProcess.kill();
    gameProcess = null;
  }
  return { success: true };
});

/**
 * Fetches the list of available Minecraft release versions from Mojang's API.
 * Returns the latest 20 release versions. Falls back to a hardcoded list
 * of popular versions (1.16.5 - 1.21.4) if the API request fails.
 * @returns {Promise<{success: boolean, versions: Array<{id: string, type: string}>}>}
 */
ipcMain.handle('versions:list', async () => {
  const fetch = require('node-fetch');
  try {
    const res = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json', { timeout: 10000 });
    const data = await res.json();
    const versions = data.versions
      .filter(v => v.type === 'release')
      .map(v => ({ id: v.id, type: v.type }));
    return { success: true, versions };
  } catch (e) {
    return {
      success: true,
      versions: [
        { id: '1.26.1', type: 'release' },
        { id: '1.26', type: 'release' },
        { id: '1.25.4', type: 'release' },
        { id: '1.25.3', type: 'release' },
        { id: '1.25.2', type: 'release' },
        { id: '1.25.1', type: 'release' },
        { id: '1.25', type: 'release' },
        { id: '1.24.4', type: 'release' },
        { id: '1.24.3', type: 'release' },
        { id: '1.24.2', type: 'release' },
        { id: '1.24.1', type: 'release' },
        { id: '1.24', type: 'release' },
        { id: '1.23.4', type: 'release' },
        { id: '1.23.3', type: 'release' },
        { id: '1.23.2', type: 'release' },
        { id: '1.23.1', type: 'release' },
        { id: '1.23', type: 'release' },
        { id: '1.22.4', type: 'release' },
        { id: '1.22.3', type: 'release' },
        { id: '1.22.2', type: 'release' },
        { id: '1.22.1', type: 'release' },
        { id: '1.22', type: 'release' },
        { id: '1.21.4', type: 'release' },
        { id: '1.21.3', type: 'release' },
        { id: '1.21.2', type: 'release' },
        { id: '1.21.1', type: 'release' },
        { id: '1.21', type: 'release' },
        { id: '1.20.4', type: 'release' },
        { id: '1.20.1', type: 'release' },
        { id: '1.19.4', type: 'release' },
        { id: '1.18.2', type: 'release' },
        { id: '1.17.1', type: 'release' },
        { id: '1.16.5', type: 'release' },
        { id: '1.12.2', type: 'release' },
        { id: '1.8.9', type: 'release' },
        { id: '1.7.10', type: 'release' },
      ]
    };
  }
});

/**
 * Opens the game data directory in the system file explorer.
 * Directory: %APPDATA%/.nova-client
 */
ipcMain.on('folder:open', () => {
  shell.openPath(GAME_DIR);
});

// ---- Settings persistence ----
ipcMain.handle('settings:load', async () => {
  return { success: true, settings: loadSettings() };
});

ipcMain.handle('settings:save', async (event, data) => {
  return { success: saveSettings(data) };
});

// ---- Auto-Update System ----
// Flow: Launcher khởi động → đọc version.json trên GitHub → so sánh version
//       → có bản mới → tải zip → giải nén đè file cũ → restart
// Không có mạng → bỏ qua, không báo lỗi

const GITHUB_OWNER = 'ngoclong0c';
const GITHUB_REPO = 'nova-client';
const CURRENT_VERSION = require('./package.json').version;

/** Thư mục tạm để tải + giải nén update */
const UPDATE_DIR = path.join(app.getPath('temp'), 'nova-client-update');

/**
 * So sánh 2 version string (semver).
 * @returns {number} 1 nếu a > b, -1 nếu a < b, 0 nếu bằng
 */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * URL file version.json trên GitHub — launcher đọc file này để check update.
 * File này được cập nhật bằng script Python: python server/version_server.py 0.2.0
 */
const VERSION_JSON_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/version.json`;

/**
 * Check update: đọc version.json trên GitHub, fallback GitHub releases API.
 * Không có mạng → trả hasUpdate: false, không báo lỗi.
 */
ipcMain.handle('update:check', async () => {
  const fetch = require('node-fetch');

  // --- Cách 1: Đọc version.json trên GitHub (nhanh, không bị rate limit) ---
  try {
    const res = await fetch(VERSION_JSON_URL, {
      headers: { 'User-Agent': 'NovaClient/' + CURRENT_VERSION },
      timeout: 5000
    });
    if (res.ok) {
      const vData = await res.json();
      const latestVersion = vData.latest_version;
      if (compareVersions(latestVersion, CURRENT_VERSION) > 0) {
        return {
          hasUpdate: true,
          currentVersion: CURRENT_VERSION,
          latestVersion,
          downloadUrl: vData.download_url,
          sha256: vData.sha256 || null,
          releaseNotes: vData.release_notes || 'Phiên bản mới!',
          releaseDate: vData.release_date,
          files: vData.files,
          source: 'version.json'
        };
      }
      return { hasUpdate: false, currentVersion: CURRENT_VERSION, latestVersion, source: 'version.json' };
    }
  } catch (e) { /* fallback */ }

  // --- Cách 2: Fallback GitHub releases API ---
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'NovaClient/' + CURRENT_VERSION },
      timeout: 8000
    });

    if (res.status === 404) {
      return { hasUpdate: false, currentVersion: CURRENT_VERSION };
    }

    const data = await res.json();
    const latestVersion = data.tag_name.replace(/^v/, '');

    if (compareVersions(latestVersion, CURRENT_VERSION) > 0) {
      const zipAsset = data.assets.find(a => a.name.endsWith('.zip'));
      return {
        hasUpdate: true,
        currentVersion: CURRENT_VERSION,
        latestVersion,
        downloadUrl: zipAsset ? zipAsset.browser_download_url : null,
        releaseNotes: data.body || 'Phiên bản mới!',
        fileSize: zipAsset ? zipAsset.size : 0,
        fileName: zipAsset ? zipAsset.name : null,
        source: 'github-api'
      };
    }

    return { hasUpdate: false, currentVersion: CURRENT_VERSION, latestVersion, source: 'github-api' };
  } catch (e) { /* không có mạng → bỏ qua */ }

  // Không có mạng → bỏ qua, không báo lỗi
  return { hasUpdate: false, currentVersion: CURRENT_VERSION };
});

/**
 * Tải update zip từ GitHub → giải nén → ghi đè file cũ → restart app.
 * @param {Electron.IpcMainInvokeEvent} event
 * @param {string} downloadUrl - URL file zip từ GitHub release
 * @returns {Promise<Object>}
 */
ipcMain.handle('update:downloadAndInstall', async (event, { downloadUrl, expectedSha256 }) => {
  const fetch = require('node-fetch');
  try {
    // Bước 1: Tải file zip
    mainWindow?.webContents.send('update:progress', { step: 'download', percent: 0, text: 'Đang tải bản cập nhật...' });

    const res = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'NovaClient/' + CURRENT_VERSION },
      redirect: 'follow'
    });
    if (!res.ok) throw new Error('Tải thất bại: HTTP ' + res.status);

    const contentLength = parseInt(res.headers.get('content-length') || '0');
    const zipPath = path.join(app.getPath('temp'), 'nova-client-update.zip');

    // Tải với progress
    const fileStream = fs.createWriteStream(zipPath);
    let downloaded = 0;

    await new Promise((resolve, reject) => {
      res.body.on('data', (chunk) => {
        downloaded += chunk.length;
        if (contentLength > 0) {
          const percent = Math.round((downloaded / contentLength) * 100);
          mainWindow?.webContents.send('update:progress', {
            step: 'download',
            percent,
            text: `Đang tải: ${(downloaded / 1024 / 1024).toFixed(1)}MB / ${(contentLength / 1024 / 1024).toFixed(1)}MB`
          });
        }
      });
      res.body.pipe(fileStream);
      res.body.on('error', reject);
      fileStream.on('finish', resolve);
    });

    // Bước 1.5: Verify SHA256 checksum
    if (expectedSha256) {
      mainWindow?.webContents.send('update:progress', { step: 'verify', percent: 45, text: 'Đang xác minh checksum...' });
      const fileBuffer = await fs.readFile(zipPath);
      const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      if (actualHash !== expectedSha256) {
        await fs.remove(zipPath);
        throw new Error(`Checksum không khớp! Expected: ${expectedSha256.substring(0, 16)}... Got: ${actualHash.substring(0, 16)}...`);
      }
    }

    // Bước 2: Giải nén zip
    mainWindow?.webContents.send('update:progress', { step: 'extract', percent: 50, text: 'Đang giải nén...' });

    // Dọn thư mục tạm cũ
    await fs.remove(UPDATE_DIR);
    await fs.ensureDir(UPDATE_DIR);

    // Giải nén bằng Node.js (đọc zip thủ công)
    await extractZip(zipPath, UPDATE_DIR);

    // Bước 3: Copy file mới đè lên file cũ
    mainWindow?.webContents.send('update:progress', { step: 'install', percent: 80, text: 'Đang cài đặt...' });

    const appDir = path.dirname(require.main.filename);
    const updateFiles = ['main.js', 'preload.js', 'index.html', 'package.json'];

    // Atomic update: copy to .tmp first, then rename to avoid corruption on crash
    for (const file of updateFiles) {
      const srcFile = path.join(UPDATE_DIR, file);
      const destFile = path.join(appDir, file);
      const tmpFile = destFile + '.tmp';
      if (await fs.pathExists(srcFile)) {
        await fs.copy(srcFile, tmpFile, { overwrite: true });
        await fs.rename(tmpFile, destFile);
      }
    }

    // Copy fabric-mod/ nếu có
    const fabricSrc = path.join(UPDATE_DIR, 'fabric-mod');
    if (await fs.pathExists(fabricSrc)) {
      await fs.copy(fabricSrc, path.join(appDir, 'fabric-mod'), { overwrite: true });
    }

    // Bước 4: Dọn file tạm
    await fs.remove(zipPath);
    await fs.remove(UPDATE_DIR);

    mainWindow?.webContents.send('update:progress', { step: 'done', percent: 100, text: 'Cập nhật xong! Đang khởi động lại...' });

    // Bước 5: Restart app
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 1500);

    return { success: true };
  } catch (err) {
    mainWindow?.webContents.send('update:progress', { step: 'error', percent: 0, text: 'Lỗi: ' + err.message });
    return { success: false, error: err.message };
  }
});

/**
 * Giải nén file zip vào thư mục đích bằng adm-zip (pure JS, cross-platform).
 * Không phụ thuộc binary hệ thống (unzip/powershell).
 */
async function extractZip(zipPath, destDir) {
  const AdmZip = require('adm-zip');
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destDir, true);
  } catch (err) {
    throw new Error('Giải nén thất bại: ' + err.message);
  }
}

/**
 * Lấy version hiện tại của app.
 */
ipcMain.handle('update:getVersion', async () => {
  return { version: CURRENT_VERSION };
});

/**
 * Mở trang GitHub releases.
 */
ipcMain.handle('update:openReleasePage', async () => {
  shell.openExternal(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`);
  return { success: true };
});

// ---- Fabric Loader Auto-Install ----

/**
 * Install Fabric Loader for a given Minecraft version.
 * Uses Fabric Meta API to download the version profile JSON.
 * @param {string} gameVersion - MC version (e.g. "1.21.4")
 * @returns {Promise<{success: boolean, versionId?: string, error?: string}>}
 */
ipcMain.handle('fabric:install', async (event, gameVersion) => {
  const fetch = require('node-fetch');
  try {
    mainWindow?.webContents.send('fabric:progress', { step: 'checking', text: 'Kiểm tra Fabric Loader...' });

    // 1. Get latest loader version from Fabric Meta API
    const loaderRes = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${gameVersion}`, {
      headers: { 'User-Agent': 'NovaClient/' + CURRENT_VERSION },
      timeout: 10000
    });
    if (!loaderRes.ok) {
      return { success: false, error: `Fabric không hỗ trợ MC ${gameVersion}` };
    }
    const loaders = await loaderRes.json();
    if (!loaders.length) {
      return { success: false, error: `Không tìm thấy Fabric Loader cho MC ${gameVersion}` };
    }

    const latestLoader = loaders[0];
    const loaderVersion = latestLoader.loader.version;
    const fabricVersionId = `fabric-loader-${loaderVersion}-${gameVersion}`;

    // 2. Check if already installed
    const versionDir = path.join(GAME_DIR, 'versions', fabricVersionId);
    const profileJson = path.join(versionDir, `${fabricVersionId}.json`);
    if (await fs.pathExists(profileJson)) {
      return { success: true, versionId: fabricVersionId, message: 'Đã cài sẵn' };
    }

    mainWindow?.webContents.send('fabric:progress', { step: 'downloading', text: `Đang tải Fabric Loader ${loaderVersion}...` });

    // 3. Download the version profile JSON from Fabric Meta
    const profileRes = await fetch(
      `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${loaderVersion}/profile/json`,
      { headers: { 'User-Agent': 'NovaClient/' + CURRENT_VERSION }, timeout: 10000 }
    );
    if (!profileRes.ok) {
      return { success: false, error: 'Không tải được Fabric profile' };
    }
    const profileData = await profileRes.json();

    // 4. Validate profile has required fields
    if (!profileData.mainClass) {
      return { success: false, error: 'Fabric profile thiếu mainClass — profile không hợp lệ' };
    }
    if (!profileData.libraries || !profileData.libraries.length) {
      return { success: false, error: 'Fabric profile thiếu libraries — profile không hợp lệ' };
    }

    // 5. Save profile JSON to versions directory
    await fs.ensureDir(versionDir);
    await fs.writeJson(profileJson, profileData, { spaces: 2 });

    // 6. Download Fabric libraries
    mainWindow?.webContents.send('fabric:progress', { step: 'libraries', text: 'Đang tải Fabric libraries...' });
    const libsDir = path.join(GAME_DIR, 'libraries');
    await fs.ensureDir(libsDir);

    for (const lib of profileData.libraries) {
      if (!lib.url && !lib.name) continue;
      // Maven coordinate: group:artifact:version
      const parts = lib.name.split(':');
      if (parts.length < 3) continue;
      const [group, artifact, ver] = parts;
      const groupPath = group.replace(/\./g, '/');
      const jarName = `${artifact}-${ver}.jar`;
      const libPath = path.join(libsDir, groupPath, artifact, ver, jarName);

      if (await fs.pathExists(libPath)) continue; // Already downloaded

      const mavenUrl = (lib.url || 'https://maven.fabricmc.net/') + `${groupPath}/${artifact}/${ver}/${jarName}`;
      try {
        const libRes = await fetch(mavenUrl, {
          headers: { 'User-Agent': 'NovaClient/' + CURRENT_VERSION },
          timeout: 15000
        });
        if (libRes.ok) {
          await fs.ensureDir(path.dirname(libPath));
          const buffer = await libRes.buffer();
          await fs.writeFile(libPath, buffer);
        }
      } catch (e) {
        // Non-fatal: minecraft-launcher-core may download missing libs
        mainWindow?.webContents.send('game:log', `[Fabric] Không tải được: ${jarName}`);
      }
    }

    mainWindow?.webContents.send('fabric:progress', { step: 'done', text: `Fabric Loader ${loaderVersion} đã cài!` });

    return { success: true, versionId: fabricVersionId, loaderVersion };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Check available Fabric Loader versions for a MC version.
 */
ipcMain.handle('fabric:check', async (event, gameVersion) => {
  const fetch = require('node-fetch');
  try {
    const res = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${gameVersion}`, {
      headers: { 'User-Agent': 'NovaClient/' + CURRENT_VERSION },
      timeout: 5000
    });
    if (!res.ok) return { available: false };
    const loaders = await res.json();
    if (!loaders.length) return { available: false };
    return {
      available: true,
      loaderVersion: loaders[0].loader.version,
      versionId: `fabric-loader-${loaders[0].loader.version}-${gameVersion}`
    };
  } catch (e) {
    return { available: false };
  }
});

// ---- Mod Manager (Modrinth API) ----

const MODRINTH_API = 'https://api.modrinth.com/v2';
const MODRINTH_HEADERS = { 'User-Agent': `NovaClient/${CURRENT_VERSION} (github.com/${GITHUB_OWNER}/${GITHUB_REPO})` };

/** Thư mục mods trong game dir */
const MODS_DIR = path.join(GAME_DIR, 'mods');
fs.ensureDirSync(MODS_DIR);

/**
 * Danh sách mod mặc định — dùng Modrinth slug thật.
 * source: 'modrinth' = tải từ Modrinth API, 'github' = tải từ GitHub releases
 */
const DEFAULT_MOD_CONFIG = {
  branches: ['Nextgen', 'Stable'],
  builds: ['Latest', 'Recommended'],
  recommended_mods: [
    {
      name: 'Baritone',
      slug: 'baritone',
      source: 'github',
      github_repo: 'cabaletta/baritone',
      description: 'AI pathfinding tự động',
      default_enabled: true
    },
    {
      name: 'Cloth Config API',
      slug: 'cloth-config2',
      source: 'modrinth',
      description: 'Thư viện config cho mod',
      default_enabled: false
    },
    {
      name: 'ImmediatelyFast',
      slug: 'immediatelyfast',
      source: 'modrinth',
      description: 'Tối ưu render, tăng FPS',
      default_enabled: true
    },
    {
      name: 'Lithium',
      slug: 'lithium',
      source: 'modrinth',
      description: 'Tối ưu logic server/client',
      default_enabled: true
    },
    {
      name: 'Sodium Extra',
      slug: 'sodium-extra',
      source: 'modrinth',
      description: 'Thêm tuỳ chỉnh đồ hoạ',
      default_enabled: false
    },
    {
      name: 'Mod Menu',
      slug: 'modmenu',
      source: 'modrinth',
      description: 'Menu quản lý mod in-game',
      default_enabled: true
    }
  ],
  additional_mods: [
    {
      name: 'Fabric API',
      slug: 'fabric-api',
      source: 'modrinth',
      description: 'Thư viện nền tảng Fabric',
      default_enabled: true
    },
    {
      name: 'Iris Shaders',
      slug: 'iris',
      source: 'modrinth',
      description: 'Hỗ trợ shader packs',
      default_enabled: true
    },
    {
      name: 'Sodium',
      slug: 'sodium',
      source: 'modrinth',
      description: 'Tối ưu render, thay OptiFine',
      default_enabled: true
    }
  ]
};

/**
 * Gọi Modrinth API lấy version mới nhất cho 1 mod theo MC version + loader.
 * @param {string} slug - Modrinth project slug (vd: 'sodium', 'fabric-api')
 * @param {string} gameVersion - Phiên bản MC (vd: '1.21.4')
 * @param {string} loader - Mod loader (vd: 'fabric')
 * @returns {Promise<{filename: string, url: string, version: string}|null>}
 */
async function getModrinthVersion(slug, gameVersion, loader) {
  const fetch = require('node-fetch');
  const params = new URLSearchParams({
    loaders: JSON.stringify([loader]),
    game_versions: JSON.stringify([gameVersion])
  });
  const res = await fetch(`${MODRINTH_API}/project/${slug}/version?${params}`, {
    headers: MODRINTH_HEADERS,
    timeout: 8000
  });
  if (!res.ok) return null;
  const versions = await res.json();
  if (!versions.length) return null;

  const latest = versions[0];
  const primaryFile = latest.files.find(f => f.primary) || latest.files[0];
  if (!primaryFile) return null;

  return {
    filename: primaryFile.filename,
    url: primaryFile.url,
    version: latest.version_number,
    size: primaryFile.size,
    sha512: primaryFile.hashes?.sha512 || null
  };
}

/**
 * Gọi GitHub API lấy release mới nhất cho mod từ GitHub.
 * @param {string} repo - GitHub repo (vd: 'cabaletta/baritone')
 * @param {string} gameVersion - MC version để filter asset name
 * @returns {Promise<{filename: string, url: string, version: string}|null>}
 */
async function getGithubRelease(repo, gameVersion) {
  const fetch = require('node-fetch');
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { 'User-Agent': 'NovaClient' },
    timeout: 8000
  });
  if (!res.ok) return null;
  const release = await res.json();

  // Tìm asset chứa 'fabric' trong tên
  const asset = release.assets.find(a =>
    a.name.endsWith('.jar') && a.name.toLowerCase().includes('fabric')
  ) || release.assets.find(a => a.name.endsWith('.jar'));

  if (!asset) return null;

  return {
    filename: asset.name,
    url: asset.browser_download_url,
    version: release.tag_name,
    size: asset.size
  };
}

/**
 * Lấy config mod từ GitHub repo, fallback hardcode.
 * Sau đó resolve download URL thật từ Modrinth/GitHub cho từng mod.
 * @returns {Promise<{success: boolean, config: Object, source: string}>}
 */
ipcMain.handle('mods:getConfig', async () => {
  const fetch = require('node-fetch');
  let config;
  let source = 'offline';

  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/mods-config.json`,
      { headers: { 'User-Agent': 'NovaClient' }, timeout: 5000 }
    );
    if (res.ok) {
      config = await res.json();
      source = 'online';
    } else {
      config = JSON.parse(JSON.stringify(DEFAULT_MOD_CONFIG));
    }
  } catch (e) {
    config = JSON.parse(JSON.stringify(DEFAULT_MOD_CONFIG));
  }

  return { success: true, config, source };
});

/**
 * Resolve download info cho 1 mod từ Modrinth/GitHub API.
 * @param {Electron.IpcMainInvokeEvent} event
 * @param {Object} params
 * @param {string} params.slug - Modrinth slug hoặc tên mod
 * @param {string} params.source - 'modrinth' hoặc 'github'
 * @param {string} params.github_repo - GitHub repo (nếu source = github)
 * @param {string} params.gameVersion - MC version
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
ipcMain.handle('mods:resolve', async (event, { slug, source, github_repo, gameVersion }) => {
  try {
    let result = null;
    if (source === 'modrinth') {
      result = await getModrinthVersion(slug, gameVersion, 'fabric');
      // Thử fallback bỏ minor version (1.21.4 → 1.21)
      if (!result && gameVersion.split('.').length > 2) {
        const major = gameVersion.split('.').slice(0, 2).join('.');
        result = await getModrinthVersion(slug, major, 'fabric');
      }
    } else if (source === 'github' && github_repo) {
      result = await getGithubRelease(github_repo, gameVersion);
    }

    if (result) {
      return { success: true, data: result };
    }
    return { success: false, error: 'Không tìm thấy version phù hợp' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Tìm kiếm mod trên Modrinth.
 * @param {Electron.IpcMainInvokeEvent} event
 * @param {Object} params
 * @param {string} params.query - Từ khoá tìm kiếm
 * @param {string} params.gameVersion - MC version
 * @returns {Promise<{success: boolean, mods: Array}>}
 */
ipcMain.handle('mods:search', async (event, { query, gameVersion }) => {
  const fetch = require('node-fetch');
  try {
    const facets = JSON.stringify([
      ['categories:fabric'],
      [`versions:${gameVersion}`],
      ['project_type:mod']
    ]);
    const params = new URLSearchParams({
      query,
      facets,
      limit: '15'
    });
    const res = await fetch(`${MODRINTH_API}/search?${params}`, {
      headers: MODRINTH_HEADERS,
      timeout: 8000
    });
    if (!res.ok) return { success: false, mods: [] };
    const data = await res.json();

    const mods = data.hits.map(hit => ({
      name: hit.title,
      slug: hit.slug,
      description: hit.description,
      downloads: hit.downloads,
      icon_url: hit.icon_url,
      source: 'modrinth'
    }));

    return { success: true, mods };
  } catch (err) {
    return { success: false, mods: [], error: err.message };
  }
});

/**
 * Lấy danh sách mod đã cài (file .jar trong mods/).
 * @returns {Promise<{success: boolean, mods: string[]}>}
 */
ipcMain.handle('mods:getInstalled', async () => {
  try {
    const files = await fs.readdir(MODS_DIR);
    const jars = files.filter(f => f.endsWith('.jar'));
    return { success: true, mods: jars };
  } catch (e) {
    return { success: true, mods: [] };
  }
});

/**
 * Tải và cài đặt danh sách mod. Resolve URL từ Modrinth API trước khi tải.
 * @param {Electron.IpcMainInvokeEvent} event
 * @param {Object} params
 * @param {Array} params.mods - Danh sách mod cần cài
 * @param {string} params.gameVersion - MC version để resolve đúng file
 * @returns {Promise<{success: boolean, installed: string[], errors: string[]}>}
 */
ipcMain.handle('mods:install', async (event, { mods: modList, gameVersion }) => {
  const fetch = require('node-fetch');
  const installed = [];
  const errors = [];

  for (let i = 0; i < modList.length; i++) {
    const mod = modList[i];
    try {
      mainWindow?.webContents.send('mods:progress', {
        current: i + 1,
        total: modList.length,
        name: mod.name,
        status: 'resolving'
      });

      // 1. Resolve download URL từ Modrinth/GitHub API
      let downloadInfo = null;
      if (mod.source === 'modrinth') {
        downloadInfo = await getModrinthVersion(mod.slug, gameVersion, 'fabric');
        if (!downloadInfo && gameVersion.split('.').length > 2) {
          const major = gameVersion.split('.').slice(0, 2).join('.');
          downloadInfo = await getModrinthVersion(mod.slug, major, 'fabric');
        }
      } else if (mod.source === 'github' && mod.github_repo) {
        downloadInfo = await getGithubRelease(mod.github_repo, gameVersion);
      }

      if (!downloadInfo) {
        errors.push(`${mod.name}: Không tìm thấy bản cho MC ${gameVersion}`);
        continue;
      }

      // 2. Tải file .jar
      mainWindow?.webContents.send('mods:progress', {
        current: i + 1,
        total: modList.length,
        name: mod.name,
        status: 'downloading',
        filename: downloadInfo.filename,
        size: downloadInfo.size
      });

      const res = await fetch(downloadInfo.url, {
        headers: { 'User-Agent': 'NovaClient' },
        redirect: 'follow',
        timeout: 30000
      });

      if (!res.ok) {
        errors.push(`${mod.name}: HTTP ${res.status}`);
        continue;
      }

      // Xoá file cũ cùng slug (nếu update version) — exact match to avoid "sodium" matching "sodium-extra"
      try {
        const existingFiles = await fs.readdir(MODS_DIR);
        const slugLower = mod.slug.toLowerCase();
        for (const f of existingFiles) {
          const fLower = f.toLowerCase();
          if (fLower.endsWith('.jar') && (fLower.startsWith(slugLower + '-') || fLower === slugLower + '.jar')) {
            await fs.remove(path.join(MODS_DIR, f));
          }
        }
      } catch (e) { /* ignore */ }

      const savePath = path.join(MODS_DIR, downloadInfo.filename);
      const fileStream = fs.createWriteStream(savePath);

      const contentLength = parseInt(res.headers.get('content-length') || '0');
      let downloaded = 0;

      await new Promise((resolve, reject) => {
        res.body.on('data', (chunk) => {
          downloaded += chunk.length;
          if (contentLength > 0) {
            mainWindow?.webContents.send('mods:progress', {
              current: i + 1,
              total: modList.length,
              name: mod.name,
              status: 'downloading',
              percent: Math.round((downloaded / contentLength) * 100),
              filename: downloadInfo.filename
            });
          }
        });
        res.body.pipe(fileStream);
        res.body.on('error', reject);
        fileStream.on('finish', resolve);
      });

      // Verify SHA512 hash if available (Modrinth provides this)
      if (downloadInfo.sha512) {
        const modBuffer = await fs.readFile(savePath);
        const actualHash = crypto.createHash('sha512').update(modBuffer).digest('hex');
        if (actualHash !== downloadInfo.sha512) {
          await fs.remove(savePath);
          errors.push(`${mod.name}: Checksum SHA512 không khớp — file có thể bị thay đổi`);
          continue;
        }
      }

      installed.push(downloadInfo.filename);

      mainWindow?.webContents.send('mods:progress', {
        current: i + 1,
        total: modList.length,
        name: mod.name,
        status: 'done',
        filename: downloadInfo.filename
      });
    } catch (err) {
      errors.push(`${mod.name}: ${err.message}`);
    }
  }

  mainWindow?.webContents.send('mods:progress', {
    current: modList.length,
    total: modList.length,
    name: '',
    status: 'complete',
    installed: installed.length,
    errors: errors.length
  });

  return { success: true, installed, errors };
});

/**
 * Xoá một mod khỏi thư mục mods/.
 * @param {Electron.IpcMainInvokeEvent} event
 * @param {string} filename - Tên file .jar cần xoá
 * @returns {Promise<{success: boolean, error?: string}>}
 */
ipcMain.handle('mods:remove', async (event, filename) => {
  try {
    const filePath = path.join(MODS_DIR, filename);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
