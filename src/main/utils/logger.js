'use strict';

const path = require('path');
const fs = require('fs-extra');

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LOG_BACKUPS = 3;

let logDir = null;
let logFile = null;

function init(gameDir) {
  logDir = path.join(gameDir, 'logs');
  fs.ensureDirSync(logDir);
  logFile = path.join(logDir, 'latest.log');
  // Write startup marker
  write('INFO', `Nova Client starting — PID ${process.pid}`);
}

function rotate() {
  try {
    if (!logFile || !fs.pathExistsSync(logFile)) return;
    const stat = fs.statSync(logFile);
    if (stat.size < MAX_LOG_SIZE) return;
    for (let i = MAX_LOG_BACKUPS - 1; i >= 1; i--) {
      const from = path.join(logDir, `latest.${i}.log`);
      const to = path.join(logDir, `latest.${i + 1}.log`);
      if (fs.pathExistsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(logFile, path.join(logDir, 'latest.1.log'));
  } catch (e) { /* ignore rotation errors */ }
}

function write(level, message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${message}`;
  if (logFile) {
    try {
      rotate();
      fs.appendFileSync(logFile, line + '\n');
    } catch (e) { /* ignore */ }
  }
  if (level === 'ERROR') console.error(line);
  else console.log(line);
}

module.exports = {
  init,
  info: (msg) => write('INFO', msg),
  warn: (msg) => write('WARN', msg),
  error: (msg) => write('ERROR', msg),
  debug: (msg) => write('DEBUG', msg),
};
