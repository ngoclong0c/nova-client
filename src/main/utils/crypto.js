'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');
const log = require('./logger');

const ALGO = 'aes-256-gcm';
let keyFile = null;

function init(gameDir) {
  keyFile = path.join(gameDir, '.keyfile');
}

/**
 * Get or generate a random 256-bit encryption key.
 * Stored in GAME_DIR/.keyfile — if lost, existing encrypted data is unreadable (forces re-login).
 */
function getKey() {
  try {
    if (fs.pathExistsSync(keyFile)) {
      const buf = fs.readFileSync(keyFile);
      if (buf.length === 32) return buf;
    }
  } catch (e) { /* regenerate */ }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key, { mode: 0o600 });
  log.info('Generated new encryption key file');
  return key;
}

function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decrypt(ciphertext) {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext;
  try {
    const key = getKey();
    const [ivHex, tagHex, encrypted] = ciphertext.split(':');
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return null; // Corrupted or wrong key — force re-login
  }
}

module.exports = { init, encrypt, decrypt };
