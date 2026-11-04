// Import Express to create API routes.
const express=require("express");
const { MAX_ATTEMPTS, normalizeWord, evaluateGuess, calculateScore } = require("../services/wordle");

// Create the Wordle game router
//pool provides acces to the MySQL database.
function createGameRouter(pool){
    // Group all game-related routes together.
    const router = express.Router();
    // Require login before accessing any Wordle game route.
    router.use((req, res, next) => {
        // Check whether the user has an active session.
        if(!req.session?.userId){
            return res.status(401).json({
            error: "Not authenticated",
        });
    }

    // Allow authenticated users to continue.
    next();
});

    // Create a new English or French Wordle game.
    router.post("/", async (req, res, next) => {
        // Validate the player's language selection.
        const { language } = req.body ?? {};

        if (language !== "en" && language !== "fr") {
            return res.status(400).json({
                error: "Language must be en or fr",
            });
        }

        try {
            // Select an eligible secret word from MySQL.
            const [words] = await pool.execute(
                `SELECT id FROM words
                 WHERE language = ?
                   AND is_solution = 1
                   AND is_active = 1
                   AND is_valid_guess = 1
                 ORDER BY RAND()
                 LIMIT 1`,
                [language]
            );

            // Stop if this language has no available solutions.
            if (words.length === 0) {
                return res.status(503).json({
                    error: "No solution words available",
                });
            }

            // Store the game for the authenticated user.
            const [result] = await pool.execute(
                `INSERT INTO games
                 (user_id, word_id, language)
                 VALUES (?, ?, ?)`,
                [req.session.userId, words[0].id, language]
            );

            // Never expose the secret word during gameplay.
            return res.status(201).json({
                gameId: result.insertId,
                language,
                status: "in_progress",
                attemptsRemaining: 6,
            });
        } catch (error) {
            // Forward unexpected errors to Express.
            next(error);
        }
    });

    // Submit a guess for an authenticated player's game.
    router.post("/:id/attempts", async (req, res, next) => {
        const gameId = req.params.id;

        // Accept only valid unsigned MySQL game IDs.
        if (!/^[1-9][0-9]{0,19}$/.test(gameId) ||
            BigInt(gameId) > 18446744073709551615n) {
            return res.status(400).json({
                error: "Invalid game ID",
            });
        }

        // Normalize and validate the player's five-letter guess.
        const guess = normalizeWord(req.body?.word);

        if (!guess) {
            return res.status(400).json({
                error: "A valid five-letter word is required",
            });
        }

        let connection;
        let transactionOpen = false;

        try {
            // Obtain one dedicated database connection.
            connection = await pool.getConnection();

            // Begin a transaction so related writes stay together.
            await connection.beginTransaction();
            transactionOpen = true;

            // Lock the user's game against simultaneous guesses.
            const [games] = await connection.execute(
                `SELECT id, word_id, language, status, attempts_used
                 FROM games
                 WHERE id = ? AND user_id = ?
                 FOR UPDATE`,
                [gameId, req.session.userId]
            );

            // Do not reveal whether another user's game exists.
            if (games.length === 0) {
                await connection.rollback();
                transactionOpen = false;
                return res.status(404).json({
                    error: "Game not found",
                });
            }

            const game = games[0];
            const previousAttempts = Number(game.attempts_used);

            // Reject completed or exhausted games.
            if (game.status !== "in_progress" ||
                !Number.isInteger(previousAttempts) ||
                previousAttempts < 0 ||
                previousAttempts >= MAX_ATTEMPTS) {
                await connection.rollback();
                transactionOpen = false;
                return res.status(409).json({
                    error: "Game cannot accept more attempts",
                });
            }

            // Check the guess against the selected language.
            const [validWords] = await connection.execute(
                `SELECT id FROM words
                 WHERE language = ?
                   AND word = ?
                   AND is_valid_guess = 1
                   AND is_active = 1
                 LIMIT 1`,
                [game.language, guess]
            );

            if (validWords.length === 0) {
                await connection.rollback();
                transactionOpen = false;
                return res.status(400).json({
                    error: "Word is not in the selected dictionary",
                });
            }

            // Retrieve the secret word only inside the backend.
            const [solutions] = await connection.execute(
                `SELECT word FROM words
                 WHERE id = ? AND language = ?
                 LIMIT 1`,
                [game.word_id, game.language]
            );

            if (solutions.length !== 1) {
                throw new Error("Game solution is unavailable");
            }

            const secret = normalizeWord(solutions[0].word);

            if (!secret) {
                throw new Error("Invalid stored game solution");
            }

            // Apply repeated-letter rules from the Wordle service.
            const feedback = evaluateGuess(secret, guess);
            const attemptNumber = previousAttempts + 1;
            const won = guess === secret;

            // Determine whether the game has ended.
            const status = won
                ? "won"
                : attemptNumber === MAX_ATTEMPTS
                    ? "lost"
                    : "in_progress";

            // Only finished games receive their final score.
            const score = status === "in_progress"
                ? 0
                : calculateScore(status, attemptNumber);

            // Save the guess and its five feedback values.
            await connection.execute(
                `INSERT INTO attempts
                 (game_id, attempt_number, guessed_word, feedback)
                 VALUES (?, ?, ?, ?)`,
                [
                    gameId,
                    attemptNumber,
                    guess,
                    JSON.stringify(feedback),
                ]
            );

            // Save the attempt count, status and final score.
            const [updated] = await connection.execute(
                `UPDATE games
                 SET attempts_used = ?,
                     status = ?,
                     score = ?,
                     finished_at = CASE
                         WHEN ? = 'in_progress' THEN NULL
                         ELSE CURRENT_TIMESTAMP
                     END
                 WHERE id = ? AND user_id = ?
                   AND status = 'in_progress'`,
                [
                    attemptNumber,
                    status,
                    score,
                    status,
                    gameId,
                    req.session.userId,
                ]
            );

            if (updated.affectedRows !== 1) {
                throw new Error("Game update failed");
            }

            // Save both changes together.
            await connection.commit();
            transactionOpen = false;

            const response = {
                attemptNumber,
                feedback,
                status,
                attemptsRemaining: MAX_ATTEMPTS - attemptNumber,
            };

            // Reveal the final score after the game ends.
            if (status !== "in_progress") {
                response.score = score;
            }

            // Reveal the secret only after a defeat.
            if (status === "lost") {
                response.solution = secret;
            }

            return res.json(response);
        } catch (error) {
            // Undo incomplete writes if an operation failed.
            if (transactionOpen && connection) {
                try {
                    await connection.rollback();
                } catch {
                    // Preserve the original error.
                }
            }

            return next(error);
        } finally {
            // Always return the connection to the MySQL pool.
            if (connection) connection.release();
        }
    });

    // Parse a bounded nonnegative integer query parameter.
    function parseNumber(value, fallback, minimum, maximum) {
        if (value === undefined) return fallback;
        if (typeof value !== "string" ||
            !/^[0-9]{1,7}$/.test(value)) return null;

        const number = Number(value);
        return number >= minimum && number <= maximum
            ? number : null;
    }

    // List only this user's completed games.
    router.get("/history", async (req, res, next) => {
        const limit = parseNumber(req.query.limit, 20, 1, 50);
        const offset = parseNumber(req.query.offset, 0, 0, 1000000);

        if (limit === null || offset === null) {
            return res.status(400).json({
                error: "Invalid pagination parameters",
            });
        }

        try {
            // Use placeholders to separate data from SQL.
            const [games] = await pool.execute(
                `SELECT id, language, status, attempts_used,
                        score, started_at, finished_at
                 FROM games
                 WHERE user_id = ?
                   AND status IN ('won', 'lost')
                 ORDER BY finished_at DESC, id DESC
                 LIMIT ? OFFSET ?`,
                [req.session.userId, limit, offset]
            );

            return res.json({ games, limit, offset });
        } catch (error) {
            return next(error);
        }
    });

    // Calculate statistics from this user's finished games.
    router.get("/stats", async (req, res, next) => {
        try {
            // Calculate the totals inside MySQL.
            const [summaryRows] = await pool.execute(
                `SELECT COUNT(*) AS totalGames,
                    SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) AS wins,
                    SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS losses,
                    COALESCE(SUM(score), 0) AS totalScore,
                    AVG(CASE WHEN status = 'won'
                        THEN attempts_used ELSE NULL END)
                        AS averageWinAttempts
                 FROM games
                 WHERE user_id = ?
                   AND status IN ('won', 'lost')`,
                [req.session.userId]
            );

            // A loss separates consecutive groups of victories.
            // The largest winning group is the best streak.
            const [streakRows] = await pool.execute(
                `WITH ordered_games AS (
                    SELECT status,
                        SUM(CASE WHEN status = 'lost'
                            THEN 1 ELSE 0 END)
                        OVER (
                            ORDER BY finished_at, id
                            ROWS UNBOUNDED PRECEDING
                        ) AS loss_group
                    FROM games
                    WHERE user_id = ?
                      AND status IN ('won', 'lost')
                 ),
                 winning_groups AS (
                    SELECT loss_group, COUNT(*) AS wins
                    FROM ordered_games
                    WHERE status = 'won'
                    GROUP BY loss_group
                 )
                 SELECT COALESCE(MAX(wins), 0)
                    AS longestWinStreak
                 FROM winning_groups`,
                [req.session.userId]
            );

            const summary = summaryRows[0];
            const totalGames = Number(summary.totalGames);
            const wins = Number(summary.wins ?? 0);

            return res.json({
                totalGames,
                wins,
                losses: Number(summary.losses ?? 0),
                winRate: totalGames === 0
                    ? 0
                    : Number((wins * 100 / totalGames).toFixed(2)),
                totalScore: Number(summary.totalScore),
                averageWinAttempts:
                    summary.averageWinAttempts === null
                        ? 0
                        : Number(
                            Number(summary.averageWinAttempts).toFixed(2)
                        ),
                longestWinStreak: Number(
                    streakRows[0]?.longestWinStreak ?? 0
                ),
            });
        } catch (error) {
            return next(error);
        }
    });

    // Retrieve one game belonging to the authenticated user.
    // Keep this dynamic route after /history and /stats.
    router.get("/:id", async (req, res, next) => {
        const gameId = req.params.id;

        if (!/^[1-9][0-9]{0,19}$/.test(gameId) ||
            BigInt(gameId) > 18446744073709551615n) {
            return res.status(400).json({
                error: "Invalid game ID",
            });
        }

        try {
            // Retrieve the game and its secret on the server.
            const [games] = await pool.execute(
                `SELECT g.id, g.language, g.status,
                        g.attempts_used, g.score,
                        w.word AS solution
                 FROM games g
                 JOIN words w ON w.id = g.word_id
                 WHERE g.id = ? AND g.user_id = ?
                 LIMIT 1`,
                [gameId, req.session.userId]
            );

            if (games.length === 0) {
                return res.status(404).json({
                    error: "Game not found",
                });
            }

            const game = games[0];

            // Retrieve previous guesses in their original order.
            const [rows] = await pool.execute(
                `SELECT attempt_number, guessed_word, feedback
                 FROM attempts
                 WHERE game_id = ?
                 ORDER BY attempt_number ASC`,
                [gameId]
            );

            const attempts = rows.map((row) => ({
                attemptNumber: row.attempt_number,
                word: row.guessed_word,
                feedback: typeof row.feedback === "string"
                    ? JSON.parse(row.feedback)
                    : row.feedback,
            }));

            const result = {
                gameId: String(game.id),
                language: game.language,
                status: game.status,
                attemptsUsed: Number(game.attempts_used),
                attemptsRemaining: Math.max(
                    0, 6 - Number(game.attempts_used)
                ),
                attempts,
            };

            // The secret and final score stay hidden
            // until the game has finished.
            if (game.status !== "in_progress") {
                result.score = Number(game.score);
                result.solution = game.solution;
            }

            return res.json(result);
        } catch (error) {
            return next(error);
        }
    });

    // Return the router to the Express application.
    return router;
}

// Allow app.js to import this router.
module.exports = createGameRouter;
