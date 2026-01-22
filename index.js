const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
require("dotenv").config();
const questionRoutes = require("./routes/questionRoutes");
const userRoutes = require("./routes/userRoutes");
const sessionRoutes = require("./routes/sessionRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const errorRoutes = require("./routes/errorRoutes");
const dashboardRoutes = require("./routes/dashboard.Routes");
const authController = require("./controllers/auth.controller");
const leaderboardRoutes = require("./routes/leaderboard.Routes");
const villageRoutes = require("./routes/villageRoutes");
const leaderboardAuthController = require("./controllers/leaderboardAuth.controller");
const pool = require("./services/db");
const app = express();

app.use(express.json());
app.set("trust proxy", true);

// app.use(cors());
app.use(
  cors({
    //origin: ['https://your-frontend-domain.com', 'http://localhost:3000'], // Allowed origins
    methods: ["GET", "POST"], // Allowed HTTP methods
    //allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
    //credentials: true // Allow credentials (e.g., cookies, HTTP auth)
  })
);

app.get("/health", (req, res) => {
  // A quick healthcheck: can extend to check DB connectivity if desired
  res.status(200).json({ status: "ok" });
});

app.use("/v1/leaderboard", leaderboardAuthController, leaderboardRoutes);
// app.use("/", authController, (req, res) => {
//   res.send("hi welcome");
// });

app.use("/v1", authController, questionRoutes);
app.use("/v1", authController, userRoutes);
app.use("/v1", authController, sessionRoutes);
app.use("/v1", authController, feedbackRoutes);
app.use("/v1", authController, errorRoutes);
app.use("/v1", authController, dashboardRoutes);
app.use("/v1/api/villages", authController, villageRoutes);
app.use(morgan("combined"));

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Service is running on port ${PORT}`);
});

// Graceful shutdown: close HTTP server and DB pool.
// Call this on SIGTERM / SIGINT so Docker or orchestrator can stop cleanly.

async function shutdown(signal) {
  try {
    console.log(`Received ${signal}. Closing HTTP server...`);
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    console.log("HTTP server closed.");

    console.log("Closing DB pool...");
    await pool.end(); // close all clients
    console.log("DB pool closed. Exiting.");
    process.exit(0);
  } catch (err) {
    console.error("Error during shutdown", err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// defensive crash handlers - log and exit so Docker restarts the container
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection at:", reason);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
  process.exit(1);
});
