const User = require('../models/User');
const { cloudinary } = require('../config/cloudinary');
const { getDataUri } = require('../utils/datauri');
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
  }),
  updateProfile: Joi.object({
    name: Joi.string().trim().min(1).max(50).optional(),
    bio: Joi.string().allow('').max(160).optional(),
    website: Joi.string().allow('').uri().max(100).optional(),
    dateOfBirth: Joi.date().less('now').optional(),
    location: Joi.object({
      country: Joi.string().allow('').max(100).optional(),
      state: Joi.string().allow('').max(100).optional(),
      language: Joi.string().allow('').max(10).optional()
    }).optional(),
    accountType: Joi.string().valid('public', 'private').optional(),
    profileImage: Joi.any().optional(),
    bgImage: Joi.any().optional()
  }).unknown(true),
  updateImage: Joi.object({
    type: Joi.string().valid('profile', 'bg').required()
  }).unknown(true),
  followRequest: Joi.object({
    requesterId: Joi.string().required()
  })
};

// Get user profile
const getProfile = async (req, res) => {
  try {
    const { username } = req.params;
    console.log("Received username from params:", username);
    const currentUser = await User.findById(req.userId);
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) {
      console.log("Unauthorized access attempt by userId:", req.userId);
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    let targetUser;
    if (!username) {
      targetUser = await User.findById(req.userId)
        .select('-password -__v')
        .populate('followers', 'name username profileImage')
        .populate('following', 'name username isVerified');
      console.log("Fetching own profile for userId:", req.userId);
    } else {
      const query = { 
        username: { $regex: `^${username}$`, $options: 'i' },
        deleted: { $ne: true },
        isDisableAccount: { $ne: true }
      };
      console.log("Profile query:", query);
      targetUser = await User.findOne(query)
        .select('-password -__v -email')
        .populate('followers', 'name username profileImage')
        .populate('following', 'name username isVerified');
      
      if (!targetUser) {
        console.log(`User not found for username: ${username}`);
        return res.status(404).json({ success: false, message: 'User not found' });
      }
    }

    console.log('Target User:', {
      username: targetUser.username,
      id: targetUser._id,
      deleted: targetUser.deleted,
      isDisableAccount: targetUser.isDisableAccount,
      accountType: targetUser.accountType
    });

    const isOwnProfile = targetUser._id.toString() === req.userId.toString();

    if (!isOwnProfile) {
      const targetUserBlocks = await User.findOne({ 
        _id: targetUser._id, 
        blockedUsers: req.userId 
      });
      if (targetUserBlocks) {
        console.log(`Target user ${targetUser.username} has blocked ${currentUser.username}`);
        return res.status(403).json({ 
          success: false, 
          message: 'This account is not available.'
        });
      }
    }

    const isFollowing = currentUser.following.includes(targetUser._id);
    const hasPendingRequest = targetUser.followRequests.includes(req.userId);
    const isBlockedByCurrentUser = currentUser.blockedUsers.includes(targetUser._id);

    let profileData = {
      name: targetUser.name,
      username: targetUser.username,
      profileImage: targetUser.profileImage,
      bgImage: targetUser.bgImage, // Ensure bgImage is included
      isVerified: targetUser.isVerified,
      accountType: targetUser.accountType,
      isOwnProfile,
      isFollowing,
      hasPendingRequest,
      isBlocked: isBlockedByCurrentUser
    };

    if (targetUser.accountType === 'public' || isOwnProfile || isFollowing) {
      profileData = {
        ...profileData,
        bio: targetUser.bio,
        followerCount: targetUser.followerCount,
        followingCount: targetUser.followingCount,
        website: targetUser.website,
        joinDate: targetUser.createdAt,
        location: targetUser.location,
        dateOfBirth: isOwnProfile ? targetUser.dateOfBirth : undefined
      };

      if (isOwnProfile) {
        profileData.followers = Array.isArray(targetUser.followers)
          ? targetUser.followers.map(follower => ({
              username: follower.username,
              name: follower.name,
              profileImage: follower.profileImage
            }))
          : [];
        profileData.following = Array.isArray(targetUser.following)
          ? targetUser.following.map(following => ({
              username: following.username,
              name: following.name,
              isFollowing: true,
              isVerified: following.isVerified
            }))
          : [];
      }
    }

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({ 
        success: true, 
        user: profileData,
        message: 'Profile retrieved successfully'
      });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Update user profile
const updateProfile = async (req, res) => {
  try {
    console.log('Received files:', req.files);
    console.log('Received body:', req.body);

    const { error } = schemas.updateProfile.validate(req.body);
    if (error) {
      console.log('Validation error:', error.details);
      return res.status(400).json({ 
        success: false, 
        message: error.details.map((d) => d.message).join(", ") 
      });
    }

    const { name, bio, website, dateOfBirth, location, accountType } = req.body;
    const user = await User.findById(req.userId);
    if (!user || user.deleted) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (name) user.name = name;
    if (bio !== undefined) user.bio = bio;
    if (website !== undefined) user.website = website;
    if (dateOfBirth) user.dateOfBirth = new Date(dateOfBirth);
    if (location) {
      if (location.country) user.location.country = location.country;
      if (location.state) user.location.state = location.state;
      if (location.language) user.location.language = location.language;
    }
    if (accountType && ['public', 'private'].includes(accountType)) {
      user.accountType = accountType;
      if (accountType === 'public') {
        user.followRequests = [];
      }
    }

    if (req.files?.profileImage) {
      try {
        console.log('Processing profile image upload');
        if (user.profileImage?.public_id) {
          await cloudinary.uploader.destroy(user.profileImage.public_id);
        }
        const fileUri = getDataUri(req.files.profileImage[0]);
        if (!fileUri.content) {
          throw new Error('Invalid profile image data');
        }
        const result = await cloudinary.uploader.upload(fileUri.content, {
          folder: 'social-media-profiles',
          public_id: `profile_${user._id}_${Date.now()}`,
          transformation: [{ width: 400, height: 400, crop: 'fill' }, { quality: 'auto' }]
        });
        user.profileImage = { public_id: result.public_id, url: result.secure_url };
      } catch (uploadError) {
        console.error('Profile image upload error:', uploadError);
        return res.status(500).json({ success: false, message: 'Failed to upload profile image' });
      }
    }

    if (req.files?.bgImage) {
      try {
        console.log('Processing background image upload');
        if (user.bgImage?.public_id) {
          await cloudinary.uploader.destroy(user.bgImage.public_id);
        }
        const fileUri = getDataUri(req.files.bgImage[0]);
        if (!fileUri.content) {
          throw new Error('Invalid background image data');
        }
        const result = await cloudinary.uploader.upload(fileUri.content, {
          folder: 'social-media-backgrounds',
          public_id: `bg_${user._id}_${Date.now()}`,
          transformation: [{ width: 1200, height: 400, crop: 'fill' }, { quality: 'auto' }]
        });
        user.bgImage = { public_id: result.public_id, url: result.secure_url };
      } catch (uploadError) {
        console.error('Background image upload error:', uploadError);
        return res.status(500).json({ success: false, message: 'Failed to upload background image' });
      }
    }

    await user.save();

    const updatedUserData = {
      _id: user._id,
      name: user.name,
      username: user.username,
      bio: user.bio,
      profileImage: user.profileImage,
      bgImage: user.bgImage,
      website: user.website,
      joinDate: user.createdAt,
      location: user.location,
      dateOfBirth: user.dateOfBirth,
      accountType: user.accountType,
      followerCount: user.followerCount,
      followingCount: user.followingCount
    };

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({ 
        success: true, 
        message: 'Profile updated successfully', 
        user: updatedUserData 
      });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ success: false, message: err.message || 'Internal server error' });
  }
};

