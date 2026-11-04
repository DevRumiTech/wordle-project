"use strict";

// Wordle permits a maximum of six guesses.
const MAX_ATTEMPTS = 6;

// Normalize five-letter words for English and French.
// French accents are removed consistently.
function normalizeWord(value) {
    if (typeof value !== "string") return null;

    const word = value.trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();

    // Reject numbers, spaces and unsupported characters.
    return /^[A-Z]{5}$/.test(word) ? word : null;
}

// Calculate Wordle feedback using two passes.
function evaluateGuess(secret, guess) {
    const solution = normalizeWord(secret);
    const attempt = normalizeWord(guess);

    if (!solution || !attempt) {
        throw new Error("Both words must have five valid letters");
    }

    const feedback = Array(5).fill("absent");
    const remaining = new Map();

    // First pass: mark correctly positioned letters.
    for (let i = 0; i < 5; i++) {
        if (attempt[i] === solution[i]) {
            feedback[i] = "correct";
        } else {
            const letter = solution[i];
            remaining.set(
                letter,
                (remaining.get(letter) ?? 0) + 1
            );
        }
    }

    // Second pass: mark letters in other positions.
    // Count each remaining occurrence only once.
    for (let i = 0; i < 5; i++) {
        if (feedback[i] === "correct") continue;

        const letter = attempt[i];
        const count = remaining.get(letter) ?? 0;

        if (count > 0) {
            feedback[i] = "present";
            remaining.set(letter, count - 1);
        }
    }

    return feedback;
}

// Calculate scores exclusively from finished games.
function calculateScore(status, attemptsUsed) {
    if (!Number.isInteger(attemptsUsed) ||
        attemptsUsed < 1 ||
        attemptsUsed > MAX_ATTEMPTS) {
        throw new RangeError("Invalid attempt count");
    }

    if (status === "lost") {
        if (attemptsUsed !== MAX_ATTEMPTS) {
            throw new Error("A loss requires six attempts");
        }
        return 0;
    }

    if (status !== "won") {
        throw new Error("Game must be finished");
    }

    const scores = [0, 1000, 800, 600, 400, 200, 100];
    return scores[attemptsUsed];
}

module.exports = {
    MAX_ATTEMPTS,
    normalizeWord,
    evaluateGuess,
    calculateScore,
};