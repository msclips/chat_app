const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participants: [{
    userId: { type: Number, required: true },
    username: { type: String, required: true },
    lastRead: { type: Date, default: Date.now },
    muteUntil: { type: Date, default: null }
  }],
  type: {
    type: String,
    enum: ['private', 'group', 'community'],
    default: 'private'
  },
  communityId: { type: Number, default: null },
  communityName: { type: String, default: null },
  groupId: { type: Number, default: null },
  groupName: { type: String, default: null },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  lastMessageTime: { type: Date, default: null },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'blocked'],
    default: 'pending'
  },
  initiatorId: {
    type: Number,
    default: null
  },
  blockedBy: {
    type: Number,
    default: null
  }
}, {
  timestamps: true
});

// Index for finding conversations by participant
conversationSchema.index({ 'participants.userId': 1, type: 1 });

module.exports = mongoose.model('Conversation', conversationSchema);
