import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_GUESSES,
  addLetter,
  removeLetter,
  keyboardStatuses,
} from '../src/game/logic.js'

test('299: a game provides six rows', () => {
  assert.equal(MAX_GUESSES, 6)
})

test('301: keyboard accepts only five letters', () => {
  assert.equal(addLetter('AB', 'c'), 'ABC')
  assert.equal(addLetter('ABCD', 'E'), 'ABCDE')
  assert.equal(addLetter('ABCDE', 'F'), 'ABCDE')
  assert.equal(addLetter('ABC', '7'), 'ABC')
  assert.equal(addLetter('ABC', 'é'), 'ABCE')
})

test('301: delete removes the last letter', () => {
  assert.equal(removeLetter('APPLE'), 'APPL')
  assert.equal(removeLetter(''), '')
})

test('303: correct feedback takes priority on the keyboard', () => {
  const statuses = keyboardStatuses([
    {
      word: 'APPLE',
      feedback: [
        'correct', 'absent', 'absent', 'present', 'absent'
      ],
    },
    {
      word: 'PEACH',
      feedback: [
        'present', 'correct', 'absent', 'absent', 'absent'
      ],
    },
  ])

  assert.equal(statuses.A, 'correct')
  assert.equal(statuses.P, 'present')
  assert.equal(statuses.E, 'correct')
  assert.equal(statuses.C, 'absent')
})