// New endpoint for instant image upload
const updateImage = async (req, res) => {
  try {
    console.log('Received files:', req.files);
    console.log('Received body:', req.body);

    const { error } = schemas.updateImage.validate(req.body);
    if (error) {
      console.log('Validation error:', error.details);
      return res.status(400).json({ 
        success: false, 
        message: error.details.map((d) => d.message).join(", ") 
      });
    }

    const { type } = req.body; // 'profile' or 'bg'
    const user = await User.findById(req.userId);
    if (!user || user.deleted) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    let imageField = type === 'profile' ? 'profileImage' : 'bgImage';
    let folder = type === 'profile' ? 'social-media-profiles' : 'social-media-backgrounds';
    let transformation = type === 'profile' 
      ? [{ width: 400, height: 400, crop: 'fill' }, { quality: 'auto' }]
      : [{ width: 1200, height: 400, crop: 'fill' }, { quality: 'auto' }];

    if (req.files?.[imageField]) {
      try {
        console.log(`Processing ${imageField} upload`);
        if (user[imageField]?.public_id) {
          await cloudinary.uploader.destroy(user[imageField].public_id);
        }
        const fileUri = getDataUri(req.files[imageField][0]);
        if (!fileUri.content) {
          throw new Error(`Invalid ${imageField} data`);
        }
        const result = await cloudinary.uploader.upload(fileUri.content, {
          folder,
          public_id: `${type}_${user._id}_${Date.now()}`,
          transformation
        });
        user[imageField] = { public_id: result.public_id, url: result.secure_url };
        await user.save();
      } catch (uploadError) {
        console.error(`${imageField} upload error:`, uploadError);
        return res.status(500).json({ success: false, message: `Failed to upload ${imageField}` });
      }
    } else {
      return res.status(400).json({ success: false, message: `No ${imageField} file provided` });
    }

    res.json({
      success: true,
      message: `${type === 'profile' ? 'Profile' : 'Background'} image updated successfully`,
      image: user[imageField]
    });
  } catch (err) {
    console.error('Update image error:', err);
    res.status(500).json({ success: false, message: err.message || 'Internal server error' });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  updateImage
};