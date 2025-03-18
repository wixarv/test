// const User = require("../models/User");
// const jwt = require("jsonwebtoken");
// const { RateLimiterMemory } = require("rate-limiter-flexible");
// const winston = require("winston");
// const getCountryFromIP = require("../utils/getcountry");
// const { v4: uuidv4 } = require("uuid");
// const DeviceDetector = require("device-detector-js");
// const Joi = require("joi");
// const crypto = require("crypto");

// // Logger setup
// const logger = winston.createLogger({
//   level: "info",
//   format: winston.format.json(),
//   transports: [new winston.transports.File({ filename: "auth.log" })],
// });

// // Rate limiters
// const signupLimiter = new RateLimiterMemory({ points: 3, duration: 3600 }); // 3 attempts per hour
// const loginLimiter = new RateLimiterMemory({ points: 15, duration: 900 }); // 15 attempts per 15 mins

// // Device detector
// const deviceDetector = new DeviceDetector();

// // JWT secrets
// const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString("hex");
// const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(64).toString("hex");

// // Validation schemas
// const schemas = {
//   signup: Joi.object({
//     name: Joi.string().min(2).max(50).required(),
//     username: Joi.string().alphanum().min(3).max(30).required(),
//     email: Joi.string().email().required(),
//     password: Joi.string()
//       .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
//       .required(),
//   }),
//   login: Joi.object({
//     identifier: Joi.string().required(),
//     password: Joi.string().required(),
//   }),
//   logoutDevice: Joi.object({
//     deviceKey: Joi.string().uuid().required(),
//   }),
// };

// // Utility functions
// const generateUsernameSuggestions = async (username) => {
//   const suggestions = [];
//   for (let i = 1; i <= 3; i++) {
//     const suggestion = `${username}${Math.floor(Math.random() * 1000)}`;
//     if (!(await User.findOne({ username: suggestion }))) suggestions.push(suggestion);
//   }
//   return suggestions;
// };

// const generateCsrfToken = () => crypto.randomBytes(32).toString("hex");

// // Controllers
// const Signup = async (req, res) => {
//   try {
//     await signupLimiter.consume(req.ip).catch(() => {
//       throw { status: 429, message: "Too many signup attempts." };
//     });
//     const { error } = schemas.signup.validate(req.body);
//     if (error) throw { status: 400, message: error.details[0].message };

//     const { name, username, email, password } = req.body;
//     const [existingEmail, existingUsername] = await Promise.all([
//       User.findOne({ email }),
//       User.findOne({ username }),
//     ]);
//     if (existingEmail && existingUsername)
//       throw {
//         status: 400,
//         message: "Email and username taken.",
//         suggestions: await generateUsernameSuggestions(username),
//       };
//     if (existingEmail) throw { status: 400, message: "Email already registered." };
//     if (existingUsername)
//       throw {
//         status: 400,
//         message: "Username taken.",
//         suggestions: await generateUsernameSuggestions(username),
//       };

//     const { country, state, localTime, language } = await getCountryFromIP(req);
//     const user = new User({
//       name,
//       username,
//       email,
//       password,
//       registeredIP: req.ip,
//       location: { country, state, language },
//       loginHistory: [
//         {
//           ip: req.ip,
//           userAgent: req.headers["user-agent"] || "Unknown",
//           deviceKey: uuidv4(),
//           country,
//           state,
//           localTime,
//           language,
//           isActive: true,
//           timestamp: new Date(),
//         },
//       ],
//       role: "user",
//     });
//     await user.save();

//     logger.info("User signed up", { email, ip: req.ip });
//     res.status(201).json({ success: true, message: "Account created successfully." });
//   } catch (error) {
//     logger.error("Signup error", { message: error.message, ip: req.ip });
//     res.status(error.status || 500).json({
//       success: false,
//       message: error.message || "Signup error.",
//       ...(error.suggestions && { usernameSuggestions: error.suggestions }),
//     });
//   }
// };

