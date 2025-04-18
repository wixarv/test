const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  username: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["security", "like", "comment", "follow","follow_request", "message", "system",'story', "profile", "welcome"],
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  read: {
    type: Boolean,
    default: false,
  },
  metadata: {
    type: Object,
    default: {},
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400,
  },
});

notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);