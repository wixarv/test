const User = require("../models/user");
const jwt = require("jsonwebtoken");
const winston = require("winston");
const Joi = require("joi");
const crypto = require("crypto");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const Notification = require("../models/notifications");
const { generateCsrfToken } = require("../middleware/authMiddleware");

const maskSensitiveData = (data) =>
  typeof data === "string" && data.length > 5
    ? `${data.substring(0, 2)}****${data.substring(data.length - 2)}`
    : data;

const logger = winston.createLogger({
  level: "info",
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

const schemas = {
  logoutDevice: Joi.object({
    deviceKey: Joi.string().uuid().required(),
  }),
  twoFactorSetup: Joi.object({
    enable: Joi.boolean().required(),
  }),
  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string()
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
      .required()
      .messages({
        "string.pattern.base":
          "New password must contain at least one lowercase letter, one uppercase letter, one number, one special character, and be at least 8 characters long",
      }),
    confirmNewPassword: Joi.string()
      .valid(Joi.ref("newPassword"))
      .required()
      .messages({ "any.only": "Passwords do not match" }),
  }),
};

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "Strict",
  path: "/",
};

const generateBackupCodes = () =>
  Array(8)
    .fill()
    .map(() => crypto.randomBytes(4).toString("hex").toUpperCase());

const ChangePassword = async (req, res) => {
  try {
    const { error } = schemas.changePassword.validate(req.body, { abortEarly: false });
    if (error) throw { status: 400, message: error.details.map((d) => d.message).join(", ") };

    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.userId).select("+password");
    if (!user) throw { status: 404, message: "User not found" };

    if (!(await user.comparePassword(currentPassword))) {
      throw { status: 401, message: "Current password is incorrect" };
    }

    if (await user.comparePassword(newPassword)) {
      throw { status: 400, message: "New password cannot be the same as current" };
    }

    user.password = newPassword;
    const currentDeviceKey = req.cookies.deviceKey;
    if (currentDeviceKey) {
      user.loginHistory = user.loginHistory.map((entry) =>
        entry.deviceKey === currentDeviceKey ? entry : { ...entry, isActive: false }
      );
      user.refreshToken = null;
    }
    await user.save();

    // Create notification with username from user
    const notification = new Notification({
      userId: req.userId,
      username: user.username, // Fetch username from user document
      type: "security",
      title: "Password Changed",
      message: `${user.username || "You"} changed your password`,
      read: false,
      createdAt: new Date(),
    });
    await notification.save();

    logger.info("Password changed and notification created", {
      userId: req.userId,
      ip: req.ip,
      notificationId: notification._id,
    });

    const io = req.app.get("io");
    const connectedUsers = req.app.get("connectedUsers");
    const userSockets = connectedUsers.get(req.userId.toString()) || [];
    if (userSockets.length > 0) {
      userSockets.forEach((socketId) => {
        io.to(socketId).emit("notification", {
          id: notification._id.toString(),
          userId: req.userId.toString(),
          username: user.username, // Include username in socket emit
          type: "security",
          message: "changed your password",
          title: "Password Changed",
          time: notification.createdAt.toISOString(),
          isRead: false,
        });
        logger.info(`Notification emitted to user ${req.userId} with socket ${socketId}`);
      });
    } else {
      logger.warn(`User ${req.userId} not connected, notification not emitted`);
    }

    const newCsrfToken = res.locals.newCsrfToken || await generateCsrfToken(req);
    res
      .cookie("csrfToken", newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .status(200)
      .json({ success: true, message: "Password changed successfully", csrfToken: newCsrfToken });
  } catch (error) {
    logger.error("Change password error", {
      message: error.message,
      userId: req.userId,
      ip: req.ip,
      stack: error.stack,
    });
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

const Refresh = async (req, res) => {
  try {
    const { refreshToken, deviceKey } = req.cookies; 
    const headerCsrfToken = req.headers["x-csrf-token"];

    if (!refreshToken) {
      logger.warn("No refresh token provided", { ip: req.ip });
      throw { status: 401, message: "No refresh token provided" };
    }
    if (!deviceKey) {
      logger.warn("No device key provided", { ip: req.ip });
      throw { status: 401, message: "No device key provided" };
    }
    if (!headerCsrfToken) {
      logger.warn("Missing CSRF token in refresh", { ip: req.ip });
      throw { status: 403, message: "Missing CSRF token" };
    }

    const user = await User.findOne({ refreshToken });
    if (!user || !user.loginHistory.some(entry => entry.deviceKey === deviceKey && entry.isActive)) {
      logger.warn("Invalid refresh token or device", { ip: req.ip });
      throw { status: 401, message: "Invalid refresh token or device, please log in again" };
    }

    try {
      jwt.verify(refreshToken, JWT_REFRESH_SECRET, { algorithms: ["HS256"], issuer: "your-app-name" });
    } catch (err) {
      logger.warn("Refresh token expired or invalid", { ip: req.ip });
      throw { status: 401, message: "Refresh token expired or invalid, please log in again" };
    }

    const [newAccessToken, newRefreshToken] = [
      jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: "15m", issuer: "your-app-name" }),
      jwt.sign({ userId: user._id }, JWT_REFRESH_SECRET, { expiresIn: "1d", issuer: "your-app-name" }),
    ];

    user.refreshToken = newRefreshToken;
    await user.save();

    const newCsrfToken = await generateCsrfToken(req); // Made async
    res
      .cookie("accessToken", newAccessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 })
      .cookie("refreshToken", newRefreshToken, { ...cookieOptions, maxAge: 24 * 60 * 60 * 1000 })
      .cookie("csrfToken", newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .status(200)
      .json({ success: true, message: "Tokens refreshed", csrfToken: newCsrfToken });
  } catch (error) {
    logger.error("Refresh error", { message: error.message, ip: req.ip });
    res.status(error.status || 401).json({ success: false, message: error.message });
  }
};

