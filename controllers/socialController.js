const User = require('../models/user');
const Notification = require('../models/notifications');
const Joi = require('joi');

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "Strict",
  path: "/",
};

const schemas = {
  search: Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required()
  })
};


// Follow a user
const followUser = async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) 
      return res.status(400).json({ success: false, message: 'Username is required.' });

    const currentUser = await User.findById(req.userId);
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) 
      return res.status(401).json({ success: false, message: 'Your account is not active.' });

    const userToFollow = await User.findOne({ username });
    if (!userToFollow || userToFollow.deleted || userToFollow.isDisableAccount) 
      return res.status(404).json({ success: false, message: 'User not found.' });
    
    if (currentUser.username === username) 
      return res.status(400).json({ success: false, message: 'You cannot follow yourself.' });
    if (currentUser.following.includes(userToFollow._id))
      return res.status(400).json({ success: false, message: 'Already following this user.' });
    if (userToFollow.followRequests.includes(req.userId))
      return res.status(400).json({ success: false, message: 'Follow request already sent.' });

    const io = req.app.get("io");
    const connectedUsers = req.app.get("connectedUsers");

    // SECURITY: Handle private accounts with follow requests
    if (userToFollow.accountType === 'private') {
      userToFollow.followRequests.push(req.userId);
      await userToFollow.save();

      const notification = new Notification({
        userId: userToFollow._id,
        username: currentUser.username,
        type: "follow_request",
        title: "New Follow Request",
        message: `${currentUser.username} wants to follow you`,
        read: false,
        createdAt: new Date()
      });
      await notification.save();

      const targetSockets = connectedUsers.get(userToFollow._id.toString()) || [];
      targetSockets.forEach((socketId) => {
        io.to(socketId).emit("notification", {
          id: notification._id.toString(),
          userId: userToFollow._id.toString(),
          username: currentUser.username,
          type: "follow_request",
          message: `${currentUser.username} wants to follow you`,
          title: "New Follow Request",
          time: notification.createdAt.toISOString(),
          isRead: false
        });
      });

      res
        .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
        .json({ 
          success: true, 
          message: 'Follow request sent successfully', 
          isFollowing: false,
          hasPendingRequest: true
        });
    } else {
      currentUser.following.push(userToFollow._id);
      currentUser.followingCount += 1;
      userToFollow.followers.push(req.userId);
      userToFollow.followerCount += 1;
      await Promise.all([currentUser.save(), userToFollow.save()]);

      const notification = new Notification({
        userId: userToFollow._id,
        username: currentUser.username,
        type: "follow",
        title: "New Follower",
        message: `${currentUser.username} has followed you`,
        read: false,
        createdAt: new Date()
      });
      await notification.save();

      const targetSockets = connectedUsers.get(userToFollow._id.toString()) || [];
      targetSockets.forEach((socketId) => {
        io.to(socketId).emit("notification", {
          id: notification._id.toString(),
          userId: userToFollow._id.toString(),
          username: currentUser.username,
          type: "follow",
          message: `${currentUser.username} has followed you`,
          title: "New Follower",
          time: notification.createdAt.toISOString(),
          isRead: false
        });
      });

      const currentUserSockets = connectedUsers.get(req.userId.toString()) || [];
      currentUserSockets.forEach((socketId) => {
        io.to(socketId).emit("profileUpdate", {
          userId: req.userId.toString(),
          followingCount: currentUser.followingCount,
          followerCount: currentUser.followerCount
        });
      });

      targetSockets.forEach((socketId) => {
        io.to(socketId).emit("profileUpdate", {
          userId: userToFollow._id.toString(),
          followerCount: userToFollow.followerCount,
          followingCount: userToFollow.followingCount
        });
      });

      res
        .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
        .json({ 
          success: true, 
          message: 'User followed successfully', 
          isFollowing: true,
          followerCount: userToFollow.followerCount,
          followingCount: currentUser.followingCount
        });
    }
  } catch (err) {
    console.error('Follow user error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Unfollow a user or cancel follow request
const unfollowUser = async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) 
      return res.status(400).json({ success: false, message: 'Username is required.' });

    const currentUser = await User.findById(req.userId);
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) 
      return res.status(401).json({ success: false, message: 'Your account is not active.' });

    const userToUnfollow = await User.findOne({ username });
    if (!userToUnfollow || userToUnfollow.deleted || userToUnfollow.isDisableAccount) 
      return res.status(404).json({ success: false, message: 'User not found.' });
    
    if (currentUser.username === username) 
      return res.status(400).json({ success: false, message: 'You cannot unfollow yourself.' });

    const io = req.app.get("io");
    const connectedUsers = req.app.get("connectedUsers");

    // SECURITY: Handle cancellation of follow requests for private accounts
    if (userToUnfollow.followRequests.includes(req.userId)) {
      userToUnfollow.followRequests = userToUnfollow.followRequests.filter(id => id.toString() !== req.userId);
      await userToUnfollow.save();

      res
        .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
        .json({ 
          success: true, 
          message: 'Follow request cancelled', 
          isFollowing: false,
          hasPendingRequest: false
        });
    } else if (!currentUser.following.includes(userToUnfollow._id)) {
      return res.status(400).json({ success: false, message: 'You are not following this user.' });
    } else {
      currentUser.following = currentUser.following.filter(id => id.toString() !== userToUnfollow._id.toString());
      currentUser.followingCount = Math.max(0, currentUser.followingCount - 1);
      userToUnfollow.followers = userToUnfollow.followers.filter(id => id.toString() !== req.userId);
      userToUnfollow.followerCount = Math.max(0, userToUnfollow.followerCount - 1);
      await Promise.all([currentUser.save(), userToUnfollow.save()]);

      const notification = new Notification({
        userId: userToUnfollow._id,
        username: currentUser.username,
        type: "follow",
        title: "Follower Removed",
        message: `${currentUser.username} has unfollowed you`,
        read: false,
        createdAt: new Date()
      });
      await notification.save();

      const targetSockets = connectedUsers.get(userToUnfollow._id.toString()) || [];
      targetSockets.forEach((socketId) => {
        io.to(socketId).emit("notification", {
          id: notification._id.toString(),
          userId: userToUnfollow._id.toString(),
          username: currentUser.username,
          type: "follow",
          message: `${currentUser.username} has unfollowed you`,
          title: "Follower Removed",
          time: notification.createdAt.toISOString(),
          isRead: false
        });
      });

      const currentUserSockets = connectedUsers.get(req.userId.toString()) || [];
      currentUserSockets.forEach((socketId) => {
        io.to(socketId).emit("profileUpdate", {
          userId: req.userId.toString(),
          followingCount: currentUser.followingCount,
          followerCount: currentUser.followerCount
        });
      });

      targetSockets.forEach((socketId) => {
        io.to(socketId).emit("profileUpdate", {
          userId: userToUnfollow._id.toString(),
          followerCount: userToUnfollow.followerCount,
          followingCount: userToUnfollow.followingCount
        });
      });

      res
        .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
        .json({ 
          success: true, 
          message: 'User unfollowed successfully', 
          isFollowing: false,
          followerCount: userToUnfollow.followerCount,
          followingCount: currentUser.followingCount
        });
    }
  } catch (err) {
    console.error('Unfollow user error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Search users
const searchUser = async (req, res) => {
  try {
    const { error } = schemas.search.validate(req.query, { abortEarly: false });
    if (error) {
      console.log('Validation error:', error.details);
      return res.status(400).json({ 
        success: false, 
        message: error.details.map((d) => d.message).join(", ") 
      });
    }

    const { username } = req.query;
    console.log('Search query username:', username);

    const currentUser = await User.findById(req.userId);
    if (!currentUser) {
      console.log('No current user found for userId:', req.userId);
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    console.log('Current user found:', currentUser.username);

    const query = { 
      username: { $regex: username.trim(), $options: 'i' },
      deleted: { $ne: true },
      isDisableAccount: { $ne: true }
    };

    console.log('Search query:', query);

    const users = await User.find(query)
      .select('-password -__v -email')
      .limit(10);

    console.log('Found users:', users.length, users.map(u => u.username));

    if (!users.length) {
      return res.status(404).json({ success: false, message: 'No users found' });
    }

    // SECURITY: Restrict data for private accounts
    const searchResults = users.map(user => {
      const isFollowing = currentUser.following.includes(user._id);
      const baseData = {
        _id: user._id,
        name: user.name,
        username: user.username,
        profileImage: user.profileImage,
        isVerified: user.isVerified,
        accountType: user.accountType,
        isFollowing,
        hasPendingRequest: user.followRequests.includes(req.userId)
      };

      if (user.accountType === 'public' || isFollowing || user._id.toString() === req.userId) {
        return {
          ...baseData,
          bio: user.bio,
          followerCount: user.followerCount,
          followingCount: user.followingCount
        };
      }
      return baseData;
    });

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({ 
        success: true, 
        users: searchResults,
        message: 'Users found successfully'
      });
  } catch (err) {
    console.error('Search user error:', err);
    res.status(err.status || 500).json({ 
      success: false, 
      message: err.message || 'Internal server error' 
    });
  }
};

// Get followers list
const getFollowers = async (req, res) => {
  try {
    const { username } = req.params;
    const currentUser = await User.findById(req.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    let targetUser;
    if (!username) {
      targetUser = await User.findById(req.userId)
        .populate('followers', 'name username profileImage isVerified');
    } else {
      targetUser = await User.findOne({
        username: { $regex: username, $options: 'i' },
        deleted: { $ne: true },
        isDisableAccount: { $ne: true }
      }).populate('followers', 'name username profileImage isVerified');

      if (!targetUser) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
    }

    const isOwnProfile = targetUser._id.toString() === req.userId;
    const isFollowing = currentUser.following.includes(targetUser._id);

    // SECURITY: Block access to private account followers unless authorized
    if (targetUser.accountType === 'private' && !isOwnProfile && !isFollowing) {
      return res.status(403).json({
        success: false,
        message: 'Cannot view followers of a private account'
      });
    }

    const followersList = Array.isArray(targetUser.followers)
      ? targetUser.followers.map(follower => ({
          _id: follower._id,
          name: follower.name,
          username: follower.username,
          profileImage: follower.profileImage,
          isVerified: follower.isVerified,
          isFollowing: currentUser.following.includes(follower._id)
        }))
      : [];

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({
        success: true,
        followers: followersList,
        followerCount: targetUser.followerCount,
        isOwnProfile,
        message: 'Followers retrieved successfully'
      });
  } catch (err) {
    console.error('Get followers error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get following list
const getFollowing = async (req, res) => {
  try {
    const { username } = req.params;
    const currentUser = await User.findById(req.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    let targetUser;
    if (!username) {
      targetUser = await User.findById(req.userId)
        .populate('following', 'name username profileImage isVerified');
    } else {
      targetUser = await User.findOne({
        username: { $regex: username, $options: 'i' },
        deleted: { $ne: true },
        isDisableAccount: { $ne: true }
      }).populate('following', 'name username profileImage isVerified');

      if (!targetUser) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
    }

    const isOwnProfile = targetUser._id.toString() === req.userId;
    const isFollowing = currentUser.following.includes(targetUser._id);

    // SECURITY: Block access to private account following unless authorized
    if (targetUser.accountType === 'private' && !isOwnProfile && !isFollowing) {
      return res.status(403).json({
        success: false,
        message: 'Cannot view following list of a private account'
      });
    }

    const followingList = Array.isArray(targetUser.following)
      ? targetUser.following.map(following => ({
          _id: following._id,
          name: following.name,
          username: following.username,
          profileImage: following.profileImage,
          isVerified: following.isVerified,
          isFollowing: currentUser.following.includes(following._id)
        }))
      : [];

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({
        success: true,
        following: followingList,
        followingCount: targetUser.followingCount,
        isOwnProfile,
        message: 'Following retrieved successfully'
      });
  } catch (err) {
    console.error('Get following error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Accept follow request
const acceptFollowRequest = async (req, res) => {
  try {
    const { error } = schemas.followRequest.validate(req.body);
    if (error) {
      console.log('Validation error:', error.details);
      return res.status(400).json({ 
        success: false, 
        message: error.details.map((d) => d.message).join(", ") 
      });
    }

    const { requesterId } = req.body;
    const currentUser = await User.findById(req.userId);
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) 
      return res.status(401).json({ success: false, message: 'Your account is not active.' });

    // SECURITY: Ensure only private accounts handle follow requests
    if (currentUser.accountType !== 'private') 
      return res.status(400).json({ success: false, message: 'Your account is not private.' });

    const requester = await User.findById(requesterId);
    if (!requester || requester.deleted || requester.isDisableAccount) 
      return res.status(404).json({ success: false, message: 'Requester not found.' });

    if (!currentUser.followRequests.includes(requesterId)) 
      return res.status(400).json({ success: false, message: 'No follow request from this user.' });

    currentUser.followRequests = currentUser.followRequests.filter(id => id.toString() !== requesterId);
    currentUser.followers.push(requesterId);
    currentUser.followerCount += 1;
    requester.following.push(req.userId);
    requester.followingCount += 1;

    await Promise.all([currentUser.save(), requester.save()]);

    const io = req.app.get("io");
    const connectedUsers = req.app.get("connectedUsers");

    const notification = new Notification({
      userId: requesterId,
      username: currentUser.username,
      type: "follow_accepted",
      title: "Follow Request Accepted",
      message: `${currentUser.username} has accepted your follow request`,
      read: false,
      createdAt: new Date()
    });
    await notification.save();

    const requesterSockets = connectedUsers.get(requesterId.toString()) || [];
    requesterSockets.forEach((socketId) => {
      io.to(socketId).emit("notification", {
        id: notification._id.toString(),
        userId: requesterId,
        username: currentUser.username,
        type: "follow_accepted",
        message: `${currentUser.username} has accepted your follow request`,
        title: "Follow Request Accepted",
        time: notification.createdAt.toISOString(),
        isRead: false
      });
    });

    const currentUserSockets = connectedUsers.get(req.userId.toString()) || [];
    currentUserSockets.forEach((socketId) => {
      io.to(socketId).emit("profileUpdate", {
        userId: req.userId.toString(),
        followerCount: currentUser.followerCount,
        followingCount: currentUser.followingCount
      });
    });

    requesterSockets.forEach((socketId) => {
      io.to(socketId).emit("profileUpdate", {
        userId: requesterId,
        followerCount: requester.followerCount,
        followingCount: requester.followingCount
      });
    });

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({ 
        success: true, 
        message: 'Follow request accepted', 
        followerCount: currentUser.followerCount
      });
  } catch (err) {
    console.error('Accept follow request error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Reject follow request
const rejectFollowRequest = async (req, res) => {
  try {
    const { error } = schemas.followRequest.validate(req.body);
    if (error) {
      console.log('Validation error:', error.details);
      return res.status(400).json({ 
        success: false, 
        message: error.details.map((d) => d.message).join(", ") 
      });
    }

    const { requesterId } = req.body;
    const currentUser = await User.findById(req.userId);
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) 
      return res.status(401).json({ success: false, message: 'Your account is not active.' });

    // SECURITY: Ensure only private accounts handle follow requests
    if (currentUser.accountType !== 'private') 
      return res.status(400).json({ success: false, message: 'Your account is not private.' });

    if (!currentUser.followRequests.includes(requesterId)) 
      return res.status(400).json({ success: false, message: 'No follow request from this user.' });

    currentUser.followRequests = currentUser.followRequests.filter(id => id.toString() !== requesterId);
    await currentUser.save();

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({ 
        success: true, 
        message: 'Follow request rejected'
      });
  } catch (err) {
    console.error('Reject follow request error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get follow requests
const getFollowRequests = async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId).populate('followRequests', 'name username profileImage isVerified');
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) 
      return res.status(401).json({ success: false, message: 'Your account is not active.' });

    // SECURITY: Only private accounts have follow requests
    if (currentUser.accountType !== 'private') 
      return res.status(400).json({ success: false, message: 'Your account is not private.' });

    const followRequestsList = Array.isArray(currentUser.followRequests)
      ? currentUser.followRequests.map(requester => ({
          _id: requester._id,
          name: requester.name,
          username: requester.username,
          profileImage: requester.profileImage,
          isVerified: requester.isVerified
        }))
      : [];

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({
        success: true,
        followRequests: followRequestsList,
        message: 'Follow requests retrieved successfully'
      });
  } catch (err) {
    console.error('Get follow requests error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};


module.exports = {
  followUser,
  unfollowUser,
  searchUser,
  getFollowers, 
  getFollowing,
  acceptFollowRequest,
  rejectFollowRequest,
  getFollowRequests
};