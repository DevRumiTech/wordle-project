require("dotenv").config();

const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const pool = require("./db");
const createApp = require("./app");
const { SESSION_MAX_AGE } = require("./session-config");

const store = new MySQLStore({
    createDatabaseTable: false,
    clearExpired: false,
    expiration: SESSION_MAX_AGE,
}, pool);

module.exports = createApp({
    pool,
    store,
    secret: process.env.SESSION_SECRET,
    production: process.env.NODE_ENV === "production",
});
