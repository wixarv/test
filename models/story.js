const mongoose = require('mongoose');

const storySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  image: {
    url: String,
    fileName: String // Added to store R2 object key
  },
  caption: {
    type: String,
    maxLength: 500
  },
  viewers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  reactions: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reaction: {
      type: String,
      enum: ['like', 'love', 'haha', 'wow', 'sad', 'angry'], // Define allowed reactions
      required: true
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 }
  }
});

// Auto-delete expired stories using TTL index
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pre-remove hook to delete R2 object
storySchema.pre('remove', async function(next) {
  try {
    if (this.image && this.image.fileName) {
      const AWS = require('aws-sdk');
      const r2 = new AWS.S3({
        endpoint: process.env.R2_ENDPOINT,
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        signatureVersion: 'v4',
        region: 'auto'
      });
      const params = {
        Bucket: process.env.R2_BUCKET_NAME,
        Key: this.image.fileName
      };
      await r2.deleteObject(params).promise();
    }
    next();
  } catch (err) {
    console.error('Error deleting R2 object:', err);
    next(err);
  }
});

module.exports = mongoose.model('Story', storySchema);