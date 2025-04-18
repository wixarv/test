const Story = require('../models/Story');
const User = require('../models/User');
const Notification = require('../models/notifications');
const AWS = require('aws-sdk');

// R2 Configuration
const r2 = new AWS.S3({
  endpoint: process.env.R2_ENDPOINT,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  signatureVersion: 'v4',
  region: 'auto'
});

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "Strict",
  path: "/",
};

// Create a new story
const createStory = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user || user.deleted || user.isDisableAccount) {
      return res.status(401).json({ success: false, message: 'Unauthorized or account not active' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Image is required for a story' });
    }

    // Upload image to R2
    const fileName = `story_${user._id}_${Date.now()}_${req.file.originalname}`;
    const params = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: 'public-read'
    };

    const uploadResult = await r2.upload(params).promise();
    const imageUrl = `https://pub-fb64b0880be642088e62cd6513eddd1c.r2.dev/${fileName}`;

    // Create story with 5-minute expiration
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now
    const story = new Story({
      userId: req.userId,
      image: { url: imageUrl, fileName: fileName },
      caption: req.body.caption || '',
      expiresAt,
    });

    await story.save();

    // Notify followers
    const io = req.app.get("io");
    const connectedUsers = req.app.get("connectedUsers");
    const notification = new Notification({
      userId: req.userId,
      username: user.username,
      type: "story",
      title: "New Story",
      message: `${user.username} posted a new story`,
      read: false,
      createdAt: new Date(),
    });
    await notification.save();

    user.followers.forEach(async (followerId) => {
      const followerSockets = connectedUsers.get(followerId.toString()) || [];
      followerSockets.forEach((socketId) => {
        io.to(socketId).emit("notification", {
          id: notification._id.toString(),
          userId: followerId.toString(),
          username: user.username,
          type: "story",
          message: `${user.username} posted a new story`,
          title: "New Story",
          time: notification.createdAt.toISOString(),
          isRead: false,
        });
      });
    });

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({
        success: true,
        message: 'Story created successfully',
        story: {
          id: story._id,
          image: story.image,
          caption: story.caption,
          createdAt: story.createdAt,
          expiresAt: story.expiresAt,
        },
      });
  } catch (err) {
    console.error('Create story error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get stories of followed users
const getStories = async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId).populate('following');
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) {
      return res.status(401).json({ success: false, message: 'Unauthorized or account not active' });
    }

    const followingIds = currentUser.following.map((user) => user._id);
    followingIds.push(req.userId);

    const stories = await Story.find({
      userId: { $in: followingIds },
      expiresAt: { $gt: new Date() },
    })
      .populate('userId', 'username profileImage name isVerified')
      .populate('viewers', 'username name profileImage')
      .populate('reactions.userId', 'username name profileImage')
      .sort({ createdAt: -1 });

    const formattedStories = stories.map((story) => {
      const isOwnStory = story.userId._id.toString() === req.userId.toString();
      return {
        id: story._id,
        user: {
          id: story.userId._id,
          username: story.userId.username,
          name: story.userId.name,
          profileImage: story.userId.profileImage,
          isVerified: story.userId.isVerified,
        },
        image: story.image,
        caption: story.caption,
        createdAt: story.createdAt,
        expiresAt: story.expiresAt,
        viewers: isOwnStory
          ? story.viewers.map((viewer) => ({
              id: viewer._id,
              username: viewer.username,
              name: viewer.name,
              profileImage: viewer.profileImage,
            }))
          : undefined, // Only show viewers to the story owner
        viewed: story.viewers.some((viewer) => viewer._id.toString() === req.userId.toString()),
        reactions: story.reactions.map((reaction) => ({
          user: {
            id: reaction.userId._id,
            username: reaction.userId.username,
            name: reaction.userId.name,
            profileImage: reaction.userId.profileImage,
          },
          reaction: reaction.reaction,
        })),
      };
    });

    // Add current user as a viewer if they haven’t viewed yet
    await Promise.all(
      stories.map(async (story) => {
        if (!story.viewers.some((viewer) => viewer._id.toString() === req.userId.toString())) {
          story.viewers.push(req.userId);
          await story.save();
        }
      })
    );

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 5 * 60 * 1000, httpOnly: false })
      .json({
        success: true,
        stories: formattedStories,
        message: 'Stories retrieved successfully',
      });
  } catch (err) {
    console.error('Get stories error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// React to a story
const reactToStory = async (req, res) => {
  try {
    const { storyId, reaction } = req.body;
    const user = await User.findById(req.userId);
    if (!user || user.deleted || user.isDisableAccount) {
      return res.status(401).json({ success: false, message: 'Unauthorized or account not active' });
    }

    const story = await Story.findById(storyId).populate('userId', 'followers');
    if (!story || story.expiresAt < new Date()) {
      return res.status(404).json({ success: false, message: 'Story not found or expired' });
    }

    // Prevent the story owner from reacting
    if (story.userId._id.toString() === req.userId.toString()) {
      return res.status(403).json({ success: false, message: 'You cannot react to your own story' });
    }

    // Check if the user is a follower
    const isFollower = story.userId.followers.some(
      (follower) => follower.toString() === req.userId.toString()
    );
    if (!isFollower) {
      return res.status(403).json({ success: false, message: 'Only followers can react to this story' });
    }

    // Check if the user already reacted
    const existingReactionIndex = story.reactions.findIndex(
      (r) => r.userId.toString() === req.userId.toString()
    );
    if (existingReactionIndex !== -1) {
      // Update existing reaction
      story.reactions[existingReactionIndex].reaction = reaction;
    } else {
      // Add new reaction
      story.reactions.push({ userId: req.userId, reaction });
    }

    await story.save();

    res.json({
      success: true,
      message: 'Reaction added successfully',
    });
  } catch (err) {
    console.error('React to story error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  createStory,
  getStories,
  reactToStory,
};