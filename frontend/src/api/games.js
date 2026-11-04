"use strict";

// Represent errors returned by the Wordle backend.
export class GameApiError extends Error {
    constructor(message, status = 0) {
        super(message)
        this.name = "GameApiError"
        this.status = status
    }
}

// Create an API client using the browser's fetch function.
export function createGameApi(fetchRequest = (...args) => fetch(...args)) {

    // Send a request with the existing browser session cookie.
    async function request(path, options = {}) {
        let response

        try {
            response = await fetchRequest(`/api${path}`, {
                credentials: "same-origin",
                cache: "no-store",
                ...options,
            })
        } catch {
            throw new GameApiError(
                "Cannot reach the Wordle server."
            )
        }

        let data

        try {
            data = await response.json()
        } catch {
            throw new GameApiError(
                "Unexpected response from the server.",
                response.status
            )
        }

        if (!response.ok) {
            throw new GameApiError(
                typeof data?.error === "string"
                    ? data.error
                    : "The request failed.",
                response.status
            )
        }

        return data
    }

    // Obtain a fresh CSRF token for every database-changing request.
    async function post(path, body) {
        const tokenResponse = await request("/auth/csrf")
        const token = tokenResponse?.csrfToken

        if (typeof token !== "string" || !token) {
            throw new GameApiError(
                "Unable to prepare a secure request."
            )
        }

        return request(path, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": token,
            },
            body: JSON.stringify(body),
        })
    }

    // Reject invalid game identifiers before making requests.
    function validGameId(id) {
        const value = String(id)

        if (!/^[1-9][0-9]{0,19}$/.test(value) ||
            BigInt(value) > 18446744073709551615n) {
            throw new GameApiError("Invalid game ID.")
        }

        return value
    }

    return {
        // Start a game in English or French.
        createGame(language) {
            return post("/games", { language })
        },

        // Submit a five-letter guess for a specific game.
        submitGuess(gameId, word) {
            return post(
                `/games/${validGameId(gameId)}/attempts`,
                { word }
            )
        },

        // Resume a game and retrieve its previous guesses.
        getGame(gameId) {
            return request(`/games/${validGameId(gameId)}`)
        },

        // Retrieve completed games with pagination.
        getHistory(limit = 20, offset = 0) {
            const params = new URLSearchParams({
                limit: String(limit),
                offset: String(offset),
            })

            return request(`/games/history?${params}`)
        },

        // Retrieve the authenticated player's statistics.
        getStats() {
            return request("/games/stats")
        },
    }
}

// Shared API instance used by React components.
export const gameApi = createGameApi()