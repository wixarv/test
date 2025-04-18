// const express = require("express");
// const router = express.Router();

// // Import from authControllers.js
// const { 
//   Signup, 
//   Login, 
//   Refresh, 
//   ChangePassword, 
//   Protected, 
//   Setup2FA,
//   GetCsrfToken, 
//   get2FAStatus
// } = require("../controllers/authController");

// // Import from sessionControllers.js
// const { 
//   Logout, 
//   LogoutAll, 
//   LogoutDevice, 
//   GetActiveDevices, 
//   Localization 
// } = require("../controllers/sessionControllers");

// const authMiddleware = require("../middleware/authMiddleware");

// // Authentication routes
// router.post("/signup", Signup);
// router.post("/login", Login);
// router.post("/refresh", Refresh);
// router.post("/change-password", authMiddleware, ChangePassword);
// router.get("/csrf-token", GetCsrfToken);

// // Session/Device management routes
// router.post("/logout", authMiddleware, Logout);
// router.post("/logout-all", authMiddleware, LogoutAll);
// router.post("/logout-device", authMiddleware, LogoutDevice);
// router.get("/active-devices", authMiddleware, GetActiveDevices);
// router.get("/localization", authMiddleware, Localization);
// router.post("/Setup2FA" ,authMiddleware ,Setup2FA)
// router.get("/2fa-status" ,authMiddleware ,get2FAStatus)

// // Protected route
// router.get("/protected", authMiddleware, Protected);

// module.exports = router;


const express = require("express");
const router = express.Router();

const { Signup, Login } = require("../controllers/authController");
const { Refresh, ChangePassword, Protected, Setup2FA, GetCsrfToken, get2FAStatus, ValidateCsrfToken } = require("../controllers/auth-management");
const { Logout, LogoutAll, LogoutDevice, GetActiveDevices, Localization } = require("../controllers/sessionControllers");

const authMiddleware = require("../middleware/authMiddleware");
const { authLimiter, loginLimiter } = require("../middleware/securityMiddleware");

// Authentication routes
router.post("/signup",authLimiter, Signup);
router.post("/login",   Login);
router.post("/refresh", Refresh);
router.post("/change-password", authMiddleware, ChangePassword);
router.get("/csrf-token", GetCsrfToken);


// Session/Device management routes
router.post("/logout", authMiddleware, Logout);
router.post("/logout-all", authMiddleware, LogoutAll);
router.post("/logout-device", authMiddleware, LogoutDevice);
router.get("/active-devices", authMiddleware, GetActiveDevices);
router.get("/localization", authMiddleware, Localization);

// 2FA routes
router.post("/setup-2fa", authMiddleware, Setup2FA);
router.get("/2fa-status", authMiddleware, get2FAStatus);

// Protected route
router.get("/protected", authMiddleware, Protected);

module.exports = router;