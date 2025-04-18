const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  name: { type: String, required: [true, "Name is required"], trim: true },
  username: { type: String, required: [true, "Username is required"], unique: true, trim: true, lowercase: true },
  email: { type: String, required: [true, "Email is required"], unique: true, trim: true, lowercase: true },
  password: { type: String, required: [true, "Password is required"], select: false },
  refreshToken: { type: String, default: null },
  bio: { type: String, default: "", maxLength: [160, "Bio cannot exceed 160 characters"] },
  website: { type: String, default: "", trim: true },
  // dateOfBirth: { 
  //   type: Date,
  //   validate: {
  //     validator: function(value) {
  //       return value < new Date();
  //     },
  //     message: "Date of birth must be in the past"
  //   }
  // },
  // Add to your User schema
searchHistory: [{
  searchTerm: {
    type: String,
    trim: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}],
  location: {
    country: { type: String, default: "" },
    state: { type: String, default: "" },
    language: { type: String, default: "en" }
  },
  profileImage: { public_id: String, url: String },
  bgImage: { public_id: String, url: String },
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  followRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  followerCount: { type: Number, default: 0 },
  followingCount: { type: Number, default: 0 },
  postCount: { type: Number, default: 0 },
  accountType: { type: String, enum: ["public", "private"], default: "public" },
  registeredIP: { type: String },
  loginHistory: [{
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    ip: { type: String, required: [true, "IP is required"] },
    userAgent: { type: String, required: [true, "User agent is required"] },
    deviceKey: { type: String, required: [true, "Device key is required"] },
    country: { type: String, default: "Unknown" },
    state: { type: String, default: "Unknown" },
    localTime: { type: String, default: null },
    language: { type: String, default: "en" },
    isActive: { type: Boolean, default: true },
    timestamp: { type: Date, default: Date.now },
    deviceType: { type: String, default: "Unknown" },
    client: { type: String, default: "Unknown" },
    os: { type: String, default: "Unknown" },
    signature: { type: String },
    deactivatedAt: { type: Date },
    terminatedBy: { type: String, enum: ["user", "system", "admin"], default: "system" }
  }],
  sessionVersion: { type: Number, default: 1 },
  failedLoginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date, default: null },
  role: { type: String, enum: ["user", "moderator", "admin"], default: "user" },
  status: { type: String, enum: ["active", "suspended", "banned"], default: "active" },
  suspensionEnd: { type: Date, default: null },
  bannedIPs: [{ type: String }],
  isVerified: { type: Boolean, default: false },
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String, default: null, select: false },
  twoFactorBackupCodes: [{ type: String, select: false }],
  notificationSettings: {
    passwordChanges: { type: Boolean, default: true },
    likes: { type: Boolean, default: true },
    comments: { type: Boolean, default: true },
    mentions: { type: Boolean, default: true },
    follows: { type: Boolean, default: true }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});


userSchema.pre("save", async function(next) {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isLocked = function() {
  return this.lockUntil && this.lockUntil > Date.now();
};

userSchema.virtual("activeSessions").get(function() {
  return Array.isArray(this.loginHistory) ? this.loginHistory.filter((session) => session.isActive).length : 0;
});

module.exports = mongoose.models.User || mongoose.model("User", userSchema);``