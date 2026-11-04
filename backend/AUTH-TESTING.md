# Authentication progress — 183/350

The entire `new game.md` specification was read before this work. No numbered
roadmap was present locally; the following increments continue from the supplied
completed step 163. Existing registration, login, regeneration and `/me` were
inspected and retained rather than reimplemented.

| Step | Increment | Result |
| --- | --- | --- |
| 164 | Destroy server session on POST logout; reject replay | PASS |
| 165 | Share cookie settings and clear matching cookie; production Secure policy | PASS |
| 166 | Handle logout storage failures without claiming success | PASS |
| 167 | Save login session before success; test rotation and storage failures | PASS |
| 168 | Session-bound CSRF tokens on all API mutations, including login/logout | PASS |
| 169 | Enforce one-hour authentication lifetime, reject invalid cookies, prevent caching | PASS |
| 170 | Bound login requests per peer IP with 429 and Retry-After | PASS |
| 171 | Bound login credential sizes and cover authentication regressions | PASS |
| 172 | Test registration validation, hashing, duplicates and SQL parameters | PASS |
| 173 | Safe JSON errors, repeatable local test command and integration documentation | PASS |

## Original isolated verification (164–173)

Run `npm test --prefix backend` from the project root: **15 tests passed**.
Tests exercise actual Express HTTP routes on ephemeral 127.0.0.1 ports, real
bcrypt, and express-session. They use synthetic accounts and an isolated memory
store only in tests; they never load `.env`, import `db.js`, or access MySQL.
No dependencies were added. Frontend lint/build are also checked for regression.

## API usage

1. GET `/api/auth/csrf`, retaining the session cookie and the returned `csrfToken`.
2. Send `X-CSRF-Token` with that token for every POST request, including
   registration, login and logout. Retain/send cookies (browser fetch credentials).
3. After successful login, GET `/api/auth/csrf` again: session regeneration
   intentionally invalidates the previous token.
4. GET `/api/auth/me` retains its existing `{ userId }` response contract.
5. POST `/api/auth/logout` returns 200 only after session destruction, and expires
   the cookie. A fresh anonymous CSRF session may also be logged out safely.

Missing/invalid CSRF tokens return 403. Expired authentication returns 401.
Auth responses use `Cache-Control: no-store`. Malformed JSON returns 400;
JSON larger than 16 KiB returns 413. Internal errors return generic JSON.
Secrets, cookies, password hashes and request bodies must never be logged.

## Runtime configuration and limits

Production still uses the existing MySQL session store and existing table,
without schema creation or business-data changes. Expired-session cleanup is
explicitly enabled every 15 minutes. Authentication expires after one hour even
if the store's touch operation extends its idle expiration. Sessions created
before this change lack `authenticatedAt` and require login again.

`SESSION_SECRET` must contain at least 32 characters from a securely generated
value; do not paste it into documentation or logs. Production cookies require
HTTPS. Express deliberately does not trust forwarded headers. A deployment
behind a TLS-terminating proxy will need a narrowly scoped trust-proxy policy
and HTTPS integration tests before deployment.

The limiter allows 10 login requests per peer IP per 15 minutes, including
successful/invalid-input requests. It is bounded to 10,000 active peer entries
and fails closed at capacity. It is process-local, resets on restart and needs a
shared store for a multi-process deployment.

## Local MySQL and frontend continuation (174–183)

The full specification and the latest implementation were reread before this
batch. The existing backend authentication behavior was retained.

| Step | Increment | Result |
| --- | --- | --- |
| 174 | Reusable read-only local MySQL/schema check | PASS |
| 175 | Correct setup SQL to include the existing users.created_at and sessions table | PASS |
| 176 | Real registration, stored bcrypt hash, timestamp and duplicate rejection | PASS |
| 177 | Real username login, invalid password, session rotation and stored identity | PASS |
| 178 | Session recovery after recreating app/store and closing session DB connections | PASS |
| 179 | Real missing, incorrect and pre-login CSRF-token rejection | PASS |
| 180 | Real logout deletion/replay, email login and MySQL session expiration | PASS |
| 181 | Frontend API client with browser cookies, fresh CSRF tokens and error handling | PASS |
| 182 | Registration/sign-in UI, password clearing and session restoration | PASS |
| 183 | Browser logout/recovery/mobile checks and final regression verification | PASS |

