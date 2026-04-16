'use strict';

const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { fetchWithRetry } = require('../utils/network');
const log = require('../utils/logger');

let gameDir = null;
let currentVersion = '0.0.0';
let sendProgress = null;

const MODRINTH_API = 'https://api.modrinth.com/v2';
const GITHUB_OWNER = 'ngoclong0c';
const GITHUB_REPO = 'nova-client';

function init(opts) {
  gameDir = opts.gameDir;
  currentVersion = opts.currentVersion || '0.0.0';
  sendProgress = opts.sendProgress || (() => {});
}

function headers() {
  return { 'User-Agent': `NovaClient/${currentVersion} (github.com/${GITHUB_OWNER}/${GITHUB_REPO})` };
}

/** Per-version mods directory */
function getModsDir(gameVersion) {
  if (gameVersion) {
    const dir = path.join(gameDir, 'mods', gameVersion);
    fs.ensureDirSync(dir);
    return dir;
  }
  const dir = path.join(gameDir, 'mods');
  fs.ensureDirSync(dir);
  return dir;
}

const DEFAULT_MOD_CONFIG = {
  branches: ['Nextgen', 'Stable'],
  builds: ['Latest', 'Recommended'],
  recommended_mods: [
    { name: 'Baritone', slug: 'baritone', source: 'github', github_repo: 'cabaletta/baritone', description: 'AI pathfinding tự động', default_enabled: true },
    { name: 'Cloth Config API', slug: 'cloth-config2', source: 'modrinth', description: 'Thư viện config cho mod', default_enabled: false },
    { name: 'ImmediatelyFast', slug: 'immediatelyfast', source: 'modrinth', description: 'Tối ưu render, tăng FPS', default_enabled: true },
    { name: 'Lithium', slug: 'lithium', source: 'modrinth', description: 'Tối ưu logic server/client', default_enabled: true },
    { name: 'Sodium Extra', slug: 'sodium-extra', source: 'modrinth', description: 'Thêm tuỳ chỉnh đồ hoạ', default_enabled: false },
    { name: 'Mod Menu', slug: 'modmenu', source: 'modrinth', description: 'Menu quản lý mod in-game', default_enabled: true },
  ],
  additional_mods: [
    { name: 'Fabric API', slug: 'fabric-api', source: 'modrinth', description: 'Thư viện nền tảng Fabric', default_enabled: true },
    { name: 'Iris Shaders', slug: 'iris', source: 'modrinth', description: 'Hỗ trợ shader packs', default_enabled: true },
    { name: 'Sodium', slug: 'sodium', source: 'modrinth', description: 'Tối ưu render, thay OptiFine', default_enabled: true },
  ],
};

/** Resolve mod download info from Modrinth */
async function getModrinthVersion(slug, gameVersion, loader) {
  const params = new URLSearchParams({
    loaders: JSON.stringify([loader]),
    game_versions: JSON.stringify([gameVersion]),
  });
  const res = await fetchWithRetry(`${MODRINTH_API}/project/${slug}/version?${params}`, {
    headers: headers(),
    timeout: 8000,
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
    size: primaryFile.size,
    sha512: primaryFile.hashes?.sha512 || null,
    dependencies: latest.dependencies || [],
    projectId: latest.project_id,
  };
}

/** Resolve mod download info from GitHub */
async function getGithubRelease(repo) {
  const res = await fetchWithRetry(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { 'User-Agent': 'NovaClient' },
    timeout: 8000,
  });
  if (!res.ok) return null;
  const release = await res.json();
  const asset = release.assets.find(a => a.name.endsWith('.jar') && a.name.toLowerCase().includes('fabric'))
    || release.assets.find(a => a.name.endsWith('.jar'));
  if (!asset) return null;
  return {
    filename: asset.name,
    url: asset.browser_download_url,
    version: release.tag_name,
    size: asset.size,
    dependencies: [],
  };
}

/** Resolve a single mod with version fallback */
async function resolve(slug, source, githubRepo, gameVersion) {
  let result = null;
  if (source === 'modrinth') {
    result = await getModrinthVersion(slug, gameVersion, 'fabric');
    if (!result && gameVersion.split('.').length > 2) {
      const major = gameVersion.split('.').slice(0, 2).join('.');
      result = await getModrinthVersion(slug, major, 'fabric');
    }
  } else if (source === 'github' && githubRepo) {
    result = await getGithubRelease(githubRepo);
  }
  return result;
}

