// authController.js
const User = require("../models/user");
const jwt = require("jsonwebtoken");
const winston = require("winston");
const Joi = require("joi");
const crypto = require("crypto");
const speakeasy = require("speakeasy");
const Notification = require("../models/notifications");
const DeviceDetector = require("device-detector-js");
const getCountryFromIP = require("../utils/getcountry");
const { generateCsrfToken } = require("../middleware/authMiddleware");
// At the top of your authController.js, add this import:
const CsrfToken = require("../models/CsrfToken");

// Environment variables with defaults
const JWT_EXPIRE = process.env.JWT_EXPIRE || "15m";
const REFRESH_EXPIRE = process.env.REFRESH_EXPIRE || "7d";
const COOKIE_EXPIRE = parseInt(process.env.COOKIE_EXPIRE || "5"); // in days

// Mask sensitive data in logs (email, IP)
const maskSensitiveData = (data) =>
  typeof data === "string" && data.length > 5
    ? `${data.substring(0, 2)}****${data.substring(data.length - 2)}`
    : data;

// Configure Winston logger
const logger = winston.createLogger({
  level: process.env.NODE_ENV === "development" ? "debug" : "info",
  format: winston.format.combine(
    winston.format((info) => {
      if (info.email) info.email = maskSensitiveData(info.email);
      if (info.ip) info.ip = maskSensitiveData(info.ip);
      return info;
    })(),
    winston.format.json()
  ),
  transports: [new winston.transports.File({ filename: "auth.log" })],
});

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must be set");
}

// Joi validation schemas
const schemas = {
  signup: Joi.object({
    name: Joi.string().min(2).max(50).required(),
    username: Joi.string().alphanum().min(3).max(30).required(),
    email: Joi.string().email().required(),
    password: Joi.string()
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
      .required(),
  }),
  login: Joi.object({
    identifier: Joi.string().required(),
    password: Joi.string().required(),
    twoFactorCode: Joi.string().allow("").optional(),
  }),
};

const deviceDetector = new DeviceDetector();

// Secure cookie options
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV !== "development",
  sameSite: "Strict",
  path: "/",
};

// Generate a persistent device key (SHA-256 hashed)
const generatePersistentDeviceKey = (deviceInfo, ip) => {
  const deviceString = `${deviceInfo.device?.type || "Unknown"}${deviceInfo.os?.name || "Unknown"}${deviceInfo.client?.name || "Unknown"}${ip}`;
  return crypto.createHash("sha256").update(deviceString).digest("hex");
};

// Generate username suggestions if taken
const generateUsernameSuggestions = async (username) => {
  const suggestions = [];
  for (let i = 1; i <= 3; i++) {
    const suggestion = `${username}${Math.floor(Math.random() * 1000)}`;
    if (!(await User.findOne({ username: suggestion }))) suggestions.push(suggestion);
  }
  return suggestions;
};

