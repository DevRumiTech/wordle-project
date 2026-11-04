import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from '../src/api/auth.js'

function fixture(responses) {
  const calls = []
  const api = createAuthApi(async (url, options) => {
    calls.push({ url, options })
    const item = responses.shift()
    if (item instanceof Error) throw item
    return { ok: item.status < 400, status: item.status, json: async () => item.data }
  })
  return { api, calls }
}

test('181: session restoration distinguishes signed-out from server failure', async () => {
  const { api } = fixture([{ status: 200, data: { userId: 3 } },
    { status: 401, data: { error: 'Not authenticated' } },
    { status: 500, data: { error: 'Server error' } }])
  assert.deepEqual(await api.me(), { userId: 3 })
  assert.equal(await api.me(), null)
  await assert.rejects(api.me(), error => error.status === 500)
})

test('181: login and logout use fresh CSRF tokens and browser credentials', async () => {
  const { api, calls } = fixture([{ status: 200, data: { csrfToken: 'first' } },
    { status: 200, data: {} }, { status: 200, data: { csrfToken: 'second' } },
    { status: 200, data: {} }])
  await api.login({ identifier: 'synthetic' })
  await api.logout()
  assert.deepEqual(calls.map(call => call.url), ['/api/auth/csrf', '/api/auth/login', '/api/auth/csrf', '/api/auth/logout'])
  assert.ok(calls.every(call => call.options.credentials === 'same-origin' && call.options.cache === 'no-store'))
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'first')
  assert.equal(calls[3].options.headers['X-CSRF-Token'], 'second')
  assert.equal(calls[1].options.method, 'POST')
})

test('181: registration propagates conflicts without automatically retrying mutations', async () => {
  const { api, calls } = fixture([{ status: 200, data: { csrfToken: 'test' } },
    { status: 409, data: { error: 'Username or email already exists' } }])
  await assert.rejects(api.register({ username: 'synthetic' }), error => error.status === 409)
  assert.equal(calls.length, 2)
})

test('181: failed CSRF acquisition prevents mutation', async () => {
  for (const response of [{ status: 403, data: {} }, { status: 200, data: {} }]) {
    const { api, calls } = fixture([response])
    await assert.rejects(api.logout())
    assert.equal(calls.length, 1)
  }
})

test('181: network failures and invalid account responses fail safely', async () => {
  const { api } = fixture([new Error('private details'), { status: 200, data: {} }])
  await assert.rejects(api.me(), /Cannot reach the server/)
  await assert.rejects(api.me(), /unexpected account response/)
})