/**
 * Resolve dependencies for a mod from Modrinth.
 * Returns list of additional mods that need to be installed.
 */
async function resolveDependencies(modInfo, gameVersion, alreadyQueued) {
  const deps = [];
  if (!modInfo.dependencies || !modInfo.dependencies.length) return deps;

  for (const dep of modInfo.dependencies) {
    // Only auto-install required dependencies
    if (dep.dependency_type !== 'required') continue;

    const depId = dep.project_id;
    if (!depId) continue;

    // Skip if already in the install queue
    if (alreadyQueued.has(depId)) continue;
    alreadyQueued.add(depId);

    try {
      // Get project info to get slug
      const projRes = await fetchWithRetry(`${MODRINTH_API}/project/${depId}`, {
        headers: headers(),
        timeout: 5000,
      });
      if (!projRes.ok) continue;
      const project = await projRes.json();

      // Resolve the dependency version
      const depVersion = await getModrinthVersion(project.slug, gameVersion, 'fabric');
      if (!depVersion) continue;

      deps.push({
        name: project.title,
        slug: project.slug,
        source: 'modrinth',
        github_repo: '',
        _resolved: depVersion,
        _isDependency: true,
      });
      log.info(`Dependency resolved: ${project.title} (required by mod)`);

      // Recurse: resolve sub-dependencies (max 1 level deep to avoid infinite loops)
      if (depVersion.dependencies && depVersion.dependencies.length > 0) {
        const subDeps = await resolveDependencies(depVersion, gameVersion, alreadyQueued);
        deps.push(...subDeps);
      }
    } catch (e) {
      log.warn(`Failed to resolve dependency ${depId}: ${e.message}`);
    }
  }

  return deps;
}

async function getConfig() {
  try {
    const res = await fetchWithRetry(
      `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/mods-config.json`,
      { headers: { 'User-Agent': 'NovaClient' }, timeout: 5000 },
    );
    if (res.ok) {
      const config = await res.json();
      return { success: true, config, source: 'online' };
    }
  } catch (e) { /* fallback */ }
  return { success: true, config: JSON.parse(JSON.stringify(DEFAULT_MOD_CONFIG)), source: 'offline' };
}

async function search(query, gameVersion) {
  try {
    const facets = JSON.stringify([['categories:fabric'], [`versions:${gameVersion}`], ['project_type:mod']]);
    const params = new URLSearchParams({ query, facets, limit: '15' });
    const res = await fetchWithRetry(`${MODRINTH_API}/search?${params}`, {
      headers: headers(),
      timeout: 8000,
    });
    if (!res.ok) return { success: false, mods: [] };
    const data = await res.json();
    const mods = data.hits.map(hit => ({
      name: hit.title,
      slug: hit.slug,
      description: hit.description,
      downloads: hit.downloads,
      icon_url: hit.icon_url,
      source: 'modrinth',
    }));
    return { success: true, mods };
  } catch (err) {
    return { success: false, mods: [], error: err.message };
  }
}

async function getInstalled(gameVersion) {
  try {
    const modsDir = getModsDir(gameVersion);
    const files = await fs.readdir(modsDir);
    return { success: true, mods: files.filter(f => f.endsWith('.jar')) };
  } catch (e) {
    return { success: true, mods: [] };
  }
}

function fileMatchesSlug(filename, slug) {
  const fLower = filename.toLowerCase();
  const sLower = slug.toLowerCase();
  return fLower.startsWith(sLower + '-') || fLower === sLower + '.jar';
}

/**
 * Download and install a single resolved mod.
 */
