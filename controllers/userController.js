
const User = require('../models/user');
const { cloudinary } = require('../config/cloudinary');
const { getDataUri } = require('../utils/datauri');
const { clients } = require('../server');
const { sendNotification } = require('../utils/notification');

const getUnifiedProfile = async (req, res) => {
  try {
    const { username } = req.params;
    const currentUser = await User.findById(req.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    let targetUser;
    if (username) {
      targetUser = await User.findOne({ 
        username, 
        deleted: false, 
        isDisableAccount: false 
      }).select('-password -__v -email');
    } else {
      targetUser = await User.findById(req.userId)
        .select('-password -__v')
        .populate('followers', 'name username profileImage')
        .populate('following', 'name username profileImage')
        .populate('blockedUsers', 'name username');
    }

    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });

    const isOwnProfile = targetUser._id.toString() === req.userId;
    
    if (targetUser.blockedUsers?.includes(req.userId)) {
      return res.status(403).json({ success: false, message: 'You cannot view this profile' });
    }
    if (currentUser.blockedUsers?.includes(targetUser._id)) {
      return res.status(403).json({ success: false, message: 'You have blocked this user' });
    }

    if (targetUser.accountType === 'private' && 
        !targetUser.followers.includes(req.userId) && 
        !isOwnProfile) {
      const limitedData = {
        _id: targetUser._id,
        name: targetUser.name,
        username: targetUser.username,
        profileImage: targetUser.profileImage,
        accountType: 'private',
        isFollowing: false,
        isFollowRequested: currentUser.followRequests?.includes(targetUser._id),
        isOwnProfile: false
      };
      return res.json({ 
        success: true, 
        user: limitedData, 
        isPrivate: true 
      });
    }

    const profileData = {
      _id: targetUser._id,
      name: targetUser.name,
      username: targetUser.username,
      bio: targetUser.bio,
      profileImage: targetUser.profileImage,
      bgImage: targetUser.bgImage,
      followerCount: targetUser.followerCount,
      followingCount: targetUser.followingCount,
      postCount: targetUser.postCount,
      accountType: targetUser.accountType,
      country: targetUser.location?.country,
      joinDate: targetUser.joinDate,
      website: targetUser.website,
      isFollowing: currentUser.following.includes(targetUser._id),
      isBlocked: currentUser.blockedUsers?.includes(targetUser._id),
      isOwnProfile,
      ...(isOwnProfile && {
        followers: targetUser.followers,
        following: targetUser.following,
        blockedUsers: targetUser.blockedUsers,
        followRequests: targetUser.followRequests
      })
    };

    res.json({ 
      success: true, 
      user: profileData,
      message: 'Profile retrieved successfully'
    });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const updateProfile = async (req, res) => {
  const { name, bio, country, accountType, website } = req.body;
  try {
    const user = await User.findById(req.userId);
    if (!user || user.deleted) return res.status(404).json({ success: false, message: 'User not found.' });
    if (name) user.name = name; if (bio !== undefined) user.bio = bio; if (country) user.location = { ...user.location, country }; if (website !== undefined) user.website = website;
    if (accountType && ['public', 'private'].includes(accountType)) user.accountType = accountType;
    if (req.files?.profileImage) {
      console.log('Profile image received:', req.files.profileImage[0].originalname);
      if (user.profileImage?.public_id) await cloudinary.uploader.destroy(user.profileImage.public_id).catch(err => console.warn('Failed to delete old profile image:', err));
      const fileUri = getDataUri(req.files.profileImage[0]), result = await cloudinary.uploader.upload(fileUri.content, { folder: 'social-media-profiles', public_id: `profile_${user._id}_${Date.now()}`, transformation: [{ width: 400, height: 400, crop: 'fill' }, { quality: 'auto' }] });
      user.profileImage = { public_id: result.public_id, url: result.secure_url };
    }
    if (req.files?.bgImage) {
      console.log('Background image received:', req.files.bgImage[0].originalname);
      if (user.bgImage?.public_id) await cloudinary.uploader.destroy(user.bgImage.public_id).catch(err => console.warn('Failed to delete old bg image:', err));
      const fileUri = getDataUri(req.files.bgImage[0]), result = await cloudinary.uploader.upload(fileUri.content, { folder: 'social-media-profiles', public_id: `bg_${user._id}_${Date.now()}`, transformation: [{ width: 1500, height: 500, crop: 'fill' }, { quality: 'auto' }] });
      user.bgImage = { public_id: result.public_id, url: result.secure_url };
    }
    await user.save();
    const updatedUserData = { _id: user._id, name: user.name, username: user.username, bio: user.bio, profileImage: user.profileImage, bgImage: user.bgImage, accountType: user.accountType, country: user.location?.country, website: user.website };
    res.json({ success: true, message: 'Profile updated successfully.', user: updatedUserData });
  } catch (err) { console.error('Update profile error:', err); res.status(500).json({ success: false, message: 'Internal server error.' }); }
};

const followUser = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || userId === req.userId) return res.status(400).json({ success: false, message: 'Invalid user ID.' });
    const userToFollow = await User.findById(userId), currentUser = await User.findById(req.userId);
    if (!userToFollow || userToFollow.deleted || userToFollow.isDisableAccount) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) return res.status(401).json({ success: false, message: 'Your account is not active.' });
    if (userToFollow.blockedUsers?.includes(req.userId)) return res.status(403).json({ success: false, message: 'You cannot follow this user.' });
    if (currentUser.blockedUsers?.includes(userId)) return res.status(403).json({ success: false, message: 'You have blocked this user.' });
    if (userToFollow.accountType === 'private' && !currentUser.following.includes(userId)) {
      if (!userToFollow.followRequests) userToFollow.followRequests = [];
      if (!userToFollow.followRequests.includes(req.userId)) {
        userToFollow.followRequests.push(req.userId); await userToFollow.save();
        // await sendNotification(clients, userToFollow._id.toString(), `${currentUser.username} has sent you a follow request.`);
      }
      return res.json({ success: true, message: 'Follow request sent.', isFollowRequested: true });
    }
    currentUser.following.push(userId); currentUser.followingCount += 1; userToFollow.followers.push(req.userId); userToFollow.followerCount += 1;
    await Promise.all([currentUser.save(), userToFollow.save()]);
    // await sendNotification(clients, userToFollow._id.toString(), `${currentUser.username} has followed you.`);
    res.json({ success: true, message: 'User followed successfully.', isFollowing: true });
  } catch (err) { console.error('Follow user error:', err); res.status(500).json({ success: false, message: 'Internal server error.' }); }
};

