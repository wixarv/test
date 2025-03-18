const User = require("../models/User");
const jwt = require("jsonwebtoken");

module.exports = async (req, res, next) => {
  const { accessToken } = req.cookies;
  const csrfToken = req.headers["x-csrf-token"];
  
  // Log for debugging
  console.log("Cookies:", req.cookies);
  console.log("CSRF Token:", csrfToken);

  if (!accessToken || !csrfToken) {
    return res.status(401).json({ success: false, message: "Missing authentication token or CSRF token" });
  }
  
  try {
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }
    req.userId = decoded.userId;
    next();
  } catch (error) {
    console.error("Token verification error:", error.message);
    return res.status(401).json({ success: false, message: "Invalid or expired authentication token" });
  }
};