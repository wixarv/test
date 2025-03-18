const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');
const {
 updateProfile, followUser, handleFollowRequest,
  getFollowRequests, getFollowers, getFollowing, blockUser, getBlockedUsers,
  disableAccount, enableAccount, deleteAccount, searchUsers,
  unfollowUser, toggleHideProfile,
  unblockUser,
  getUnifiedProfile
} = require('../controllers/userController');

// Profile routes
router.get('/p8m2q/:username', authMiddleware, getUnifiedProfile); // was /profile/:username
router.put('/z3n5t', authMiddleware, upload.fields([
  { name: 'profileImage', maxCount: 1 }, 
  { name: 'bgImage', maxCount: 1 }
]), updateProfile); // was /profile

// Follow/Unfollow routes
router.post('/f4j8r/:userId', authMiddleware, followUser); // was /follow/:userId
router.post('/r9k1w/:userId', authMiddleware, handleFollowRequest); // was /follow-request/:userId
router.post('/u6h3m/:userId', authMiddleware, unfollowUser); // was /unfollow/:userId


router.get('/q5v9x', authMiddleware, getFollowRequests); // was /follow-requests
router.get('/t1b4y', authMiddleware, getFollowers); // was /followers
router.get('/g8d2l', authMiddleware, getFollowing); // was /following

// Block/Unblock routes
router.post('/b7c3k/:userId', authMiddleware, blockUser); // was /block/:userId
router.post('/u4n6b/:userId', authMiddleware, unblockUser); 
router.get('/m5j9z', authMiddleware, getBlockedUsers); // was /blocked

// Account management routes
router.post('/d4h8n', authMiddleware, disableAccount); // was /disable-account
router.post('/e2r6p', authMiddleware, enableAccount); // was /enable-account
router.delete('/k9t3w', authMiddleware, deleteAccount); // was /delete-account
router.post('/h1v5q', authMiddleware, toggleHideProfile); // was /toggle-hide-profile (changed to POST)

// Search and suggestions
router.get('/s7m2f', authMiddleware, searchUsers); // was /search

module.exports = router;