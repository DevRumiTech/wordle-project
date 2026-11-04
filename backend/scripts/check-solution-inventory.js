"use strict";

const pool = require("../db");

// This script only performs SELECT queries.
async function main() {
    try {
        const [rows] = await pool.execute(
            `SELECT language,
                    COUNT(*) AS totalWords,
                    SUM(is_valid_guess = 1 AND is_active = 1)
                        AS validGuesses,
                    SUM(is_solution = 1 AND is_active = 1)
                        AS eligibleSolutions
             FROM words
             GROUP BY language
             ORDER BY language`
        );

        // Report counts, never passwords or secret values.
        for (const row of rows) {
            console.log(
                `${row.language}: total=${row.totalWords}, ` +
                `valid=${row.validGuesses}, ` +
                `solutions=${row.eligibleSolutions}`
            );
        }

        if (rows.length !== 2) {
            throw new Error("Expected French and English dictionaries");
        }

        console.log("READ-ONLY DICTIONARY CHECK FINISHED");
    } finally {
        await pool.end();
    }
}

main().catch(() => {
    // Avoid displaying database credentials in error details.
    console.error("Dictionary inspection failed. Check DB access.");
    process.exitCode = 1;
});