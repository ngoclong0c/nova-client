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

async function check() {
  // Method 1: version.json
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
          hasUpdate: true, currentVersion, latestVersion,
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
        hasUpdate: true, currentVersion, latestVersion,
        downloadUrl: zipAsset ? zipAsset.browser_download_url : null,
        releaseNotes: data.body || 'Phiên bản mới!',
        source: 'github-api',
      };
    }
    return { hasUpdate: false, currentVersion, latestVersion, source: 'github-api' };
  } catch (e) { /* offline */ }

  return { hasUpdate: false, currentVersion };
}

/**
 * Backup current files before update for rollback.
 * Returns backup directory path.
 */
async function createBackup(filesToBackup) {
  const backupDir = path.join(tempDir, `nova-backup-${Date.now()}`);
  await fs.ensureDir(backupDir);
  for (const file of filesToBackup) {
    const srcFile = path.join(appDir, file);
    if (await fs.pathExists(srcFile)) {
      const destFile = path.join(backupDir, file);
      await fs.ensureDir(path.dirname(destFile));
      await fs.copy(srcFile, destFile);
    }
  }
  // Backup src/ directory
  const srcDir = path.join(appDir, 'src');
  if (await fs.pathExists(srcDir)) {
    await fs.copy(srcDir, path.join(backupDir, 'src'));
  }
  // Backup fabric-mod/
  const fabricDir = path.join(appDir, 'fabric-mod');
  if (await fs.pathExists(fabricDir)) {
    await fs.copy(fabricDir, path.join(backupDir, 'fabric-mod'));
  }
  log.info('Backup created: ' + backupDir);
  return backupDir;
}

/**
 * Rollback: restore files from backup.
 */
async function rollback(backupDir, filesToRestore) {
  log.warn('Rolling back update from backup: ' + backupDir);
  for (const file of filesToRestore) {
    const backupFile = path.join(backupDir, file);
    const destFile = path.join(appDir, file);
    if (await fs.pathExists(backupFile)) {
      await atomicCopy(backupFile, destFile);
    }
  }
  // Restore src/
  const srcBackup = path.join(backupDir, 'src');
  if (await fs.pathExists(srcBackup)) {
    await fs.copy(srcBackup, path.join(appDir, 'src'), { overwrite: true });
  }
  // Restore fabric-mod/
  const fabricBackup = path.join(backupDir, 'fabric-mod');
  if (await fs.pathExists(fabricBackup)) {
    await fs.copy(fabricBackup, path.join(appDir, 'fabric-mod'), { overwrite: true });
  }
  log.info('Rollback complete');
}

/**
 * Verify individual extracted files exist and are non-empty.
 */
async function verifyExtractedFiles(updateDir, expectedFiles) {
  for (const file of expectedFiles) {
    const filePath = path.join(updateDir, file);
    if (file.endsWith('/')) continue; // skip directories
    if (!await fs.pathExists(filePath)) {
      throw new Error(`File bị thiếu sau giải nén: ${file}`);
    }
    const stat = await fs.stat(filePath);
    if (stat.size === 0) {
      throw new Error(`File rỗng sau giải nén: ${file}`);
    }
  }
}

/**
 * Download update ZIP → verify → backup → extract → verify files → atomic install → restart.
 * On failure at any step: rollback to backup.
 */
