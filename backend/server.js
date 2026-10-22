//Import Express, the framework used to create our server.
const express = require("express");

// Create an Express application.
const app = express();

// Define port 3001 for our backend server
const PORT = 3001;

// Create a GET route for the homepage ("/").
app.get("/", (req, res) => {

    // Send a text response to the browser.
    res.send("Wordle backend is running!");

}); // End the GET route.

// Start the server and listen on port 3001.
app.listen(PORT, ()=> {

    // Display the server address in the terminal. 
    console.log(`Server running on http://localhost:${PORT}`)

}); // End the server startup