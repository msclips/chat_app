const mongoose = require('mongoose');

const groupMemberSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  userId: { type: Number, required: true },
  role: { type: String, enum: ['admin', 'member'], default: 'member' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  muteUntil: { type: Date, default: null },
  lastReadMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  joinedAt: { type: Date, default: Date.now }
});

// Indexes for lightning fast lookups inside the socket
groupMemberSchema.index({ groupId: 1, status: 1 });
groupMemberSchema.index({ userId: 1, status: 1 });
groupMemberSchema.index({ groupId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('GroupMember', groupMemberSchema);