// const Login = async (req, res) => {
//   try {
//     await loginLimiter.consume(req.ip).catch(() => {
//       throw { status: 429, message: "Too many login attempts." };
//     });
    
//     const { error } = schemas.login.validate(req.body);
//     if (error) throw { status: 400, message: error.details[0].message };

//     const { identifier, password } = req.body;
//     const user = await User.findOne({ 
//       $or: [{ email: identifier }, { username: identifier }] 
//     }).select("+password");
    
//     if (!user || !(await user.comparePassword(password))) {
//       if (user) {
//         user.failedLoginAttempts += 1;
//         if (user.failedLoginAttempts >= 5) user.lockUntil = Date.now() + 900000;
//         await user.save();
//       }
//       throw { status: 401, message: "Invalid credentials." };
//     }

//     user.failedLoginAttempts = 0;
//     user.lockUntil = null;
//     const { country, state, localTime, language } = await getCountryFromIP(req);
//     const deviceInfo = deviceDetector.parse(req.headers["user-agent"] || "Unknown");
    
//     // Device signature excluding client
//     const deviceSignature = `${deviceInfo?.device?.type || "Unknown"}-${
//       deviceInfo?.os?.name || "Unknown"
//     }-${req.ip}`;
    
//     const existingDeviceIndex = user.loginHistory.findIndex(entry => 
//       entry.isActive && 
//       `${entry.deviceType}-${entry.os}-${entry.ip}` === deviceSignature
//     );

//     const currentTime = new Date();
//     let deviceKey;

//     if (existingDeviceIndex !== -1) {
//       // Reuse existing deviceKey
//       deviceKey = user.loginHistory[existingDeviceIndex].deviceKey;
//       // Update existing device entry
//       user.loginHistory[existingDeviceIndex] = {
//         ...user.loginHistory[existingDeviceIndex], // Preserve all existing fields
//         ip: req.ip,
//         userAgent: req.headers["user-agent"] || "Unknown",
//         client: deviceInfo?.client?.name || "Unknown",
//         country,
//         state,
//         localTime,
//         language,
//         deviceKey, // Explicitly include deviceKey
//         timestamp: currentTime,
//       };
//     } else {
//       // Generate new deviceKey for new device
//       deviceKey = uuidv4();
//       user.loginHistory.push({
//         ip: req.ip,
//         userAgent: req.headers["user-agent"] || "Unknown",
//         deviceKey, // Ensure deviceKey is included
//         country,
//         state,
//         localTime,
//         language,
//         isActive: true,
//         timestamp: currentTime,
//         deviceType: deviceInfo?.device?.type || "Unknown",
//         client: deviceInfo?.client?.name || "Unknown",
//         os: deviceInfo?.os?.name || "Unknown",
//       });
//     }

//     const [accessToken, refreshToken] = [
//       jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: "7d" }),
//       jwt.sign({ userId: user._id }, JWT_REFRESH_SECRET, { expiresIn: "7d" }),
//     ];
//     user.refreshToken = refreshToken;
//     await user.save();

//     const csrfToken = generateCsrfToken();
//     res
//       .cookie("accessToken", accessToken, {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//         maxAge: 7 * 24 * 60 * 60 * 1000,
//       })
//       .cookie("refreshToken", refreshToken, {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//         maxAge: 7 * 24 * 60 * 60 * 1000,
//       })
//       .cookie("deviceKey", deviceKey, {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//         maxAge: 7 * 24 * 60 * 60 * 1000,
//       })
//       .cookie("csrfToken", csrfToken, {
//         httpOnly: false,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//         maxAge: 7 * 24 * 60 * 60 * 1000,
//       })
//       .status(200)
//       .json({
//         success: true,
//         message: "Logged in successfully.",
//         userId: user._id.toString(),
//         csrfToken,
//         serverTime: currentTime.toISOString(),
//       });
//   } catch (error) {
//     logger.error("Login error", { message: error.message, ip: req.ip });
//     res.status(error.status || 500).json({ 
//       success: false, 
//       message: error.message || "Login error." 
//     });
//   }
// };

