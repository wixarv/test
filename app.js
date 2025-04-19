const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const winston = require("winston");
const path = require("path");
const i18n = require("i18n");
const { v4: uuidv4 } = require('uuid');

const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const companyRoutes = require("./routes/companyRoutes");
const userRoute = require("./routes/userRoutes");
const storyRoutes = require("./routes/storyRoutes");
const NotificationRoute = require("./routes/NotificationsRoute");
const applySecurity = require("./middleware/securityMiddleware");

const app = express();

// Logger
const logger = winston.createLogger({
  level: "error",
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: "error.log" })],
});

// i18n
i18n.configure({
  locales: ["en", "es"],
  directory: path.join(__dirname, "locales"),
  defaultLocale: "en",
  cookie: "lang",
  queryParameter: "lang",
  objectNotation: true,
});
app.use(i18n.init);

app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [process.env.FRONTEND_URL].filter(Boolean);
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "x-csrf-token"],
  exposedHeaders: ["x-csrf-token"],
}));

// Security Middleware
applySecurity(app);

// Routes
app.use("/auth", authRoutes);
app.use("/", userRoute);
app.use("/", storyRoutes);
app.use("/admin", adminRoutes);
app.use("/company", companyRoutes);
app.use("/notifications", NotificationRoute);

// Health Check
app.get("/welcome", (req, res) => {
  const requestId = uuidv4();
  const userLang = req.headers['accept-language']?.split(',')[0] || "en";
  res.status(200).json({
    success: true,
    requestId,
    message: req.__("Welcome to our vibrant social media platform, bhai! You're here to conquer the feeds—connect, create, and inspire. Endless scrolling might suck at times, but your spark will make it legendary! 🌟"),
    metadata: {
      timestamp: new Date().toISOString(),
      language: userLang
    }
  });
});

app.get("/api/active-users", (req, res) => {
  try {
    const connectedUsers = app.get("connectedUsers");
    res.status(200).json({
      success: true,
      data: { activeUsers: connectedUsers.size },
      message: req.__("active_users_count_success"),
      metadata: { timestamp: new Date().toISOString() }
    });
  } catch (err) {
    const errorId = uuidv4();
    logger.error("Error fetching active users", { message: err.message, stack: err.stack });
    res.status(500).json({
      success: false,
      requestId: errorId,
      message: req.__("active_users_count_failed"),
      errorDetails: {
        code: "INTERNAL_SERVER_ERROR",
        supportTicketLink: `/support/ticket?errorId=${errorId}`
      },
      metadata: {
        timestamp: new Date().toISOString(),
        supportContact: "support@socialapp.com"
      }
    });
  }
});

// Error Handler
app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).json({ success: false, message: req.__("invalid_csrf_token") });
  }
  logger.error("Global error", { message: err.message, stack: err.stack });
  res.status(500).json({ success: false, message: req.__("server_error") });
});

module.exports = app;
