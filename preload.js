/**
 * @file preload.js
 * @description Electron preload script that serves as a secure bridge between
 *              the renderer process (index.html) and the main process (main.js).
 *              Uses contextBridge to safely expose a limited API (window.novaAPI)
 *              to the renderer while keeping nodeIntegration disabled.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Exposes the Nova Client API to the renderer process as `window.novaAPI`.
 * All methods are thin wrappers around Electron IPC calls.
 *
 * @namespace novaAPI
 * @property {Function} minimize - Minimizes the application window
 * @property {Function} maximize - Toggles maximize/restore of the application window
 * @property {Function} close - Closes the application (quits the app)
 * @property {Function} login - Initiates Microsoft OAuth authentication flow
 * @property {Function} launch - Launches Minecraft with the given options
 * @property {Function} killGame - Terminates the running Minecraft process
 * @property {Function} onProgress - Registers a callback for download/launch progress events
 * @property {Function} onLog - Registers a callback for game console log messages
 * @property {Function} onGameClosed - Registers a callback for when the game process exits
 * @property {Function} onGameError - Registers a callback for game error events
 * @property {Function} getVersions - Fetches available Minecraft versions from Mojang API
 * @property {Function} openFolder - Opens the game data directory in system file explorer
 */
contextBridge.exposeInMainWorld('novaAPI', {
  /** Minimizes the application window */
  minimize: () => ipcRenderer.send('window:minimize'),
  /** Toggles maximize/restore of the application window */
  maximize: () => ipcRenderer.send('window:maximize'),
  /** Closes the application */
  close: () => ipcRenderer.send('window:close'),

  /**
   * Initiates Microsoft OAuth login and returns the Minecraft profile.
   * @returns {Promise<{success: boolean, profile?: Object, error?: string}>}
   */
  login: () => ipcRenderer.invoke('auth:login'),

  /**
   * Creates an offline/crack profile with the given username.
   * @param {string} username - Player name (minimum 3 characters)
   * @returns {Promise<{success: boolean, profile?: Object, error?: string}>}
   */
  offlineLogin: (username) => ipcRenderer.invoke('auth:offline', username),

  /**
   * Launches Minecraft with the specified options.
   * @param {Object} opts - Launch options (version, profile, ram, server)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  launch: (opts) => ipcRenderer.invoke('game:launch', opts),
  /** Kills the running Minecraft game process */
  killGame: () => ipcRenderer.invoke('game:kill'),

  /**
   * Registers a callback for download/launch progress events.
   * @param {Function} cb - Callback receiving {type, task, total}
   */
  onProgress: (cb) => ipcRenderer.on('game:progress', (_, data) => cb(data)),
  /**
   * Registers a callback for game console log messages.
   * @param {Function} cb - Callback receiving the log message string
   */
  onLog: (cb) => ipcRenderer.on('game:log', (_, msg) => cb(msg)),
  /**
   * Registers a callback for when the game process exits.
   * @param {Function} cb - Callback receiving the exit code
   */
  onGameClosed: (cb) => ipcRenderer.on('game:closed', (_, code) => cb(code)),
  /**
   * Registers a callback for game error events.
   * @param {Function} cb - Callback receiving the error message string
   */
  onGameError: (cb) => ipcRenderer.on('game:error', (_, err) => cb(err)),

  /**
   * Fetches available Minecraft release versions.
   * @returns {Promise<{success: boolean, versions: Array<{id: string, type: string}>}>}
   */
  getVersions: () => ipcRenderer.invoke('versions:list'),

  /** Opens the game data directory (%APPDATA%/.nova-client) in file explorer */
  openFolder: () => ipcRenderer.send('folder:open'),

  // ---- Auto-Update ----
  /** Lấy version hiện tại */
  getVersion: () => ipcRenderer.invoke('update:getVersion'),
  /** Kiểm tra bản cập nhật từ GitHub */
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  /** Tải + giải nén + cài đặt + restart app */
  downloadAndInstall: (url) => ipcRenderer.invoke('update:downloadAndInstall', url),
  /** Mở trang GitHub releases */
  openReleasePage: () => ipcRenderer.invoke('update:openReleasePage'),
  /** Lắng nghe tiến trình update */
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_, data) => cb(data)),

  // ---- Mod Manager (Modrinth API) ----
  /** Lấy danh sách mod config (online + fallback) */
  getModConfig: () => ipcRenderer.invoke('mods:getConfig'),
  /** Resolve download info cho 1 mod từ Modrinth/GitHub */
  resolveMod: (params) => ipcRenderer.invoke('mods:resolve', params),
  /** Tìm kiếm mod trên Modrinth */
  searchMods: (params) => ipcRenderer.invoke('mods:search', params),
  /** Lấy danh sách mod đã cài trong mods/ */
  getInstalledMods: () => ipcRenderer.invoke('mods:getInstalled'),
  /** Tải và cài đặt danh sách mod (resolve + download tự động) */
  installMods: (params) => ipcRenderer.invoke('mods:install', params),
  /** Xoá một mod */
  removeMod: (filename) => ipcRenderer.invoke('mods:remove', filename),
  /** Lắng nghe tiến trình cài mod */
  onModProgress: (cb) => ipcRenderer.on('mods:progress', (_, data) => cb(data)),
});