// const Refresh = async (req, res) => {
//   try {
//     const { refreshToken, csrfToken } = req.cookies;
//     if (!refreshToken || !csrfToken || req.headers["x-csrf-token"] !== csrfToken)
//       throw { status: 401, message: "Invalid or missing tokens." };

//     const user = await User.findOne({ refreshToken });
//     if (!user) throw { status: 401, message: "Invalid refresh token." };
//     const decodedRefresh = jwt.verify(refreshToken, JWT_REFRESH_SECRET);

//     const [newAccessToken, newRefreshToken] = [
//       jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: "7d" }),
//       jwt.sign({ userId: user._id }, JWT_REFRESH_SECRET, { expiresIn: "7d" }),
//     ];
//     user.refreshToken = newRefreshToken;
//     await user.save();

//     const newCsrfToken = generateCsrfToken();
//     res
//       .cookie("accessToken", newAccessToken, {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//         maxAge: 7 * 24 * 60 * 60 * 1000,
//       })
//       .cookie("refreshToken", newRefreshToken, {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//         maxAge: 7 * 24 * 60 * 60 * 1000,
//       })
//       .cookie("csrfToken", newCsrfToken, {
//         httpOnly: false,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//         maxAge: 7 * 24 * 60 * 60 * 1000,
//       })
//       .status(200)
//       .json({ success: true, message: "Tokens refreshed.", csrfToken: newCsrfToken });
//   } catch (error) {
//     res.status(error.status || 401).json({ success: false, message: error.message || "Refresh failed." });
//   }
// };

// const Logout = async (req, res) => {
//   try {
//     const { csrfToken } = req.cookies;
//     if (!csrfToken || req.headers["x-csrf-token"] !== csrfToken)
//       throw { status: 403, message: "Invalid CSRF token." };

//     const user = await User.findById(req.userId);
//     if (user) {
//       const { deviceKey } = req.cookies;
//       if (deviceKey) {
//         user.loginHistory = user.loginHistory.map((entry) =>
//           entry.deviceKey === deviceKey ? { ...entry, isActive: false } : entry
//         );
//         if (!user.loginHistory.some((entry) => entry.isActive)) user.refreshToken = null;
//       }
//       await user.save();
//     }
//     res
//       .clearCookie("accessToken", {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//       })
//       .clearCookie("refreshToken", {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//       })
//       .clearCookie("deviceKey", {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//       })
//       .clearCookie("csrfToken", {
//         httpOnly: false,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//       })
//       .status(200)
//       .json({ success: true, message: "Logged out successfully." });
//   } catch (error) {
//     res.status(error.status || 500).json({ success: false, message: error.message || "Logout error." });
//   }
// };

// const LogoutAll = async (req, res) => {
//   try {
//     const { csrfToken } = req.cookies;
//     if (!csrfToken || req.headers["x-csrf-token"] !== csrfToken)
//       throw { status: 403, message: "Invalid CSRF token." };

//     const user = await User.findById(req.userId);
//     if (user) {
//       user.loginHistory = user.loginHistory.map((entry) => ({ ...entry, isActive: false }));
//       user.refreshToken = null;
//       await user.save();
//     }
//     res
//       .clearCookie("accessToken", {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//       })
//       .clearCookie("refreshToken", {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//       })
//       .clearCookie("deviceKey", {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//       })
//       .clearCookie("csrfToken", {
//         httpOnly: false,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//       })
//       .status(200)
//       .json({ success: true, message: "Logged out from all devices successfully." });
//   } catch (error) {
//     logger.error("LogoutAll error:", { message: error.message });
//     res.status(500).json({
//       success: false,
//       message: error.message || "Error logging out from all devices.",
//     });
//   }
// };

