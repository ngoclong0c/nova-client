'use strict';

const fs = require('fs-extra');

/**
 * Atomic write: write to .tmp then rename to avoid corruption on crash.
 */
async function atomicWrite(destPath, data) {
  const tmpPath = destPath + '.tmp';
  await fs.writeJson(tmpPath, data, { spaces: 2 });
  await fs.rename(tmpPath, destPath);
}

/**
 * Atomic file copy: copy to .tmp then rename.
 */
async function atomicCopy(srcFile, destFile) {
  const tmpFile = destFile + '.tmp';
  await fs.copy(srcFile, tmpFile, { overwrite: true });
  await fs.rename(tmpFile, destFile);
}

module.exports = { atomicWrite, atomicCopy };
