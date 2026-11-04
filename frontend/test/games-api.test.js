import test from "node:test"
import assert from "node:assert/strict"

import {
    createGameApi,
    GameApiError,
} from "../src/api/games.js"

// Simulate an HTTP response without starting a server.
function reply(status, data) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return data
        },
    }
}

// Capture browser requests and return prepared responses.
function mockClient(responses) {
    const calls = []

    const api = createGameApi(async (url, options) => {
        calls.push({ url, options })
        return responses.shift()
    })

    return { api, calls }
}

test("295: game creation includes session and CSRF", async () => {
    const { api, calls } = mockClient([
        reply(200, { csrfToken: "test-token" }),
        reply(201, {
            gameId: 12,
            language: "en",
            status: "in_progress",
            attemptsRemaining: 6,
        }),
    ])

    const game = await api.createGame("en")

    assert.equal(game.gameId, 12)
    assert.equal(calls[0].url, "/api/auth/csrf")
    assert.equal(calls[1].url, "/api/games")
    assert.equal(calls[1].options.method, "POST")
    assert.equal(calls[1].options.credentials, "same-origin")
    assert.equal(
        calls[1].options.headers["X-CSRF-Token"],
        "test-token"
    )
    assert.deepEqual(
        JSON.parse(calls[1].options.body),
        { language: "en" }
    )
})

test("296: guesses use the correct game endpoint", async () => {
    const { api, calls } = mockClient([
        reply(200, { csrfToken: "secure-token" }),
        reply(200, {
            attemptNumber: 1,
            feedback: Array(5).fill("correct"),
            status: "won",
            attemptsRemaining: 5,
            score: 1000,
        }),
    ])

    const result = await api.submitGuess(12, "APPLE")

    assert.equal(result.status, "won")
    assert.equal(
        calls[1].url,
        "/api/games/12/attempts"
    )
    assert.deepEqual(
        JSON.parse(calls[1].options.body),
        { word: "APPLE" }
    )
})

test("297: retrieve a game without requesting CSRF", async () => {
    const { api, calls } = mockClient([
        reply(200, {
            gameId: "12",
            status: "in_progress",
            attempts: [],
        }),
    ])

    const result = await api.getGame(12)

    assert.equal(result.gameId, "12")
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, "/api/games/12")
    assert.equal(calls[0].options.credentials, "same-origin")
})

test("297: history includes pagination parameters", async () => {
    const { api, calls } = mockClient([
        reply(200, { games: [] }),
    ])

    await api.getHistory(10, 20)

    assert.equal(
        calls[0].url,
        "/api/games/history?limit=10&offset=20"
    )
})

test("297: statistics use the private endpoint", async () => {
    const { api, calls } = mockClient([
        reply(200, { totalGames: 4, wins: 3 }),
    ])

    const stats = await api.getStats()

    assert.equal(stats.wins, 3)
    assert.equal(calls[0].url, "/api/games/stats")
})

test("298: authentication errors preserve HTTP status", async () => {
    const { api } = mockClient([
        reply(401, { error: "Not authenticated" }),
    ])

    await assert.rejects(
        () => api.getStats(),
        (error) => {
            assert.ok(error instanceof GameApiError)
            assert.equal(error.status, 401)
            return true
        }
    )
})

test("298: missing CSRF token blocks game creation", async () => {
    const { api, calls } = mockClient([
        reply(200, {}),
    ])

    await assert.rejects(
        () => api.createGame("fr"),
        GameApiError
    )

    assert.equal(calls.length, 1)
})

test("298: invalid IDs never reach the server", async () => {
    const { api, calls } = mockClient([])

    assert.throws(
        () => api.getGame("invalid"),
        GameApiError
    )

    assert.equal(calls.length, 0)
})

test("298: network errors produce safe messages", async () => {
    const api = createGameApi(async () => {
        throw new Error("Private network details")
    })

    await assert.rejects(
        () => api.getStats(),
        (error) => {
            assert.equal(error.status, 0)
            assert.equal(
                error.message,
                "Cannot reach the Wordle server."
            )
            return true
        }
    )
})