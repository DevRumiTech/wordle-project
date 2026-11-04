const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
// Prevent driver/store debug modes from exposing SQL parameters or cookies.
require('debug').disable();
const mysql = require('mysql2/promise');

function localOptions() {
    if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST) ||
        process.env.DB_NAME !== 'wordle_db') {
        throw new Error('Expected the local wordle_db database; no connection attempted');
    }
    return {
        host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
        user: process.env.DB_USER, password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME, connectTimeout: 5000,
    };
}

async function inspectSchema(connection) {
    const [columns] = await connection.execute(`SELECT TABLE_NAME, COLUMN_NAME,
        COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('users', 'sessions')
        ORDER BY TABLE_NAME, ORDINAL_POSITION`);
    const [tables] = await connection.execute(`SELECT TABLE_NAME, ENGINE
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`);
    const required = {
        users: ['id', 'username', 'email', 'password_hash', 'created_at', 'updated_at'],
        sessions: ['session_id', 'expires', 'data'],
    };
    for (const [table, names] of Object.entries(required)) {
        if (!names.every(name => columns.some(row => row.TABLE_NAME === table && row.COLUMN_NAME === name))) {
            throw new Error('Required authentication columns are missing; schema approval is needed');
        }
        if (!tables.some(row => row.TABLE_NAME === table && row.ENGINE === 'InnoDB')) {
            throw new Error('Transactional authentication tables are required');
        }
    }
    return columns;
}

module.exports = { mysql, localOptions, inspectSchema };
