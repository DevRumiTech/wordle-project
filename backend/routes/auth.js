// Import Express.
const express = require("express"); 

// import bcrypt to securely hash user passwords.
const bcrypt = require("bcrypt");

// import the MySQL connection pool.
const pool = require("../db");

// Create a router for authentication routes. 
const router = express.Router();

// Make the router available to the Express server. 
module.exports = router;

router.post("/register", async(req, res)=>{
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

    // Check that the username is not too long. 
    if(username.length > 30){
        // Return an error if it exceeds 30 characters.
        return res.status(400).json({
            error: "Username must not exceed 30 characters", 
        });
    }

    // Define a basic pattern for email addresses.
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Check the email format and maximum length.
    if(!emailPattern.test(email) || email.length > 255){
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

    // Registration is not yet implemented.
    return res.status(501).json({
        error: "Registration is not implemented yet",
    });
});