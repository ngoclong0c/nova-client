'use strict';

const { Client } = require('minecraft-launcher-core');
const log = require('../utils/logger');
const javaService = require('./javaService');

const launcher = new Client();
let gameProcess = null;
let gameDir = null;
let sendToRenderer = null; // { progress, log, closed, error }

function init(opts) {
  gameDir = opts.gameDir;
  sendToRenderer = opts.sendToRenderer;
}

function isRunning() {
  return gameProcess !== null;
}

/**
 * Launch Minecraft with crash handling + retry.
 */
async function launch({ version, profile, ram, server }) {
  if (gameProcess) {
    return { success: false, error: 'Game đang chạy rồi!' };
  }

  const javaPath = await javaService.findJavaPath();
  log.info(`Launching MC ${version} — Java: ${javaPath} — RAM: ${ram}`);

  const opts = {
    authorization: {
      access_token: profile.accessToken,
      client_token: profile.uuid,
      uuid: profile.uuid,
      name: profile.name,
      user_properties: '{}',
      meta: { type: profile.userType === 'legacy' ? 'mojang' : 'msa', xuid: profile.uuid },
    },
    root: gameDir,
    version: { number: version, type: 'release' },
    memory: { max: ram, min: '1G' },
    javaPath,
    ...(server ? {
      server: {
        host: server.split(':')[0],
        port: parseInt(server.split(':')[1] || 25565),
      },
    } : {}),
  };

  return new Promise((resolve) => {
    launcher.removeAllListeners();

    launcher.on('debug', (msg) => {
      sendToRenderer.log(msg);
    });

    launcher.on('data', (msg) => {
      sendToRenderer.log(msg);
      // Detect crash patterns in game output
      if (typeof msg === 'string' && msg.includes('---- Minecraft Crash Report ----')) {
        log.error('CRASH DETECTED in game output');
        sendToRenderer.error('Game crash detected! Xem log để biết chi tiết.');
      }
    });

    launcher.on('progress', (data) => {
      sendToRenderer.progress({ type: data.type, task: data.task, total: data.total });
    });

    launcher.on('close', (code) => {
      gameProcess = null;
      log.info(`Game exited with code ${code}`);
      if (code !== 0 && code !== null) {
        log.warn(`Game exited abnormally (code ${code})`);
        sendToRenderer.error(`Game thoát bất thường (code ${code}). Xem console log để biết chi tiết.`);
      }
      sendToRenderer.closed(code);
    });

    launcher.on('error', (err) => {
      gameProcess = null;
      log.error('Game error: ' + err.message);
      sendToRenderer.error(err.message);
    });

    launcher.launch(opts).then((proc) => {
      gameProcess = proc;
      log.info('Game process started — PID ' + (proc.pid || 'unknown'));
      resolve({ success: true });
    }).catch((err) => {
      log.error('Launch failed: ' + err.message);
      resolve({ success: false, error: err.message });
    });
  });
}

async function kill() {
  if (gameProcess) {
    log.info('Killing game process');
    gameProcess.kill();
    gameProcess = null;
  }
  return { success: true };
}

module.exports = { init, launch, kill, isRunning };