const unfollowUser = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || userId === req.userId) return res.status(400).json({ success: false, message: 'Invalid user ID.' });
    const userToUnfollow = await User.findById(userId), currentUser = await User.findById(req.userId);
    if (!userToUnfollow || userToUnfollow.deleted || userToUnfollow.isDisableAccount) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) return res.status(401).json({ success: false, message: 'Your account is not active.' });
    if (!currentUser.following.includes(userId)) return res.status(400).json({ success: false, message: 'You are not following this user.' });
    currentUser.following = currentUser.following.filter(id => id.toString() !== userId); currentUser.followingCount = Math.max(0, currentUser.followingCount - 1);
    userToUnfollow.followers = userToUnfollow.followers.filter(id => id.toString() !== req.userId); userToUnfollow.followerCount = Math.max(0, userToUnfollow.followerCount - 1);
    await Promise.all([currentUser.save(), userToUnfollow.save()]);
    // await sendNotification(clients, userToUnfollow._id.toString(), `${currentUser.username} has unfollowed you.`);
    res.json({ success: true, message: 'User unfollowed successfully.', isFollowing: false });
  } catch (err) { console.error('Unfollow user error:', err); res.status(500).json({ success: false, message: 'Internal server error.' }); }
};

const handleFollowRequest = async (req, res) => {
  try {
    const { userId } = req.params, { action } = req.body;
    if (!userId || !['accept', 'reject'].includes(action)) return res.status(400).json({ success: false, message: 'Invalid request.' });
    const currentUser = await User.findById(req.userId), requestingUser = await User.findById(userId);
    if (!currentUser || !requestingUser) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!currentUser.followRequests?.includes(userId)) return res.status(400).json({ success: false, message: 'No follow request found.' });
    currentUser.followRequests = currentUser.followRequests.filter(id => id.toString() !== userId);
    if (action === 'accept') {
      currentUser.followers.push(userId); currentUser.followerCount += 1; requestingUser.following.push(req.userId); requestingUser.followingCount += 1;
      await Promise.all([currentUser.save(), requestingUser.save()]);
      await sendNotification(clients, requestingUser._id.toString(), `${currentUser.username} has accepted your follow request.`);
      return res.json({ success: true, message: 'Follow request accepted.' });
    }
    await currentUser.save(); await sendNotification(clients, requestingUser._id.toString(), `${currentUser.username} has rejected your follow request.`);
    res.json({ success: true, message: 'Follow request rejected.' });
  } catch (err) { console.error('Handle follow request error:', err); res.status(500).json({ success: false, message: 'Internal server error.' }); }
};