async function downloadAndVerifyMod(downloadInfo, modsDir, modSlug) {
  const res = await fetchWithRetry(downloadInfo.url, {
    headers: { 'User-Agent': 'NovaClient' },
    redirect: 'follow',
    timeout: 30000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // Remove old version
  try {
    const existingFiles = await fs.readdir(modsDir);
    for (const f of existingFiles) {
      if (f.endsWith('.jar') && fileMatchesSlug(f, modSlug)) {
        await fs.remove(path.join(modsDir, f));
      }
    }
  } catch (e) { /* ignore */ }

  const buffer = await res.buffer();

  // Verify SHA512
  if (downloadInfo.sha512) {
    const actualHash = crypto.createHash('sha512').update(buffer).digest('hex');
    if (actualHash !== downloadInfo.sha512) {
      throw new Error('Checksum SHA512 không khớp');
    }
  }

  const savePath = path.join(modsDir, downloadInfo.filename);
  await fs.writeFile(savePath, buffer);
  return downloadInfo.filename;
}

/**
 * Install mods with dependency resolution + parallel download.
 */
async function installMods(modList, gameVersion) {
  const modsDir = getModsDir(gameVersion);
  log.info(`Mod install: ${modList.length} mods for MC ${gameVersion} → ${modsDir}`);

  // Phase 1: Resolve all mods + their dependencies
  sendProgress({ current: 0, total: modList.length, name: 'Resolving dependencies...', status: 'resolving' });

  const resolvedMods = [];
  const queuedProjectIds = new Set();
  const installedSlugs = new Set();

  // Check what's already installed
  try {
    const existing = await fs.readdir(modsDir);
    for (const f of existing) {
      if (f.endsWith('.jar')) {
        // Extract slug-ish name from filename
        const dashIdx = f.indexOf('-');
        if (dashIdx > 0) installedSlugs.add(f.substring(0, dashIdx).toLowerCase());
      }
    }
  } catch (e) { /* ignore */ }

  for (const mod of modList) {
    try {
      const downloadInfo = await resolve(mod.slug, mod.source, mod.github_repo, gameVersion);
      if (!downloadInfo) {
        resolvedMods.push({ mod, error: `Không tìm thấy bản cho MC ${gameVersion}` });
        continue;
      }
      resolvedMods.push({ mod, downloadInfo });

      // Resolve dependencies (Modrinth mods only)
      if (mod.source === 'modrinth' && downloadInfo.dependencies) {
        if (downloadInfo.projectId) queuedProjectIds.add(downloadInfo.projectId);
        // Add all explicitly queued mod slugs
        modList.forEach(m => { if (m.slug) queuedProjectIds.add(m.slug); });

        const deps = await resolveDependencies(downloadInfo, gameVersion, queuedProjectIds);
        for (const dep of deps) {
          // Skip if slug already installed
          if (installedSlugs.has(dep.slug.toLowerCase())) {
            log.info(`Dependency ${dep.slug} already installed, skipping`);
            continue;
          }
          resolvedMods.push({ mod: dep, downloadInfo: dep._resolved });
          log.info(`Auto-adding dependency: ${dep.name}`);
        }
      }
    } catch (e) {
      resolvedMods.push({ mod, error: e.message });
    }
  }

  // Phase 2: Parallel download
  const totalMods = resolvedMods.length;
  log.info(`Installing ${totalMods} mods (including dependencies)`);

  const CONCURRENCY = 4;
  const installed = [];
  const errors = [];

  for (let batchStart = 0; batchStart < totalMods; batchStart += CONCURRENCY) {
    const batch = resolvedMods.slice(batchStart, batchStart + CONCURRENCY);

    const results = await Promise.allSettled(batch.map(async ({ mod, downloadInfo, error }, batchIdx) => {
      const i = batchStart + batchIdx;

      if (error) throw new Error(error);
      if (!downloadInfo) throw new Error('No download info');

      const label = mod._isDependency ? `[dep] ${mod.name}` : mod.name;
      sendProgress({ current: i + 1, total: totalMods, name: label, status: 'downloading', filename: downloadInfo.filename });

      const filename = await downloadAndVerifyMod(downloadInfo, modsDir, mod.slug);

      sendProgress({ current: i + 1, total: totalMods, name: label, status: 'done', filename });
      log.info(`Mod installed: ${filename}${mod._isDependency ? ' (dependency)' : ''}`);
      return filename;
    }));

    results.forEach((result, batchIdx) => {
      const { mod, error: resolveErr } = batch[batchIdx];
      if (result.status === 'fulfilled') {
        installed.push(result.value);
      } else {
        const errMsg = `${mod.name}: ${resolveErr || result.reason?.message || 'Unknown error'}`;
        errors.push(errMsg);
        log.warn('Mod install failed: ' + errMsg);
      }
    });
  }

  sendProgress({ current: totalMods, total: totalMods, name: '', status: 'complete', installed: installed.length, errors: errors.length });
  return { success: true, installed, errors };
}

async function removeMod(filename, gameVersion) {
  try {
    const modsDir = getModsDir(gameVersion);
    const filePath = path.join(modsDir, filename);
    if (await fs.pathExists(filePath)) await fs.remove(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { init, getConfig, resolve, search, getInstalled, installMods, removeMod, getModsDir };
