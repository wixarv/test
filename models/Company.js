const mongoose = require("mongoose");

const companySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  appVersion: [{
    version: { type: String, required: true, trim: true },
    releaseDate: { type: Date, default: Date.now },
    updateTime: { type: Date, default: null },
    description: { type: String, default: "Latest version." },
    changelog: [{ type: String }],
  }],
  faqs: [{
    question: { type: String, required: true },
    answer: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: null },
  }],
  questions: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    question: { type: String, required: true },
    askedAt: { type: Date, default: Date.now },
    reply: { type: String, default: null },
    repliedAt: { type: Date, default: null },
    repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  }],
  problems: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    problem: { type: String, required: true },
    reportedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ["pending", "resolved", "closed"], default: "pending" },
    resolution: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

module.exports = mongoose.models.Company || mongoose.model("Company", companySchema);