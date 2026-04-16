'use strict';

const crypto = require('crypto');
const { Auth } = require('msmc');
const log = require('../utils/logger');

const authManager = new Auth('select_account');

/**
 * Microsoft OAuth login via MSMC.
 * Opens Electron browser window for auth flow.
 */
async function loginMicrosoft() {
  try {
    log.info('Auth: Starting Microsoft login...');
    const xboxManager = await authManager.launch('electron');
    const token = await xboxManager.getMinecraft();
    const profile = {
      name: token.profile.name,
      uuid: token.profile.id,
      accessToken: token.mclc().token,
      userType: 'msa',
      // Store refresh data for token refresh
      _xboxToken: xboxManager,
    };
    log.info(`Auth: Microsoft login success — ${profile.name}`);
    return { success: true, profile };
  } catch (err) {
    log.error('Auth: Microsoft login failed — ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Offline/crack login with username validation.
 */
function loginOffline(username) {
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
    uuid,
    accessToken: uuid,
    userType: 'legacy',
  };
  log.info(`Auth: Offline login — ${trimmed}`);
  return { success: true, profile };
}

/**
 * Attempt to refresh a Microsoft token.
 * Returns refreshed profile or null if refresh fails.
 */
async function refreshToken(profile) {
  if (profile.userType !== 'msa') return null;
  try {
    log.info('Auth: Attempting token refresh...');
    // msmc doesn't expose a direct refresh method, so we try a silent re-auth
    const xboxManager = await authManager.launch('electron');
    const token = await xboxManager.getMinecraft();
    log.info('Auth: Token refresh success');
    return {
      ...profile,
      accessToken: token.mclc().token,
    };
  } catch (e) {
    log.warn('Auth: Token refresh failed — ' + e.message);
    return null;
  }
}

module.exports = { loginMicrosoft, loginOffline, refreshToken };
