const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  senderId: { type: Number, required: true },
  senderName: { type: String, required: true },
  messageType: {
    type: String,
    enum: ['text', 'file', 'image', 'poll'],
    default: 'text'
  },
  pollData: {
    question: { type: String },
    options: [{
      option: { type: String },
      votes: [{ type: Number }] // Array of userIds who voted
    }],
    allowMultiple: { type: Boolean, default: false },
    showVoters: { type: Boolean, default: false }
  },
  content: { type: String, default: '' },
  fileUrl: { type: String, default: null },
  fileName: { type: String, default: null },
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  readBy: [{
    userId: { type: Number, required: true },
    readAt: { type: Date, default: Date.now }
  }],
  isEdited: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  delete_type: { type: Number, enum: [1, 2, null], default: null },
  deleted_by: [{ type: Number }]
}, {
  timestamps: true
});

// Index for querying messages by conversation
messageSchema.index({ conversationId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