async function downloadAndInstall({ downloadUrl, expectedSha256 }) {
  const updateFiles = ['main.js', 'preload.js', 'index.html', 'package.json'];
  let backupDir = null;

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

    // 2. Verify SHA256 of ZIP
    if (expectedSha256) {
      sendProgress({ step: 'verify', percent: 40, text: 'Đang xác minh checksum...' });
      const fileBuffer = await fs.readFile(zipPath);
      const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      if (actualHash !== expectedSha256) {
        await fs.remove(zipPath);
        throw new Error('Checksum ZIP không khớp!');
      }
      log.info('Update ZIP checksum verified OK');
    }

    // 3. Extract
    sendProgress({ step: 'extract', percent: 50, text: 'Đang giải nén...' });
    const updateDir = path.join(tempDir, 'nova-client-update');
    await fs.remove(updateDir);
    await fs.ensureDir(updateDir);

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(updateDir, true);

    // 4. Verify extracted files
    sendProgress({ step: 'verify', percent: 60, text: 'Đang kiểm tra file...' });
    await verifyExtractedFiles(updateDir, updateFiles);
    log.info('Extracted files verified OK');

    // 5. Backup current files
    sendProgress({ step: 'backup', percent: 65, text: 'Đang backup file cũ...' });
    backupDir = await createBackup(updateFiles);

    // 6. Atomic install
    sendProgress({ step: 'install', percent: 75, text: 'Đang cài đặt...' });
    for (const file of updateFiles) {
      const srcFile = path.join(updateDir, file);
      const destFile = path.join(appDir, file);
      if (await fs.pathExists(srcFile)) {
        await atomicCopy(srcFile, destFile);
      }
    }
    // Copy directories
    const fabricSrc = path.join(updateDir, 'fabric-mod');
    if (await fs.pathExists(fabricSrc)) {
      await fs.copy(fabricSrc, path.join(appDir, 'fabric-mod'), { overwrite: true });
    }
    const srcDir = path.join(updateDir, 'src');
    if (await fs.pathExists(srcDir)) {
      await fs.copy(srcDir, path.join(appDir, 'src'), { overwrite: true });
    }

    // 7. Verify installed files match extracted files
    sendProgress({ step: 'verify', percent: 90, text: 'Đang xác minh cài đặt...' });
    for (const file of updateFiles) {
      const srcFile = path.join(updateDir, file);
      const destFile = path.join(appDir, file);
      if (await fs.pathExists(srcFile)) {
        const srcHash = crypto.createHash('sha256').update(await fs.readFile(srcFile)).digest('hex');
        const destHash = crypto.createHash('sha256').update(await fs.readFile(destFile)).digest('hex');
        if (srcHash !== destHash) {
          throw new Error(`File ${file} bị lỗi sau cài đặt — hash không khớp`);
        }
      }
    }
    log.info('Installed files verified OK');

    // 8. Cleanup
    await fs.remove(zipPath);
    await fs.remove(updateDir);
    // Keep backup for 1 run in case of startup failure; cleanup on next successful boot
    sendProgress({ step: 'done', percent: 100, text: 'Cập nhật xong! Đang khởi động lại...' });
    log.info('Update installed successfully, restarting...');

    setTimeout(() => restartApp(), 1500);
    return { success: true };
  } catch (err) {
    // ROLLBACK on any failure
    if (backupDir) {
      sendProgress({ step: 'rollback', percent: 50, text: 'Lỗi! Đang khôi phục phiên bản cũ...' });
      try {
        await rollback(backupDir, updateFiles);
        sendProgress({ step: 'error', percent: 0, text: 'Lỗi: ' + err.message + ' (đã rollback)' });
        log.warn('Update failed, rolled back: ' + err.message);
      } catch (rollbackErr) {
        sendProgress({ step: 'error', percent: 0, text: 'Lỗi nghiêm trọng: rollback thất bại! ' + rollbackErr.message });
        log.error('ROLLBACK FAILED: ' + rollbackErr.message);
      }
    } else {
      sendProgress({ step: 'error', percent: 0, text: 'Lỗi: ' + err.message });
      log.error('Update failed (no backup): ' + err.message);
    }
    return { success: false, error: err.message };
  }
}

/**
 * Clean up old backup dirs on successful startup.
 */
async function cleanupOldBackups() {
  try {
    const entries = await fs.readdir(tempDir);
    for (const entry of entries) {
      if (entry.startsWith('nova-backup-')) {
        await fs.remove(path.join(tempDir, entry));
        log.info('Cleaned old backup: ' + entry);
      }
    }
  } catch (e) { /* ignore */ }
}

module.exports = { init, check, downloadAndInstall, cleanupOldBackups, GITHUB_OWNER, GITHUB_REPO };
