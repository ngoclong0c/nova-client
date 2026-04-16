'use strict';

const fs = require('fs-extra');
const path = require('path');
const cryptoUtil = require('../utils/crypto');
const { atomicWrite } = require('../utils/file');
const log = require('../utils/logger');

let settingsFile = null;

function init(gameDir) {
  settingsFile = path.join(gameDir, 'settings.json');
}

function load() {
  try {
    if (fs.pathExistsSync(settingsFile)) {
      const data = fs.readJsonSync(settingsFile);
      // Decrypt sensitive fields
      if (data.profile && data.profile.accessToken) {
        data.profile.accessToken = cryptoUtil.decrypt(data.profile.accessToken);
        if (!data.profile.accessToken) {
          delete data.profile; // Decryption failed — force re-login
          log.warn('Settings: token decryption failed, cleared profile');
        }
      }
      return data;
    }
  } catch (e) {
    log.error('Settings load error: ' + e.message);
  }
  return {};
}

async function save(data) {
  try {
    const current = load();
    const merged = { ...current, ...data };
    const toSave = JSON.parse(JSON.stringify(merged));
    // Encrypt sensitive fields
    if (toSave.profile && toSave.profile.accessToken) {
      toSave.profile.accessToken = cryptoUtil.encrypt(toSave.profile.accessToken);
    }
    await atomicWrite(settingsFile, toSave);
    return true;
  } catch (e) {
    log.error('Settings save error: ' + e.message);
    return false;
  }
}

module.exports = { init, load, save };
