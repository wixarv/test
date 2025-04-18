
const express = require("express");
const router = express.Router();
const {
  createPost,
} = require("../controllers/PostController");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/posts", authMiddleware, createPost);


module.exports = router;