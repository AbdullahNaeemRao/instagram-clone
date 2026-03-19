const { Pool } = require('pg');
require('dotenv').config();

function buildPoolConfig() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is required');
    }

    let ssl = { rejectUnauthorized: false };

    try {
        const hostname = new URL(connectionString).hostname;
        if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
            ssl = false;
        }
    } catch (error) {
        // Default to remote-safe SSL config when URL parsing fails.
    }

    return {
        connectionString,
        ssl,
    };
}

const pool = new Pool(buildPoolConfig());

pool.on('connect', () => {
    console.log('Connected to PostgreSQL Database');
});

module.exports = pool;
module.exports.buildPoolConfig = buildPoolConfig;
