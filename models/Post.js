// Post.js
const mongoose = require('mongoose');
const postSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, trim: true },
  images: [{ url: String, fileName: String }],
  video: { url: String, fileName: String },
  hashtags: [String],
  topics: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Topic' }],
  type: { type: String, enum: ['post', 'quote', 'poll', 'share', 'capsule', 'draft', 'scheduled'], default: 'post' },
  quotedPostId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  sharedPostId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  poll: {
    question: String,
    options: [{ text: String, votes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] }],
    expiresAt: Date,
  },
  capsuleUnlockAt: { type: Date }, // For time capsule posts
  scheduleAt: { type: Date }, // For scheduled posts
  isPinned: { type: Boolean, default: false }, // Pinned post
  likes: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }],
  reactions: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, emoji: String }],
  comments: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      content: String,
      createdAt: Date,
    },
  ],
  shares: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }],
  views: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }], // Unique viewers
  viewCount: { type: Number, default: 0 }, // Total views
  popularityScore: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});
module.exports = mongoose.model('Post', postSchema);

// Topic.js (unchanged)
const mongoose = require('mongoose');
const topicSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  postCount: { type: Number, default: 0 },
});
module.exports = mongoose.model('Topic', topicSchema);

// User.js (partial, for pinned post)
const userSchema = new mongoose.Schema({
  // ... other fields ...
  pinnedPostId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
});