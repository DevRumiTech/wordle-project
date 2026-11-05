import test from 'node:test'
import assert from 'node:assert/strict'

import {
  readActiveGameId,
  saveActiveGameId,
  clearActiveGameId,
} from '../src/game/activeGame.js'

function memoryStorage() {
  const values = new Map()

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, value)
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}

test('319: save and retrieve the active game ID', () => {
  const storage = memoryStorage()

  assert.equal(saveActiveGameId('123', storage), true)
  assert.equal(readActiveGameId(storage), '123')
})

test('319: invalid identifiers are rejected', () => {
  const storage = memoryStorage()

  assert.equal(saveActiveGameId('invalid', storage), false)
  assert.equal(saveActiveGameId('0', storage), false)
  assert.equal(
    saveActiveGameId('18446744073709551616', storage),
    false
  )
  assert.equal(readActiveGameId(storage), null)
})

test('321: completing a game removes its saved ID', () => {
  const storage = memoryStorage()

  saveActiveGameId(42, storage)
  assert.equal(clearActiveGameId(storage), true)
  assert.equal(readActiveGameId(storage), null)
})

test('322: unavailable storage does not crash the game', () => {
  const unavailable = {
    getItem() { throw new Error('Storage blocked') },
    setItem() { throw new Error('Storage blocked') },
    removeItem() { throw new Error('Storage blocked') },
  }

  assert.equal(readActiveGameId(unavailable), null)
  assert.equal(saveActiveGameId(42, unavailable), false)
  assert.equal(clearActiveGameId(unavailable), false)
})