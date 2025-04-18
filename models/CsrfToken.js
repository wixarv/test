const mongoose = require("mongoose");

const csrfTokenSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: '10m' } 
  },
  used: { type: Boolean, default: false },
});

module.exports = mongoose.model("CsrfToken", csrfTokenSchema);
