// Import Express to create API routes.
const express=require("express");

// Create the Wordle game router
//pool provides acces to the MySQL database.
function createGameRouter(pool){
    // Group all game-related routes together.
    const router = express.Router();
    // Require login before accessing any Wordle game route.
    router.use((req, res, next) => {
        // Check whether the user has an active session.
        if(!req.session?.userId){
            return res.status(401).json({
            error: "Not authenticated",
        });
    }

    // Allow authenticated users to continue.
    next();
});

    // Return the router to the Express application.
    return router;
}

// Allow app.js to import this router.
module.exports = createGameRouter;
