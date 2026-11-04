const SESSION_NAME = "connect.sid";
const SESSION_MAX_AGE = 60 * 60 * 1000;

function cookieOptions(production) {
    return { httpOnly: true, secure: production, sameSite: "lax", path: "/" };
}

module.exports = { SESSION_NAME, SESSION_MAX_AGE, cookieOptions };