// const LogoutDevice = async (req, res) => {
//   try {
//     const { csrfToken } = req.cookies;
//     if (!csrfToken || req.headers["x-csrf-token"] !== csrfToken)
//       throw { status: 403, message: "Invalid CSRF token." };
//     const { error } = schemas.logoutDevice.validate(req.body);
//     if (error) throw { status: 400, message: error.details[0].message };

//     const { deviceKey } = req.body;
//     const user = await User.findById(req.userId);
//     if (!user) throw { status: 404, message: "User not found." };

//     const deviceExists = user.loginHistory.some((entry) => entry.deviceKey === deviceKey);
//     if (!deviceExists) throw { status: 404, message: "Device not found." };

//     user.loginHistory = user.loginHistory.map((entry) =>
//       entry.deviceKey === deviceKey ? { ...entry, isActive: false } : entry
//     );
//     if (!user.loginHistory.some((entry) => entry.isActive)) user.refreshToken = null;
//     await user.save();

//     res.status(200).json({
//       success: true,
//       message: `Logged out from device ${deviceKey} successfully.`,
//     });
//   } catch (error) {
//     logger.error("LogoutDevice error:", { message: error.message });
//     res.status(error.status || 500).json({
//       success: false,
//       message: error.message || "Error logging out device.",
//     });
//   }
// };

// const GetActiveDevices = async (req, res) => {
//   try {
//     const { csrfToken, deviceKey: currentDeviceKey } = req.cookies;
//     if (!csrfToken || req.headers["x-csrf-token"] !== csrfToken)
//       throw { status: 403, message: "Invalid CSRF token." };

//     const user = await User.findById(req.userId);
//     if (!user) throw { status: 404, message: "User not found." };

//     const now = new Date();
//     const deviceMap = new Map();

//     user.loginHistory
//       .filter((entry) => entry.isActive)
//       .forEach((entry) => {
//         const deviceInfo = deviceDetector.parse(entry.userAgent || "Unknown");
//         const deviceSignature = `${deviceInfo?.device?.type || "Unknown"}-${
//           deviceInfo?.os?.name || "Unknown"
//         }-${entry.ip}`;

//         if (entry.deviceKey === currentDeviceKey) {
//           entry.timestamp = now; // Update timestamp for current device
//         }

//         if (!deviceMap.has(deviceSignature) || 
//             new Date(entry.timestamp) > new Date(deviceMap.get(deviceSignature).lastActive)) {
//           const timeDiffMs = now - new Date(entry.timestamp);
//           const hoursAgo = Math.round(timeDiffMs / (1000 * 60 * 60) * 10) / 10;

//           deviceMap.set(deviceSignature, {
//             ip: entry.ip,
//             country: entry.country,
//             state: entry.state,
//             localTime: entry.localTime,
//             language: entry.language,
//             deviceKey: entry.deviceKey,
//             deviceType: deviceInfo?.device?.type || "Unknown",
//             client: entry.client || "Unknown",
//             os: deviceInfo?.os?.name || "Unknown",
//             lastActive: entry.timestamp,
//             hoursAgo: hoursAgo >= 0 ? hoursAgo : 0,
//             isCurrentDevice: entry.deviceKey === currentDeviceKey,
//           });
//         }
//       });

//     await user.save();
//     const activeDevices = Array.from(deviceMap.values());

//     res.status(200).json({ 
//       success: true, 
//       devices: activeDevices,
//       total: activeDevices.length,
//       serverTime: now.toISOString(),
//     });
//   } catch (error) {
//     res.status(error.status || 500).json({
//       success: false,
//       message: error.message || "Error fetching devices.",
//     });
//   }
// };

// const Protected = async (req, res) => {
//   try {
//     const user = await User.findById(req.userId);
//     if (!user) throw { status: 404, message: "User not found." };
//     res.status(200).json({
//       success: true,
//       message: "This is a protected route.",
//       userId: user._id.toString(),
//     });
//   } catch (error) {
//     res.status(error.status || 500).json({
//       success: false,
//       message: error.message || "Protected route error.",
//     });
//   }
// };

