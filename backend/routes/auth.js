// Import Express.
const express = require("express"); 

// import bcrypt to securely hash user passwords.
const bcrypt = require("bcrypt");

// import the MySQL connection pool.
const pool = require("../db");

// Create a router for authentication routes. 
const router = express.Router();


// Handle user registration. 
router.post("/register", async (req, res) => {
    // Read the information sent by the user. 
    const {username, email, password} = req.body || {};

    // Check that all three fields contain text.
    if(
        typeof username !== "string" || !username.trim() ||
        typeof email !== "string" || !email.trim() ||
        typeof password !== "string" || !password
    ){
        // Return an error if information is missing. 
        return res.status(400).json({
            error: "Username, email and password are required", 
        });
    }

    // Reject fields containing only spaces.
    if(
        username.trim() === "" ||
        email.trim() === "" ||
        password.trim() === ""
    ){
        return res.status(400).json({
            error: "Field cannot contain only spaces",
        });
    }

    // Remove spaces before and after the username.
    const cleanUsername = username.trim();

    // Remove surrounding spaces and lowercase the email. 
    const cleanEmail = email.trim().toLowerCase();

    // Check the length of the cleaned username. 
    if(cleanUsername.length > 30){
        // Return an error if it exceeds 30 characters.
        return res.status(400).json({
            error: "Username must not exceed 30 characters", 
        });
    }

    // Validate the cleaned email addresses.
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Check the email format and maximum length.
    if(!emailPattern.test(cleanEmail) || cleanEmail.length > 255){
        // Return an error for an invalid email.
        return res.status(400).json({
            error: "Please enter a valid email address",
        });
    }

    // Check that the password contains at least 8 characters.
    if (password.length < 8) {
        // Return an error if the password is too short.
        return res.status(400).json({
            error: "Password must contain at least 8 characters",
        });
    }

    // Check bcrypt's maximum password size of 72 bytes.
    if (Buffer.byteLength(password, "utf8") > 72){
        // Return an error if the password is too long.
        return res.status(400).json({
            error: "Password exceeds the maximum allowed size", 
        });

    }

    // Register the new user securly.
    try {
        // Check whether the username or email already exists. 
        const [existingUsers] = await pool.execute(
            "SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1",
            [cleanUsername, cleanEmail]
        );

        // Reject registration if an account already exists.
        if (existingUsers.length > 0){
            return res.status(409).json({
                error: "Username or email already exists",
            });
        }

        // Hash the password securely.
        const passwordHash = await bcrypt.hash(password, 12);

        // Save the new user in MySQL.
        await pool.execute(
            `INSERT INTO users
            (username, email, password_hash, created_at, updated_at)
            VALUES (?, ?, ?, NOW(), NOW())`, 
            [cleanUsername, cleanEmail, passwordHash]
        );

        // Confirm successful registration.
        return res.status(201).json({
            message: "Registration successful", 
        });


    }catch (error) {
        //Display the error code without exposing private information.
        console.error("Registration error:", error.code);


    // Handle duplicate usernames or emails.
        if (error.code === "ER_DUP_ENTRY"){
            return res.status(409).json({
                error: "Username or email already exists",
            });
        }

        // Handle other unexpected database errors.
        return res.status(500).json({
            error: "Registration failed",
        });
    }

});

// Make the router available to the Express server.
module.exports = router;