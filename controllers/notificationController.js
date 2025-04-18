const Notification = require("../models/notifications");
const User = require("../models/user");
const winston = require("winston");

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: "notifications.log" })],
});

const getNotifications = async (req, res) => {
  try {
    const { type, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const query = { userId: req.userId };
    if (type && type !== "all") {
      query.type = type;
    }

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Notification.countDocuments(query),
    ]);

    const unreadCount = await Notification.countDocuments({
      userId: req.userId,
      read: false,
    });

    res.status(200).json({
      success: true,
      notifications,
      total,
      unreadCount,
      hasMore: total > skip + notifications.length,
    });
  } catch (error) {
    logger.error("Error fetching notifications", {
      userId: req.userId,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
    });
  }
};

const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.userId;

    if (!notificationId) {
      return res.status(400).json({
        success: false,
        message: "Notification ID is required",
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID not found, authentication required",
      });
    }

    if (notificationId === "all") {
      const result = await Notification.updateMany(
        { userId: req.userId, read: false },
        { read: true }
      );

      if (result.modifiedCount === 0) {
        logger.warn("No unread notifications found to mark as read", { userId });
      }

      const userSockets = req.connectedUsers.get(userId.toString()) || [];
      if (userSockets.length > 0) {
        userSockets.forEach((socketId) => {
          req.io.to(socketId).emit("notificationsMarkedAsRead", { all: true });
          logger.info(`All notifications marked as read emitted to ${userId} with socket ${socketId}`);
        });
      }

      res.status(200).json({
        success: true,
        message: "All notifications marked as read",
        modifiedCount: result.modifiedCount,
      });
    } else {
      const notification = await Notification.findOne({
        _id: notificationId,
        userId: req.userId,
      });

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: "Notification not found or does not belong to this user",
          notificationId,
          userId,
        });
      }

      if (notification.read) {
        return res.status(200).json({
          success: true,
          message: "Notification is already marked as read",
          notification,
        });
      }

      await Notification.updateOne(
        { _id: notificationId, userId: req.userId },
        { $set: { read: true } }
      );

      const updatedNotification = await Notification.findById(notificationId);

      const userSockets = req.connectedUsers.get(userId.toString()) || [];
      if (userSockets.length > 0) {
        userSockets.forEach((socketId) => {
          req.io.to(socketId).emit("notificationMarkedAsRead", {
            id: updatedNotification._id.toString(),
            userId: userId.toString(),
            username: updatedNotification.username || "Unknown",
            time: updatedNotification.createdAt.toISOString(),
            type: updatedNotification.type,
            message: updatedNotification.message,
            title: updatedNotification.title,
            isRead: true,
          });
          logger.info(`Notification ${notificationId} marked as read emitted to ${userId} with socket ${socketId}`);
        });
      }

      res.status(200).json({
        success: true,
        message: "Notification marked as read",
        notification: updatedNotification,
      });
    }
  } catch (error) {
    logger.error("Error marking notification as read", {
      userId: req.userId,
      notificationId: req.params.notificationId,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      message: `Failed to mark notification as read: ${error.message}`,
    });
  }
};

const createNotification = async (req, res) => {
  try {
    const { title, message, type, username } = req.body;
    const userId = req.userId;

    logger.info("Create notification attempt", { userId, body: req.body });

    if (!userId) {
      logger.error("No userId provided", { body: req.body });
      return res.status(401).json({
        success: false,
        message: "User ID not found, authentication required",
      });
    }

    if (!title || !type) {
      logger.error("Missing required fields", { userId, title, type });
      return res.status(400).json({
        success: false,
        message: "Title and type are required",
      });
    }

    // Fetch username if not provided
    let finalUsername = username;
    if (!finalUsername || typeof finalUsername !== "string" || !finalUsername.trim()) {
      logger.info("No valid username in body, fetching from User", { userId, providedUsername: username });
      const user = await User.findById(userId);
      if (!user) {
        logger.error("User not found in database", { userId });
        return res.status(404).json({
          success: false,
          message: "User not found in database",
        });
      }
      finalUsername = user.username; // User schema guarantees username exists
      logger.info("Resolved username from User", { userId, finalUsername });
    } else {
      finalUsername = finalUsername.trim().toLowerCase();
      logger.info("Using username from request body", { userId, finalUsername });
    }

    const notification = new Notification({
      userId,
      username: finalUsername,
      title,
      message: message || "",
      type,
      read: false,
      createdAt: new Date(),
    });

    await notification.save();
    logger.info("Notification created successfully", { userId, username: finalUsername, title, type });

    const userSockets = req.connectedUsers.get(userId.toString()) || [];
    if (userSockets.length > 0) {
      userSockets.forEach((socketId) => {
        req.io.to(socketId).emit("notification", {
          id: notification._id.toString(),
          userId: userId.toString(),
          username: finalUsername,
          time: notification.createdAt.toISOString(),
          type: notification.type,
          message: notification.message,
          title: notification.title,
          isRead: notification.read,
        });
        logger.info(`Notification emitted to user ${userId} with socket ${socketId}`, { title });
      });
    } else {
      logger.warn(`User ${userId} not connected, notification not emitted`);
    }

    res.status(201).json({
      success: true,
      message: "Notification created",
      notification,
    });
  } catch (error) {
    logger.error("Error creating notification", {
      userId: req.userId || req.body.userId,
      body: req.body,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      message: `Failed to create notification: ${error.message}`,
    });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  createNotification,
};