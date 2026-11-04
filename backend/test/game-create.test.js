"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const createGameRouter = require("../routes/games");

// Send a test request to an isolated local Express server.
// The database connection is replaced by a controlled fake.
async function sendRequest(pool, userId, body) {
    const app = express();
    app.use(express.json());

    // Simulate a session only when the test user is logged in.
    app.use((req, res, next) => {
        if (userId !== null) {
            req.session = { userId };
        }
        next();
    });

    app.use("/api/games", createGameRouter(pool));

    const server = await new Promise((resolve) => {
        const instance = app.listen(0, "127.0.0.1", () => {
            resolve(instance);
        });
    });

    try {
        const response = await fetch(
            `http://127.0.0.1:${server.address().port}/api/games`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
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

test("270: anonymous game creation is rejected", async () => {
    const pool = {
        execute: async () => {
            throw new Error("Database should not be called");
        },
    };

    const response = await sendRequest(pool, null, {
        language: "en",
    });

    assert.equal(response.status, 401);
});

test("270: invalid language is rejected", async () => {
    const pool = {
        execute: async () => {
            throw new Error("Database should not be called");
        },
    };

    const response = await sendRequest(pool, 7, {
        language: "de",
    });

    assert.equal(response.status, 400);
});

test("270: missing solution words return 503", async () => {
    const pool = {
        execute: async () => [[]],
    };

    const response = await sendRequest(pool, 7, {
        language: "fr",
    });

    assert.equal(response.status, 503);
});

test("270: game creation saves owner and hides secret", async () => {
    const queries = [];

    const pool = {
        execute: async (sql, params) => {
            queries.push({ sql, params });

            if (sql.includes("SELECT id FROM words")) {
                return [[{ id: 44 }]];
            }

            if (sql.includes("INSERT INTO games")) {
                return [{ insertId: 97 }];
            }

            throw new Error("Unexpected database query");
        },
    };

    const response = await sendRequest(pool, 7, {
        language: "fr",
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.gameId, 97);
    assert.equal(response.body.status, "in_progress");
    assert.equal(response.body.attemptsRemaining, 6);

    // Only the server knows the selected word.
    assert.equal("word" in response.body, false);
    assert.equal("wordId" in response.body, false);
    assert.equal("solution" in response.body, false);

    assert.deepEqual(queries[0].params, ["fr"]);
    assert.deepEqual(queries[1].params, [7, 44, "fr"]);
});