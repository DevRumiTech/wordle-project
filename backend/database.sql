-- Create the database if it does not already exist. 
CREATE DATABASE IF NOT EXISTS wordle_db;

-- Select the Wordle database for our next SQL commands.
USE wordle_db;

-- Create the users table if it does not exist.
CREATE TABLE IF NOT EXISTS users (

-- Unique ID for each user.
id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

-- Username, maximum 30 characters, no duplicates.
username VARCHAR(30) NOT NULL UNIQUE,

-- Email address, no duplicates.
email VARCHAR(255) NOT NULL UNIQUE,

-- Store the hashed password, never the original password.
password_hash VARCHAR(255) NOT NULL,

-- Record when the account was last updated.
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
ON UPDATE CURRENT_TIMESTAMP
);

-- Create the table for French and English words.
CREATE TABLE IF NOT EXISTS words (

    -- Unique ID for each word.
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    -- Store the word.
    word VARCHAR(20) NOT NULL,

    -- Specify French or English.
    language ENUM('fr', 'en') NOT NULL,

    -- Allow the word as a player's guess.
    is_valid_guess BOOLEAN NOT NULL DEFAULT TRUE,

    -- Allow the word to be selected as a secret word.
    is_solution BOOLEAN NOT NULL DEFAULT FALSE, 

    -- Indicate whether the word is active.
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- Prevent duplicate words within the same language.
    UNIQUE (language, word)
);

-- Select our Wordle database.
USE wordle_db;

-- Create the games table.
CREATE TABLE IF NOT EXISTS games (

    -- Unique ID for each game. 
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, 

    -- Identify the player.
    user_id INT UNSIGNED NOT NULL,

    -- Identify the secret word.
    word_id INT UNSIGNED NOT NULL,

    -- Language of the game.
    language ENUM('fr', 'en') NOT NULL,

    -- Track the game's current status.
    status ENUM('in_progress', 'won', 'lost')
    NOT NULL DEFAULT 'in_progress',

    -- Count the player's attempts.
    attempts_used TINYINT UNSIGNED NOT NULL DEFAULT 0,

    -- Store the player's score.
    score INT UNSIGNED NOT NULL DEFAULT 0,

    -- Record when the game starts.
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- Record when the game finishes.
    finished_at DATETIME NULL,

    -- Connect each game to its player.
    FOREIGN KEY (user_id) REFERENCES users(id),

    -- Connect each game to its secret word.
    FOREIGN KEY (word_id) REFERENCES words(id),

    -- Speed up searches by player and date.
    INDEX (user_id, started_at),

    -- Speed up searches by player and status.
    INDEX (user_id, status)
);

-- Create the attempts table.
CREATE TABLE IF NOT EXISTS attempts(

    -- Unique ID for each attempt.
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, 

    -- Identify the game.
    game_id BIGINT UNSIGNED NOT NULL,

    -- Attempt number (1 to 6).
    attempt_number TINYINT UNSIGNED NOT NULL,

    -- Store the word submitted by the player.
    guessed_word VARCHAR(20) NOT NULL,

    -- Store the feedback for each letter.
    feedback JSON NOT NULL,

    -- Record when the attempt was made.
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- Connect the attempt to its game.
    FOREIGN KEY (game_id) REFERENCES games(id),

    -- Prevent duplicate attempt numbers in one game.
    UNIQUE (game_id, attempt_number)
);