const blockUser = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || userId === req.userId) return res.status(400).json({ success: false, message: 'Invalid user ID.' });
    const userToBlock = await User.findById(userId), currentUser = await User.findById(req.userId);
    if (!userToBlock || userToBlock.deleted) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!currentUser || currentUser.deleted) return res.status(401).json({ success: false, message: 'Your account is not active.' });
    if (!currentUser.blockedUsers) currentUser.blockedUsers = [];
    const isBlocked = currentUser.blockedUsers.includes(userId);
    if (isBlocked) {
      currentUser.blockedUsers = currentUser.blockedUsers.filter(id => id.toString() !== userId); await currentUser.save();
      return res.json({ success: true, message: 'User unblocked successfully.', isBlocked: false });
    }
    currentUser.blockedUsers.push(userId);
    if (currentUser.following.includes(userId)) { currentUser.following = currentUser.following.filter(id => id.toString() !== userId); currentUser.followingCount = Math.max(0, currentUser.followingCount - 1); userToBlock.followers = userToBlock.followers.filter(id => id.toString() !== req.userId); userToBlock.followerCount = Math.max(0, userToBlock.followerCount - 1); }
    if (currentUser.followers.includes(userId)) { currentUser.followers = currentUser.followers.filter(id => id.toString() !== userId); currentUser.followerCount = Math.max(0, currentUser.followerCount - 1); userToBlock.following = userToBlock.following.filter(id => id.toString() !== req.userId); userToBlock.followingCount = Math.max(0, userToBlock.followingCount - 1); }
    await Promise.all([currentUser.save(), userToBlock.save()]);
    res.json({ success: true, message: 'User blocked successfully.', isBlocked: true });
  } catch (err) { console.error('Block user error:', err); res.status(500).json({ success: false, message: 'Internal server error.' }); }
};

const unblockUser = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || userId === req.userId) {
      return res.status(400).json({ success: false, message: 'Invalid user ID.' });
    }
    
    const userToUnblock = await User.findById(userId);
    const currentUser = await User.findById(req.userId);
    
    if (!userToUnblock || userToUnblock.deleted) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    if (!currentUser || currentUser.deleted) {
      return res.status(401).json({ success: false, message: 'Your account is not active.' });
    }
    
    if (!currentUser.blockedUsers?.includes(userId)) {
      return res.status(400).json({ success: false, message: 'User is not blocked.' });
    }
    
    currentUser.blockedUsers = currentUser.blockedUsers.filter(id => id.toString() !== userId);
    await currentUser.save();
    
    res.json({ 
      success: true, 
      message: 'User unblocked successfully.', 
      isBlocked: false 
    });
  } catch (err) {
    console.error('Unblock user error:', err);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

const disableAccount = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user || user.deleted) return res.status(404).json({ success: false, message: 'User not found.' });
    if (user.isDisableAccount) return res.status(400).json({ success: false, message: 'Account already disabled.' });
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (user.lastDisableDate && new Date(user.lastDisableDate) > oneWeekAgo) {
      const nextAvailableDate = new Date(user.lastDisableDate); nextAvailableDate.setDate(nextAvailableDate.getDate() + 7);
      return res.status(403).json({ success: false, message: `You can only disable once per week. Next available: ${nextAvailableDate.toDateString()}` });
    }
    user.isDisableAccount = true; user.lastDisableDate = new Date(); await user.save();
    await sendNotification(clients, user._id.toString(), 'Your account has been disabled.');
    res.status(200).json({ success: true, message: 'Account disabled successfully.' });
  } catch (err) { console.error('Disable account error:', err); res.status(500).json({ success: false, message: 'Internal server error.' }); }
};

const enableAccount = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (user.deleted) return res.status(400).json({ success: false, message: 'Account permanently deleted.' });
    if (!user.isDisableAccount) return res.status(400).json({ success: false, message: 'Account already enabled.' });
    user.isDisableAccount = false; await user.save();
    await sendNotification(clients, user._id.toString(), 'Your account has been enabled.');
    res.status(200).json({ success: true, message: 'Account enabled successfully.' });
  } catch (err) { console.error('Enable account error:', err); res.status(500).json({ success: false, message: 'Internal server error.' }); }
};

