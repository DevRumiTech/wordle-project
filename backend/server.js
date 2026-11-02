// Load environment variables
require("dotenv").config();

// Import Express, the framework used to create our server.
const express = require("express");

// Manage user login sessions
const session = require("express-session");

// Store user sessions in MySQL
const MySQLStore = require("express-mysql-session")(session);

// Import the MySQL connection pool from db.js.
const pool = require("./db");

// Create the MySQL session store
const sessionStore = new MySQLStore({
    createDatabaseTable: false
}, pool);

// Check whether MySQL session storage is ready
sessionStore.onReady()
    .then(()=>{
        console.log("MySQL session store ready");
    })
    .catch((error)=> {
        console.error("Session store error:", error.message);
    });

// Import authentication routes.
const authRoutes = require("./routes/auth");

// Create an Express application.
const app = express();

// Allow Express to read incoming JSON data.
app.use(express.json())

// Enable server-side login sessions
app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    resave: false, 
    saveUninitialized: false,

    // Configure session cookie security
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production", 
        sameSite: "lax",
        maxAge: 60 * 60 * 1000
    }
}));

// Direct authentication requests to the auth router.
app.use("/api/auth", authRoutes);

// Define port 3001 for our backend server
const PORT = 3001;

// Test the connection between Express and MySQL.
app.get("/", async (req, res) => {
    try {
        // Send a simple query to MySQL.
        await pool.query("SELECT 1");

        // Respond when the database connection works.
        res.send("Wordle backend and database are running");
    }catch(error){
        // Record the error code without exposing credentials.
        console.error("Database error:", error.code);

        // Return an HTTP 500 error is MySQL is unavailable.
        res.status(500).send("Database unavailable");
    }
});

// Start the server and listen on port 3001.
app.listen(PORT, ()=> {

    // Display the server address in the terminal. 
    console.log(`Server running on http://localhost:${PORT}`)

}); // End the server startup