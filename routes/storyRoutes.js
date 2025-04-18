const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createStory, getStories, reactToStory } = require('../controllers/storyController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// ⚠️ Multer always before authMiddleware
router.post('/create', upload.single('image'), authMiddleware, createStory); // POST /api/stories/create
router.get('/stories', authMiddleware, getStories); // GET /api/stories
router.post('/react', authMiddleware, reactToStory); // POST /api/stories/react

module.exports = router;