### Schema finding

The actual local `users` table already contains nullable `created_at DATETIME
DEFAULT CURRENT_TIMESTAMP`. The actual local `sessions` table also already
exists. Both definitions were missing from `database.sql`; the file now includes
them for fresh installations. No CREATE, ALTER, DROP or other DDL was executed.
No live schema migration was needed, so no schema approval was requested.

Do not run the entire setup SQL as a migration against an existing database.
CREATE TABLE IF NOT EXISTS does not add missing columns to an existing table.
Any future required live schema change must be shown to the user as exact SQL
and approved before execution.

### Commands and results

From the project root:

- `npm test --prefix backend`: 15 isolated backend tests passed.
- `npm run check:db --prefix backend`: read-only local schema inspection passed.
- Configured session secret meets the startup requirement (value never printed).
- `npm run test:mysql --prefix backend`: actual local MySQL checks for 174–180 passed.
- `npm test --prefix frontend`: 5 API-client tests passed.
- `npm run lint --prefix frontend`: passed.
- `npm run build --prefix frontend`: passed.
- `npm run test:browser --prefix backend`: browser flow checks for 182–183 passed
  with a locally installed Playwright package. Set `WORDLE_PLAYWRIGHT_PATH` to
  the absolute path of that existing package if it is not resolvable normally.
  This command does not download or install a browser or package.

Both MySQL scripts load backend configuration internally and refuse connections
unless the host is loopback and the database is `wordle_db`. They do not print
credentials, cookies, tokens, hashes or personal records. The schema check prints
column metadata only. Local socket access may require sandbox permission.

The MySQL integration test rolls back its temporary account transaction. Session
rows are committed via separate connections to prove durable storage, then only
session IDs generated by that test are deleted. Expired-session sweeping is
disabled during testing so unrelated sessions remain untouched. Session restart
coverage recreates the app/store and session connection pool within the test
process; it does not restart the actual MySQL service or the production process.

The browser test runs isolated HTTP/Vite servers on ephemeral loopback ports and
uses one transaction for all account/session writes. It rolls back on completion.
Both tests compare in-memory before/after fingerprints of all existing table
records; both checks passed. Auto-increment counters may advance even when an
INSERT is rolled back; no existing rows are deleted or modified. Run these
checks while other writers are idle to avoid unrelated fingerprint changes.

Browser coverage includes registration, wrong/correct passwords, reload
persistence, a simulated failed logout preserving signed-in UI, successful
logout, email login on a 375px viewport, Enter-key submission, network failure
and retry. No uncaught browser errors were observed. The mobile sign-in
screenshot was inspected locally. The Browser plugin had no available browser,
so verification used the Mac's existing Playwright/Chromium installation.

### Running the frontend locally

Start the backend with `node server.js` from `backend/`, then run
`npm run dev --prefix frontend` from the project root. Vite proxies `/api` to
`http://127.0.0.1:3001`, keeping API calls and browser cookies same-origin.
The client fetches a fresh CSRF token before each mutation, including logout;
it does not store credentials or tokens in localStorage. The browser owns the
HttpOnly session cookie. A successful registration returns to sign-in, matching
the backend's existing behavior rather than automatically authenticating.

### Remaining work

- Verify production HTTPS and proxy configuration. The development proxy does
  not configure production hosting; a production same-origin API route is needed.
- The rate limiter is process-local; shared enforcement is needed for multiple
  backend processes.
- Add game functionality and the remaining project steps. No game routes or
  game UI were introduced in this authentication batch.
