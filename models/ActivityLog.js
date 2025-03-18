const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true }, // e.g., "login", "ban", "post_deleted"
    target: { type: mongoose.Schema.Types.ObjectId, refPath: "targetModel" }, // Target of action (e.g., user or post)
    targetModel: { type: String, enum: ["User", "Post"], required: true },
    details: { type: String },
    ip: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.models.ActivityLog || mongoose.model("ActivityLog", activityLogSchema);