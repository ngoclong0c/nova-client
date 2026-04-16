'use strict';

const path = require('path');
const fs = require('fs-extra');

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LOG_BACKUPS = 3;

let logDir = null;
let logFile = null;
let crashFile = null;

function init(gameDir) {
  logDir = path.join(gameDir, 'logs');
  fs.ensureDirSync(logDir);
  logFile = path.join(logDir, 'latest.log');
  crashFile = path.join(logDir, 'crash.log');
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
  else if (level !== 'DEBUG') console.log(line);
}

/**
 * Write crash report to separate crash.log with context.
 * Appends full crash data, never rotated (user should check manually).
 */
function writeCrash(crashData) {
  if (!crashFile) return;
  const ts = new Date().toISOString();
  const separator = '='.repeat(60);
  const lines = [
    separator,
    `CRASH REPORT — ${ts}`,
    separator,
    typeof crashData === 'string' ? crashData : JSON.stringify(crashData, null, 2),
    separator,
    '',
  ].join('\n');
  try {
    fs.appendFileSync(crashFile, lines);
  } catch (e) { /* ignore */ }
  write('ERROR', 'Crash report written to crash.log');
}

/**
 * Get path to latest.log for attaching to error reports.
 */
function getLogPath() {
  return logFile;
}

function getCrashLogPath() {
  return crashFile;
}

module.exports = {
  init,
  info: (msg) => write('INFO', msg),
  warn: (msg) => write('WARN', msg),
  error: (msg) => write('ERROR', msg),
  debug: (msg) => write('DEBUG', msg),
  writeCrash,
  getLogPath,
  getCrashLogPath,
};