// ========================
// SIGNUP CONTROLLER
// ========================
const Signup = async (req, res) => {
  try {
    // Validate request body
    const { error } = schemas.signup.validate(req.body, { abortEarly: false });
    if (error) throw { status: 400, message: error.details.map((d) => d.message).join(", ") };

    const { name, username, email, password } = req.body;

    // Check if email/username already exists
    const [existingEmail, existingUsername] = await Promise.all([
      User.findOne({ email }),
      User.findOne({ username }),
    ]);

    if (existingEmail && existingUsername) {
      throw {
        status: 400,
        message: "Email and username already taken",
        suggestions: await generateUsernameSuggestions(username),
      };
    }
    if (existingEmail) throw { status: 400, message: "Email already registered" };
    if (existingUsername) {
      throw {
        status: 400,
        message: "Username taken",
        suggestions: await generateUsernameSuggestions(username),
      };
    }

    // Get user location and device info
    const { country, state, localTime, language } = await getCountryFromIP(req);
    const deviceInfo = deviceDetector.parse(req.headers["user-agent"] || "Unknown");
    const deviceKey = generatePersistentDeviceKey(deviceInfo, req.ip);

    // Create new user
    const user = new User({
      name,
      username,
      email,
      password,
      registeredIP: req.ip,
      location: { country, state, language },
      loginHistory: [
        {
          ip: req.ip,
          userAgent: req.headers["user-agent"] || "Unknown",
          deviceKey,
          country,
          state,
          localTime,
          language,
          isActive: true,
          timestamp: new Date(),
          deviceType: deviceInfo.device?.type || "Unknown",
          os: deviceInfo.os?.name || "Unknown",
          client: deviceInfo.client?.name || "Unknown",
          signature: deviceKey,
        },
      ],
      role: "user",
      sessionVersion: Date.now(), // Unique session version
    });
    await user.save();

    // Send welcome notification
    const notification = new Notification({
      userId: user._id,
      username: username,
      type: "welcome",
      title: "Welcome to the Platform!",
      message: `Hello ${username}, we're excited to have you on board!`,
      isRead: false,
      metadata: { timestamp: new Date().toISOString() },
    });
    await notification.save();

    logger.info("User signed up", { email: maskSensitiveData(email), ip: req.ip });

    // Generate JWT tokens
    const accessToken = jwt.sign({ userId: user._id }, JWT_SECRET, {
      expiresIn: JWT_EXPIRE,
      issuer: "your-app-name",
    });
    const refreshToken = jwt.sign({ userId: user._id }, JWT_REFRESH_SECRET, {
      expiresIn: REFRESH_EXPIRE,
      issuer: "your-app-name",
    });
    user.refreshToken = refreshToken;
    await user.save();

    // Generate CSRF token (user-bound)
    const csrfToken = await generateCsrfToken(user._id.toString());

    // Clear any existing CSRF tokens for this user
    await CsrfToken.deleteMany({ userId: user._id });

    // Set secure HTTP cookies
    res
      .cookie("accessToken", accessToken, { 
        ...cookieOptions, 
        maxAge: JWT_EXPIRE === "1h" ? 60 * 60 * 1000 : 15 * 60 * 1000 
      })
      .cookie("refreshToken", refreshToken, { 
        ...cookieOptions, 
        maxAge: COOKIE_EXPIRE * 24 * 60 * 60 * 1000 
      })
      .cookie("deviceKey", deviceKey, { 
        ...cookieOptions, 
        maxAge: COOKIE_EXPIRE * 24 * 60 * 60 * 1000 
      })
      .cookie("sessionVersion", user.sessionVersion, { 
        ...cookieOptions, 
        maxAge: COOKIE_EXPIRE * 24 * 60 * 60 * 1000 
      })
      .cookie("csrfToken", csrfToken, { 
        ...cookieOptions, 
        maxAge: 10 * 60 * 1000, 
        httpOnly: false 
      })
      .status(201)
      .json({ success: true, message: "Account created successfully", csrfToken });

  } catch (error) {
    logger.error("Signup error", { message: error.message, ip: req.ip });
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Signup error",
      ...(error.suggestions && { usernameSuggestions: error.suggestions }),
    });
  }
};

