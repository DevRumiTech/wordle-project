// Reuse the existing MySQL connection.
const pool = require("../db");

// Load the English and French dictionaries.
const dictionaries = [
  ["en", require("an-array-of-english-words")],
  ["fr", require("an-array-of-french-words")],
];

// Import dictionary words into MySQL.
async function importWords() {
  for (const [language, dictionary] of dictionaries) {

    // Keep unique five-letter words without accents.
    const words = [...new Set(
      dictionary.filter(word => /^[a-z]{5}$/.test(word))
    )];

    // Insert words in batches of 500.
    for (let i = 0; i < words.length; i += 500) {
      const rows = words.slice(i, i + 500)
        .map(word => [word, language, 1, 0, 1]);

      // Avoid inserting duplicate words.
      await pool.query(
        "INSERT IGNORE INTO words (word, language, is_valid_guess, is_solution, is_active) VALUES ?",
        [rows]
      );
    }

    // Display the number of words processed.
    console.log(`${language}: ${words.length} processed`);
  }
}

// Run the import and close the database connection.
importWords()
  .catch(error => {
    console.error("Import failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());