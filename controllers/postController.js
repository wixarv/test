const Post = require('../models/post');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Topic = require('../models/Topic');
const AWS = require('aws-sdk');
const ffmpeg = require('fluent-ffmpeg');
const ffprobeStatic = require('@ffprobe-installer/ffprobe').path;
ffmpeg.setFfprobePath(ffprobeStatic);
const { promisify } = require('util');
const ffprobeAsync = promisify(ffmpeg.ffprobe);

// R2 Configuration
const r2 = new AWS.S3({
  endpoint: process.env.R2_ENDPOINT,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  signatureVersion: 'v4',
  region: 'auto',
});

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Strict',
  path: '/',
};

// Validate video duration (max 5 minutes)
const validateVideoDuration = async (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = require('stream');
    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);
    ffprobeAsync(bufferStream)
      .then((metadata) => {
        const duration = metadata.format.duration;
        resolve(duration <= 300);
      })
      .catch((err) => reject(err));
  });
};

// Create a post
const createPost = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user || user.deleted || user.isDisableAccount) {
      return res.status(401).json({ success: false, message: 'Unauthorized or account not active' });
    }

    const {
      content,
      topics,
      type = 'post',
      quotedPostId,
      pollOptions,
      pollExpiresAt,
      capsuleUnlockAt,
      scheduleAt,
      isDraft = false,
    } = req.body;
    const images = req.files?.images;
    const video = req.files?.video?.[0];

    // Validate inputs
    if (
      !content &&
      (!images || images.length === 0) &&
      !video &&
      type !== 'poll' &&
      type !== 'quote' &&
      type !== 'capsule'
    ) {
      return res.status(400).json({ success: false, message: 'Content, images, video, or poll required' });
    }

    if (images && images.length > 4) {
      return res.status(400).json({ success: false, message: 'Maximum 4 images allowed' });
    }

    if (video && images?.length > 0) {
      return res.status(400).json({ success: false, message: 'Cannot upload images and video together' });
    }

    // Validate video
    if (video) {
      const isValidDuration = await validateVideoDuration(video.buffer);
      if (!isValidDuration) {
        return res.status(400).json({ success: false, message: 'Video must be 5 minutes or less' });
      }
    }

    // Validate poll
    let pollData = null;
    if (type === 'poll') {
      if (!pollOptions || !Array.isArray(pollOptions) || pollOptions.length < 2 || pollOptions.length > 4) {
        return res.status(400).json({ success: false, message: 'Polls require 2-4 options' });
      }
      if (!pollExpiresAt || new Date(pollExpiresAt) <= new Date()) {
        return res.status(400).json({ success: false, message: 'Invalid poll expiration' });
      }
      pollData = {
        question: content,
        options: pollOptions.map((text) => ({ text, votes: [] })),
        expiresAt: new Date(pollExpiresAt),
      };
    }

    // Validate quote
    if (type === 'quote' && quotedPostId) {
      const quotedPost = await Post.findById(quotedPostId);
      if (!quotedPost) {
        return res.status(404).json({ success: false, message: 'Quoted post not found' });
      }
    }

    // Validate time capsule
    let capsuleDate = null;
    if (type === 'capsule') {
      if (!capsuleUnlockAt || new Date(capsuleUnlockAt) <= new Date()) {
        return res.status(400).json({ success: false, message: 'Invalid capsule unlock date' });
      }
      capsuleDate = new Date(capsuleUnlockAt);
    }

    // Validate schedule
    let scheduleDate = null;
    if (type === 'scheduled') {
      if (!scheduleAt || new Date(scheduleAt) <= new Date()) {
        return res.status(400).json({ success: false, message: 'Invalid schedule date' });
      }
      scheduleDate = new Date(scheduleAt);
    }

    // Upload media
    const uploadedImages = [];
    if (images && images.length > 0) {
      for (const image of images) {
        const fileName = `post_${user._id}_${Date.now()}_${image.originalname}`;
        const params = {
          Bucket: process.env.R2_BUCKET_NAME,
          Key: fileName,
          Body: image.buffer,
          ContentType: image.mimetype,
          ACL: 'public-read',
        };
        const uploadResult = await r2.upload(params).promise();
        uploadedImages.push({
          url: `https://pub-fb64b0880be642088e62cd6513eddd1c.r2.dev/${fileName}`,
          fileName,
        });
      }
    }

    let uploadedVideo = null;
    if (video) {
      const fileName = `post_${user._id}_${Date.now()}_${video.originalname}`;
      const params = {
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileName,
        Body: video.buffer,
        ContentType: video.mimetype,
        ACL: 'public-read',
      };
      const uploadResult = await r2.upload(params).promise();
      uploadedVideo = {
        url: `https://pub-fb64b0880be642088e62cd6513eddd1c.r2.dev/${fileName}`,
        fileName,
      };
    }

    // Extract hashtags
    const hashtagRegex = /#[\w]+/g;
    const hashtags = (content?.match(hashtagRegex) || []).map((tag) => tag.toLowerCase().substring(1));

    // Process topics
    let topicIds = [];
    if (topics && Array.isArray(topics)) {
      const validTopics = await Topic.find({ name: { $in: topics } });
      topicIds = validTopics.map((topic) => topic._id);
    }

    // Create post
    const post = new Post({
      userId: req.userId,
      content,
      images: uploadedImages,
      video: uploadedVideo,
      hashtags,
      topics: topicIds,
      type: isDraft ? 'draft' : type,
      quotedPostId: type === 'quote' ? quotedPostId : undefined,
      poll: type === 'poll' ? pollData : undefined,
      capsuleUnlockAt: type === 'capsule' ? capsuleDate : undefined,
      scheduleAt: type === 'scheduled' ? scheduleDate : undefined,
      popularityScore: 0,
      createdAt: new Date(),
    });

    await post.save();

    // Update topic counts (except for drafts)
    if (topicIds.length > 0 && !isDraft) {
      await Topic.updateMany(
        { _id: { $in: topicIds } },
        { $inc: { postCount: 1 } }
      );
    }

    // Notify followers (except for drafts, scheduled, or capsules)
    if (!isDraft && type !== 'scheduled' && type !== 'capsule') {
      const io = req.app.get('io');
      const connectedUsers = req.app.get('connectedUsers');
      const notification = new Notification({
        userId: req.userId,
        username: user.username,
        type: 'post',
        title: 'New Post',
        message: `${user.username} shared a new post`,
        read: false,
        createdAt: new Date(),
      });
      await notification.save();

      user.followers.forEach(async (followerId) => {
        const followerSockets = connectedUsers.get(followerId.toString()) || [];
        followerSockets.forEach((socketId) => {
          io.to(socketId).emit('notification', {
            id: notification._id.toString(),
            userId: followerId.toString(),
            username: user.username,
            type: 'post',
            message: `${user.username} shared a new post`,
            title: 'New Post',
            time: notification.createdAt.toISOString(),
            isRead: false,
          });
        });
      });
    }

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 24 * 60 * 60 * 1000, httpOnly: false })
      .json({
        success: true,
        message: isDraft ? 'Draft saved successfully' : 'Post created successfully',
        post: {
          id: post._id,
          userId: post.userId,
          content: post.content,
          images: post.images,
          video: post.video,
          hashtags: post.hashtags,
          topics: post.topics,
          type: post.type,
          quotedPostId: post.quotedPostId,
          poll: post.poll,
          capsuleUnlockAt: post.capsuleUnlockAt,
          scheduleAt: post.scheduleAt,
          likes: post.likes,
          reactions: post.reactions,
          comments: post.comments,
          shares: post.shares,
          views: post.views,
          viewCount: post.viewCount,
          popularityScore: post.popularityScore,
          createdAt: post.createdAt,
        },
      });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get feed
