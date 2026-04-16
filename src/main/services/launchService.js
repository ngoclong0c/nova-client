'use strict';

const { Client } = require('minecraft-launcher-core');
const log = require('../utils/logger');
const javaService = require('./javaService');
const authService = require('./authService');

const launcher = new Client();
let gameProcess = null;
let gameDir = null;
let sendToRenderer = null;
let onProfileRefreshed = null; // callback to update state store

function init(opts) {
  gameDir = opts.gameDir;
  sendToRenderer = opts.sendToRenderer;
  onProfileRefreshed = opts.onProfileRefreshed || (() => {});
}

function isRunning() {
  return gameProcess !== null;
}

/**
 * Launch Minecraft with token validation + crash handling.
 */
async function launch({ version, profile, ram, server }) {
  if (gameProcess) {
    return { success: false, error: 'Game đang chạy rồi!' };
  }

  // Auto-validate token before launch (MSA only)
  let validProfile = profile;
  if (profile.userType === 'msa') {
    const tokenCheck = await authService.ensureValidToken(profile);
    if (!tokenCheck.valid) {
      return { success: false, error: 'Token hết hạn — vui lòng đăng nhập lại', needsRelogin: true };
    }
    validProfile = tokenCheck.profile;
    // Notify state store if token was refreshed
    if (validProfile.accessToken !== profile.accessToken) {
      onProfileRefreshed(validProfile);
      log.info('Token was refreshed before launch');
    }
  }

  const javaPath = await javaService.findJavaPath();
  log.info(`Launching MC ${version} — Java: ${javaPath} — RAM: ${ram}`);

  const opts = {
    authorization: {
      access_token: validProfile.accessToken,
      client_token: validProfile.uuid,
      uuid: validProfile.uuid,
      name: validProfile.name,
      user_properties: '{}',
      meta: { type: validProfile.userType === 'legacy' ? 'mojang' : 'msa', xuid: validProfile.uuid },
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

  // Collect crash data from game output
  let crashBuffer = [];
  let isCrashing = false;

  return new Promise((resolve) => {
    launcher.removeAllListeners();

    launcher.on('debug', (msg) => {
      sendToRenderer.log(msg);
    });

    launcher.on('data', (msg) => {
      sendToRenderer.log(msg);

      // Detect crash report in game output
      if (typeof msg === 'string') {
        if (msg.includes('---- Minecraft Crash Report ----')) {
          isCrashing = true;
          crashBuffer = [];
        }
        if (isCrashing) {
          crashBuffer.push(msg);
          // End of crash report
          if (msg.includes('-- System Details --') || crashBuffer.length > 200) {
            const crashText = crashBuffer.join('\n');
            log.writeCrash(crashText);
            sendToRenderer.error('Game crash detected! Xem logs/crash.log để biết chi tiết.');
            isCrashing = false;
          }
        }
      }
    });

    launcher.on('progress', (data) => {
      sendToRenderer.progress({ type: data.type, task: data.task, total: data.total });
    });

    launcher.on('close', (code) => {
      gameProcess = null;
      log.info(`Game exited with code ${code}`);

      // Write any remaining crash buffer
      if (isCrashing && crashBuffer.length > 0) {
        log.writeCrash(crashBuffer.join('\n'));
      }

      if (code !== 0 && code !== null) {
        log.warn(`Game exited abnormally (code ${code})`);
        sendToRenderer.error(`Game thoát bất thường (code ${code}). Xem console log để biết chi tiết.`);
      }
      sendToRenderer.closed(code);
    });

    launcher.on('error', (err) => {
      gameProcess = null;
      log.error('Game error: ' + err.message);
      log.writeCrash({ type: 'launcher_error', message: err.message, stack: err.stack });
      sendToRenderer.error(err.message);
    });

    launcher.launch(opts).then((proc) => {
      gameProcess = proc;
      log.info('Game process started — PID ' + (proc.pid || 'unknown'));
      resolve({ success: true });
    }).catch((err) => {
      log.error('Launch failed: ' + err.message);
      log.writeCrash({ type: 'launch_failure', message: err.message, stack: err.stack, version, ram });
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
