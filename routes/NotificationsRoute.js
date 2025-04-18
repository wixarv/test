const express = require("express");
const router = express.Router();
const {
  getNotifications,
  markAsRead,
  createNotification,
} = require("../controllers/notificationController");
const authMiddleware = require("../middleware/authMiddleware");

const notifyUser = (req, res, next) => {
  req.io = req.app.get("io");
  req.connectedUsers = req.app.get("connectedUsers");
  next();
};

// Routes
router.get("/", authMiddleware, getNotifications);
router.put("/mark-as-read/:notificationId", authMiddleware, notifyUser, markAsRead); // Added notifyUser
router.post("/", authMiddleware, notifyUser, createNotification);

module.exports = router;