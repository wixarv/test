require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const companyRoutes = require("./routes/companyRoutes");
const applySecurity = require("./middleware/securityMiddleware");
const winston = require("winston");
const i18n = require("i18n");
const path = require("path");

const logger = winston.createLogger({
  level: "error",
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: "error.log" })],
});
const app = express();

i18n.configure({
  locales: ["en", "es"],
  directory: path.join(__dirname, "locales"),
  defaultLocale: "en",
  cookie: "lang",
  queryParameter: "lang",
  objectNotation: true,
});
app.use(i18n.init);
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000", credentials: true }));
// applySecurity(app);

app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/company", companyRoutes);
const { GetCsrfToken } = require("./controllers/authController");
app.get("/auth/csrf-token", GetCsrfToken);
app.get("/welcome", (req, res) => res.json({ message: req.__("welcome_message") }));

app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") return res.status(403).json({ success: false, message: req.__("invalid_csrf_token") });
  logger.error("Global error:", { message: err.message, stack: err.stack });
  res.status(500).json({ success: false, message: req.__("server_error") });
});

connectDB();

module.exports = app;