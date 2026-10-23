// Import the MySQL connection pool.
const pool = require("./db");

// Create an asynchronous function to test the connection.
async function testConnection(){
    try {
        // Ask MySQL which database is connected
        const [rows] = await pool.query(
            "SELECT DATABASE() AS database_name"
        );

        // Display the connected database.
        console.log("Connected to:", rows[0].database_name);
    } catch (error){
        // Display an error if the connection fails.
        console.error("Connection failed:", error.message);
    } finally {
        // Close database connections after testing.
        await pool.end();
    }
}

// Run the test.
testConnection();