'use strict';

/**
 * Central State Store — single source of truth for app state.
 * Services and IPC read/write through this store.
 * Emits change events so UI can be notified.
 */

const { EventEmitter } = require('events');
const log = require('./utils/logger');

class StateStore extends EventEmitter {
  constructor() {
    super();
    this._state = {
      profile: null,          // { name, uuid, accessToken, userType, tokenExpiry }
      selectedVersion: null,   // e.g. '1.21.4'
      gameRunning: false,
      gameVersion: null,       // version of running game
      ram: '4G',
      server: '',
      installedMods: [],       // for current version
      updateAvailable: null,   // update info object or null
    };
  }

  get(key) {
    return this._state[key];
  }

  set(key, value) {
    const old = this._state[key];
    this._state[key] = value;
    if (old !== value) {
      this.emit('change', key, value, old);
      this.emit(`change:${key}`, value, old);
    }
  }

  /** Bulk update multiple keys */
  update(partial) {
    for (const [key, value] of Object.entries(partial)) {
      this.set(key, value);
    }
  }

  /** Get full state snapshot (for debugging / serialization) */
  getAll() {
    return { ...this._state };
  }

  /** Restore state from saved settings */
  restore(settings) {
    if (!settings) return;
    if (settings.profile) this.set('profile', settings.profile);
    if (settings.selectedVersion) this.set('selectedVersion', settings.selectedVersion);
    if (settings.ram) this.set('ram', settings.ram);
    if (settings.server !== undefined) this.set('server', settings.server);
    log.info('State restored from settings');
  }

  /** Serialize current state for saving */
  serialize() {
    return {
      profile: this._state.profile,
      selectedVersion: this._state.selectedVersion,
      ram: this._state.ram,
      server: this._state.server,
    };
  }
}

// Singleton
module.exports = new StateStore();
