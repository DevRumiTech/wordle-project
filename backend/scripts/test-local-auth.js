const { mysql, localOptions, inspectSchema } = require('./local-database');
const { once } = require('node:events');
const { randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const createApp = require('../app');
const { SESSION_MAX_AGE } = require('../session-config');

// Throw only fixed descriptions: assertion output must never contain secrets.
function check(condition, description) { if (!condition) throw new Error(description); }
async function main() {
    const options = localOptions();
    const accountConnection = await mysql.createConnection(options);
    let sessionPool;
    let store;
    let server;
    let base;
    let cookie;
    let token;
    let fixtureId;
    let before;
    let transaction = false;
    const ownedSessions = new Set();
    const secret = randomBytes(32).toString('hex');
    const username = `verify_${randomBytes(8).toString('hex')}`;
    const email = `${username}@example.invalid`;
    const password = randomBytes(24).toString('hex');

    // Fingerprints remain in memory; no account, game or session content is logged.
    async function fingerprint() {
        const hash = createHash('sha256');
        for (const table of ['users', 'words', 'games', 'attempts', 'sessions']) {
            const key = table === 'sessions' ? 'session_id' : 'id';
            const [rows] = await accountConnection.query(`SELECT * FROM ${table} ORDER BY ${key}`);
            hash.update(JSON.stringify(rows));
        }
        return hash.digest('hex');
    }
    async function stopApp() {
        if (server) {
            await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
            server = undefined;
        }
        if (store) { await store.close(); store = undefined; }
        if (sessionPool) { await sessionPool.end(); sessionPool = undefined; }
    }
    async function startApp() {
        sessionPool = mysql.createPool({ ...options, connectionLimit: 2 });
        store = new MySQLStore({ createDatabaseTable: false, clearExpired: false,
            endConnectionOnClose: false, expiration: SESSION_MAX_AGE }, sessionPool);
        await store.onReady();
        const originalSet = store.set.bind(store);
        store.set = (id, value, callback) => {
            ownedSessions.add(id);
            return originalSet(id, value, callback);
        };
        const app = createApp({ pool: accountConnection, store, secret });
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        base = `http://127.0.0.1:${server.address().port}/api/auth`;
    }
    async function request(route, { body, csrf = true, overrideCookie = cookie, overrideToken = token } = {}) {
        const headers = {};
        if (overrideCookie) headers.Cookie = overrideCookie;
        if (csrf && overrideToken) headers['X-CSRF-Token'] = overrideToken;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
            headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return { status: response.status, data: await response.json(), headers: response.headers };
    }
    async function getCsrf() {
        const result = await request('/csrf');
        check(result.status === 200 && typeof result.data.csrfToken === 'string', 'CSRF retrieval');
        token = result.data.csrfToken;
    }
    async function sessionRows() {
        const [rows] = await sessionPool.query('SELECT session_id, expires, data FROM sessions');
        return rows.filter(row => ownedSessions.has(row.session_id));
    }
    try {
        await inspectSchema(accountConnection);
        before = await fingerprint();
        console.log('174 PASS: actual local MySQL schema and InnoDB authentication tables');
        const sql = fs.readFileSync(path.resolve(__dirname, '../database.sql'), 'utf8');
        check(/created_at DATETIME DEFAULT CURRENT_TIMESTAMP/.test(sql) &&
            /CREATE TABLE IF NOT EXISTS sessions/.test(sql), 'Setup schema definitions');
        console.log('175 PASS: setup SQL includes existing creation timestamp and session definitions; no DDL executed');
        await accountConnection.beginTransaction();
        transaction = true;
        await startApp();
        await getCsrf();
        check((await request('/register', { body: { username, email, password } })).status === 201, 'Registration');
        const [accounts] = await accountConnection.execute('SELECT id, password_hash, created_at FROM users WHERE username = ? AND email = ?', [username, email]);
        check(accounts.length === 1 && accounts[0].created_at && await bcrypt.compare(password, accounts[0].password_hash), 'Stored account hash and timestamp');
        fixtureId = accounts[0].id;
        check((await request('/register', { body: { username, email, password } })).status === 409, 'Duplicate registration');
        console.log('176 PASS: real registration, stored bcrypt hash, creation timestamp and duplicate rejection');
        check((await request('/login', { body: { identifier: username, password: randomBytes(24).toString('hex') } })).status === 401, 'Incorrect password');
        const anonymousCookie = cookie;
        check((await request('/login', { body: { identifier: username, password } })).status === 200, 'Username login');
        const authenticatedCookie = cookie;
        check(authenticatedCookie !== anonymousCookie, 'Session rotation');
        check((await request('/me', { overrideCookie: anonymousCookie })).status === 401, 'Old session replay');
        check((await request('/me')).data.userId === fixtureId, 'Authenticated identity');
        check((await sessionRows()).some(row => JSON.parse(row.data).userId === fixtureId), 'Persisted session row');
        console.log('177 PASS: real password validation, username login, rotation and stored session');
        await stopApp();
        await startApp();
        check((await request('/me')).data.userId === fixtureId, 'Session after app/store/connection recreation');
        console.log('178 PASS: session survives app/store recreation and all session database connections closing');
        for (const route of ['/register', '/login', '/logout']) {
            check((await request(route, { body: {}, csrf: false })).status === 403, 'Missing CSRF rejected');
        }
        check((await request('/logout', { body: {}, overrideToken: randomBytes(32).toString('hex') })).status === 403, 'Wrong CSRF rejected');
        check((await request('/logout', { body: {} })).status === 403, 'Pre-login CSRF rejected');
        await getCsrf();
        check((await request('/me')).data.userId === fixtureId, 'Rejected CSRF leaves session intact');
        console.log('179 PASS: missing, incorrect and stale CSRF tokens rejected without logout');
        check((await request('/logout', { body: {} })).status === 200, 'Logout');
        check(!(await sessionRows()).some(row => JSON.parse(row.data).userId === fixtureId), 'Logout removed stored session');
        check((await request('/me', { overrideCookie: authenticatedCookie })).status === 401, 'Logged-out cookie replay');
        await getCsrf();
        check((await request('/login', { body: { identifier: email, password } })).status === 200, 'Email login');
        const own = (await sessionRows()).find(row => JSON.parse(row.data).userId === fixtureId);
        check(Boolean(own), 'Expiration fixture');
        await sessionPool.execute('UPDATE sessions SET expires = ? WHERE session_id = ?', [Math.floor(Date.now() / 1000) - 10, own.session_id]);
        check((await request('/me')).status === 401, 'MySQL expiration');
        console.log('180 PASS: logout deletion/replay, email reconnection and database session expiration');
    } finally {
        await stopApp();
        if (transaction) await accountConnection.rollback();
        for (const id of ownedSessions) {
            await accountConnection.execute('DELETE FROM sessions WHERE session_id = ?', [id]);
        }
        try {
            if (before) check(await fingerprint() === before, 'Existing data changed during verification');
            if (before) console.log('PASS: fixture account rolled back, only test sessions removed, existing records unchanged');
        } finally { await accountConnection.end(); }
    }
}
main().catch(() => {
    console.error('FAIL: local authentication verification stopped; review the last completed check. No DDL was executed.');
    process.exitCode = 1;
});