// const GetCsrfToken = async (req, res) => {
//   const csrfToken = generateCsrfToken();
//   res
//     .cookie("csrfToken", csrfToken, {
//       httpOnly: false,
//       secure: process.env.NODE_ENV === "production",
//       sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
//       maxAge: 7 * 24 * 60 * 60 * 1000,
//     })
//     .status(200)
//     .json({ csrfToken });
// };

// const Localization = async (req, res) => {
//   try {
//     const { csrfToken } = req.cookies;
//     if (!csrfToken || req.headers["x-csrf-token"] !== csrfToken) 
//       return res.status(403).json({ success: false, message: "Invalid CSRF token." });

//     const user = await User.findById(req.userId);
//     if (!user) 
//       return res.status(404).json({ success: false, message: "User not found." });

//     const locationData = await getCountryFromIP(req);
//     const deviceInfo = deviceDetector.parse(req.headers["user-agent"] || "Unknown");
    
//     const userLocation = {
//       country: locationData.country,
//       region: locationData.state,
//       city: locationData.city,
//       localTime: locationData.localTime,
//       language: locationData.language,
//       device: {
//         os: deviceInfo?.os?.name || "Unknown",
//         osVersion: deviceInfo?.os?.version || "Unknown",
//         browser: deviceInfo?.client?.name || "Unknown",
//         browserVersion: deviceInfo?.client?.version || "Unknown"
//       },
//       lastUpdated: new Date()
//     };

//     if (req.cookies.deviceKey) {
//       const session = user.loginHistory.find(
//         entry => entry.deviceKey === req.cookies.deviceKey && entry.isActive
//       );
//       if (session) {
//         Object.assign(session, {
//           ip: req.ip,
//           country: locationData.country,
//           state: locationData.state,
//           city: locationData.city,
//           localTime: locationData.localTime,
//           lastUpdated: new Date()
//         });
//         await user.save();
//       }
//     }

//     logger.info("User location retrieved", { userId: req.userId, ip: req.ip, country: locationData.country });
//     res.status(200).json({ success: true, location: userLocation, message: "Your location data retrieved successfully" });
//   } catch (error) {
//     logger.error("GetUserLocation error", { message: error.message, ip: req.ip });
//     res.status(error.status || 500).json({ success: false, message: error.message || "Error retrieving your location data" });
//   }
// };
// module.exports = {
//   Signup,
//   Login,
//   Refresh,
//   Logout,
//   LogoutAll,
//   LogoutDevice,
//   GetActiveDevices,
//   Protected,
//   GetCsrfToken,
//   Localization
// };















const User = require("../models/User");
const jwt = require("jsonwebtoken");
const { RateLimiterMemory } = require("rate-limiter-flexible");
const winston = require("winston");
const getCountryFromIP = require("../utils/getcountry");
const { v4: uuidv4 } = require("uuid");
const DeviceDetector = require("device-detector-js");
const Joi = require("joi");
const crypto = require("crypto");

// Logger setup
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: "auth.log" })],
});

// Rate limiters
const signupLimiter = new RateLimiterMemory({ points: 3, duration: 3600 });
const loginLimiter = new RateLimiterMemory({ points: 15, duration: 900 });

// Device detector
const deviceDetector = new DeviceDetector();

// JWT secrets
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString("hex");
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(64).toString("hex");

// Validation schemas
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
  }),
  logoutDevice: Joi.object({
    deviceKey: Joi.string().uuid().required(),
  }),
};

// Utility functions
const generateUsernameSuggestions = async (username) => {
  const suggestions = [];
  for (let i = 1; i <= 3; i++) {
    const suggestion = `${username}${Math.floor(Math.random() * 1000)}`;
    if (!(await User.findOne({ username: suggestion }))) suggestions.push(suggestion);
  }
  return suggestions;
};

const generateCsrfToken = () => crypto.randomBytes(32).toString("hex");

