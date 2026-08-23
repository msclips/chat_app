const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const UserToken = require('../models/UserToken');
const { getSockets } = require('../socket/socketManager');
const { sendChatNotification } = require('../services/chatNotificationService');

function getRequestUser(req) {
  const userId = req.body?.userId || req.query?.userId || req.headers['x-user-id'];
  const username = req.body?.username || req.query?.username || req.body?.user_name || req.query?.user_name || req.headers['x-user-name'];
  return {
    id: userId ? (isNaN(userId) ? userId : Number(userId)) : null,
    user_name: username || 'User',
  };
}

// POST /api/notifications/reply
// Called from mobile background isolate when user taps "Reply" on a notification.
router.post('/reply', async (req, res) => {
  try {
    const { conversationId, text, userId, username } = req.body;
    const io = req.app.get('io');

    if (!conversationId || !text || !userId) {
      return res.status(400).json({ success: false, message: 'conversationId, text, and userId are required' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const senderName = username || req.headers['x-user-name'] || 'User';
    const numericUserId = Number(userId);

    const message = new Message({
      conversationId,
      senderId: numericUserId,
      senderName,
      content: text,
      messageType: 'text',
    });
    await message.save();

    // Update conversation last message
    conversation.lastMessage = message._id;
    conversation.updatedAt = new Date();
    conversation.participants = conversation.participants.map(p => {
      if (p.userId !== numericUserId) {
        p.unreadCount = (p.unreadCount || 0) + 1;
      }
      return p;
    });
    await conversation.save();

    const messageData = message.toObject();

    // Emit to all participants in the conversation room
    io.to(`conv:${conversationId}`).emit('message:new', messageData);

    // Emit conversation updated to participants not in the room
    for (const participant of conversation.participants) {
      if (participant.userId !== numericUserId) {
        const sockets = getSockets(participant.userId);
        if (sockets) {
          for (const sid of sockets) {
            io.to(sid).emit('conversation:updated', {
              conversationId: conversation._id,
              lastMessage: messageData,
              incrementUnread: true,
            });
          }
        }
      }
    }

    // Send push notifications to other participants (fire-and-forget)
    try {
      const otherUserIds = conversation.participants
        .filter(p => p.userId !== numericUserId)
        .map(p => p.userId);

      const userTokensToNotify = [];
      for (const id of otherUserIds) {
        const tokenData = await UserToken.findOne({ where: { user_id: id } });
        if (tokenData) {
          userTokensToNotify.push({
            user_id: id,
            android_token: tokenData.android_token,
            web_token: tokenData.web_token,
          });
        }
      }

      if (userTokensToNotify.length > 0) {
        await sendChatNotification({
          userIds: userTokensToNotify,
          senderName,
          conversationName: conversation.groupName || conversation.communityName || senderName,
          chatData: {
            chat_id: conversationId,
            chat_type: conversation.type,
            message_id: message._id.toString(),
            sender_id: userId.toString(),
            sender_name: senderName,
            message_content: text,
            msg_type: 'text',
          },
        });
      }
    } catch (notifyErr) {
      console.error('[NOTIFICATIONS] Error sending notification for inline reply:', notifyErr.message);
    }

    res.status(200).json({ success: true, message: messageData });
  } catch (err) {
    console.error('[NOTIFICATIONS] /reply error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/notifications/mark-read
// Called from mobile background isolate when user taps "Mark as read" on a notification.
router.post('/mark-read', async (req, res) => {
  try {
    const { conversationId, userId } = req.body;
    const io = req.app.get('io');

    if (!conversationId || !userId) {
      return res.status(400).json({ success: false, message: 'conversationId and userId are required' });
    }

    const numericUserId = Number(userId);

    // Mark all unread messages in the conversation as read for this user
    await Message.updateMany(
      { conversationId, readBy: { $ne: numericUserId } },
      { $push: { readBy: numericUserId } }
    );

    // Reset unread count for this user in the conversation
    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
      conversation.participants = conversation.participants.map(p => {
        if (p.userId === numericUserId) {
          p.unreadCount = 0;
        }
        return p;
      });
      await conversation.save();
    }

    // Notify active clients that messages were read (e.g., remove badges on other devices)
    io.to(`conv:${conversationId}`).emit('messages:read', {
      conversationId,
      readByUserId: numericUserId,
    });

    // Fallback for mobile clients not joined in the specific room
    if (conversation && Array.isArray(conversation.participants)) {
      for (const p of conversation.participants) {
        if (p.userId === numericUserId) continue; // Don't echo to the sender
        const sockets = getSockets(p.userId);
        if (sockets) {
          for (const sid of sockets) {
            io.to(sid).emit('messages:read', {
              conversationId,
              readByUserId: numericUserId,
            });
          }
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[NOTIFICATIONS] /mark-read error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
