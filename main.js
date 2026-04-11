/**
 * @file main.js
 * @description Electron main process for Nova Client - Minecraft Launcher.
 *              Handles window management, Microsoft authentication, Minecraft
 *              game launching, version fetching, and IPC communication with
 *              the renderer process.
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
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
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
  const profile = {
    name: username.trim(),
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
      min: '512M'
    },
    javaPath: 'javaw',
    // Nếu có server thì tự kết nối
    ...(server ? {
      server: {
        host: server.split(':')[0],
        port: parseInt(server.split(':')[1] || 25565)
      }
    } : {})
  };

  return new Promise((resolve) => {
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
    const res = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json');
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

// ---- Auto-Update System ----
// Flow: Bạn tạo release trên GitHub (tag: v0.1.1, attach file nova-client-0.1.1.zip)
//       → Người chơi mở launcher → check GitHub API → tải zip → giải nén đè file cũ → restart

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
 * Check update từ GitHub releases.
 * @returns {Promise<Object>} hasUpdate, currentVersion, latestVersion, downloadUrl, releaseNotes, fileSize
 */
ipcMain.handle('update:check', async () => {
  const fetch = require('node-fetch');
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'NovaClient/' + CURRENT_VERSION }
    });

    if (res.status === 404) {
      return { hasUpdate: false, currentVersion: CURRENT_VERSION, error: 'Chưa có release nào' };
    }

    const data = await res.json();
    const latestVersion = data.tag_name.replace(/^v/, '');

    if (compareVersions(latestVersion, CURRENT_VERSION) > 0) {
      // Tìm file .zip trong assets
      const zipAsset = data.assets.find(a => a.name.endsWith('.zip'));
      return {
        hasUpdate: true,
        currentVersion: CURRENT_VERSION,
        latestVersion,
        downloadUrl: zipAsset ? zipAsset.browser_download_url : null,
        releaseNotes: data.body || 'Phiên bản mới!',
        fileSize: zipAsset ? zipAsset.size : 0,
        fileName: zipAsset ? zipAsset.name : null
      };
    }

    return { hasUpdate: false, currentVersion: CURRENT_VERSION, latestVersion };
  } catch (err) {
    return { hasUpdate: false, currentVersion: CURRENT_VERSION, error: err.message };
  }
});

/**
 * Tải update zip từ GitHub → giải nén → ghi đè file cũ → restart app.
 * @param {Electron.IpcMainInvokeEvent} event
 * @param {string} downloadUrl - URL file zip từ GitHub release
 * @returns {Promise<Object>}
 */
ipcMain.handle('update:downloadAndInstall', async (event, downloadUrl) => {
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

    for (const file of updateFiles) {
      const srcFile = path.join(UPDATE_DIR, file);
      const destFile = path.join(appDir, file);
      if (await fs.pathExists(srcFile)) {
        await fs.copy(srcFile, destFile, { overwrite: true });
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
 * Giải nén file zip vào thư mục đích (không dùng thư viện ngoài).
 * Dùng unzip command trên Windows hoặc Node.js built-in.
 */
async function extractZip(zipPath, destDir) {
  const { exec } = require('child_process');

  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      // Windows: dùng PowerShell Expand-Archive
      const cmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`;
      exec(cmd, (err) => {
        if (err) reject(new Error('Giải nén thất bại: ' + err.message));
        else resolve();
      });
    } else {
      // Linux/Mac: dùng unzip
      exec(`unzip -o "${zipPath}" -d "${destDir}"`, (err) => {
        if (err) reject(new Error('Giải nén thất bại: ' + err.message));
        else resolve();
      });
    }
  });
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

// ---- Mod Manager (Modrinth API) ----

const MODRINTH_API = 'https://api.modrinth.com/v2';
const MODRINTH_HEADERS = { 'User-Agent': 'NovaClient/0.0.9 (github.com/ngoclong0c/nova-client)' };

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
    headers: MODRINTH_HEADERS
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
    size: primaryFile.size
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
    headers: { 'User-Agent': 'NovaClient' }
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
      headers: MODRINTH_HEADERS
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
        redirect: 'follow'
      });

      if (!res.ok) {
        errors.push(`${mod.name}: HTTP ${res.status}`);
        continue;
      }

      // Xoá file cũ cùng slug (nếu update version)
      try {
        const existingFiles = await fs.readdir(MODS_DIR);
        for (const f of existingFiles) {
          if (f.toLowerCase().includes(mod.slug.toLowerCase()) && f.endsWith('.jar')) {
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
