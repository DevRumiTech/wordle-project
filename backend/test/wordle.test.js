"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    MAX_ATTEMPTS,
    normalizeWord,
    evaluateGuess,
    calculateScore,
} = require("../services/wordle");

test("266: normalize English and French words", () => {
    assert.equal(normalizeWord(" hello "), "HELLO");
    assert.equal(normalizeWord("école"), "ECOLE");
    assert.equal(normalizeWord("ÉTAGE"), "ETAGE");
    assert.equal(normalizeWord("hello!"), null);
    assert.equal(normalizeWord("cat"), null);
    assert.equal(normalizeWord(null), null);
});

test("267: all letters correct", () => {
    assert.deepEqual(
        evaluateGuess("CRANE", "CRANE"),
        Array(5).fill("correct")
    );
});

test("267: repeated letters respect available counts", () => {
    assert.deepEqual(
        evaluateGuess("APPLE", "PAPAL"),
        ["present", "present", "correct", "absent", "present"]
    );

    assert.deepEqual(
        evaluateGuess("BANAL", "AAAAA"),
        ["absent", "correct", "absent", "correct", "absent"]
    );
});

test("267: invalid words are rejected", () => {
    assert.throws(() => evaluateGuess("CAT", "CRANE"));
    assert.throws(() => evaluateGuess("APPLE", "12345"));
});

test("268: exact scoring table", () => {
    assert.equal(MAX_ATTEMPTS, 6);

    const expected = [1000, 800, 600, 400, 200, 100];

    for (let attempt = 1; attempt <= 6; attempt++) {
        assert.equal(
            calculateScore("won", attempt),
            expected[attempt - 1]
        );
    }

    assert.equal(calculateScore("lost", 6), 0);
});

test("268: invalid score states are rejected", () => {
    assert.throws(() => calculateScore("won", 0));
    assert.throws(() => calculateScore("won", 7));
    assert.throws(() => calculateScore("lost", 3));
    assert.throws(() => calculateScore("in_progress", 2));
});