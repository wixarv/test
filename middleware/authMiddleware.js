// authMiddleware.js
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/user");
const CsrfToken = require("../models/CsrfToken");

// Environment variables with defaults
const JWT_EXPIRE = process.env.JWT_EXPIRE || "15m";
const REFRESH_EXPIRE = process.env.REFRESH_EXPIRE || "7d";
const COOKIE_EXPIRE = parseInt(process.env.COOKIE_EXPIRE || "5"); // in days

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must be set");
}

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV !== "development",
  sameSite: process.env.NODE_ENV === "development" ? "Lax" : "None", // Fix for cross-site requests
  path: "/",
};

// Generate a strong CSRF token using SHA-256
const generateCsrfToken = async (userId) => {
  const randomPart = crypto.randomBytes(32).toString("hex");
  const timestamp = Date.now().toString();
  
  const hmac = crypto.createHmac("sha256", JWT_SECRET);
  hmac.update(userId + randomPart + timestamp);
  const token = hmac.digest("hex");
  
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  
  await CsrfToken.create({ 
    token,
    userId,
    expiresAt,
    used: false,
  });
  
  return token;
};

const trackTokenUsage = async (tokenId, userId, ip) => {
  await CsrfToken.findByIdAndUpdate(tokenId, {
    $addToSet: { usedIps: ip },
    userIp: ip
  });
};

