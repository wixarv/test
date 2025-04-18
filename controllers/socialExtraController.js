const User = require('../models/user');
const Joi = require('joi');

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "Strict",
  path: "/",
};

const schemas = {
  blockUser: Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required()
  }),
  searchHistory: Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required()
  })
};

// Block a user
const blockUser = async (req, res) => {
  try {
    const { error } = schemas.blockUser.validate(req.params);
    if (error) {
      return res.status(400).json({ 
        success: false, 
        message: error.details.map((d) => d.message).join(", ") 
      });
    }

    const { username } = req.params;
    const currentUser = await User.findById(req.userId);
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) 
      return res.status(401).json({ success: false, message: 'Your account is not active.' });

    const targetUser = await User.findOne({ username });
    if (!targetUser || targetUser.deleted || targetUser.isDisableAccount) 
      return res.status(404).json({ success: false, message: 'User not found.' });

    if (currentUser.username === username) 
      return res.status(400).json({ success: false, message: 'You cannot block yourself.' });

    if (currentUser.blockedUsers.includes(targetUser._id)) 
      return res.status(400).json({ success: false, message: 'User already blocked.' });

    // Remove any existing follow relationships
    currentUser.following = currentUser.following.filter(id => id.toString() !== targetUser._id.toString());
    currentUser.followingCount = Math.max(0, currentUser.followingCount - 1);
    targetUser.followers = targetUser.followers.filter(id => id.toString() !== req.userId);
    targetUser.followerCount = Math.max(0, targetUser.followerCount - 1);

    // Remove any follow requests
    targetUser.followRequests = targetUser.followRequests.filter(id => id.toString() !== req.userId);
    currentUser.followRequests = currentUser.followRequests.filter(id => id.toString() !== targetUser._id.toString());

    // Add to blocked list
    currentUser.blockedUsers.push(targetUser._id);

    await Promise.all([currentUser.save(), targetUser.save()]);

    const io = req.app.get("io");
    const connectedUsers = req.app.get("connectedUsers");

    // Update profiles for both users
    const currentUserSockets = connectedUsers.get(req.userId.toString()) || [];
    currentUserSockets.forEach((socketId) => {
      io.to(socketId).emit("profileUpdate", {
        userId: req.userId.toString(),
        followingCount: currentUser.followingCount,
        followerCount: currentUser.followerCount
      });
    });

    const targetUserSockets = connectedUsers.get(targetUser._id.toString()) || [];
    targetUserSockets.forEach((socketId) => {
      io.to(socketId).emit("profileUpdate", {
        userId: targetUser._id.toString(),
        followerCount: targetUser.followerCount,
        followingCount: targetUser.followingCount
      });
    });

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({ 
        success: true, 
        message: 'User blocked successfully',
        isBlocked: true
      });
  } catch (err) {
    console.error('Block user error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Unblock a user
const unblockUser = async (req, res) => {
  try {
    const { error } = schemas.blockUser.validate(req.params);
    if (error) {
      return res.status(400).json({ 
        success: false, 
        message: error.details.map((d) => d.message).join(", ") 
      });
    }

    const { username } = req.params;
    const currentUser = await User.findById(req.userId);
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) 
      return res.status(401).json({ success: false, message: 'Your account is not active.' });

    const targetUser = await User.findOne({ username });
    if (!targetUser || targetUser.deleted || targetUser.isDisableAccount) 
      return res.status(404).json({ success: false, message: 'User not found.' });

    if (!currentUser.blockedUsers.includes(targetUser._id)) 
      return res.status(400).json({ success: false, message: 'User is not blocked.' });

    currentUser.blockedUsers = currentUser.blockedUsers.filter(id => id.toString() !== targetUser._id.toString());
    await currentUser.save();

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({ 
        success: true, 
        message: 'User unblocked successfully',
        isBlocked: false
      });
  } catch (err) {
    console.error('Unblock user error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get blocked users list
const getBlockedUsers = async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId)
      .populate('blockedUsers', 'name username profileImage isVerified');
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) 
      return res.status(401).json({ success: false, message: 'Your account is not active.' });

    const blockedUsersList = Array.isArray(currentUser.blockedUsers)
      ? currentUser.blockedUsers.map(user => ({
          name: user.name,
          username: user.username,
          profileImage: user.profileImage,
          isVerified: user.isVerified
        }))
      : [];

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({
        success: true,
        blockedUsers: blockedUsersList,
        message: 'Blocked users retrieved successfully'
      });
  } catch (err) {
    console.error('Get blocked users error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Add to search history
const addSearchHistory = async (req, res) => {
  try {
    const { error } = schemas.searchHistory.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        success: false, 
        message: error.details.map((d) => d.message).join(", ") 
      });
    }

    const { username } = req.body;
    const currentUserId = req.userId;
    const currentUser = await User.findById(currentUserId);
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) 
      return res.status(401).json({ success: false, message: 'Your account is not active.' });

    const searchedUser = await User.findOne({ username });
    if (!searchedUser || searchedUser.deleted || searchedUser.isDisableAccount) 
      return res.status(404).json({ success: false, message: 'User not found.' });

    if (currentUser.blockedUsers.includes(searchedUser._id)) 
      return res.status(403).json({ success: false, message: 'Cannot search blocked user.' });

    // Add or update search history entry
    const searchTerm = username.trim();
    const existingEntryIndex = currentUser.searchHistory.findIndex(
      entry => entry.searchTerm.toLowerCase() === searchTerm.toLowerCase()
    );

    if (existingEntryIndex !== -1) {
      currentUser.searchHistory[existingEntryIndex].timestamp = new Date();
    } else {
      currentUser.searchHistory.push({
        searchTerm,
        timestamp: new Date()
      });
    }

    // Limit search history to 20 entries
    if (currentUser.searchHistory.length > 20) {
      currentUser.searchHistory = currentUser.searchHistory
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 20);
    }

    await currentUser.save();

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({ 
        success: true, 
        message: 'Search history updated successfully'
      });
  } catch (err) {
    console.error('Add search history error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get search history
const getSearchHistory = async (req, res) => {
  try {
    const currentUserId = req.userId;
    const currentUser = await User.findById(currentUserId);
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) 
      return res.status(401).json({ success: false, message: 'Your account is not active.' });

    // Sort search history by timestamp (most recent first)
    const searchHistory = currentUser.searchHistory
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);

    // Enrich search history with user details if search term matches a username
    const historyList = await Promise.all(searchHistory.map(async (entry) => {
      const searchedUser = await User.findOne({
        username: entry.searchTerm.toLowerCase(),
        deleted: { $ne: true },
        isDisableAccount: { $ne: true }
      }).select('name username profileImage isVerified');

      return {
        _id: new mongoose.Types.ObjectId().toString(), // Generate a unique ID for the entry
        searchTerm: entry.searchTerm,
        timestamp: entry.timestamp,
        user: searchedUser ? {
          name: searchedUser.name,
          username: searchedUser.username,
          profileImage: searchedUser.profileImage,
          isVerified: searchedUser.isVerified
        } : null
      };
    }));

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({
        success: true,
        searchHistory: historyList,
        message: 'Search history retrieved successfully'
      });
  } catch (err) {
    console.error('Get search history error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Remove single search history entry
const removeSearchHistory = async (req, res) => {
  try {
    const { searchTerm } = req.params;
    const currentUserId = req.userId;
    const currentUser = await User.findById(currentUserId);
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) 
      return res.status(401).json({ success: false, message: 'Your account is not active.' });

    const initialLength = currentUser.searchHistory.length;
    currentUser.searchHistory = currentUser.searchHistory.filter(
      entry => entry.searchTerm.toLowerCase() !== searchTerm.toLowerCase()
    );

    if (currentUser.searchHistory.length === initialLength) 
      return res.status(404).json({ success: false, message: 'Search history entry not found.' });

    await currentUser.save();

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({ 
        success: true, 
        message: 'Search history entry removed successfully'
      });
  } catch (err) {
    console.error('Remove search history error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Clear all search history
const clearSearchHistory = async (req, res) => {
  try {
    const currentUserId = req.userId;
    const currentUser = await User.findById(currentUserId);
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) 
      return res.status(401).json({ success: false, message: 'Your account is not active.' });

    currentUser.searchHistory = [];
    await currentUser.save();

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({ 
        success: true, 
        message: 'Search history cleared successfully'
      });
  } catch (err) {
    console.error('Clear search history error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  blockUser,
  unblockUser,
  getBlockedUsers,
  addSearchHistory,
  getSearchHistory,
  removeSearchHistory,
  clearSearchHistory
};