const express = require("express");
const session = require("express-session");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const createAuthRouter = require("./routes/auth");
// Import the router that handles Wordle games.
const createGameRouter = require("./routes/games");
const { SESSION_NAME, SESSION_MAX_AGE, cookieOptions } = require("./session-config");

function createApp({ pool, store, secret, production = false, loginLimit = 10 }) {
    if (!store || typeof secret !== "string" || secret.length < 32) {
        throw new Error("A session store and a session secret of at least 32 characters are required");
    }
    const app = express();
    app.set("production", production);
    app.disable("x-powered-by");
    app.use("/api", (req, res, next) => {
        res.set("Cache-Control", "no-store");
        next();
    });
    app.use(express.json({ limit: "16kb" }));
    app.use(session({
        name: SESSION_NAME, store, secret, resave: false, saveUninitialized: false,
        cookie: { ...cookieOptions(production), maxAge: SESSION_MAX_AGE },
    }));
    app.use("/api", (req, res, next) => {
        if (req.session?.userId && (!Number.isFinite(req.session.authenticatedAt) ||
            Date.now() - req.session.authenticatedAt >= SESSION_MAX_AGE)) {
            return req.session.destroy((error) => {
                if (error) return next(error);
                res.clearCookie(SESSION_NAME, cookieOptions(production));
                res.status(401).json({ error: "Session expired" });
            });
        }
        next();
    });
    app.get("/api/auth/csrf", (req, res, next) => {
        req.session.csrfToken ||= randomBytes(32).toString("hex");
        req.session.save((error) => {
            if (error) return next(error);
            res.json({ csrfToken: req.session.csrfToken });
        });
    });
    app.use("/api", (req, res, next) => {
        if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
        const token = req.get("X-CSRF-Token");
        const expected = req.session?.csrfToken;
        if (!token || !expected || Buffer.byteLength(token) !== Buffer.byteLength(expected) ||
            !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
            return res.status(403).json({ error: "Invalid CSRF token" });
        }
        next();
    });
    // Bounded per-process protection, keyed by the actual peer (no trusted proxy).
    const attempts = new Map();
    app.post("/api/auth/login", (req, res, next) => {
        const now = Date.now();
        for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
        const key = req.ip;
        const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
        if (entry.count >= loginLimit || (!attempts.has(key) && attempts.size >= 10000)) {
            res.set("Retry-After", String(Math.max(1, Math.ceil((entry.until - now) / 1000))));
            return res.status(429).json({ error: "Too many login attempts; try again later" });
        }
        entry.count++;
        attempts.set(key, entry);
        next();
    });
    app.use("/api/auth", createAuthRouter(pool));
    // Connect Wordle game endpoints to the Express application.
    app.use("/api/games", createGameRouter(pool));
    app.get("/", async (req, res) => {
        try {
            await pool.query("SELECT 1");
            res.send("Wordle backend and database are running");
        } catch {
            res.status(500).send("Database unavailable");
        }
    });
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        const status = error.type === "entity.parse.failed" ? 400 :
            error.type === "entity.too.large" ? 413 : 500;
        res.status(status).json({ error: status === 500 ? "Server error" : "Invalid request body" });
    });
    return app;
}

module.exports = createApp;