const deleteAccount = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (user.profileImage?.public_id) await cloudinary.uploader.destroy(user.profileImage.public_id).catch(err => console.warn('Failed to delete profile image:', err));
    if (user.bgImage?.public_id) await cloudinary.uploader.destroy(user.bgImage.public_id).catch(err => console.warn('Failed to delete bg image:', err));
    await User.updateMany({ followers: req.userId }, { $pull: { followers: req.userId }, $inc: { followerCount: -1 } });
    await User.updateMany({ following: req.userId }, { $pull: { following: req.userId }, $inc: { followingCount: -1 } });
    user.deleted = true; user.email = `deleted_${user._id}@example.com`; user.username = `deleted_${user._id}`; user.profileImage = { url: '', public_id: '' }; user.bgImage = { url: '', public_id: '' }; user.isDisableAccount = true;
    await user.save(); res.status(200).json({ success: true, message: 'Account deleted successfully.' });
  } catch (err) { console.error('Delete account error:', err); res.status(500).json({ success: false, message: 'Internal server error.' }); }
};

const getFollowRequests = async (req, res) => {
  try {
    const user = await User.findById(req.userId).populate('followRequests', 'name username profileImage').select('followRequests');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, requests: user.followRequests || [] });
  } catch (err) { console.error('Get follow requests error:', err); res.status(500).json({ success: false, message: 'Internal server error.' }); }
};

const getFollowers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, limit = parseInt(req.query.limit) || 20, skip = (page - 1) * limit;
    const user = await User.findById(req.userId).populate({ path: 'followers', match: { isHidden: false }, select: 'name username profileImage', options: { limit, skip } }).select('followers followerCount');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, followers: user.followers, totalCount: user.followerCount, currentPage: page, totalPages: Math.ceil(user.followerCount / limit) });
  } catch (err) { console.error('Get followers error:', err); res.status(500).json({ success: false, message: 'Internal server error.' }); }
};

const getFollowing = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, limit = parseInt(req.query.limit) || 20, skip = (page - 1) * limit;
    const user = await User.findById(req.userId).populate({ path: 'following', match: { isHidden: false }, select: 'name username profileImage', options: { limit, skip } }).select('following followingCount');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, following: user.following, totalCount: user.followingCount, currentPage: page, totalPages: Math.ceil(user.followingCount / limit) });
  } catch (err) { console.error('Get following error:', err); res.status(500).json({ success: false, message: 'Internal server error.' }); }
};

const getBlockedUsers = async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .populate('blockedUsers', 'name username')
      .select('blockedUsers');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    
    const blockedUsers = user.blockedUsers || [];
    const totalBlocked = blockedUsers.length;
    
    res.json({ 
      success: true, 
      blockedUsers: blockedUsers,
      totalBlocked: totalBlocked 
    });
  } catch (err) { 
    console.error('Get blocked users error:', err); 
    res.status(500).json({ success: false, message: 'Internal server error.' }); 
  }
};

const toggleHideProfile = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user || user.deleted) return res.status(404).json({ success: false, message: 'User not found.' });
    user.isHidden = !user.isHidden; await user.save();
    const message = user.isHidden ? 'Your profile is now hidden from searches and lists.' : 'Your profile is now visible.';
    // await sendNotification(clients, user._id.toString(), message);
    res.json({ success: true, message, isHidden: user.isHidden });
  } catch (err) { console.error('Toggle hide profile error:', err); res.status(500).json({ success: false, message: 'Internal server error.' }); }
};

const searchUsers = async (req, res) => {
  try {
    const { q } = req.query, page = parseInt(req.query.page) || 1, limit = parseInt(req.query.limit) || 20, skip = (page - 1) * limit;
    if (!q) return res.status(400).json({ success: false, message: 'Search query is required.' });
    const currentUser = await User.findById(req.userId).select('following blockedUsers');
    const query = { $or: [{ name: { $regex: q, $options: 'i' } }, { username: { $regex: q, $options: 'i' } }], deleted: false, isDisableAccount: false, isHidden: false, _id: { $ne: req.userId } };
    if (currentUser.blockedUsers?.length) query._id = { ...query._id, $nin: currentUser.blockedUsers };
    const totalCount = await User.countDocuments(query), users = await User.find(query).select('name username profileImage followerCount accountType').skip(skip).limit(limit).lean();
    const followingIds = currentUser.following.map(id => id.toString()), usersWithRelation = users.map(user => ({ ...user, isFollowing: followingIds.includes(user._id.toString()) }));
    res.json({ success: true, users: usersWithRelation, totalCount, currentPage: page, totalPages: Math.ceil(totalCount / limit) });
  } catch (err) { console.error('Search users error:', err); res.status(500).json({ success: false, message: 'Internal server error.' }); }
};



module.exports = {getUnifiedProfile, updateProfile,unblockUser, followUser, unfollowUser, handleFollowRequest, blockUser, disableAccount, enableAccount, deleteAccount, getFollowRequests, getFollowers, getFollowing, getBlockedUsers, toggleHideProfile, searchUsers, };