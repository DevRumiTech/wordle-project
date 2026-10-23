// Load configuration settings from the .env file
require("dotenv").config();

// Import SQL with the Promise support.
const mysql = require("mysql2/promise");

// Create a pool of reusable MySQL connections.
const pool = mysql.createPool({
    // Address of the MySQL server.
    host: process.env.DB_HOST,

    // Port used by MySQL.
    port: Number(process.env.DB_PORT),

    // MySQL application account.
    user: process.env.DB_USER,

    // Password for the application account.
    password: process.env.DB_PASSWORD,

    // Database used by Wordle.
    database: process.env.DB_NAME,

    // Wait when all connections are busy.
    waitForConnections: true,

    // Allow up to 10 connections in the pool.
    connectionLimit: 10,
});

// Make the connection pool available to other backend files.
module.exports = pool;