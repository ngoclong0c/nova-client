'use strict';

const path = require('path');
const fs = require('fs-extra');
const { fetchWithRetry } = require('../utils/network');
const log = require('../utils/logger');

let gameDir = null;
let currentVersion = '0.0.0';
let sendProgress = null;
let sendLog = null;

function init(opts) {
  gameDir = opts.gameDir;
  currentVersion = opts.currentVersion || '0.0.0';
  sendProgress = opts.sendProgress || (() => {});
  sendLog = opts.sendLog || (() => {});
}

const HEADERS = () => ({ 'User-Agent': 'NovaClient/' + currentVersion });

/**
 * Check if Fabric Loader is available for a MC version.
 */
async function check(gameVersion) {
  try {
    const res = await fetchWithRetry(
      `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}`,
      { headers: HEADERS(), timeout: 5000 },
    );
    if (!res.ok) return { available: false };
    const loaders = await res.json();
    if (!loaders.length) return { available: false };
    return {
      available: true,
      loaderVersion: loaders[0].loader.version,
      versionId: `fabric-loader-${loaders[0].loader.version}-${gameVersion}`,
    };
  } catch (e) {
    return { available: false };
  }
}

/**
 * Install Fabric Loader with profile validation + library downloading.
 */
async function install(gameVersion) {
  try {
    sendProgress({ step: 'checking', text: 'Kiểm tra Fabric Loader...' });

    // 1. Get latest loader
    const loaderRes = await fetchWithRetry(
      `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}`,
      { headers: HEADERS(), timeout: 10000 },
    );
    if (!loaderRes.ok) return { success: false, error: `Fabric không hỗ trợ MC ${gameVersion}` };
    const loaders = await loaderRes.json();
    if (!loaders.length) return { success: false, error: `Không tìm thấy Fabric Loader cho MC ${gameVersion}` };

    const loaderVersion = loaders[0].loader.version;
    const fabricVersionId = `fabric-loader-${loaderVersion}-${gameVersion}`;
    log.info(`Fabric: installing ${fabricVersionId}`);

    // 2. Check if already installed
    const versionDir = path.join(gameDir, 'versions', fabricVersionId);
    const profileJson = path.join(versionDir, `${fabricVersionId}.json`);
    if (await fs.pathExists(profileJson)) {
      return { success: true, versionId: fabricVersionId, message: 'Đã cài sẵn' };
    }

    sendProgress({ step: 'downloading', text: `Đang tải Fabric Loader ${loaderVersion}...` });

    // 3. Download profile JSON
    const profileRes = await fetchWithRetry(
      `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${loaderVersion}/profile/json`,
      { headers: HEADERS(), timeout: 10000 },
    );
    if (!profileRes.ok) return { success: false, error: 'Không tải được Fabric profile' };
    const profileData = await profileRes.json();

    // 4. Validate
    if (!profileData.mainClass) return { success: false, error: 'Fabric profile thiếu mainClass' };
    if (!profileData.libraries || !profileData.libraries.length) return { success: false, error: 'Fabric profile thiếu libraries' };

    // 5. Save profile
    await fs.ensureDir(versionDir);
    await fs.writeJson(profileJson, profileData, { spaces: 2 });

    // 6. Download libraries
    sendProgress({ step: 'libraries', text: 'Đang tải Fabric libraries...' });
    const libsDir = path.join(gameDir, 'libraries');
    await fs.ensureDir(libsDir);

    for (const lib of profileData.libraries) {
      if (!lib.url && !lib.name) continue;
      const parts = lib.name.split(':');
      if (parts.length < 3) continue;
      const [group, artifact, ver] = parts;
      const groupPath = group.replace(/\./g, '/');
      const jarName = `${artifact}-${ver}.jar`;
      const libPath = path.join(libsDir, groupPath, artifact, ver, jarName);
      if (await fs.pathExists(libPath)) continue;

      const mavenUrl = (lib.url || 'https://maven.fabricmc.net/') + `${groupPath}/${artifact}/${ver}/${jarName}`;
      try {
        const libRes = await fetchWithRetry(mavenUrl, { headers: HEADERS(), timeout: 15000 }, 2);
        if (libRes.ok) {
          await fs.ensureDir(path.dirname(libPath));
          const buffer = await libRes.buffer();
          await fs.writeFile(libPath, buffer);
        }
      } catch (e) {
        sendLog(`[Fabric] Không tải được: ${jarName}`);
        log.warn('Fabric lib download failed: ' + jarName);
      }
    }

    sendProgress({ step: 'done', text: `Fabric Loader ${loaderVersion} đã cài!` });
    log.info('Fabric: installed ' + fabricVersionId);
    return { success: true, versionId: fabricVersionId, loaderVersion };
  } catch (err) {
    log.error('Fabric install error: ' + err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { init, check, install };