// =======================
// LOGIN CONTROLLER
// =======================
const Login = async (req, res) => {
  try {
    // Validate request body
    const { error } = schemas.login.validate(req.body, { abortEarly: false });
    if (error) throw { status: 400, message: error.details.map((d) => d.message).join(", ") };

    const { identifier, password, twoFactorCode } = req.body;

    // Find user with password and 2FA data
    const user = await User.findOne({
      $or: [{ email: identifier }, { username: identifier }],
    }).select("+password +twoFactorSecret +twoFactorBackupCodes");

    // Check credentials
    if (!user || !(await user.comparePassword(password))) {
      if (user) {
        user.failedLoginAttempts += 1;
        if (user.failedLoginAttempts >= 5) {
          user.lockUntil = Date.now() + 15 * 60 * 1000; // Lock for 15 mins
          await user.save();
          logger.warn("Account locked", { email: identifier, ip: req.ip });
        }
        await user.save();
      }
      throw { status: 401, message: "Invalid credentials" };
    }

    // Check if account is locked
    if (user.lockUntil && user.lockUntil > Date.now()) {
      throw { status: 403, message: `Account locked until ${new Date(user.lockUntil).toISOString()}` };
    }

    // 2FA verification (if enabled)
    if (user.twoFactorEnabled) {
      if (!twoFactorCode) {
        return res.status(200).json({ success: false, message: "2FA code required", requires2FA: true });
      }
      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: "base32",
        token: twoFactorCode,
        window: 1,
      });
      if (!verified) {
        const backupCodeIndex = user.twoFactorBackupCodes.indexOf(twoFactorCode);
        if (backupCodeIndex === -1) throw { status: 401, message: "Invalid 2FA code" };
        user.twoFactorBackupCodes.splice(backupCodeIndex, 1);
      }
    }

    // Reset failed attempts and update session
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    user.sessionVersion = Date.now(); // Reset session version (unique per login)

    // Device fingerprinting
    const deviceInfo = deviceDetector.parse(req.headers["user-agent"] || "Unknown");
    const deviceKey = generatePersistentDeviceKey(deviceInfo, req.ip);

    // Check if device already exists in login history
    const existingDevice = user.loginHistory.find((entry) => entry.deviceKey === deviceKey);
    const loginEntry = existingDevice
      ? { ...existingDevice, timestamp: new Date(), isActive: true }
      : {
          ip: req.ip,
          userAgent: req.headers["user-agent"] || "Unknown",
          deviceKey,
          country: (await getCountryFromIP(req)).country,
          deviceType: deviceInfo.device?.type || "Unknown",
          os: deviceInfo.os?.name || "Unknown",
          client: deviceInfo.client?.name || "Unknown",
          timestamp: new Date(),
          isActive: true,
          signature: deviceKey,
        };

    // Update login history (max 5 active devices)
    user.loginHistory = user.loginHistory.filter((entry) => entry.isActive);
    if (!existingDevice) user.loginHistory.push(loginEntry);
    if (user.loginHistory.length > 5) user.loginHistory.shift();

    // Generate JWT tokens
    const accessToken = jwt.sign({ userId: user._id }, JWT_SECRET, {
      expiresIn: JWT_EXPIRE,
      issuer: "your-app-name",
    });
    const refreshToken = jwt.sign({ userId: user._id }, JWT_REFRESH_SECRET, {
      expiresIn: REFRESH_EXPIRE,
      issuer: "your-app-name",
    });
    user.refreshToken = refreshToken;
    await user.save();

    // Generate CSRF token (user-bound)
    const csrfToken = await generateCsrfToken(user._id.toString());

    // Clear any existing CSRF tokens for this user
    await CsrfToken.deleteMany({ userId: user._id });

    // Set secure HTTP cookies
    res
      .cookie("accessToken", accessToken, { 
        ...cookieOptions, 
        maxAge: JWT_EXPIRE === "1h" ? 60 * 60 * 1000 : 15 * 60 * 1000 
      })
      .cookie("refreshToken", refreshToken, { 
        ...cookieOptions, 
        maxAge: COOKIE_EXPIRE * 24 * 60 * 60 * 1000 
      })
      .cookie("deviceKey", deviceKey, { 
        ...cookieOptions, 
        maxAge: COOKIE_EXPIRE * 24 * 60 * 60 * 1000 
      })
      .cookie("sessionVersion", user.sessionVersion, { 
        ...cookieOptions, 
        maxAge: COOKIE_EXPIRE * 24 * 60 * 60 * 1000 
      })
      .cookie("csrfToken", csrfToken, { 
        ...cookieOptions, 
        maxAge: 10 * 60 * 1000, 
        httpOnly: false 
      })
      .status(200)
      .json({
        success: true,
        message: "Logged in successfully",
        twoFactorEnabled: user.twoFactorEnabled,
      });

  } catch (error) {
    logger.error("Login error", { message: error.message, ip: req.ip });
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

module.exports = { Signup, Login };