const Protected = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) throw { status: 404, message: "User not found" };

    const newCsrfToken = res.locals.newCsrfToken || await generateCsrfToken(req);
    res
      .cookie("csrfToken", newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .status(200)
      .json({
        success: true,
        message: "Protected",
        userId: user._id.toString(),
        // csrfToken: newCsrfToken,
      });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

const GetCsrfToken = async (req, res) => {
  try {
    const csrfToken = await generateCsrfToken(req); // Made async
    res
      .cookie("csrfToken", csrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .status(200)
      .json({ success: true, csrfToken });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error generating CSRF token" });
  }
};

const Setup2FA = async (req, res) => {
  try {
    const { error } = schemas.twoFactorSetup.validate(req.body);
    if (error) throw { status: 400, message: error.details[0].message };

    const { enable } = req.body;
    const user = await User.findById(req.userId).select("+twoFactorSecret +twoFactorBackupCodes");
    if (!user) throw { status: 404, message: "User not found" };

    if (enable) {
      if (user.twoFactorEnabled) throw { status: 400, message: "2FA already enabled" };

      const secret = speakeasy.generateSecret({ length: 20, name: `social:${user.email}` });
      user.twoFactorSecret = secret.base32;
      user.twoFactorBackupCodes = generateBackupCodes();
      user.twoFactorEnabled = true;
      await user.save();

      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
      const newCsrfToken = res.locals.newCsrfToken || await generateCsrfToken(req); // Made async
      res
        .cookie("csrfToken", newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
        .status(200)
        .json({
          success: true,
          message: "2FA enabled",
          qrCodeUrl,
          twoFactorEnabled: true,
          csrfToken: newCsrfToken,
        });
    } else {
      if (!user.twoFactorEnabled) throw { status: 400, message: "2FA already disabled" };
      user.twoFactorEnabled = false;
      user.twoFactorSecret = null;
      user.twoFactorBackupCodes = [];
      await user.save();

      const newCsrfToken = res.locals.newCsrfToken || await generateCsrfToken(req); // Made async
      res
        .cookie("csrfToken", newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
        .status(200)
        .json({
          success: true,
          message: "2FA disabled",
          twoFactorEnabled: false,
          csrfToken: newCsrfToken,
        });
    }
  } catch (error) {
    logger.error("2FA setup error", { message: error.message, userId: req.userId });
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

const get2FAStatus = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) throw { status: 404, message: "User not found" };

    const newCsrfToken = res.locals.newCsrfToken || await generateCsrfToken(req); 
    res
      .cookie("csrfToken", newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .status(200)
      .json({ success: true, twoFactorEnabled: user.twoFactorEnabled, csrfToken: newCsrfToken });
  } catch (error) {
    logger.error("2FA status error", { message: error.message, userId: req.userId });
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

const get2FABackupCodes = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("+twoFactorBackupCodes");
    if (!user) throw { status: 404, message: "User not found" };

    const newCsrfToken = res.locals.newCsrfToken || await generateCsrfToken(req); // Made async
    res
      .cookie("csrfToken", newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .status(200)
      .json({
        success: true,
        backupCodes: user.twoFactorBackupCodes,
        csrfToken: newCsrfToken,
      });
  } catch (error) {
    logger.error("2FA backup codes error", { message: error.message, userId: req.userId });
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};



module.exports = {
  ChangePassword,
  Refresh,
  Protected,
  GetCsrfToken,
  Setup2FA,
  get2FAStatus,
  get2FABackupCodes,
};