const getFeed = async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId).populate('following');
    if (!currentUser || currentUser.deleted || currentUser.isDisableAccount) {
      return res.status(401).json({ success: false, message: 'Unauthorized or account not active' });
    }

    const { type = 'for-you', hashtag, topic, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    let query = { type: { $ne: 'draft' } }; // Exclude drafts
    let sort = { createdAt: -1 };

    // Handle capsule visibility
    query.$or = [
      { capsuleUnlockAt: { $exists: false } },
      { capsuleUnlockAt: { $lte: new Date() } },
    ];

    if (hashtag) {
      query.hashtags = hashtag.toLowerCase();
    }
    if (topic) {
      const topicDoc = await Topic.findOne({ name: topic });
      if (topicDoc) {
        query.topics = topicDoc._id;
      } else {
        return res.status(404).json({ success: false, message: 'Topic not found' });
      }
    }

    if (type === 'following') {
      const followingIds = currentUser.following.map((user) => user._id);
      followingIds.push(req.userId);
      query.userId = { $in: followingIds };
    } else if (type === 'for-you') {
      const followingIds = currentUser.following.map((user) => user._id);
      const userTopics = await Topic.find({ _id: { $in: currentUser.topics } });
      query.$or = [
        { userId: { $in: followingIds } },
        { topics: { $in: userTopics.map((t) => t._id) } },
      ];
      sort = { popularityScore: -1, createdAt: -1 };
    }

    // Include pinned post for user profiles
    if (type === 'profile' && req.query.profileId) {
      const profileUser = await User.findById(req.query.profileId);
      if (profileUser.pinnedPostId) {
        query._id = { $ne: profileUser.pinnedPostId }; // Exclude pinned post from main feed
      }
    }

    // Fetch posts
    const posts = await Post.find(query)
      .populate('userId', 'username profileImage name isVerified')
      .populate('topics', 'name')
      .populate('likes.userId', 'username name profileImage')
      .populate('reactions.userId', 'username name profileImage')
      .populate('comments.userId', 'username name profileImage')
      .populate('shares.userId', 'username name profileImage')
      .populate('quotedPostId', 'userId content images video createdAt')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // Add pinned post for profile feed
    let pinnedPost = null;
    if (type === 'profile' && req.query.profileId) {
      const profileUser = await User.findById(req.query.profileId);
      if (profileUser.pinnedPostId) {
        pinnedPost = await Post.findById(profileUser.pinnedPostId)
          .populate('userId', 'username profileImage name isVerified')
          .populate('topics', 'name')
          .populate('likes.userId', 'username name profileImage')
          .populate('reactions.userId', 'username name profileImage')
          .populate('comments.userId', 'username name profileImage')
          .populate('shares.userId', 'username name profileImage')
          .populate('quotedPostId', 'userId content images video createdAt');
      }
    }

    // Update views and popularity
    const now = new Date();
    const formattedPosts = await Promise.all(
      posts.map(async (post) => {
        // Track view
        if (!post.views.some((v) => v.userId.toString() === req.userId.toString())) {
          post.views.push({ userId: req.userId });
          post.viewCount += 1;
          await post.save();
        }

        // Calculate view velocity (views in last hour)
        const recentViews = post.views.filter(
          (v) => (now - v.createdAt) / (1000 * 60 * 60) < 1
        ).length;
        const viewVelocity = recentViews / 1; // Views per hour

        // Popularity
        const hoursSincePost = (now - post.createdAt) / (1000 * 60 * 60);
        const decayFactor = Math.exp(-hoursSincePost / 24);
        const engagementScore =
          post.likes.length * 1 +
          post.reactions.length * 1.5 +
          post.comments.length * 2 +
          post.shares.length * 3 +
          viewVelocity * 0.5;
        post.popularityScore = engagementScore * decayFactor;
        await post.save();

        return {
          id: post._id,
          user: {
            id: post.userId._id,
            username: post.userId.username,
            name: post.userId.name,
            profileImage: post.userId.profileImage,
            isVerified: post.userId.isVerified,
          },
          content: post.content,
          images: post.images,
          video: post.video,
          hashtags: post.hashtags,
          topics: post.topics.map((t) => t.name),
          type: post.type,
          quotedPost: post.quotedPostId
            ? {
                id: post.quotedPostId._id,
                userId: post.quotedPostId.userId,
                content: post.quotedPostId.content,
                images: post.quotedPostId.images,
                video: post.quotedPostId.video,
                createdAt: post.quotedPostId.createdAt,
              }
            : null,
          poll: post.poll
            ? {
                question: post.poll.question,
                options: post.poll.options.map((opt) => ({
                  text: opt.text,
                  voteCount: opt.votes.length,
                  voted: opt.votes.some((v) => v.toString() === req.userId.toString()),
                })),
                expiresAt: post.poll.expiresAt,
              }
            : null,
          capsuleUnlockAt: post.capsuleUnlockAt,
          scheduleAt: post.scheduleAt,
          isPinned: post.isPinned,
          likes: post.likes.map((like) => ({
            userId: like.userId._id,
            username: like.userId.username,
            name: like.userId.name,
          })),
          reactions: post.reactions.map((r) => ({
            userId: r.userId._id,
            username: r.userId.username,
            name: r.userId.name,
            emoji: r.emoji,
          })),
          comments: post.comments.map((comment) => ({
            userId: comment.userId._id,
            username: comment.userId.username,
            name: comment.userId.name,
            content: comment.content,
            createdAt: comment.createdAt,
          })),
          shares: post.shares.map((share) => ({
            userId: share.userId._id,
            username: share.userId.username,
            name: share.userId.name,
          })),
          views: post.views.length,
          viewCount: post.viewCount,
          isLiked: post.likes.some((l) => l.userId._id.toString() === req.userId.toString()),
          isShared: post.shares.some((s) => s.userId._id.toString() === req.userId.toString()),
          userReaction: post.reactions.find((r) => r.userId._id.toString() === req.userId.toString())?.emoji,
          popularityScore: post.popularityScore,
          createdAt: post.createdAt,
        };
      })
    );

    // Format pinned post
    let formattedPinnedPost = null;
    if (pinnedPost) {
      formattedPinnedPost = {
        id: pinnedPost._id,
        user: {
          id: pinnedPost.userId._id,
          username: pinnedPost.userId.username,
          name: pinnedPost.userId.name,
          profileImage: pinnedPost.userId.profileImage,
          isVerified: pinnedPost.userId.isVerified,
        },
        content: pinnedPost.content,
        images: pinnedPost.images,
        video: pinnedPost.video,
        hashtags: pinnedPost.hashtags,
        topics: pinnedPost.topics.map((t) => t.name),
        type: pinnedPost.type,
        quotedPost: pinnedPost.quotedPostId
          ? {
              id: pinnedPost.quotedPostId._id,
              userId: pinnedPost.quotedPostId.userId,
              content: pinnedPost.quotedPostId.content,
              images: pinnedPost.quotedPostId.images,
              video: pinnedPost.quotedPostId.video,
              createdAt: pinnedPost.quotedPostId.createdAt,
            }
          : null,
        poll: pinnedPost.poll
          ? {
              question: pinnedPost.poll.question,
              options: pinnedPost.poll.options.map((opt) => ({
                text: opt.text,
                voteCount: opt.votes.length,
                voted: opt.votes.some((v) => v.toString() === req.userId.toString()),
              })),
              expiresAt: pinnedPost.poll.expiresAt,
            }
          : null,
        capsuleUnlockAt: pinnedPost.capsuleUnlockAt,
        scheduleAt: pinnedPost.scheduleAt,
        isPinned: pinnedPost.isPinned,
        likes: pinnedPost.likes.map((like) => ({
          userId: like.userId._id,
          username: like.userId.username,
          name: like.userId.name,
        })),
        reactions: pinnedPost.reactions.map((r) => ({
          userId: r.userId._id,
          username: r.userId.username,
          name: r.userId.name,
          emoji: r.emoji,
        })),
        comments: pinnedPost.comments.map((comment) => ({
          userId: comment.userId._id,
          username: comment.userId.username,
          name: comment.userId.name,
          content: comment.content,
          createdAt: comment.createdAt,
        })),
        shares: pinnedPost.shares.map((share) => ({
          userId: share.userId._id,
          username: share.userId.username,
          name: share.userId.name,
        })),
        views: pinnedPost.views.length,
        viewCount: pinnedPost.viewCount,
        isLiked: pinnedPost.likes.some((l) => l.userId._id.toString() === req.userId.toString()),
        isShared: pinnedPost.shares.some((s) => s.userId._id.toString() === req.userId.toString()),
        userReaction: pinnedPost.reactions.find((r) => r.userId._id.toString() === req.userId.toString())?.emoji,
        popularityScore: pinnedPost.popularityScore,
        createdAt: pinnedPost.createdAt,
      };
    }

    res
      .cookie('csrfToken', res.locals.newCsrfToken, { ...cookieOptions, maxAge: 24 * 60 * 60 * 1000, httpOnly: false })
      .json({
        success: true,
        posts: formattedPosts,
        pinnedPost: formattedPinnedPost,
        message: 'Feed retrieved successfully',
      });
  } catch (err) {
    console.error('Get feed error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Like a post
const likePost = async (req, res) => {
  try {
    const { postId } = req.body;
    const user = await User.findById(req.userId);
    if (!user || user.deleted || user.isDisableAccount) {
      return res.status(401).json({ success: false, message: 'Unauthorized or account not active' });
    }

    const post = await Post.findById(postId).populate('userId', 'username');
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const likeIndex = post.likes.findIndex((l) => l.userId.toString() === req.userId.toString());
    let message = '';
    if (likeIndex === -1) {
      post.likes.push({ userId: req.userId });
      message = 'Post liked successfully';

      // Notify post owner (if not self)
      if (post.userId._id.toString() !== req.userId.toString()) {
        const io = req.app.get('io');
        const connectedUsers = req.app.get('connectedUsers');
        const notification = new Notification({
          userId: post.userId._id,
          username: user.username,
          type: 'like',
          title: 'Post Liked',
          message: `${user.username} liked your post`,
          read: false,
          createdAt: new Date(),
        });
        await notification.save();

        const ownerSockets = connectedUsers.get(post.userId._id.toString()) || [];
        ownerSockets.forEach((socketId) => {
          io.to(socketId).emit('notification', {
            id: notification._id.toString(),
            userId: post.userId._id.toString(),
            username: user.username,
            type: 'like',
            message: `${user.username} liked your post`,
            title: 'Post Liked',
            time: notification.createdAt.toISOString(),
            isRead: false,
          });
        });
      }
    } else {
      post.likes.splice(likeIndex, 1);
      message = 'Post unliked successfully';
    }

    await post.save();

    res.json({ success: true, message });
  } catch (err) {
    console.error('Like post error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// React to a post
const reactPost = async (req, res) => {
  try {
    const { postId, emoji } = req.body;
    const user = await User.findById(req.userId);
    if (!user || user.deleted || user.isDisableAccount) {
      return res.status(401).json({ success: false, message: 'Unauthorized or account not active' });
    }

    if (!emoji || !['😂', '😍', '🔥', '😢', '👍'].includes(emoji)) {
      return res.status(400).json({ success: false, message: 'Invalid emoji' });
    }

    const post = await Post.findById(postId).populate('userId', 'username');
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const reactionIndex = post.reactions.findIndex((r) => r.userId.toString() === req.userId.toString());
    if (reactionIndex === -1) {
      post.reactions.push({ userId: req.userId, emoji });
      message = 'Reaction added successfully';

      // Notify post owner (if not self)
      if (post.userId._id.toString() !== req.userId.toString()) {
        const io = req.app.get('io');
        const connectedUsers = req.app.get('connectedUsers');
        const notification = new Notification({
          userId: post.userId._id,
          username: user.username,
          type: 'reaction',
          title: 'Post Reacted',
          message: `${user.username} reacted to your post with ${emoji}`,
          read: false,
          createdAt: new Date(),
        });
        await notification.save();

        const ownerSockets = connectedUsers.get(post.userId._id.toString()) || [];
        ownerSockets.forEach((socketId) => {
          io.to(socketId).emit('notification', {
            id: notification._id.toString(),
            userId: post.userId._id.toString(),
            username: user.username,
            type: 'reaction',
            message: `${user.username} reacted to your post with ${emoji}`,
            title: 'Post Reacted',
            time: notification.createdAt.toISOString(),
            isRead: false,
          });
        });
      }
    } else {
      if (post.reactions[reactionIndex].emoji === emoji) {
        post.reactions.splice(reactionIndex, 1);
        message = 'Reaction removed successfully';
      } else {
        post.reactions[reactionIndex].emoji = emoji;
        message = 'Reaction updated successfully';
      }
    }

    await post.save();

    res.json({ success: true, message });
  } catch (err) {
    console.error('React post error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Comment on a post
const commentPost = async (req, res) => {
  try {
    const { postId, content } = req.body;
    const user = await User.findById(req.userId);
    if (!user || user.deleted || user.isDisableAccount) {
      return res.status(401).json({ success: false, message: 'Unauthorized or account not active' });
    }

    if (!content) {
      return res.status(400).json({ success: false, message: 'Comment content required' });
    }

    const post = await Post.findById(postId).populate('userId', 'username');
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    post.comments.push({ userId: req.userId, content, createdAt: new Date() });
    await post.save();

    // Notify post owner (if not self)
    if (post.userId._id.toString() !== req.userId.toString()) {
      const io = req.app.get('io');
      const connectedUsers = req.app.get('connectedUsers');
      const notification = new Notification({
        userId: post.userId._id,
        username: user.username,
        type: 'comment',
        title: 'New Comment',
        message: `${user.username} commented on your post`,
        read: false,
        createdAt: new Date(),
      });
      await notification.save();

      const ownerSockets = connectedUsers.get(post.userId._id.toString()) || [];
      ownerSockets.forEach((socketId) => {
        io.to(socketId).emit('notification', {
          id: notification._id.toString(),
          userId: post.userId._id.toString(),
          username: user.username,
          type: 'comment',
          message: `${user.username} commented on your post`,
          title: 'New Comment',
          time: notification.createdAt.toISOString(),
          isRead: false,
        });
      });
    }

    res.json({ success: true, message: 'Comment added successfully' });
  } catch (err) {
    console.error('Comment post error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Share a post
const sharePost = async (req, res) => {
  try {
    const { postId } = req.body;
    const user = await User.findById(req.userId);
    if (!user || user.deleted || user.isDisableAccount) {
      return res.status(401).json({ success: false, message: 'Unauthorized or account not active' });
    }

    const originalPost = await Post.findById(postId);
    if (!originalPost) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    if (originalPost.shares.some((s) => s.userId.toString() === req.userId.toString())) {
      return res.status(400).json({ success: false, message: 'Post already shared' });
    }

    const sharePost = new Post({
      userId: req.userId,
      type: 'share',
      sharedPostId: postId,
      popularityScore: 0,
      createdAt: new Date(),
    });

    await sharePost.save();
    originalPost.shares.push({ userId: req.userId });
    await originalPost.save();

    res.json({ success: true, message: 'Post shared successfully' });
  } catch (err) {
    console.error('Share post error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Vote in a poll
const votePoll = async (req, res) => {
  try {
    const { postId, optionIndex } = req.body;
    const user = await User.findById(req.userId);
    if (!user || user.deleted || user.isDisableAccount) {
      return res.status(401).json({ success: false, message: 'Unauthorized or account not active' });
    }

    const post = await Post.findById(postId);
    if (!post || post.type !== 'poll') {
      return res.status(404).json({ success: false, message: 'Poll not found' });
    }

    if (post.poll.expiresAt < new Date()) {
      return res.status(400).json({ success: false, message: 'Poll has expired' });
    }

    const hasVoted = post.poll.options.some((opt) =>
      opt.votes.some((v) => v.toString() === req.userId.toString())
    );
    if (hasVoted) {
      return res.status(400).json({ success: false, message: 'You have already voted' });
    }

    if (optionIndex >= 0 && optionIndex < post.poll.options.length) {
      post.poll.options[optionIndex].votes.push(req.userId);
      await post.save();
      res.json({ success: true, message: 'Vote recorded successfully' });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid option' });
    }
  } catch (err) {
    console.error('Vote poll error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Pin a post
const pinPost = async (req, res) => {
  try {
    const { postId } = req.body;
    const user = await User.findById(req.userId);
    if (!user || user.deleted || user.isDisableAccount) {
      return res.status(401).json({ success: false, message: 'Unauthorized or account not active' });
    }

    const post = await Post.findById(postId);
    if (!post || post.userId.toString() !== req.userId.toString()) {
      return res.status(404).json({ success: false, message: 'Post not found or not owned' });
    }

    // Unpin previous post
    if (user.pinnedPostId) {
      await Post.updateOne({ _id: user.pinnedPostId }, { isPinned: false });
    }

    // Pin new post
    user.pinnedPostId = postId;
    post.isPinned = true;
    await user.save();
    await post.save();

    res.json({ success: true, message: 'Post pinned successfully' });
  } catch (err) {
    console.error('Pin post error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Unpin a post
const unpinPost = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user || user.deleted || user.isDisableAccount) {
      return res.status(401).json({ success: false, message: 'Unauthorized or account not active' });
    }

    if (user.pinnedPostId) {
      await Post.updateOne({ _id: user.pinnedPostId }, { isPinned: false });
      user.pinnedPostId = null;
      await user.save();
    }

    res.json({ success: true, message: 'Post unpinned successfully' });
  } catch (err) {
    console.error('Unpin post error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Publish a draft
const publishDraft = async (req, res) => {
  try {
    const { postId } = req.body;
    const user = await User.findById(req.userId);
    if (!user || user.deleted || user.isDisableAccount) {
      return res.status(401).json({ success: false, message: 'Unauthorized or account not active' });
    }

    const post = await Post.findById(postId);
    if (!post || post.userId.toString() !== req.userId.toString() || post.type !== 'draft') {
      return res.status(404).json({ success: false, message: 'Draft not found or not owned' });
    }

    post.type = 'post';
    await post.save();

    // Notify followers
    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers');
    const notification = new Notification({
      userId: req.userId,
      username: user.username,
      type: 'post',
      title: 'New Post',
      message: `${user.username} shared a new post`,
      read: false,
      createdAt: new Date(),
    });
    await notification.save();

    user.followers.forEach(async (followerId) => {
      const followerSockets = connectedUsers.get(followerId.toString()) || [];
      followerSockets.forEach((socketId) => {
        io.to(socketId).emit('notification', {
          id: notification._id.toString(),
          userId: followerId.toString(),
          username: user.username,
          type: 'post',
          message: `${user.username} shared a new post`,
          title: 'New Post',
          time: notification.createdAt.toISOString(),
          isRead: false,
        });
      });
    });

    res.json({ success: true, message: 'Draft published successfully' });
  } catch (err) {
    console.error('Publish draft error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get trending
const getTrending = async (req, res) => {
  try {
    const recentPosts = await Post.find({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      type: { $ne: 'draft' },
    });
    const hashtagCounts = {};
    recentPosts.forEach((post) => {
      post.hashtags.forEach((hashtag) => {
        hashtagCounts[hashtag] = (hashtagCounts[hashtag] || 0) + 1;
      });
    });
    const trendingHashtags = Object.entries(hashtagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([hashtag]) => hashtag);

    const trendingTopics = await Topic.find()
      .sort({ postCount: -1 })
      .limit(10)
      .select('name');

    res.json({
      success: true,
      trending: {
        hashtags: trendingHashtags,
        topics: trendingTopics.map((t) => t.name),
      },
      message: 'Trending data retrieved successfully',
    });
  } catch (err) {
    console.error('Get trending error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Notify capsule unlock
const notifyCapsuleUnlock = async () => {
  try {
    const now = new Date();
    const capsules = await Post.find({
      type: 'capsule',
      capsuleUnlockAt: { $lte: now },
      notified: { $ne: true },
    }).populate('userId', 'username followers');

    for (const capsule of capsules) {
      const user = capsule.userId;
      const io = req.app.get('io');
      const connectedUsers = req.app.get('connectedUsers');
      const notification = new Notification({
        userId: user._id,
        username: user.username,
        type: 'capsule',
        title: 'Time Capsule Unlocked',
        message: `${user.username}'s time capsule has unlocked!`,
        read: false,
        createdAt: now,
      });
      await notification.save();

      user.followers.forEach(async (followerId) => {
        const followerSockets = connectedUsers.get(followerId.toString()) || [];
        followerSockets.forEach((socketId) => {
          io.to(socketId).emit('notification', {
            id: notification._id.toString(),
            userId: followerId.toString(),
            username: user.username,
            type: 'capsule',
            message: `${user.username}'s time capsule has unlocked!`,
            title: 'Time Capsule Unlocked',
            time: notification.createdAt.toISOString(),
            isRead: false,
          });
        });
      });

      capsule.notified = true;
      await capsule.save();
    }
  } catch (err) {
    console.error('Notify capsule unlock error:', err);
  }
};

module.exports = {
  createPost,
  getFeed,
  likePost,
  reactPost,
  commentPost,
  sharePost,
  votePoll,
  pinPost,
  unpinPost,
  publishDraft,
  getTrending,
  notifyCapsuleUnlock,
};