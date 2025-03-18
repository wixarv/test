const express = require("express");
const router = express.Router();

// Import from authControllers.js
const { 
  Signup, 
  Login, 
  Refresh, 
  ChangePassword, 
  Protected, 
  GetCsrfToken 
} = require("../controllers/authController");

// Import from sessionControllers.js
const { 
  Logout, 
  LogoutAll, 
  LogoutDevice, 
  GetActiveDevices, 
  Localization 
} = require("../controllers/sessionControllers");

const authMiddleware = require("../middleware/authMiddleware");

// Authentication routes
router.post("/signup", Signup);
router.post("/login", Login);
router.post("/refresh", Refresh);
router.post("/change-password", authMiddleware, ChangePassword);
router.get("/csrf-token", GetCsrfToken);

// Session/Device management routes
router.post("/logout", authMiddleware, Logout);
router.post("/logout-all", authMiddleware, LogoutAll);
router.post("/logout-device", authMiddleware, LogoutDevice);
router.get("/active-devices", authMiddleware, GetActiveDevices);
router.get("/localization", authMiddleware, Localization);

// Protected route
router.get("/protected", authMiddleware, Protected);

module.exports = router;