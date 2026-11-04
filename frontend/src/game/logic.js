export const MAX_GUESSES = 6

// Accept one letter, including normalized French accents.
export function addLetter(current, input) {
  if (typeof input !== 'string') return current

  const letter = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()

  if (!/^[A-Z]$/.test(letter) || current.length >= 5) {
    return current
  }

  return current + letter
}

// Remove the final letter without affecting earlier letters.
export function removeLetter(current) {
  return current.slice(0, -1)
}

// Stronger feedback must not be replaced by weaker feedback.
export function keyboardStatuses(guesses) {
  const ranks = { absent: 1, present: 2, correct: 3 }
  const statuses = {}

  for (const guess of guesses) {
    for (let i = 0; i < 5; i++) {
      const letter = guess.word[i]
      const status = guess.feedback[i]

      if ((ranks[status] ?? 0) >
          (ranks[statuses[letter]] ?? 0)) {
        statuses[letter] = status
      }
    }
  }

  return statuses
}