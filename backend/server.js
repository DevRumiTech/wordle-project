require("dotenv").config();
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const pool = require("./db");
const createApp = require("./app");
const { SESSION_MAX_AGE } = require("./session-config");

const sessionStore = new MySQLStore({
    createDatabaseTable: false,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: SESSION_MAX_AGE,
}, pool);

const app = createApp({
    pool, store: sessionStore, secret: process.env.SESSION_SECRET,
    production: process.env.NODE_ENV === "production",
});

sessionStore.onReady().then(() => {
    app.listen(3001, () => console.log("Server running on http://localhost:3001"));
}).catch(() => {
    console.error("Session store unavailable");
    process.exitCode = 1;
    sessionStore.close();
});
