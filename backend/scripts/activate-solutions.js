"use strict";

const fs = require("node:fs");
const path = require("node:path");
const pool = require("../db");

// Previously verified Wordle solution candidates.
const candidates = {
    en: [
        "APPLE", "BREAD", "CHAIR", "GRAPE", "HOUSE",
        "PLANT", "RIVER", "SMILE", "TABLE", "TRAIN"
    ],
    fr: [
        "ARBRE", "CHIEN", "FLEUR", "LIVRE", "NEIGE",
        "PLAGE", "POMME", "PORTE", "ROUTE", "TABLE"
    ]
};

async function main() {
    let connection;
    let transactionOpen = false;

    try {
        // Obtain one connection for the complete operation.
        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionOpen = true;

        // Do not overwrite an existing solution selection.
        const [previous] = await connection.execute(
            "SELECT COUNT(*) AS total FROM words WHERE is_solution = 1"
        );

        if (Number(previous[0].total) !== 0) {
            throw new Error("Solution flags already exist. No changes made.");
        }

        const selected = [];

        // Verify every previously approved candidate exists.
        for (const [language, names] of Object.entries(candidates)) {
            const placeholders = names.map(() => "?").join(",");

            const [rows] = await connection.execute(
                `SELECT id, word, language, is_active,
                        is_valid_guess, is_solution
                 FROM words
                 WHERE language = ?
                   AND UPPER(word) IN (${placeholders})
                 FOR UPDATE`,
                [language, ...names]
            );

            const found = new Set(
                rows.map(row => row.word.toUpperCase())
            );

            const missing = names.filter(name => !found.has(name));

            if (missing.length > 0 || rows.length !== 10) {
                throw new Error(
                    `${language}: Missing or duplicated candidates: ` +
                    missing.join(", ")
                );
            }

            // Reject inactive words or invalid guesses.
            if (rows.some(row =>
                Number(row.is_active) !== 1 ||
                Number(row.is_valid_guess) !== 1 ||
                Number(row.is_solution) !== 0
            )) {
                throw new Error(
                    `${language}: Candidate flags are not suitable`
                );
            }

            selected.push(...rows);
            console.log(`${language}: 10 candidates verified`);
        }

        // Save the original flags before changing the database.
        // This is a snapshot of affected rows, not a full DB backup.
        const backupDirectory = path.join(__dirname, "../backups");
        fs.mkdirSync(backupDirectory, { recursive: true });

        const stamp = new Date().toISOString()
            .replace(/[:.]/g, "-");

        const backupFile = path.join(
            backupDirectory,
            `solution-flags-${stamp}.json`
        );

        fs.writeFileSync(
            backupFile,
            JSON.stringify({
                createdAt: new Date().toISOString(),
                rows: selected
            }, null, 2),
            { encoding: "utf8", flag: "wx" }
        );

        console.log("Previous solution flags backed up.");

        // Update exactly the 20 verified records.
        const ids = selected.map(row => row.id);
        const placeholders = ids.map(() => "?").join(",");

        const [result] = await connection.execute(
            `UPDATE words SET is_solution = 1
             WHERE id IN (${placeholders})
               AND is_solution = 0
               AND is_active = 1
               AND is_valid_guess = 1`,
            ids
        );

        if (result.affectedRows !== 20) {
            throw new Error("Expected exactly 20 updated records");
        }

        // Verify the final solution counts before committing.
        const [counts] = await connection.execute(
            `SELECT language, COUNT(*) AS total
             FROM words
             WHERE is_solution = 1
             GROUP BY language`
        );

        const totals = Object.fromEntries(
            counts.map(row => [row.language, Number(row.total)])
        );

        if (totals.en !== 10 || totals.fr !== 10) {
            throw new Error("Solution counts failed verification");
        }

        // Confirm that real game-creation SQL can select a word.
        for (const language of ["en", "fr"]) {
            const [words] = await connection.execute(
                `SELECT id FROM words
                 WHERE language = ?
                   AND is_solution = 1
                   AND is_active = 1
                   AND is_valid_guess = 1
                 ORDER BY RAND()
                 LIMIT 1`,
                [language]
            );

            if (words.length !== 1) {
                throw new Error(
                    `No selectable solution for ${language}`
                );
            }
        }

        // Save both languages together.
        await connection.commit();
        transactionOpen = false;

        console.log("ENGLISH SOLUTIONS: 10");
        console.log("FRENCH SOLUTIONS: 10");
        console.log("TOTAL ACTIVATED: 20");
        console.log("DATABASE TRANSACTION COMMITTED");
        console.log("BACKUP: " + backupFile);

    } catch (error) {
        // Undo all incomplete database changes.
        if (transactionOpen && connection) {
            try {
                await connection.rollback();
            } catch {
                console.error("Database rollback failed");
            }
        }

        console.error("ACTIVATION FAILED: " + error.message);
        process.exitCode = 1;

    } finally {
        if (connection) connection.release();
        await pool.end();
    }
}

main();