const Signup = async (req, res) => {
  try {
    await signupLimiter.consume(req.ip).catch(() => {
      throw { status: 429, message: "Too many signup attempts." };
    });
    const { error } = schemas.signup.validate(req.body);
    if (error) throw { status: 400, message: error.details[0].message };

    const { name, username, email, password } = req.body;
    const [existingEmail, existingUsername] = await Promise.all([
      User.findOne({ email }),
      User.findOne({ username }),
    ]);
    if (existingEmail && existingUsername)
      throw {
        status: 400,
        message: "Email and username taken.",
        suggestions: await generateUsernameSuggestions(username),
      };
    if (existingEmail) throw { status: 400, message: "Email already registered." };
    if (existingUsername)
      throw {
        status: 400,
        message: "Username taken.",
        suggestions: await generateUsernameSuggestions(username),
      };

    const { country, state, localTime, language } = await getCountryFromIP(req);
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
          deviceKey: uuidv4(),
          country,
          state,
          localTime,
          language,
          isActive: true,
          timestamp: new Date(),
        },
      ],
      role: "user",
    });
    await user.save();

    logger.info("User signed up", { email, ip: req.ip });
    res.status(201).json({ success: true, message: "Account created successfully." });
  } catch (error) {
    logger.error("Signup error", { message: error.message, ip: req.ip });
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Signup error.",
      ...(error.suggestions && { usernameSuggestions: error.suggestions }),
    });
  }
};

const Login = async (req, res) => {
  try {
    await loginLimiter.consume(req.ip).catch(() => {
      throw { status: 429, message: "Too many login attempts." };
    });
    
    const { error } = schemas.login.validate(req.body);
    if (error) throw { status: 400, message: error.details[0].message };

    const { identifier, password } = req.body;
    const user = await User.findOne({ 
      $or: [{ email: identifier }, { username: identifier }] 
    }).select("+password");
    
    if (!user || !(await user.comparePassword(password))) {
      if (user) {
        user.failedLoginAttempts += 1;
        if (user.failedLoginAttempts >= 5) user.lockUntil = Date.now() + 900000;
        await user.save();
      }
      throw { status: 401, message: "Invalid credentials." };
    }

    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    const { country, state, localTime, language } = await getCountryFromIP(req);
    const deviceInfo = deviceDetector.parse(req.headers["user-agent"] || "Unknown");
    
    const deviceSignature = `${deviceInfo?.device?.type || "Unknown"}-${
      deviceInfo?.os?.name || "Unknown"
    }-${req.ip}`;
    
    const existingDeviceIndex = user.loginHistory.findIndex(entry => 
      entry.isActive && 
      `${entry.deviceType}-${entry.os}-${entry.ip}` === deviceSignature
    );

    const currentTime = new Date();
    let deviceKey;

    if (existingDeviceIndex !== -1) {
      deviceKey = user.loginHistory[existingDeviceIndex].deviceKey;
      user.loginHistory[existingDeviceIndex] = {
        ...user.loginHistory[existingDeviceIndex],
        ip: req.ip,
        userAgent: req.headers["user-agent"] || "Unknown",
        client: deviceInfo?.client?.name || "Unknown",
        country,
        state,
        localTime,
        language,
        deviceKey,
        timestamp: currentTime,
      };
    } else {
      deviceKey = uuidv4();
      user.loginHistory.push({
        ip: req.ip,
        userAgent: req.headers["user-agent"] || "Unknown",
        deviceKey,
        country,
        state,
        localTime,
        language,
        isActive: true,
        timestamp: currentTime,
        deviceType: deviceInfo?.device?.type || "Unknown",
        client: deviceInfo?.client?.name || "Unknown",
        os: deviceInfo?.os?.name || "Unknown",
      });
    }

    const [accessToken, refreshToken] = [
      jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: "7d" }),
      jwt.sign({ userId: user._id }, JWT_REFRESH_SECRET, { expiresIn: "7d" }),
    ];
    user.refreshToken = refreshToken;
    await user.save();

    const csrfToken = generateCsrfToken();
    res
      .cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .cookie("deviceKey", deviceKey, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .cookie("csrfToken", csrfToken, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .status(200)
      .json({
        success: true,
        message: "Logged in successfully.",
        userId: user._id.toString(),
        csrfToken,
        serverTime: currentTime.toISOString(),
      });
  } catch (error) {
    logger.error("Login error", { message: error.message, ip: req.ip });
    res.status(error.status || 500).json({ 
      success: false, 
      message: error.message || "Login error." 
    });
  }
};

