"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const createGameRouter = require("../routes/games");

// Test the API using simulated MySQL responses.
async function request(path, pool, userId = 7) {
    const app = express();

    app.use((req, res, next) => {
        if (userId !== null) req.session = { userId };
        next();
    });

    app.use("/api/games", createGameRouter(pool));

    // Hide database errors from HTTP clients.
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
            `http://127.0.0.1:${server.address().port}${path}`
        );
        return {
            status: response.status,
            body: await response.json(),
        };
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) =>
                error ? reject(error) : resolve()
            );
        });
    }
}

test("276: history contains completed games only", async () => {
    const pool = {
        execute: async (sql, params) => {
            assert.match(sql, /user_id = \?/);
            assert.match(sql, /status IN/);
            assert.deepEqual(params, [7, 20, 0]);

            return [[{
                id: 11,
                language: "en",
                status: "won",
                score: 800,
                attempts_used: 2,
            }]];
        },
    };

    const result = await request("/api/games/history", pool);
    assert.equal(result.status, 200);
    assert.equal(result.body.games.length, 1);
    assert.equal(result.body.games[0].score, 800);
});

test("276: invalid pagination is rejected", async () => {
    const pool = {
        execute: async () => {
            throw new Error("Database should not be called");
        },
    };

    const result = await request(
        "/api/games/history?limit=500",
        pool
    );
    assert.equal(result.status, 400);
});

test("277: statistics follow database results", async () => {
    let calls = 0;
    const pool = {
        execute: async (sql, params) => {
            assert.deepEqual(params, [7]);
            calls++;

            if (calls === 1) {
                return [[{
                    totalGames: 4,
                    wins: 3,
                    losses: 1,
                    totalScore: 2000,
                    averageWinAttempts: "2.6667",
                }]];
            }

            return [[{ longestWinStreak: 2 }]];
        },
    };

    const result = await request("/api/games/stats", pool);

    assert.equal(result.status, 200);
    assert.equal(result.body.totalGames, 4);
    assert.equal(result.body.wins, 3);
    assert.equal(result.body.losses, 1);
    assert.equal(result.body.winRate, 75);
    assert.equal(result.body.totalScore, 2000);
    assert.equal(result.body.averageWinAttempts, 2.67);
    assert.equal(result.body.longestWinStreak, 2);
});

test("278: active game never exposes its secret", async () => {
    const pool = {
        execute: async (sql, params) => {
            if (sql.includes("FROM games g")) {
                assert.deepEqual(params, ["12", 7]);
                return [[{
                    id: 12,
                    language: "en",
                    status: "in_progress",
                    attempts_used: 1,
                    score: 0,
                    solution: "APPLE",
                }]];
            }

            return [[{
                attempt_number: 1,
                guessed_word: "CRANE",
                feedback: JSON.stringify([
                    "absent", "absent", "present",
                    "absent", "present"
                ]),
            }]];
        },
    };

    const result = await request("/api/games/12", pool);

    assert.equal(result.status, 200);
    assert.equal(result.body.attemptsRemaining, 5);
    assert.equal(result.body.attempts.length, 1);
    assert.equal("solution" in result.body, false);
    assert.equal("score" in result.body, false);
    assert.equal(
        JSON.stringify(result.body).includes("APPLE"),
        false
    );
});

test("278: finished game can display its result", async () => {
    const pool = {
        execute: async (sql) => {
            if (sql.includes("FROM games g")) {
                return [[{
                    id: 12,
                    language: "en",
                    status: "won",
                    attempts_used: 2,
                    score: 800,
                    solution: "APPLE",
                }]];
            }
            return [[]];
        },
    };

    const result = await request("/api/games/12", pool);
    assert.equal(result.status, 200);
    assert.equal(result.body.score, 800);
    assert.equal(result.body.solution, "APPLE");
});

test("279: another user's game is inaccessible", async () => {
    const pool = {
        execute: async (sql, params) => {
            assert.deepEqual(params, ["12", 7]);
            return [[]];
        },
    };

    const result = await request("/api/games/12", pool);
    assert.equal(result.status, 404);
});

test("279: anonymous statistics are rejected", async () => {
    const pool = {
        execute: async () => {
            throw new Error("Database should not be called");
        },
    };

    const result = await request("/api/games/stats", pool, null);
    assert.equal(result.status, 401);
});