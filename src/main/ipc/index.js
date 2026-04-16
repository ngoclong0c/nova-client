'use strict';

/**
 * IPC Router — registers all IPC handlers.
 * Uses state store for profile/version state.
 */

const { ipcMain, shell } = require('electron');
const authService = require('../services/authService');
const launchService = require('../services/launchService');
const versionService = require('../services/versionService');
const fabricService = require('../services/fabricService');
const modService = require('../services/modService');
const updateService = require('../services/updateService');
const settingsService = require('../services/settingsService');

function register(store) {
  // ---- Auth ----
  ipcMain.handle('auth:login', async () => {
    const result = await authService.loginMicrosoft();
    if (result.success) store.set('profile', result.profile);
    return result;
  });

  ipcMain.handle('auth:offline', async (event, username) => {
    const result = authService.loginOffline(username);
    if (result.success) store.set('profile', result.profile);
    return result;
  });

  // ---- Game ----
  ipcMain.handle('game:launch', async (event, opts) => {
    store.set('gameRunning', true);
    store.set('gameVersion', opts.version);
    const result = await launchService.launch(opts);
    if (!result.success) {
      store.set('gameRunning', false);
    }
    return result;
  });

  ipcMain.handle('game:kill', async () => {
    store.set('gameRunning', false);
    return launchService.kill();
  });

  // ---- Versions ----
  ipcMain.handle('versions:list', async () => {
    return versionService.getVersions();
  });

  // ---- Settings ----
  ipcMain.handle('settings:load', async () => {
    return { success: true, settings: settingsService.load() };
  });

  ipcMain.handle('settings:save', async (event, data) => {
    // Sync to store
    if (data.profile) store.set('profile', data.profile);
    if (data.selectedVersion) store.set('selectedVersion', data.selectedVersion);
    if (data.ram) store.set('ram', data.ram);
    if (data.server !== undefined) store.set('server', data.server);
    return { success: await settingsService.save(data) };
  });

  // ---- State ----
  ipcMain.handle('store:get', async (event, key) => {
    return store.get(key);
  });

  ipcMain.handle('store:getAll', async () => {
    const state = store.getAll();
    // Don't send accessToken to renderer
    if (state.profile) {
      state.profile = { ...state.profile };
      delete state.profile.accessToken;
    }
    return state;
  });

  // ---- Update ----
  ipcMain.handle('update:getVersion', async () => {
    return { version: require('../../../package.json').version };
  });

  ipcMain.handle('update:check', async () => {
    const result = await updateService.check();
    if (result.hasUpdate) store.set('updateAvailable', result);
    return result;
  });

  ipcMain.handle('update:downloadAndInstall', async (event, params) => {
    return updateService.downloadAndInstall(params);
  });

  ipcMain.handle('update:openReleasePage', async () => {
    shell.openExternal(`https://github.com/${updateService.GITHUB_OWNER}/${updateService.GITHUB_REPO}/releases`);
    return { success: true };
  });

  // ---- Fabric ----
  ipcMain.handle('fabric:install', async (event, gameVersion) => {
    return fabricService.install(gameVersion);
  });

  ipcMain.handle('fabric:check', async (event, gameVersion) => {
    return fabricService.check(gameVersion);
  });

  // ---- Mods ----
  ipcMain.handle('mods:getConfig', async () => {
    return modService.getConfig();
  });

  ipcMain.handle('mods:resolve', async (event, { slug, source, github_repo, gameVersion }) => {
    try {
      const result = await modService.resolve(slug, source, github_repo, gameVersion);
      if (result) return { success: true, data: result };
      return { success: false, error: 'Không tìm thấy version phù hợp' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('mods:search', async (event, { query, gameVersion }) => {
    return modService.search(query, gameVersion);
  });

  ipcMain.handle('mods:getInstalled', async (event, gameVersion) => {
    return modService.getInstalled(gameVersion);
  });

  ipcMain.handle('mods:install', async (event, { mods: modList, gameVersion }) => {
    return modService.installMods(modList, gameVersion);
  });

  ipcMain.handle('mods:remove', async (event, { filename, gameVersion }) => {
    return modService.removeMod(filename, gameVersion);
  });
}

module.exports = { register };
