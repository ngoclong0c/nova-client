'use strict';

const crypto = require('crypto');
const { Auth } = require('msmc');
const log = require('../utils/logger');

const authManager = new Auth('select_account');

/** Cached xbox manager for token refresh */
let cachedXboxManager = null;

/**
 * Microsoft OAuth login via MSMC.
 */
async function loginMicrosoft() {
  try {
    log.info('Auth: Starting Microsoft login...');
    const xboxManager = await authManager.launch('electron');
    const token = await xboxManager.getMinecraft();
    cachedXboxManager = xboxManager;
    const profile = {
      name: token.profile.name,
      uuid: token.profile.id,
      accessToken: token.mclc().token,
      userType: 'msa',
      tokenExpiry: Date.now() + (23 * 60 * 60 * 1000), // ~23h (MC tokens last 24h)
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
 * Check if token is expired or about to expire (within 30 min).
 */
function isTokenExpired(profile) {
  if (!profile || profile.userType !== 'msa') return false;
  if (!profile.tokenExpiry) return true; // no expiry stored = assume expired
  return Date.now() > (profile.tokenExpiry - 30 * 60 * 1000); // 30 min buffer
}

/**
 * Refresh token with retry (up to 2 attempts).
 * Returns refreshed profile or null if all attempts fail.
 */
async function refreshToken(profile) {
  if (!profile || profile.userType !== 'msa') return null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      log.info(`Auth: Token refresh attempt ${attempt}/2...`);

      // Try using cached xbox manager first (silent, no popup)
      let xboxManager = cachedXboxManager;
      if (!xboxManager) {
        xboxManager = await authManager.launch('electron');
      }

      const token = await xboxManager.getMinecraft();
      cachedXboxManager = xboxManager;

      const refreshed = {
        ...profile,
        accessToken: token.mclc().token,
        tokenExpiry: Date.now() + (23 * 60 * 60 * 1000),
      };
      log.info('Auth: Token refresh success');
      return refreshed;
    } catch (e) {
      log.warn(`Auth: Token refresh attempt ${attempt} failed — ${e.message}`);
      cachedXboxManager = null; // Force fresh login on next attempt
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  log.error('Auth: All token refresh attempts failed');
  return null;
}

/**
 * Ensure token is valid before game launch.
 * Auto-refreshes if expired. Returns updated profile or signals need for re-login.
 */
async function ensureValidToken(profile) {
  if (!profile) return { valid: false, needsRelogin: true };
  if (profile.userType !== 'msa') return { valid: true, profile };

  if (!isTokenExpired(profile)) {
    return { valid: true, profile };
  }

  log.info('Auth: Token expired, attempting refresh...');
  const refreshed = await refreshToken(profile);
  if (refreshed) {
    return { valid: true, profile: refreshed };
  }

  // Refresh failed → user needs to re-login
  return { valid: false, needsRelogin: true };
}

module.exports = { loginMicrosoft, loginOffline, refreshToken, ensureValidToken, isTokenExpired };
