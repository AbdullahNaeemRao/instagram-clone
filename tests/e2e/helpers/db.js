const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });
const pool = require('../../../db');

pool.on('error', (error) => {
  console.error('Playwright DB pool error:', error.message);
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function waitFor(check, { timeout = 45000, interval = 1000, message = 'condition' } = {}) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await check();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Timed out waiting for ${message}`);
}

module.exports = {
  pool,
  query,
  waitFor,
};
