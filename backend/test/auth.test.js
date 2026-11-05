const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const session = require('express-session');
const bcrypt = require('bcrypt');
const createApp = require('../app');
const { cookieOptions, SESSION_MAX_AGE } = require('../session-config');

// Entirely synthetic accounts and sessions; never import db.js or read .env.
async function fixture(t, options = {}) {
    const password = randomBytes(18).toString('hex');
    const hash = await bcrypt.hash(password, 4);
    const queries = [];
    const pool = { async execute(sql, params) {
        queries.push({ sql, params });
        if (options.dbFailure) throw new Error('synthetic private database details');
        if (sql.startsWith('SELECT id FROM')) return [options.duplicate ? [{ id: 1 }] : []];
        // Return account details for the authenticated profile endpoint.
        if (sql.includes('SELECT username, email, created_at FROM users')) {
            return [options.profileMissing ? [] : [{
                username: 'player',
                email: 'player@example.test',
                created_at: '2026-10-19T09:00:00.000Z'
            }]];
        }
        if (sql.includes('INSERT')) {
            if (options.duplicateRace) throw Object.assign(new Error(), { code: 'ER_DUP_ENTRY' });
            return [{ insertId: 2 }];
        }
        return [params[0] === 'player' || params[0] === 'player@example.test'
            ? [{ id: 1, username: 'player', email: 'player@example.test', password_hash: hash }] : []];
    }, async query() { return [[{ ok: 1 }]]; } };
    const store = new session.MemoryStore();
    const app = createApp({ pool, store, secret: randomBytes(32).toString('hex'), ...options });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    let cookie;
    let token;
    async function request(path, { method = 'GET', body, csrf = true, useCookie = cookie, raw } = {}) {
        const headers = {};
        if (useCookie) headers.Cookie = useCookie;
        if (csrf && token) headers['X-CSRF-Token'] = token;
        if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth${path}`, {
            method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const data = await response.json();
        return { status: response.status, data, headers: response.headers, setCookie };
    }
    async function csrf() {
        const result = await request('/csrf');
        token = result.data.csrfToken;
        return result;
    }
    async function login(identifier = 'player') {
        await csrf();
        return request('/login', { method: 'POST', body: { identifier, password } });
    }
    return { request, csrf, login, store, queries, password, get cookie() { return cookie; } };
}

test('164: logout destroys stored session and rejects replay', async t => {
    const f = await fixture(t);
    assert.equal((await f.login()).status, 200);
    assert.equal((await f.request('/me')).status, 200);
    await f.csrf();
    const oldCookie = f.cookie;
    assert.equal((await f.request('/logout', { method: 'POST' })).status, 200);
    assert.equal(Object.keys(f.store.sessions).length, 0);
    assert.equal((await f.request('/me', { useCookie: oldCookie })).status, 401);
});

test('165: cookie attributes and logout deletion match; anonymous logout is safe', async t => {
    const f = await fixture(t);
    const initial = await f.csrf();
    assert.ok(initial.setCookie.includes('HttpOnly'));
    assert.ok(initial.setCookie.includes('SameSite=Lax'));
    assert.ok(initial.setCookie.includes('Path=/'));
    assert.ok(!initial.setCookie.includes('Secure'));
    const result = await f.request('/logout', { method: 'POST' });
    assert.equal(result.status, 200);
    assert.ok(result.setCookie.includes('Expires=Thu, 01 Jan 1970'));
    assert.deepEqual(cookieOptions(true), { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    await f.csrf();
    assert.equal((await f.request('/logout', { method: 'POST' })).status, 200);
});

test('166: failed destruction does not falsely report logout success', async t => {
    const f = await fixture(t);
    await f.login();
    await f.csrf();
    f.store.destroy = (id, callback) => callback(new Error('private store details'));
    const result = await f.request('/logout', { method: 'POST' });
    assert.equal(result.status, 500);
    assert.equal(result.setCookie, null);
    assert.deepEqual(result.data, { error: 'Logout failed' });
});

test('167: login rotates sessions and only succeeds after persistence', async t => {
    const f = await fixture(t);
    await f.csrf();
    const oldCookie = f.cookie;
    assert.equal((await f.login()).status, 200);
    assert.ok(f.cookie !== oldCookie);
    assert.equal((await f.request('/me', { useCookie: oldCookie })).status, 401);
    assert.deepEqual((await f.request('/me')).data, { userId: 1, username: 'player', email: 'player@example.test', createdAt: '2026-10-19T09:00:00.000Z' });
    await f.csrf();
    f.store.set = (id, value, callback) => callback(new Error('private storage details'));
    const result = await f.request('/login', { method: 'POST', body: { identifier: 'player', password: f.password } });
    assert.equal(result.status, 500);
    assert.deepEqual(result.data, { error: 'Session error' });
    assert.equal((await f.request('/me')).status, 401);
});

test('168: missing, wrong, cross-session and pre-login CSRF tokens are rejected', async t => {
    const f = await fixture(t);
    for (const path of ['/register', '/login', '/logout']) {
        assert.equal((await f.request(path, { method: 'POST', csrf: false, body: {} })).status, 403);
    }
    const before = await f.csrf();
    const id = Object.keys(f.store.sessions)[0];
    const record = JSON.parse(f.store.sessions[id]);
    record.csrfToken = 'x'.repeat(64);
    f.store.sessions[id] = JSON.stringify(record);
    assert.equal((await f.request('/logout', { method: 'POST' })).status, 403);
    await f.login();
    // Login regenerated the session, so the cached token is no longer valid.
    assert.equal((await f.request('/logout', { method: 'POST' })).status, 403);
    await f.csrf();
    assert.equal((await f.request('/logout', { method: 'POST', useCookie: before.setCookie.split(';')[0] })).status, 403);
});

test('169: absolute expiration, anonymous privacy and no-store responses', async t => {
    const f = await fixture(t);
    const anonymous = await f.request('/me');
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.setCookie, null);
    assert.equal(anonymous.headers.get('cache-control'), 'no-store');
    await f.login();
    const id = Object.keys(f.store.sessions)[0];
    const record = JSON.parse(f.store.sessions[id]);
    record.authenticatedAt = Date.now() - SESSION_MAX_AGE - 1;
    f.store.sessions[id] = JSON.stringify(record);
    assert.equal((await f.request('/me')).status, 401);
    assert.equal(Object.keys(f.store.sessions).length, 0);
});

test('170: login throttling returns 429 and retry information', async t => {
    const f = await fixture(t, { loginLimit: 2 });
    await f.csrf();
    for (let i = 0; i < 2; i++) assert.equal((await f.request('/login', {
        method: 'POST', body: { identifier: 'missing', password: f.password },
    })).status, 401);
    const result = await f.request('/login', { method: 'POST', body: {} });
    assert.equal(result.status, 429);
    assert.ok(Number(result.headers.get('retry-after')) > 0);
});

test('171: username/email login, invalid credentials and bounded input', async t => {
    const f = await fixture(t);
    assert.equal((await f.login('player@example.test')).status, 200);
    await f.csrf();
    for (const body of [{ identifier: 'player', password: 'incorrect' },
        { identifier: "' OR 1=1 --", password: f.password }]) {
        const result = await f.request('/login', { method: 'POST', body });
        assert.equal(result.status, 401);
        assert.deepEqual(result.data, { error: 'Invalid username/email or password' });
    }
    for (const body of [{}, { identifier: [], password: f.password },
        { identifier: 'x'.repeat(256), password: f.password },
        { identifier: 'player', password: 'é'.repeat(37) }]) {
        assert.equal((await f.request('/login', { method: 'POST', body })).status, 400);
    }
    assert.ok(f.queries.every(query => !query.sql.includes("' OR 1=1")));
});

test('172: registration validates, hashes and uses parameterized SQL', async t => {
    const f = await fixture(t);
    await f.csrf();
    const body = { username: ' new-player ', email: ' NEW@example.test ', password: f.password };
    assert.equal((await f.request('/register', { method: 'POST', body })).status, 201);
    const insert = f.queries.find(query => query.sql.includes('INSERT'));
    assert.equal(insert.params[0], 'new-player');
    assert.equal(insert.params[1], 'new@example.test');
    assert.ok(await bcrypt.compare(f.password, insert.params[2]));
    for (const invalid of [{ ...body, password: 'short' }, { ...body, email: 'bad' },
        { ...body, username: ' ' }, { ...body, password: 'é'.repeat(37) }]) {
        assert.equal((await f.request('/register', { method: 'POST', body: invalid })).status, 400);
    }
});

for (const option of ['duplicate', 'duplicateRace']) test(`172: registration handles ${option}`, async t => {
    const f = await fixture(t, { [option]: true });
    await f.csrf();
    assert.equal((await f.request('/register', { method: 'POST', body: {
        username: 'player', email: 'player@example.test', password: f.password,
    } })).status, 409);
});

test('173: malformed/oversized JSON and backend failures return safe JSON', async t => {
    const f = await fixture(t, { dbFailure: true });
    assert.equal((await f.request('/login', { method: 'POST', raw: '{' })).status, 400);
    assert.equal((await f.request('/login', { method: 'POST', body: { value: 'x'.repeat(17000) } })).status, 413);
    const result = await f.login();
    assert.equal(result.status, 500);
    assert.deepEqual(result.data, { error: 'Server error' });
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.throws(() => createApp({ store: f.store, secret: '' }), /session secret/);
});

test('167: regeneration failure returns a safe error', async t => {
    const f = await fixture(t);
    await f.csrf();
    f.store.destroy = (id, callback) => callback(new Error('private store details'));
    const result = await f.request('/login', { method: 'POST', body: { identifier: 'player', password: f.password } });
    assert.equal(result.status, 500);
    assert.deepEqual(result.data, { error: 'Session error' });
});

test('169: expired and tampered cookies cannot authenticate', async t => {
    const f = await fixture(t);
    await f.login();
    const saved = f.cookie;
    assert.equal((await f.request('/me', { useCookie: saved + 'tampered' })).status, 401);
    const id = Object.keys(f.store.sessions)[0];
    const record = JSON.parse(f.store.sessions[id]);
    record.cookie.expires = new Date(Date.now() - 1000).toISOString();
    f.store.sessions[id] = JSON.stringify(record);
    assert.equal((await f.request('/me', { useCookie: saved })).status, 401);
});

test('165: production refuses to send session cookies over plain HTTP', async t => {
    const f = await fixture(t, { production: true });
    assert.equal((await f.csrf()).setCookie, null);
});

test('359: profile returns only the signed-in account details', async t => {
    const f = await fixture(t);

    // Anonymous visitors cannot retrieve account details.
    assert.equal((await f.request('/me')).status, 401);

    await f.login();
    const result = await f.request('/me');

    assert.equal(result.status, 200);
    assert.deepEqual(result.data, {
        userId: 1,
        username: 'player',
        email: 'player@example.test',
        createdAt: '2026-10-19T09:00:00.000Z'
    });

    // Password hashes must never appear in the response.
    assert.equal('password_hash' in result.data, false);

    const query = f.queries.find(item =>
        item.sql.includes('SELECT username, email, created_at FROM users')
    );
    assert.deepEqual(query.params, [1]);
});

test('360: missing user accounts cannot expose a profile', async t => {
    const f = await fixture(t, { profileMissing: true });

    assert.equal((await f.login()).status, 200);

    const result = await f.request('/me');
    assert.equal(result.status, 401);
    assert.deepEqual(result.data, { error: 'Account unavailable' });
});