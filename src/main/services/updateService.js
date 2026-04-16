'use strict';

const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { fetchWithRetry } = require('../utils/network');
const { atomicCopy } = require('../utils/file');
const log = require('../utils/logger');

const GITHUB_OWNER = 'ngoclong0c';
const GITHUB_REPO = 'nova-client';

let currentVersion = '0.0.0';
let tempDir = null;
let appDir = null;
let sendProgress = null;
let restartApp = null;

function init(opts) {
  currentVersion = opts.currentVersion;
  tempDir = opts.tempDir;
  appDir = opts.appDir;
  sendProgress = opts.sendProgress || (() => {});
  restartApp = opts.restartApp || (() => {});
}

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

const VERSION_JSON_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/version.json`;

/**
 * Check for updates from version.json + GitHub API fallback.
 */
async function check() {
  // Method 1: version.json on GitHub (fast, no rate limit)
  try {
    const res = await fetchWithRetry(VERSION_JSON_URL, {
      headers: { 'User-Agent': 'NovaClient/' + currentVersion },
      timeout: 5000,
    });
    if (res.ok) {
      const vData = await res.json();
      const latestVersion = vData.latest_version;
      if (compareVersions(latestVersion, currentVersion) > 0) {
        log.info(`Update available: ${currentVersion} → ${latestVersion}`);
        return {
          hasUpdate: true,
          currentVersion,
          latestVersion,
          downloadUrl: vData.download_url,
          sha256: vData.sha256 || null,
          releaseNotes: vData.release_notes || 'Phiên bản mới!',
          releaseDate: vData.release_date,
          files: vData.files,
          source: 'version.json',
        };
      }
      return { hasUpdate: false, currentVersion, latestVersion, source: 'version.json' };
    }
  } catch (e) { /* fallback */ }

  // Method 2: GitHub releases API
  try {
    const res = await fetchWithRetry(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      { headers: { 'User-Agent': 'NovaClient/' + currentVersion }, timeout: 8000 },
    );
    if (res.status === 404) return { hasUpdate: false, currentVersion };
    const data = await res.json();
    const latestVersion = data.tag_name.replace(/^v/, '');
    if (compareVersions(latestVersion, currentVersion) > 0) {
      const zipAsset = data.assets.find(a => a.name.endsWith('.zip'));
      return {
        hasUpdate: true,
        currentVersion,
        latestVersion,
        downloadUrl: zipAsset ? zipAsset.browser_download_url : null,
        releaseNotes: data.body || 'Phiên bản mới!',
        fileSize: zipAsset ? zipAsset.size : 0,
        fileName: zipAsset ? zipAsset.name : null,
        source: 'github-api',
      };
    }
    return { hasUpdate: false, currentVersion, latestVersion, source: 'github-api' };
  } catch (e) { /* offline */ }

  return { hasUpdate: false, currentVersion };
}

/**
 * Download update ZIP → verify SHA256 → extract → atomic install → restart.
 */
async function downloadAndInstall({ downloadUrl, expectedSha256 }) {
  try {
    // 1. Download
    sendProgress({ step: 'download', percent: 0, text: 'Đang tải bản cập nhật...' });
    const res = await fetchWithRetry(downloadUrl, {
      headers: { 'User-Agent': 'NovaClient/' + currentVersion },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('Tải thất bại: HTTP ' + res.status);

    const contentLength = parseInt(res.headers.get('content-length') || '0');
    const zipPath = path.join(tempDir, 'nova-client-update.zip');
    const fileStream = fs.createWriteStream(zipPath);
    let downloaded = 0;

    await new Promise((resolve, reject) => {
      res.body.on('data', (chunk) => {
        downloaded += chunk.length;
        if (contentLength > 0) {
          const percent = Math.round((downloaded / contentLength) * 100);
          sendProgress({ step: 'download', percent, text: `Đang tải: ${(downloaded / 1024 / 1024).toFixed(1)}MB / ${(contentLength / 1024 / 1024).toFixed(1)}MB` });
        }
      });
      res.body.pipe(fileStream);
      res.body.on('error', reject);
      fileStream.on('finish', resolve);
    });

    // 2. Verify SHA256
    if (expectedSha256) {
      sendProgress({ step: 'verify', percent: 45, text: 'Đang xác minh checksum...' });
      const fileBuffer = await fs.readFile(zipPath);
      const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      if (actualHash !== expectedSha256) {
        await fs.remove(zipPath);
        throw new Error(`Checksum không khớp!`);
      }
      log.info('Update checksum verified OK');
    }

    // 3. Extract
    sendProgress({ step: 'extract', percent: 50, text: 'Đang giải nén...' });
    const updateDir = path.join(tempDir, 'nova-client-update');
    await fs.remove(updateDir);
    await fs.ensureDir(updateDir);

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(updateDir, true);

    // 4. Atomic install
    sendProgress({ step: 'install', percent: 80, text: 'Đang cài đặt...' });
    const updateFiles = ['main.js', 'preload.js', 'index.html', 'package.json'];
    for (const file of updateFiles) {
      const srcFile = path.join(updateDir, file);
      const destFile = path.join(appDir, file);
      if (await fs.pathExists(srcFile)) {
        await atomicCopy(srcFile, destFile);
      }
    }
    // Copy fabric-mod/ if exists
    const fabricSrc = path.join(updateDir, 'fabric-mod');
    if (await fs.pathExists(fabricSrc)) {
      await fs.copy(fabricSrc, path.join(appDir, 'fabric-mod'), { overwrite: true });
    }
    // Copy src/ if exists (new architecture)
    const srcDir = path.join(updateDir, 'src');
    if (await fs.pathExists(srcDir)) {
      await fs.copy(srcDir, path.join(appDir, 'src'), { overwrite: true });
    }

    // 5. Cleanup
    await fs.remove(zipPath);
    await fs.remove(updateDir);

    sendProgress({ step: 'done', percent: 100, text: 'Cập nhật xong! Đang khởi động lại...' });
    log.info('Update installed, restarting...');

    setTimeout(() => restartApp(), 1500);
    return { success: true };
  } catch (err) {
    sendProgress({ step: 'error', percent: 0, text: 'Lỗi: ' + err.message });
    log.error('Update failed: ' + err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { init, check, downloadAndInstall, GITHUB_OWNER, GITHUB_REPO };
