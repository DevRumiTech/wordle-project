const { mysql, localOptions, inspectSchema } = require('./local-database');
const { randomBytes, createHash } = require('node:crypto');
const { once } = require('node:events');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const createApp = require('../app');

// Optional verification using an already installed local Playwright package.
// No installation, download, schema change or committed test account.
function check(condition, label) { if (!condition) throw new Error(label); }
async function main() {
    const { chromium } = require(process.env.WORDLE_PLAYWRIGHT_PATH || 'playwright');
    const { createServer } = await import(pathToFileURL(path.resolve(__dirname, '../../frontend/node_modules/vite/dist/node/index.js')).href);
    const connection = await mysql.createConnection(localOptions());
    let appServer, vite, browser, store, before;
    let transaction = false;
    let phase = 'setup';
    async function fingerprint() {
        const hash = createHash('sha256');
        for (const table of ['users', 'words', 'games', 'attempts', 'sessions']) {
            const [rows] = await connection.query(`SELECT * FROM ${table} ORDER BY ${table === 'sessions' ? 'session_id' : 'id'}`);
            hash.update(JSON.stringify(rows));
        }
        return hash.digest('hex');
    }
    try {
        await inspectSchema(connection);
        before = await fingerprint();
        await connection.beginTransaction();
        transaction = true;
        store = new MySQLStore({ createDatabaseTable: false, clearExpired: false,
            endConnectionOnClose: false }, connection);
        await store.onReady();
        appServer = createApp({ pool: connection, store, secret: randomBytes(32).toString('hex') }).listen(0, '127.0.0.1');
        await once(appServer, 'listening');
        vite = await createServer({ root: path.resolve(__dirname, '../../frontend'),
            logLevel: 'silent', server: { host: '127.0.0.1', port: 0, open: false,
                proxy: { '/api': `http://127.0.0.1:${appServer.address().port}` } } });
        await vite.listen();
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        let browserErrors = 0;
        page.on('pageerror', () => browserErrors++);
        const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
        const username = `browser_${randomBytes(8).toString('hex')}`;
        const email = `${username}@example.invalid`;
        const password = randomBytes(24).toString('hex');
        phase = 'anonymous session and registration';
        await page.goto(origin);
        await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Create an account', exact: true }).click();
        await page.getByLabel('Username', { exact: true }).fill(username);
        await page.getByLabel('Email', { exact: true }).fill(email);
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Create account', exact: true }).click();
        await page.getByText('Account created. You can now sign in.', { exact: true }).waitFor();
        check(await page.getByLabel('Password', { exact: true }).inputValue() === '', 'Password clear');
        phase = 'invalid login';
        await page.getByLabel('Username or email').fill(username);
        await page.getByLabel('Password', { exact: true }).fill(randomBytes(24).toString('hex'));
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'Invalid username/email or password' }).waitFor();
        check(await page.getByLabel('Password', { exact: true }).inputValue() === '', 'Invalid password clear');
        phase = 'login and reload persistence';
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.getByRole('heading', { name: 'You’re signed in' }).waitFor();
        await page.reload();
        await page.getByRole('heading', { name: 'You’re signed in' }).waitFor();
        console.log('182 PASS: browser registration, invalid login, successful login and session restoration');
        phase = 'failed logout preserves account state';
        await page.route('**/api/auth/logout', route => route.fulfill({ status: 500,
            contentType: 'application/json', body: JSON.stringify({ error: 'Logout failed' }) }));
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'Logout failed' }).waitFor();
        check(await page.getByRole('heading', { name: 'You’re signed in' }).isVisible(), 'Failed logout state');
        await page.unroute('**/api/auth/logout');
        phase = 'logout and mobile layout';
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
        await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
        await page.reload();
        await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
        await page.setViewportSize({ width: 375, height: 812 });
        check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile horizontal fit');
        await page.getByLabel('Username or email').fill(email);
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByLabel('Password', { exact: true }).press('Enter');
        await page.getByRole('heading', { name: 'You’re signed in' }).waitFor();
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
        await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
        phase = 'network error and recovery';
        await page.route('**/api/auth/me', route => route.abort());
        await page.reload();
        await page.getByRole('alert').filter({ hasText: 'Cannot reach the server' }).waitFor();
        await page.unroute('**/api/auth/me');
        await page.getByRole('button', { name: 'Try again' }).click();
        await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
        check(browserErrors === 0, 'No uncaught browser errors');
        await page.screenshot({ path: '/private/tmp/wordle-auth-mobile.png', fullPage: true });
        console.log('183 PASS: logout failure/recovery, logout across reload, mobile email login, keyboard submission and network recovery');
    } catch {
        console.error(`Browser check failed during: ${phase}`);
        throw new Error('Browser verification failed');
    } finally {
        if (browser) await browser.close();
        if (vite) await vite.close();
        if (appServer) await new Promise(resolve => { appServer.close(resolve); appServer.closeAllConnections(); });
        if (store) await store.close();
        if (transaction) await connection.rollback();
        try {
            if (before) check(await fingerprint() === before, 'Existing database records changed');
            if (before) console.log('PASS: browser test transaction rolled back; existing database records unchanged');
        } finally { await connection.end(); }
    }
}
main().catch(() => { console.error('FAIL: browser authentication verification stopped safely'); process.exitCode = 1; });
