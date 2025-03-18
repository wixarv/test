const User = require("../models/User");
const winston = require("winston");
const getCountryFromIP = require("../utils/getcountry");
const DeviceDetector = require("device-detector-js");
const Joi = require("joi");
const crypto = require("crypto");

// Logger setup
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: "auth.log" })],
});

// Device detector
const deviceDetector = new DeviceDetector();

// Validation schemas
const schemas = {
  logoutDevice: Joi.object({
    deviceKey: Joi.string().uuid().required(),
  }),
};

// Utility functions
const generateCsrfToken = () => crypto.randomBytes(32).toString("hex");

const Logout = async (req, res) => {
  try {
    const { csrfToken } = req.cookies;
    if (!csrfToken || req.headers["x-csrf-token"] !== csrfToken)
      throw { status: 403, message: "Invalid CSRF token." };

    const user = await User.findById(req.userId);
    if (user) {
      const { deviceKey } = req.cookies;
      if (deviceKey) {
        user.loginHistory = user.loginHistory.map((entry) =>
          entry.deviceKey === deviceKey ? { ...entry, isActive: false } : entry
        );
        if (!user.loginHistory.some((entry) => entry.isActive)) user.refreshToken = null;
      }
      await user.save();
    }
    res
      .clearCookie("accessToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
      })
      .clearCookie("refreshToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
      })
      .clearCookie("deviceKey", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
      })
      .clearCookie("csrfToken", {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
      })
      .status(200)
      .json({ success: true, message: "Logged out successfully." });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || "Logout error." });
  }
};

const LogoutAll = async (req, res) => {
    try {
      const { csrfToken } = req.cookies;
      if (!csrfToken || req.headers["x-csrf-token"] !== csrfToken)
        throw { status: 403, message: "Invalid CSRF token." };
  
      const user = await User.findById(req.userId);
      if (!user) throw { status: 404, message: "User not found." };
      
      // Mark all devices as inactive
      user.loginHistory = user.loginHistory.map((entry) => ({ ...entry, isActive: false }));
      // Clear the refresh token
      user.refreshToken = null;
      await user.save();
      
      // Clear cookies on the current device
      res
        .clearCookie("accessToken", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
          path: "/"
        })
        .clearCookie("refreshToken", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
          path: "/"
        })
        .clearCookie("deviceKey", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
          path: "/"
        })
        .clearCookie("csrfToken", {
          httpOnly: false,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
          path: "/"
        })
        .status(200)
        .json({ success: true, message: "Logged out from all devices successfully." });
        
      logger.info("User logged out from all devices", { userId: req.userId });
    } catch (error) {
      logger.error("LogoutAll error:", { message: error.message, userId: req.userId });
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Error logging out from all devices.",
      });
    }
  };
  
  const LogoutDevice = async (req, res) => {
    try {
      const { csrfToken } = req.cookies;
      if (!csrfToken || req.headers["x-csrf-token"] !== csrfToken)
        throw { status: 403, message: "Invalid CSRF token." };
  
      const { error } = schemas.logoutDevice.validate(req.body);
      if (error) throw { status: 400, message: error.details[0].message };
  
      const { deviceKey } = req.body;
      const user = await User.findById(req.userId);
      if (!user) throw { status: 404, message: "User not found." };
  
      // Check if the device exists in the user's login history
      const deviceIndex = user.loginHistory.findIndex((entry) => entry.deviceKey === deviceKey);
      if (deviceIndex === -1) throw { status: 404, message: "Device not found." };
  
      // Mark the specific device as inactive
      user.loginHistory[deviceIndex].isActive = false;
      
      // If this was the last active device, clear the refresh token
      if (!user.loginHistory.some((entry) => entry.isActive)) {
        user.refreshToken = null;
      }
      
      await user.save();
  
      // If the current device is being logged out, clear cookies
      if (req.cookies.deviceKey === deviceKey) {
        res
          .clearCookie("accessToken", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
            path: "/"
          })
          .clearCookie("refreshToken", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
            path: "/"
          })
          .clearCookie("deviceKey", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
            path: "/"
          })
          .clearCookie("csrfToken", {
            httpOnly: false,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
            path: "/"
          });
      }
  
      logger.info("User logged out from specific device", { userId: req.userId, deviceKey });
      res.status(200).json({
        success: true,
        message: `Logged out from device ${deviceKey} successfully.`,
      });
    } catch (error) {
      logger.error("LogoutDevice error:", { message: error.message, userId: req.userId });
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Error logging out device.",
      });
    }
  };