const authMiddleware = async (req, res, next) => {
  const { accessToken, refreshToken, deviceKey, sessionVersion } = req.cookies;
  const headerCsrfToken = req.headers["x-csrf-token"];
  const userIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.connection.remoteAddress;

  console.log("Auth Middleware - CSRF Token:", headerCsrfToken, "User IP:", userIp); // Debugging

  if (!headerCsrfToken) {
    return res.status(403).json({ success: false, message: "Missing CSRF token" });
  }

  if (!accessToken) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  try {
    const decodedPayload = jwt.decode(accessToken);
    if (!decodedPayload || !decodedPayload.userId) {
      return res.status(401).json({ success: false, message: "Invalid token format" });
    }

    const tokenData = await CsrfToken.findOne({ token: headerCsrfToken });
    console.log("Token Data:", tokenData); // Debugging
    
    if (!tokenData || tokenData.expiresAt < Date.now()) {
      if (tokenData) await CsrfToken.deleteOne({ token: headerCsrfToken });
      return res.status(403).json({ success: false, message: "Invalid or expired CSRF token" });
    }

    if (tokenData.userId && tokenData.userId.toString() !== decodedPayload.userId) {
      await CsrfToken.deleteOne({ token: headerCsrfToken });
      return res.status(403).json({ success: false, message: "Token mismatch" });
    }

    // Temporarily disable IP check for debugging
    // if (tokenData.userIp && tokenData.userIp !== userIp) {
    //   return res.status(403).json({ success: false, message: "Invalid token origin" });
    // }
    
    const decoded = jwt.verify(accessToken, JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "your-app-name",
    });

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ success: false, message: "User not found" });
    }

    // Temporarily disable sessionVersion check for debugging
    // if (!sessionVersion || parseInt(sessionVersion) !== user.sessionVersion) {
    //   res
    //     .clearCookie("accessToken", cookieOptions)
    //     .clearCookie("refreshToken", cookieOptions)
    //     .clearCookie("deviceKey", cookieOptions)
    //     .clearCookie("sessionVersion", cookieOptions)
    //     .clearCookie("csrfToken", { ...cookieOptions, httpOnly: false });
    //   return res.status(401).json({ success: false, message: "Unauthorized: Session invalidated" });
    // }

    await trackTokenUsage(tokenData._id, user._id, userIp);

    req.userId = decoded.userId;

    const shouldRefreshTokens = tokenData.expiresAt - Date.now() < 3 * 60 * 1000;
    
    if (shouldRefreshTokens) {
      const newAccessToken = jwt.sign({ userId: user._id }, JWT_SECRET, {
        expiresIn: JWT_EXPIRE,
        issuer: "your-app-name",
      });
      const newRefreshToken = jwt.sign({ userId: user._id }, JWT_REFRESH_SECRET, {
        expiresIn: REFRESH_EXPIRE,
        issuer: "your-app-name",
      });
      user.refreshToken = newRefreshToken;
      await user.save();

      const newCsrfToken = await generateCsrfToken(user._id.toString());
      res.cookie("accessToken", newAccessToken, { 
        ...cookieOptions, 
        maxAge: JWT_EXPIRE === "1h" ? 60 * 60 * 1000 : 15 * 60 * 1000 
      });
      res.cookie("refreshToken", newRefreshToken, { 
        ...cookieOptions, 
        maxAge: COOKIE_EXPIRE * 24 * 60 * 60 * 1000 
      });
      res.cookie("sessionVersion", user.sessionVersion, { 
        ...cookieOptions, 
        maxAge: COOKIE_EXPIRE * 24 * 60 * 60 * 1000 
      });
      res.cookie("csrfToken", newCsrfToken, { 
        ...cookieOptions, 
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: false 
      });

      res.locals.newCsrfToken = newCsrfToken;
    } else {
      res.locals.newCsrfToken = headerCsrfToken;
    }
    
    next();
  } catch (error) {
    console.error("Auth Middleware Error:", error); // Debugging
    if (error.name === "TokenExpiredError" && refreshToken && deviceKey) {
      try {
        const decodedRefresh = jwt.verify(refreshToken, JWT_REFRESH_SECRET, {
          algorithms: ["HS256"],
          issuer: "your-app-name",
        });
        const user = await User.findOne({ _id: decodedRefresh.userId, refreshToken });
        if (!user || !user.loginHistory.some(entry => entry.deviceKey === deviceKey && entry.isActive)) {
          return res.status(401).json({ success: false, message: "Invalid refresh token or device" });
        }

        // Temporarily disable sessionVersion check for debugging
        // if (!sessionVersion || parseInt(sessionVersion) !== user.sessionVersion) {
        //   res
        //     .clearCookie("accessToken", cookieOptions)
        //     .clearCookie("refreshToken", cookieOptions)
        //     .clearCookie("deviceKey", cookieOptions)
        //     .clearCookie("sessionVersion", cookieOptions)
        //     .clearCookie("csrfToken", { ...cookieOptions, httpOnly: false });
        //   return res.status(401).json({ success: false, message: "Unauthorized: Session invalidated" });
        // }

        const newAccessToken = jwt.sign({ userId: user._id }, JWT_SECRET, {
          expiresIn: JWT_EXPIRE,
          issuer: "your-app-name",
        });
        const newRefreshToken = jwt.sign({ userId: user._id }, JWT_REFRESH_SECRET, {
          expiresIn: REFRESH_EXPIRE,
          issuer: "your-app-name",
        });
        user.refreshToken = newRefreshToken;
        await user.save();

        const newCsrfToken = await generateCsrfToken(user._id.toString());
        res.cookie("accessToken", newAccessToken, { 
          ...cookieOptions, 
          maxAge: JWT_EXPIRE === "1h" ? 60 * 60 * 1000 : 15 * 60 * 1000 
        });
        res.cookie("refreshToken", newRefreshToken, { 
          ...cookieOptions, 
          maxAge: COOKIE_EXPIRE * 24 * 60 * 60 * 1000 
        });
        res.cookie("sessionVersion", user.sessionVersion, { 
          ...cookieOptions, 
          maxAge: COOKIE_EXPIRE * 24 * 60 * 60 * 1000 
        });
        res.cookie("csrfToken", newCsrfToken, { 
          ...cookieOptions, 
          maxAge: 24 * 60 * 60 * 1000, // 24 hours
          httpOnly: false 
        });

        req.userId = user._id;
        res.locals.newCsrfToken = newCsrfToken;
        next();
      } catch (refreshError) {
        console.error("Refresh Token Error:", refreshError); // Debugging
        return res.status(401).json({ success: false, message: "Session expired, please log in again" });
      }
    } else {
      return res.status(401).json({ success: false, message: `Invalid authentication token: ${error.message}` });
    }
  }
};

const cleanupExpiredTokens = async () => {
  try {
    const result = await CsrfToken.deleteMany({ expiresAt: { $lt: Date.now() } });
    console.log(`Cleaned up ${result.deletedCount} expired CSRF tokens`);
  } catch (error) {
    console.error("Error cleaning up expired CSRF tokens:", error);
  }
};

setInterval(cleanupExpiredTokens, 60 * 60 * 1000);
cleanupExpiredTokens();

module.exports = authMiddleware;
module.exports.generateCsrfToken = generateCsrfToken;