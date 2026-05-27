const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const GroupUser = require('../models/GroupUser');
const { addSocket, removeSocket, getSockets } = require('./socketManager');

function chatHandler(io) {
  io.on('connection', (socket) => {
    const userId = socket.user.id;
    const username = socket.user.user_name;

    console.log(`✅ Authenticated User connected: ${username} (${userId})`);

    // Register socket in shared manager (also used by REST /api/socket/connect)
    addSocket(userId, socket.id);

    // Join user's existing conversation rooms
    socket.on('conversations:join', async (conversationIds) => {
      if (!Array.isArray(conversationIds)) return;
      
      for (const convId of conversationIds) {
        // For private chats, verify participant
        // For communities, anyone can join the room (view access)
        const conversation = await Conversation.findById(convId);
        
        if (conversation) {
            if (conversation.type === 'community') {
                socket.join(`conv:${convId}`);
                console.log(`User ${username} joined community room conv:${convId}`);
            } else if (conversation.participants.some(p => p.userId === userId)) {
                socket.join(`conv:${convId}`);
                console.log(`User ${username} joined room conv:${convId}`);
            }
        }
      }
    });

    // Send Message
    socket.on('message:send', async (data) => {
      try {

        let parsedData;

        try {
          parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (err) {
          console.error('Invalid JSON:', data);
          return;
        }

        const { conversationId, content, messageType = 'text', tempId, replyTo } = parsedData;

        if (!conversationId || !content) return;
       
        // Verify user is participant or has community access
        const conversation = await Conversation.findById(conversationId);

        if (!conversation) return;

        if (conversation.type === 'community') {
            // Check if user is in group_user table
            const membership = await GroupUser.findOne({
                where: { group_id: conversation.communityId, user_id: userId }
            });

            if (!membership) {
                console.warn(`User ${username} attempted to send message to community ${conversation.communityId} without permission.`);
                return socket.emit('message:error', { error: 'You are not a member of this community.' });
            }
        } else {
            // Private or regular group
            const isParticipant = conversation.participants.some(p => p.userId === userId);
            if (!isParticipant) return;

            // Enforce private message requests status validation
            if (conversation.type === 'private') {
                if (conversation.status === 'blocked') {
                    console.warn(`User ${username} attempted to send a message to a blocked conversation: ${conversationId}`);
                    return socket.emit('message:error', { error: 'You are blocked from sending messages to this user.' });
                }
                if (conversation.status === 'pending' && conversation.initiatorId !== userId) {
                    console.warn(`User ${username} attempted to send a message to a pending conversation without accepting first: ${conversationId}`);
                    return socket.emit('message:error', { error: 'You must accept the conversation request before replying.' });
                }
            }
        }

        // Save message to MongoDB
        const message = new Message({
          conversationId,
          senderId: userId,
          senderName: username,
          messageType,
          content,
          replyTo: replyTo || null,
          readBy: [{ userId, readAt: new Date() }]
        });
        await message.save();

        if (replyTo) {
          await message.populate('replyTo', 'senderName content');
        }

        // Update conversation last message
        await Conversation.updateOne(
          { _id: conversationId },
          {
            $set: {
              lastMessage: message._id,
              lastMessageTime: message.createdAt
            }
          }
        );

        const messageData = message.toObject();
        messageData.tempId = tempId;

        // Emit to sender
        socket.emit('message:delivered', { tempId, message: messageData });

        // Broadcast to other participants in the room
        socket.to(`conv:${conversationId}`).emit('message:new', messageData);

        // Notify participants who might be online but not in the room (only for private/group)
        if (conversation.type !== 'community') {
            for (const participant of conversation.participants) {
              if (participant.userId !== userId) {
                const sockets = getSockets(participant.userId);
                if (sockets) {
                  for (const sid of sockets) {
                    io.to(sid).emit('conversation:updated', {
                      conversationId,
                      lastMessage: messageData,
                      incrementUnread: true
                    });
                  }
                }
              }
            }
        }

      } catch (err) {
        console.error('Message send error:', err);
        socket.emit('message:error', { error: 'Failed to send message' });
      }
    });

    // Edit Message
    socket.on('message:edit', async (data) => {
      try {
        let parsedData;
        try {
          parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (err) {
          console.error('Invalid JSON:', data);
          return;
        }

        const { messageId, content } = parsedData;
        if (!messageId || !content) return;

        const message = await Message.findById(messageId);
        if (!message) return;

        if (message.senderId !== userId) {
            return socket.emit('message:error', { error: 'You can only edit your own messages.' });
        }

        message.content = content;
        message.isEdited = true;
        await message.save();

        if (message.replyTo) {
          await message.populate('replyTo', 'senderName content');
        }

        const messageData = message.toObject();

        socket.emit('message:updated', messageData);
        socket.to(`conv:${message.conversationId}`).emit('message:updated', messageData);
        
        // Notify participants who might be online but not in the room if this was the last message
        const conversation = await Conversation.findById(message.conversationId);
        if (conversation && conversation.type !== 'community' && conversation.lastMessage && conversation.lastMessage.toString() === messageId.toString()) {
            for (const participant of conversation.participants) {
              if (participant.userId !== userId) {
                const sockets = getSockets(participant.userId);
                if (sockets) {
                  for (const sid of sockets) {
                    io.to(sid).emit('conversation:updated', {
                      conversationId: conversation._id,
                      lastMessage: messageData,
                      incrementUnread: false
                    });
                  }
                }
              }
            }
        }
      } catch (err) {
        console.error('Message edit error:', err);
        socket.emit('message:error', { error: 'Failed to edit message' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`❌ User disconnected: ${username}`);
      removeSocket(userId, socket.id);
    });
  });
}

module.exports = chatHandler;