const ChangePassword = async (req, res) => {
  try {
    const { csrfToken } = req.cookies;
    if (!csrfToken || req.headers["x-csrf-token"] !== csrfToken) {
      throw { status: 403, message: "Invalid CSRF token." };
    }

    const changePasswordSchema = Joi.object({
      currentPassword: Joi.string().required(),
      newPassword: Joi.string()
        .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
        .required()
        .messages({
          "string.pattern.base": "New password must contain at least one lowercase letter, one uppercase letter, one number, one special character, and be at least 8 characters long"
        }),
      confirmNewPassword: Joi.string()
        .valid(Joi.ref("newPassword"))
        .required()
        .messages({
          "any.only": "Passwords do not match"
        })
    });

    const { error } = changePasswordSchema.validate(req.body);
    if (error) throw { status: 400, message: error.details[0].message };

    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.userId).select("+password");
    if (!user) throw { status: 404, message: "User not found." };

    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      throw { status: 401, message: "Current password is incorrect." };
    }

    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      throw { status: 400, message: "New password cannot be the same as the current password." };
    }

    user.password = newPassword;
    
    const currentDeviceKey = req.cookies.deviceKey;
    if (currentDeviceKey) {
      user.loginHistory = user.loginHistory.map(entry => 
        entry.deviceKey === currentDeviceKey 
          ? entry 
          : { ...entry, isActive: false }
      );
      user.refreshToken = null;
    }

    await user.save();

    logger.info("Password changed successfully", { 
      userId: req.userId, 
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      message: "Password changed successfully."
    });

  } catch (error) {
    logger.error("Change password error", { 
      message: error.message, 
      userId: req.userId, 
      ip: req.ip 
    });
    
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Error changing password."
    });
  }
};

const Refresh = async (req, res) => {
  try {
    const { refreshToken, csrfToken } = req.cookies;
    if (!refreshToken || !csrfToken || req.headers["x-csrf-token"] !== csrfToken)
      throw { status: 401, message: "Invalid or missing tokens." };

    const user = await User.findOne({ refreshToken });
    if (!user) throw { status: 401, message: "Invalid refresh token." };
    const decodedRefresh = jwt.verify(refreshToken, JWT_REFRESH_SECRET);

    const [newAccessToken, newRefreshToken] = [
      jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: "7d" }),
      jwt.sign({ userId: user._id }, JWT_REFRESH_SECRET, { expiresIn: "7d" }),
    ];
    user.refreshToken = newRefreshToken;
    await user.save();

    const newCsrfToken = generateCsrfToken();
    res
      .cookie("accessToken", newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .cookie("refreshToken", newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .cookie("csrfToken", newCsrfToken, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .status(200)
      .json({ success: true, message: "Tokens refreshed.", csrfToken: newCsrfToken });
  } catch (error) {
    res.status(error.status || 401).json({ success: false, message: error.message || "Refresh failed." });
  }
};

const Protected = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) throw { status: 404, message: "User not found." };
    res.status(200).json({
      success: true,
      message: "This is a protected route.",
      userId: user._id.toString(),
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Protected route error.",
    });
  }
};

const GetCsrfToken = async (req, res) => {
  const csrfToken = generateCsrfToken();
  res
    .cookie("csrfToken", csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
    .status(200)
    .json({ csrfToken });
};

module.exports = {
  Signup,
  Login,
  ChangePassword,
  Refresh,
  Protected,
  GetCsrfToken
};