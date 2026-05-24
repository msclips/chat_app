const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const Message = require('../models/Message');

/**
 * Helper to extract user identity directly from request headers, body, or query parameters.
 * Eliminates the need for any authentication middleware.
 */
function getRequestUser(req) {
  const userId = req.headers['x-user-id'] || req.body.userId || req.query.userId || req.body.id || req.query.id;
  const username = req.headers['x-user-name'] || req.body.username || req.query.username || req.body.user_name || req.query.user_name;

  return {
    id: userId ? (isNaN(userId) ? userId : Number(userId)) : 1,
    user_name: username || 'Guest'
  };
}

const { getSockets } = require('../socket/socketManager');

// Create or get a private conversation
router.post('/', async (req, res) => {
  const { participantId } = req.body;
  const currentUser = getRequestUser(req);

  if (!participantId) {
    return res.status(400).json({ message: 'Participant ID is required' });
  }

  try {
    // Find the participant in MySQL to get their username
    const participant = await User.findByPk(participantId);
    if (!participant) {
      return res.status(404).json({ message: 'Participant not found' });
    }

    // Check if conversation already exists between these two users
    let conversation = await Conversation.findOne({
      type: 'private',
      'participants.userId': { $all: [currentUser.id, participantId] }
    });

    if (!conversation) {
      conversation = new Conversation({
        participants: [
          { userId: currentUser.id, username: currentUser.user_name },
          { userId: participantId, username: participant.user_name }
        ],
        type: 'private',
        status: 'pending',
        initiatorId: currentUser.id
      });
      await conversation.save();
    } else {
      // Handle blocked conversation
      if (conversation.status === 'blocked') {
        if (conversation.blockedBy !== currentUser.id) {
          return res.status(403).json({ message: 'You have been blocked by this user.' });
        }
      }
    }

    res.json(conversation);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// List user's conversations (hiding blocked ones)
router.get('/', async (req, res) => {
  const currentUser = getRequestUser(req);
  try {
    const conversations = await Conversation.find({
      'participants.userId': currentUser.id,
      status: { $ne: 'blocked' }
    }).sort({ updatedAt: -1 });

    res.json(conversations);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Get messages for a conversation
router.get('/:id/messages', async (req, res) => {
  const currentUser = getRequestUser(req);
  try {
    console.log('Fetching messages for conversation:', req.params.id);
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      return res.status(404).send('Conversation not found');
    }

    // Do not return message history to recipient if pending
    if (conversation.type === 'private' && conversation.status === 'pending') {
      if (conversation.initiatorId !== currentUser.id) {
        console.log('Recipient requested messages for pending conversation, returning empty history.');
        return res.json([]);
      }
    }

    const messages = await Message.find({ conversationId: req.params.id })
      .sort({ createdAt: 1 }) // Oldest first for chat history
      .limit(50);
    console.log(`Found ${messages.length} messages`);
    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).send('Server Error');
  }
});

// Accept a conversation request
router.post('/:id/accept', async (req, res) => {
  const currentUser = getRequestUser(req);
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    if (conversation.status !== 'pending') {
      return res.status(400).json({ message: 'Conversation is not in pending state' });
    }

    if (conversation.initiatorId === currentUser.id) {
      return res.status(403).json({ message: 'Initiator cannot accept their own request' });
    }

    conversation.status = 'accepted';
    await conversation.save();

    // Notify the initiator via Socket.IO if they are online
    const io = req.app.get('io');
    if (io) {
      const sockets = getSockets(conversation.initiatorId);
      if (sockets) {
        for (const sid of sockets) {
          io.to(sid).emit('conversation:accepted', { conversationId: conversation._id });
        }
      }
    }

    res.json({ success: true, conversation });
  } catch (err) {
    console.error('Accept error:', err);
    res.status(500).send('Server Error');
  }
});

// Reject/Block a conversation request
router.post('/:id/reject', async (req, res) => {
  const currentUser = getRequestUser(req);
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    if (conversation.status !== 'pending') {
      return res.status(400).json({ message: 'Conversation is not in pending state' });
    }

    if (conversation.initiatorId === currentUser.id) {
      return res.status(403).json({ message: 'Initiator cannot reject their own request' });
    }

    conversation.status = 'blocked';
    conversation.blockedBy = currentUser.id;
    await conversation.save();

    res.json({ success: true, conversation });
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
