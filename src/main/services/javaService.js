'use strict';

const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { fetchWithRetry } = require('../utils/network');
const log = require('../utils/logger');

let gameDir = null;
let sendProgress = null;
let sendLog = null;
let currentVersion = '0.0.0';
let tempDir = null;

function init(opts) {
  gameDir = opts.gameDir;
  sendProgress = opts.sendProgress || (() => {});
  sendLog = opts.sendLog || (() => {});
  currentVersion = opts.currentVersion || '0.0.0';
  tempDir = opts.tempDir;
}

/**
 * Auto-detect Java installation.
 * Priority: JAVA_HOME → common paths → PATH → auto-download from Adoptium.
 */
async function findJavaPath() {
  const { execFile } = require('child_process');

  // 1. JAVA_HOME
  if (process.env.JAVA_HOME) {
    const javaBin = process.platform === 'win32'
      ? path.join(process.env.JAVA_HOME, 'bin', 'javaw.exe')
      : path.join(process.env.JAVA_HOME, 'bin', 'java');
    if (await fs.pathExists(javaBin)) {
      log.info('Java found via JAVA_HOME: ' + javaBin);
      return javaBin;
    }
  }

  // 2. Common paths
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
        const javaBinMac = path.join(dir, entry, 'Contents', 'Home', 'bin', 'java');
        if (await fs.pathExists(javaBin)) { log.info('Java found: ' + javaBin); return javaBin; }
        if (process.platform === 'darwin' && await fs.pathExists(javaBinMac)) { log.info('Java found: ' + javaBinMac); return javaBinMac; }
      }
    } catch (e) { /* ignore */ }
  }

  // 3. System PATH
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const target = process.platform === 'win32' ? 'javaw' : 'java';
  try {
    const result = await new Promise((resolve, reject) => {
      execFile(cmd, [target], (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim().split('\n')[0].trim());
      });
    });
    if (result) { log.info('Java found via PATH: ' + result); return result; }
  } catch (e) { /* not found */ }

  // 4. Auto-download from Adoptium
  sendLog('[Nova] Java không tìm thấy, đang tải từ Adoptium...');
  log.info('Java not found, downloading from Adoptium...');
  try {
    const javaBin = await downloadAdoptiumJava();
    if (javaBin) return javaBin;
  } catch (e) {
    sendLog('[Nova] Tải Java thất bại: ' + e.message);
    log.error('Adoptium download failed: ' + e.message);
  }

  // 5. Fallback
  return process.platform === 'win32' ? 'javaw' : 'java';
}

/**
 * Download Java from Adoptium with checksum verification.
 */
async function downloadAdoptiumJava() {
  const AdmZip = require('adm-zip');
  const javaVersion = '21'; // LTS
  const javaBaseDir = path.join(gameDir, 'java-runtime');
  await fs.ensureDir(javaBaseDir);

  // Check cache
  try {
    const existing = await fs.readdir(javaBaseDir);
    for (const dir of existing) {
      const javaBin = process.platform === 'win32'
        ? path.join(javaBaseDir, dir, 'bin', 'javaw.exe')
        : path.join(javaBaseDir, dir, 'bin', 'java');
      if (await fs.pathExists(javaBin)) { log.info('Java cached: ' + javaBin); return javaBin; }
    }
  } catch (e) { /* continue */ }

  const osMap = { win32: 'windows', darwin: 'mac', linux: 'linux' };
  const archMap = { x64: 'x64', arm64: 'aarch64', ia32: 'x32' };
  const osName = osMap[process.platform] || 'linux';
  const archName = archMap[process.arch] || 'x64';
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz';

  sendProgress({ type: 'java', task: 0, total: 100 });
  sendLog(`[Nova] Đang tải Java ${javaVersion} (${osName}-${archName})...`);

  // Fetch expected checksum from Adoptium API
  let expectedChecksum = null;
  try {
    const infoUrl = `https://api.adoptium.net/v3/assets/latest/${javaVersion}/hotspot?os=${osName}&architecture=${archName}&image_type=jre`;
    const infoRes = await fetchWithRetry(infoUrl, {
      headers: { 'User-Agent': 'NovaClient/' + currentVersion },
      timeout: 10000,
    });
    if (infoRes.ok) {
      const infoData = await infoRes.json();
      if (infoData[0]?.binary?.package?.checksum) {
        expectedChecksum = infoData[0].binary.package.checksum;
        log.info('Java expected checksum: ' + expectedChecksum.substring(0, 16) + '...');
      }
    }
  } catch (e) {
    log.warn('Could not fetch Java checksum: ' + e.message);
  }

  // Download binary
  const apiUrl = `https://api.adoptium.net/v3/binary/latest/${javaVersion}/ga/${osName}/${archName}/jre/hotspot/normal/eclipse?project=jdk`;
  const res = await fetchWithRetry(apiUrl, {
    headers: { 'User-Agent': 'NovaClient/' + currentVersion },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Adoptium API HTTP ${res.status}`);

  const archivePath = path.join(tempDir, `java-${javaVersion}.${ext}`);
  const contentLength = parseInt(res.headers.get('content-length') || '0');
  const fileStream = fs.createWriteStream(archivePath);
  let downloaded = 0;

  await new Promise((resolve, reject) => {
    res.body.on('data', (chunk) => {
      downloaded += chunk.length;
      if (contentLength > 0) {
        const pct = Math.round((downloaded / contentLength) * 100);
        sendProgress({ type: 'java', task: pct, total: 100 });
        sendLog(`[Nova] Tải Java: ${(downloaded / 1024 / 1024).toFixed(1)}MB / ${(contentLength / 1024 / 1024).toFixed(1)}MB`);
      }
    });
    res.body.pipe(fileStream);
    res.body.on('error', reject);
    fileStream.on('finish', resolve);
  });

  // Verify checksum
  if (expectedChecksum) {
    sendLog('[Nova] Đang xác minh checksum Java...');
    const fileBuffer = await fs.readFile(archivePath);
    const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    if (actualHash !== expectedChecksum) {
      await fs.remove(archivePath);
      throw new Error(`Java checksum mismatch! Expected: ${expectedChecksum.substring(0, 16)}...`);
    }
    log.info('Java checksum verified OK');
    sendLog('[Nova] Checksum OK!');
  }

  // Extract
  sendLog('[Nova] Đang giải nén Java...');
  if (ext === 'zip') {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(javaBaseDir, true);
  } else {
    const { execFile } = require('child_process');
    await new Promise((resolve, reject) => {
      execFile('tar', ['xzf', archivePath, '-C', javaBaseDir], (err) => {
        if (err) reject(new Error('Giải nén Java thất bại: ' + err.message));
        else resolve();
      });
    });
  }
  await fs.remove(archivePath);

  // Find extracted binary
  const dirs = await fs.readdir(javaBaseDir);
  for (const dir of dirs) {
    const javaBin = process.platform === 'win32'
      ? path.join(javaBaseDir, dir, 'bin', 'javaw.exe')
      : path.join(javaBaseDir, dir, 'bin', 'java');
    if (await fs.pathExists(javaBin)) {
      sendLog(`[Nova] Java đã cài: ${javaBin}`);
      log.info('Java installed: ' + javaBin);
      return javaBin;
    }
  }
  return null;
}

module.exports = { init, findJavaPath };
