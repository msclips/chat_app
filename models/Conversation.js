const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participants: [{
    userId: { type: Number, required: true },
    username: { type: String, required: true },
    lastRead: { type: Date, default: Date.now }
  }],
  type: {
    type: String,
    enum: ['private', 'group', 'community'],
    default: 'private'
  },
  communityId: { type: Number, default: null },
  communityName: { type: String, default: null },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  lastMessageTime: { type: Date, default: null }
}, {
  timestamps: true
});

// Index for finding conversations by participant
conversationSchema.index({ 'participants.userId': 1, type: 1 });

module.exports = mongoose.model('Conversation', conversationSchema);
