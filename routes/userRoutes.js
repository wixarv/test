const router = require('express').Router();
const authMiddleware = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');
const { getProfile, updateProfile, updateImage } = require('../controllers/profileController');
const { 
  followUser, 
  unfollowUser, 
  searchUser, 
  getFollowers, 
  getFollowing,
  acceptFollowRequest,
  rejectFollowRequest,
  getFollowRequests,
} = require('../controllers/socialController');
const { 
  blockUser,
  unblockUser,
  getBlockedUsers,
  addSearchHistory,
  getSearchHistory,
  removeSearchHistory,
  clearSearchHistory
} = require('../controllers/socialExtraController');

// Profile routes
router.get('/profile/:username?', authMiddleware, getProfile);
router.put(
  '/profile',
  authMiddleware,
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'bgImage', maxCount: 1 }
  ]),
  updateProfile
);
router.put(
  '/profile/image',
  authMiddleware,
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'bgImage', maxCount: 1 }
  ]),
  updateImage
);

// Social interaction routes
router.post('/f4j8r/:username', authMiddleware, followUser);
router.post('/u6h3m/:username', authMiddleware, unfollowUser);
router.get('/searchUser', authMiddleware, searchUser);
router.get('/followers/:username?', authMiddleware, getFollowers);
router.get('/following/:username?', authMiddleware, getFollowing);
router.post('/acceptFollowRequest', authMiddleware, acceptFollowRequest);
router.delete('/rejectFollowRequest', authMiddleware, rejectFollowRequest);
router.get('/getFollowRequests', authMiddleware, getFollowRequests);

// User interaction routes
router.post('/block/:username', authMiddleware, blockUser);
router.post('/unblock/:username', authMiddleware, unblockUser);
router.get('/blocked-list', authMiddleware, getBlockedUsers);
router.post('/addSearchHistory', authMiddleware, addSearchHistory);
router.get('/getSearchHistory', authMiddleware, getSearchHistory);
router.delete('/removeSearchHistory/:historyId', authMiddleware, removeSearchHistory);
router.delete('/clearSearchHistory', authMiddleware, clearSearchHistory);

module.exports = router;