'use strict';

const fetch = require('node-fetch');
const log = require('./logger');

/**
 * fetch wrapper with automatic retry and exponential backoff.
 * @param {string} url
 * @param {object} options - node-fetch options
 * @param {number} maxRetries - default 3
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      lastErr = err;
      log.warn(`Fetch attempt ${attempt}/${maxRetries} failed for ${url}: ${err.message}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastErr;
}

module.exports = { fetchWithRetry };