const GetActiveDevices = async (req, res) => {
  try {
    const { csrfToken, deviceKey: currentDeviceKey } = req.cookies;
    if (!csrfToken || req.headers["x-csrf-token"] !== csrfToken)
      throw { status: 403, message: "Invalid CSRF token." };

    const user = await User.findById(req.userId);
    if (!user) throw { status: 404, message: "User not found." };

    const now = new Date();
    const deviceMap = new Map();

    user.loginHistory
      .filter((entry) => entry.isActive)
      .forEach((entry) => {
        const deviceInfo = deviceDetector.parse(entry.userAgent || "Unknown");
        const deviceSignature = `${deviceInfo?.device?.type || "Unknown"}-${
          deviceInfo?.os?.name || "Unknown"
        }-${entry.ip}`;

        if (entry.deviceKey === currentDeviceKey) {
          entry.timestamp = now;
        }

        if (!deviceMap.has(deviceSignature) || 
            new Date(entry.timestamp) > new Date(deviceMap.get(deviceSignature).lastActive)) {
          const timeDiffMs = now - new Date(entry.timestamp);
          const hoursAgo = Math.round(timeDiffMs / (1000 * 60 * 60) * 10) / 10;

          deviceMap.set(deviceSignature, {
            ip: entry.ip,
            country: entry.country,
            state: entry.state,
            localTime: entry.localTime,
            language: entry.language,
            deviceKey: entry.deviceKey,
            deviceType: deviceInfo?.device?.type || "Unknown",
            client: entry.client || "Unknown",
            os: deviceInfo?.os?.name || "Unknown",
            lastActive: entry.timestamp,
            hoursAgo: hoursAgo >= 0 ? hoursAgo : 0,
            isCurrentDevice: entry.deviceKey === currentDeviceKey,
          });
        }
      });

    await user.save();
    const activeDevices = Array.from(deviceMap.values());

    res.status(200).json({ 
      success: true, 
      devices: activeDevices,
      total: activeDevices.length,
      serverTime: now.toISOString(),
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Error fetching devices.",
    });
  }
};

const Localization = async (req, res) => {
  try {
    const { csrfToken } = req.cookies;
    if (!csrfToken || req.headers["x-csrf-token"] !== csrfToken) 
      return res.status(403).json({ success: false, message: "Invalid CSRF token." });

    const user = await User.findById(req.userId);
    if (!user) 
      return res.status(404).json({ success: false, message: "User not found." });

    const locationData = await getCountryFromIP(req);
    const deviceInfo = deviceDetector.parse(req.headers["user-agent"] || "Unknown");
    
    const userLocation = {
      country: locationData.country,
      region: locationData.state,
      city: locationData.city,
      localTime: locationData.localTime,
      language: locationData.language,
      device: {
        os: deviceInfo?.os?.name || "Unknown",
        osVersion: deviceInfo?.os?.version || "Unknown",
        browser: deviceInfo?.client?.name || "Unknown",
        browserVersion: deviceInfo?.client?.version || "Unknown"
      },
      lastUpdated: new Date()
    };

    if (req.cookies.deviceKey) {
      const session = user.loginHistory.find(
        entry => entry.deviceKey === req.cookies.deviceKey && entry.isActive
      );
      if (session) {
        Object.assign(session, {
          ip: req.ip,
          country: locationData.country,
          state: locationData.state,
          city: locationData.city,
          localTime: locationData.localTime,
          lastUpdated: new Date()
        });
        await user.save();
      }
    }

    logger.info("User location retrieved", { userId: req.userId, ip: req.ip, country: locationData.country });
    res.status(200).json({ success: true, location: userLocation, message: "Your location data retrieved successfully" });
  } catch (error) {
    logger.error("GetUserLocation error", { message: error.message, ip: req.ip });
    res.status(error.status || 500).json({ success: false, message: error.message || "Error retrieving your location data" });
  }
};

module.exports = {
  Logout,
  LogoutAll,
  LogoutDevice,
  GetActiveDevices,
  Localization
};