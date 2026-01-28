const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
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

const checkHealthStatus = async () => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Starting health check...`);

  try {
    const oneHourAgo = Date.now() - 3600000;

    const [questionsRes, feedbackRes, errorRes] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM questions WHERE ets > $1', [oneHourAgo]),
      pool.query('SELECT COUNT(*) FROM feedback WHERE ets > $1', [oneHourAgo]),
      pool.query('SELECT COUNT(*) FROM errordetails WHERE ets > $1', [oneHourAgo])
    ]);

    const counts = {
      questions: parseInt(questionsRes.rows[0].count),
      feedback: parseInt(feedbackRes.rows[0].count),
      errors: parseInt(errorRes.rows[0].count)
    };

    console.log(`[${timestamp}] Retrieved counts:`, JSON.stringify(counts));

    const thresholds = {
      questionsMin: parseInt(process.env.THRESHOLD_QUESTIONS_MIN || 0),
      feedbackMin: parseInt(process.env.THRESHOLD_FEEDBACK_MIN || 0),
      errorsMax: parseInt(process.env.THRESHOLD_ERRORS_MAX || 10)
    };

    console.log(`[${timestamp}] Thresholds config:`, JSON.stringify(thresholds));

    let alertTriggered = false;
    let alertMessage = "Health Check Alert (Last Hour):\n";

    if (counts.questions < thresholds.questionsMin) {
      alertTriggered = true;
      const msg = `- Low Questions: ${counts.questions} (Min: ${thresholds.questionsMin})\n`;
      alertMessage += msg;
      console.warn(`[${timestamp}] Violation: ${msg.trim()}`);
    }
    if (counts.feedback < thresholds.feedbackMin) {
      alertTriggered = true;
      const msg = `- Low Feedback: ${counts.feedback} (Min: ${thresholds.feedbackMin})\n`;
      alertMessage += msg;
      console.warn(`[${timestamp}] Violation: ${msg.trim()}`);
    }
    if (counts.errors > thresholds.errorsMax) {
      alertTriggered = true;
      const msg = `- High Errors: ${counts.errors} (Max: ${thresholds.errorsMax})\n`;
      alertMessage += msg;
      console.warn(`[${timestamp}] Violation: ${msg.trim()}`);
    }

    if (alertTriggered) {
      console.log(`[${timestamp}] Alert triggered! Sending notification...`);
      if (process.env.SLACK_WEBHOOK_URL) {
        try {
          await axios.post(process.env.SLACK_WEBHOOK_URL, {
            text: alertMessage
          });
          console.log(`[${timestamp}] Slack alert sent successfully.`);
        } catch (err) {
          console.error(`[${timestamp}] Failed to send Slack alert:`, err.message);
        }
      } else {
        console.log(`[${timestamp}] No SLACK_WEBHOOK_URL configured. Skipping notification.`);
      }
    } else {
      console.log(`[${timestamp}] Health check passed. No alerts.`);
    }

    return {
      status: alertTriggered ? "alert" : "ok",
      counts,
      thresholds,
      alertTriggered
    };

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Health check logic failed:`, error);
    throw error;
  }
};

app.get("/health", async (req, res) => {
  try {
    const result = await checkHealthStatus();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ status: "error", error: error.message });
  }
});

// Schedule health check to run every hour
cron.schedule('0 * * * *', async () => {
  console.log('Running scheduled health check...');
  try {
    await checkHealthStatus();
  } catch (error) {
    console.error('Scheduled health check failed:', error);
  }
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
