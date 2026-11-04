"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const createGameRouter = require("../routes/games");

// Simulate a MySQL connection without changing real data.
function fakePool(options = {}) {
    const events = [];
    const game = options.game === undefined
        ? {
            id: 12,
            word_id: 4,
            language: "en",
            status: "in_progress",
            attempts_used: 0,
        }
        : options.game;

    const connection = {
        async beginTransaction() {
            events.push("begin");
        },

        async execute(sql, params) {
            events.push({ sql, params });

            // Lock and retrieve the current user's game.
            if (sql.includes("FROM games") &&
                sql.includes("FOR UPDATE")) {
                return [game ? [game] : []];
            }

            // Check whether the guess belongs to the dictionary.
            if (sql.includes("is_valid_guess = 1")) {
                return [options.invalidDictionary ? [] : [{ id: 8 }]];
            }

            // Retrieve the server-side solution.
            if (sql.includes("SELECT word FROM words")) {
                return [[{ word: options.secret ?? "APPLE" }]];
            }

            // Save a guess.
            if (sql.includes("INSERT INTO attempts")) {
                return [{ insertId: 50 }];
            }

            // Update the game.
            if (sql.includes("UPDATE games")) {
                return [{
                    affectedRows: options.failedUpdate ? 0 : 1,
                }];
            }

            throw new Error("Unexpected SQL statement");
        },

        async commit() {
            events.push("commit");
        },

        async rollback() {
            events.push("rollback");
        },

        release() {
            events.push("release");
        },
    };

    return {
        events,
        async getConnection() {
            events.push("connection");
            return connection;
        },
    };
}

// Send requests through a temporary local Express application.
async function submitGuess(pool, id, word, userId = 7) {
    const app = express();
    app.use(express.json());

    // Simulate the authenticated browser session.
    app.use((req, res, next) => {
        if (userId !== null) req.session = { userId };
        next();
    });

    app.use("/api/games", createGameRouter(pool));

    // Avoid exposing internal errors during tests.
    app.use((error, req, res, next) => {
        res.status(500).json({ error: "Internal server error" });
    });

    const server = await new Promise((resolve) => {
        const instance = app.listen(0, "127.0.0.1", () => {
            resolve(instance);
        });
    });

    try {
        const response = await fetch(
            `http://127.0.0.1:${server.address().port}/api/games/${id}/attempts`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ word }),
            }
        );

        return {
            status: response.status,
            body: await response.json(),
        };
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }
}

test("271: anonymous guesses are rejected", async () => {
    const pool = fakePool();
    const result = await submitGuess(pool, "12", "APPLE", null);

    assert.equal(result.status, 401);
    assert.equal(pool.events.length, 0);
});

test("271: invalid game IDs and words are rejected", async () => {
    const pool = fakePool();

    assert.equal(
        (await submitGuess(pool, "abc", "APPLE")).status,
        400
    );

    assert.equal(
        (await submitGuess(pool, "12", "CAT")).status,
        400
    );

    assert.equal(pool.events.length, 0);
});

test("272: inaccessible games return 404", async () => {
    const pool = fakePool({ game: null });
    const result = await submitGuess(pool, "12", "APPLE");

    assert.equal(result.status, 404);
    assert.ok(pool.events.includes("rollback"));
    assert.ok(pool.events.includes("release"));
});

test("272: finished games reject new guesses", async () => {
    const pool = fakePool({
        game: {
            id: 12,
            word_id: 4,
            language: "en",
            status: "won",
            attempts_used: 2,
        },
    });

    const result = await submitGuess(pool, "12", "APPLE");

    assert.equal(result.status, 409);
    assert.ok(pool.events.includes("rollback"));
});

test("273: words outside the dictionary are rejected", async () => {
    const pool = fakePool({ invalidDictionary: true });
    const result = await submitGuess(pool, "12", "ZZZZZ");

    assert.equal(result.status, 400);
    assert.ok(pool.events.includes("rollback"));
});

test("274: unfinished games hide solution and score", async () => {
    const pool = fakePool();
    const result = await submitGuess(pool, "12", "PEACH");

    assert.equal(result.status, 200);
    assert.equal(result.body.status, "in_progress");
    assert.equal(result.body.attemptNumber, 1);
    assert.equal(result.body.attemptsRemaining, 5);

    assert.deepEqual(
        result.body.feedback,
        ["present", "present", "present", "absent", "absent"]
    );

    assert.equal("solution" in result.body, false);
    assert.equal("score" in result.body, false);

    assert.ok(pool.events.includes("commit"));
    assert.ok(pool.events.includes("release"));

    // Verify the database records receive consistent values.
    const insert = pool.events.find(
        (item) => item.sql?.includes("INSERT INTO attempts")
    );
    const update = pool.events.find(
        (item) => item.sql?.includes("UPDATE games")
    );

    assert.equal(insert.params[1], 1);
    assert.equal(update.params[0], 1);
    assert.equal(update.params[1], "in_progress");
});

test("274: victory scores depend on attempts", async () => {
    const pool = fakePool({
        game: {
            id: 12,
            word_id: 4,
            language: "en",
            status: "in_progress",
            attempts_used: 1,
        },
    });

    const result = await submitGuess(pool, "12", "APPLE");

    assert.equal(result.status, 200);
    assert.equal(result.body.status, "won");
    assert.equal(result.body.attemptNumber, 2);
    assert.equal(result.body.score, 800);
    assert.equal("solution" in result.body, false);
    assert.ok(pool.events.includes("commit"));
});

test("274: sixth incorrect guess ends in defeat", async () => {
    const pool = fakePool({
        game: {
            id: 12,
            word_id: 4,
            language: "en",
            status: "in_progress",
            attempts_used: 5,
        },
    });

    const result = await submitGuess(pool, "12", "CRANE");

    assert.equal(result.status, 200);
    assert.equal(result.body.status, "lost");
    assert.equal(result.body.attemptsRemaining, 0);
    assert.equal(result.body.score, 0);
    assert.equal(result.body.solution, "APPLE");
});

test("274: failed database update rolls back", async () => {
    const pool = fakePool({ failedUpdate: true });
    const result = await submitGuess(pool, "12", "APPLE");

    assert.equal(result.status, 500);
    assert.ok(pool.events.includes("rollback"));
    assert.ok(pool.events.includes("release"));
    assert.equal(pool.events.includes("commit"), false);
});

test("274: French accented guesses normalize", async () => {
    const pool = fakePool({
        secret: "ECOLE",
        game: {
            id: 12,
            word_id: 4,
            language: "fr",
            status: "in_progress",
            attempts_used: 0,
        },
    });

    const result = await submitGuess(pool, "12", "école");

    assert.equal(result.status, 200);
    assert.equal(result.body.status, "won");
    assert.equal(result.body.score, 1000);
});