const User = require("../models/user");

module.exports = (roles) => async (req, res, next) => {
  const { accessToken } = req.cookies;
  const csrfToken = req.headers["x-csrf-token"];
  if (!accessToken || !csrfToken) return res.status(401).json({ success: false, message: "Missing authentication token or CSRF token" });
  try {
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user || !roles.includes(user.role)) return res.status(403).json({ success: false, message: "Insufficient permissions" });
    req.userId = decoded.userId;
    req.userRole = user.role;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: "Invalid or expired authentication token" });
  }
};