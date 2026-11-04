"use strict";

const assert = require("node:assert/strict");
const pool = require("../db");
const { normalizeWord, evaluateGuess, calculateScore } =
    require("../services/wordle");

// Test real MySQL operations without keeping test games.
async function main() {
    let connection;
    let phase = "connection";
    const insertedIds = [];

    try {
        connection = await pool.getConnection();

        // Step 286: Verify both languages have eligible solutions.
        phase = "solution inventory";

        for (const language of ["en", "fr"]) {
            const [rows] = await connection.execute(
                `SELECT COUNT(*) AS total
                 FROM words
                 WHERE language = ?
                   AND is_solution = 1
                   AND is_valid_guess = 1
                   AND is_active = 1`,
                [language]
            );

            assert.equal(Number(rows[0].total), 10);
        }

        console.log("286 PASSED: Both languages have 10 solutions");

        // Use an existing test-capable account.
        // No password or personal information is displayed.
        phase = "test account availability";

        const [users] = await connection.execute(
            "SELECT id FROM users ORDER BY id LIMIT 1"
        );

        if (users.length === 0) {
            throw new Error("NO_TEST_USER");
        }

        const userId = users[0].id;

        // All inserted records will be rolled back.
        await connection.beginTransaction();

        for (const language of ["en", "fr"]) {
            phase = `${language} game creation`;

            // Select a real solution without printing it.
            const [solutions] = await connection.execute(
                `SELECT id, word
                 FROM words
                 WHERE language = ?
                   AND is_solution = 1
                   AND is_active = 1
                   AND is_valid_guess = 1
                 ORDER BY id LIMIT 1`,
                [language]
            );

            assert.equal(solutions.length, 1);

            const solution = solutions[0];
            const secret = normalizeWord(solution.word);

            assert.ok(secret);

            // Step 287: Insert a game with real foreign keys.
            const [created] = await connection.execute(
                `INSERT INTO games
                 (user_id, word_id, language)
                 VALUES (?, ?, ?)`,
                [userId, solution.id, language]
            );

            const gameId = created.insertId;
            insertedIds.push(gameId);

            const [games] = await connection.execute(
                `SELECT id, status, attempts_used
                 FROM games
                 WHERE id = ? AND user_id = ?
                 FOR UPDATE`,
                [gameId, userId]
            );

            assert.equal(games.length, 1);
            assert.equal(games[0].status, "in_progress");
            assert.equal(Number(games[0].attempts_used), 0);

            console.log(`287 PASSED: ${language} game created`);

            // Step 288: Confirm the solution is a valid guess.
            phase = `${language} dictionary and attempt`;

            const [validWords] = await connection.execute(
                `SELECT id FROM words
                 WHERE language = ?
                   AND word = ?
                   AND is_valid_guess = 1
                   AND is_active = 1
                 LIMIT 1`,
                [language, secret]
            );

            assert.equal(validWords.length, 1);

            // Simulate solving the game on the first attempt.
            const feedback = evaluateGuess(secret, secret);

            assert.deepEqual(feedback, Array(5).fill("correct"));

            const [attempt] = await connection.execute(
                `INSERT INTO attempts
                 (game_id, attempt_number, guessed_word, feedback)
                 VALUES (?, ?, ?, ?)`,
                [gameId, 1, secret, JSON.stringify(feedback)]
            );

            assert.equal(attempt.affectedRows, 1);

            const [savedAttempts] = await connection.execute(
                `SELECT feedback FROM attempts
                 WHERE game_id = ? AND attempt_number = ?`,
                [gameId, 1]
            );

            assert.equal(savedAttempts.length, 1);

            const storedFeedback = savedAttempts[0].feedback;
            const parsedFeedback =
                typeof storedFeedback === "string"
                    ? JSON.parse(storedFeedback)
                    : storedFeedback;

            assert.deepEqual(parsedFeedback, feedback);

            console.log(`288 PASSED: ${language} attempt saved`);

            // Step 289: Apply the exact scoring table.
            phase = `${language} victory and scoring`;

            const score = calculateScore("won", 1);
            assert.equal(score, 1000);

            const [updated] = await connection.execute(
                `UPDATE games
                 SET status = 'won',
                     attempts_used = ?,
                     score = ?,
                     finished_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND user_id = ?
                   AND status = 'in_progress'`,
                [1, score, gameId, userId]
            );

            assert.equal(updated.affectedRows, 1);

            const [finished] = await connection.execute(
                `SELECT status, attempts_used, score, finished_at
                 FROM games
                 WHERE id = ? AND user_id = ?`,
                [gameId, userId]
            );

            assert.equal(finished[0].status, "won");
            assert.equal(Number(finished[0].attempts_used), 1);
            assert.equal(Number(finished[0].score), 1000);
            assert.ok(finished[0].finished_at);

            console.log(`289 PASSED: ${language} victory and score`);
        }

        // Step 290: Verify real SQL used by the read endpoints.
        phase = "history and statistics";

        const [history] = await connection.execute(
            `SELECT id, language, status, attempts_used,
                    score, started_at, finished_at
             FROM games
             WHERE user_id = ?
               AND status IN ('won', 'lost')
             ORDER BY finished_at DESC, id DESC
             LIMIT ? OFFSET ?`,
            [userId, 50, 0]
        );

        for (const id of insertedIds) {
            assert.ok(
                history.some(game => String(game.id) === String(id))
            );
        }

        const [summary] = await connection.execute(
            `SELECT COUNT(*) AS totalGames,
                SUM(CASE WHEN status = 'won'
                    THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN status = 'lost'
                    THEN 1 ELSE 0 END) AS losses,
                COALESCE(SUM(score), 0) AS totalScore,
                AVG(CASE WHEN status = 'won'
                    THEN attempts_used ELSE NULL END)
                    AS averageWinAttempts
             FROM games
             WHERE user_id = ?
               AND status IN ('won', 'lost')`,
            [userId]
        );

        assert.ok(Number(summary[0].totalGames) >= 2);

        // Verify MySQL 8 window functions used for winning streaks.
        const [streak] = await connection.execute(
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
            [userId]
        );

        assert.equal(streak.length, 1);

        console.log("290 PASSED: History, statistics and streak SQL");

    } catch (error) {
        console.error("FAILED PHASE: " + phase);
        console.error("ERROR TYPE: " + (error.code ?? error.name));
        process.exitCode = 1;

    } finally {
        if (connection) {
            try {
                // Never retain the temporary game records.
                await connection.rollback();
                console.log("TEST TRANSACTION ROLLED BACK");
            } catch {
                console.error("ROLLBACK FAILED: Stop and inspect");
                process.exitCode = 1;
            }

            connection.release();
        }

        // Confirm temporary games are not still present.
        if (insertedIds.length && process.exitCode !== 1) {
            try {
                const placeholders = insertedIds.map(() => "?").join(",");
                const [remaining] = await pool.execute(
                    `SELECT COUNT(*) AS total
                     FROM games
                     WHERE id IN (${placeholders})`,
                    insertedIds
                );

                assert.equal(Number(remaining[0].total), 0);
                console.log("NO TEST GAME RECORDS RETAINED");
            } catch {
                console.error("POST-ROLLBACK VERIFICATION FAILED");
                process.exitCode = 1;
            }
        }

        await pool.end();
    }
}

main().catch(() => {
    console.error("Unexpected integration test failure");
    process.exitCode = 1;
});