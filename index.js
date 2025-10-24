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

app.use("/v1", authController, questionRoutes);
app.use("/v1", authController, userRoutes);
app.use("/v1", authController, sessionRoutes);
app.use("/v1", authController, feedbackRoutes);
app.use("/v1", authController, leaderboardRoutes);
app.use("/v1", authController, errorRoutes);
app.use(morgan("combined"));

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Service is running on port ${PORT}`);
});
