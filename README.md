# Wordle Game

Full-stack Wordle application developed during the Rafisa internship.

## Technologies

- React 19, Vite 8 and styled-components
- Node.js and Express
- MySQL 8.4
- JavaScript, HTML and CSS

## Features

- Registration, login and logout
- English and French dictionaries
- Unlimited games with six attempts each
- Virtual and physical keyboards
- Feedback for correct, misplaced and absent letters
- Support for repeated letters
- Server-side scoring and game persistence
- Restoration of unfinished games
- Personal history and statistics
- Responsive layout and accessible feedback labels

## Requirements

Install Node.js, npm and MySQL 8.4.

## Installation

For a new local installation:

1. Open MySQL Workbench.
2. Execute `backend/database.sql` to initialize the database.
3. Run `npm ci` inside the backend directory.
4. Copy `backend/.env.example` to `backend/.env`.
5. Configure the database credentials and a private session secret.
6. Run `npm ci` inside the frontend directory.

Do not commit `.env` or share its credentials.

## Dictionaries

For a newly initialized database, use:

    cd backend
    node dictionaries/import-words.js

The project also includes:

    scripts/activate-solutions.js

Use this activation script only when preparing the solution inventory
for a new database. Do not rerun it unnecessarily.

Existing local database contents are not stored in Git.

## Start the application

Backend terminal:

    cd backend
    node server.js

Frontend terminal:

    cd frontend
    npm run dev

Open http://localhost:5173 in the browser.

The backend uses port 3001. Vite forwards API requests to it.

## Game rules and scoring

Each secret word contains five letters.
Players have six attempts to guess the word.

- Green: correct letter and position
- Yellow: letter exists in another position
- Gray: absent letter or no remaining occurrences

| Winning attempt | Score |
|---|---:|
| 1 | 1000 |
| 2 | 800 |
| 3 | 600 |
| 4 | 400 |
| 5 | 200 |
| 6 | 100 |
| Loss | 0 |

The backend selects the word, validates guesses and calculates scores.

## REST API

Authentication:

| Method | Endpoint |
|---|---|
| POST | /api/auth/register |
| POST | /api/auth/login |
| POST | /api/auth/logout |
| GET | /api/auth/me |
| GET | /api/auth/csrf |

Gameplay:

| Method | Endpoint |
|---|---|
| POST | /api/games |
| POST | /api/games/:id/attempts |
| GET | /api/games/:id |
| GET | /api/games/history |
| GET | /api/games/stats |

Private endpoints require authentication.
Requests modifying data require CSRF protection.

POST /api/games accepts a language such as "en" or "fr".
POST /api/games/:id/attempts accepts a five-letter word.

The API returns JSON responses and suitable HTTP error codes.
The secret word remains hidden during unfinished games.

## Tests

Backend:

    cd backend
    npm test

Frontend:

    cd frontend
    npm test
    npm run lint
    npm run build

Additional MySQL integration scripts are located in backend/scripts.
They require a configured database and may change local test records.

## Dictionary sources and licences

English:
- Package: an-array-of-english-words
- Source: https://github.com/words/an-array-of-english-words
- Licence: MIT

French:
- Package: an-array-of-french-words
- Source: https://github.com/words/an-array-of-french-words
- Licence: MIT

Dictionary import accepts unique five-letter words containing a-z.

## Security

- Password hashing with bcrypt
- MySQL-backed sessions
- HttpOnly session cookies
- Secure cookies when running production HTTPS
- CSRF protection
- Parameterized SQL queries
- Per-user authorization checks
- Login request limits
- Server-side score calculations

Production deployment requires HTTPS and appropriate environment
configuration. Dependency audits should be reviewed before deployment.

## Excluded from version 1

- Global leaderboard
- Shared daily challenge
- Live multiplayer
- Third-party login
- Native mobile application