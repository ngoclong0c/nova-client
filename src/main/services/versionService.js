'use strict';

const { fetchWithRetry } = require('../utils/network');
const log = require('../utils/logger');

// Real Minecraft versions only — no fake versions
const FALLBACK_VERSIONS = [
  '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21',
  '1.20.6', '1.20.4', '1.20.2', '1.20.1',
  '1.19.4', '1.19.2',
  '1.18.2',
  '1.17.1',
  '1.16.5',
  '1.12.2',
  '1.8.9',
  '1.7.10',
].map(id => ({ id, type: 'release' }));

/**
 * Fetch all Minecraft release versions from Mojang API.
 * Falls back to a hardcoded list of real versions.
 */
async function getVersions() {
  try {
    const res = await fetchWithRetry(
      'https://launchermeta.mojang.com/mc/game/version_manifest.json',
      { timeout: 10000 },
    );
    const data = await res.json();
    const versions = data.versions
      .filter(v => v.type === 'release')
      .map(v => ({ id: v.id, type: v.type }));
    log.info(`Versions: fetched ${versions.length} releases from Mojang`);
    return { success: true, versions };
  } catch (e) {
    log.warn('Versions: Mojang API failed, using fallback — ' + e.message);
    return { success: true, versions: FALLBACK_VERSIONS };
  }
}

module.exports = { getVersions };
