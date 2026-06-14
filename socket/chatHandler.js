const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const GroupUser = require('../models/GroupUser');
const UserToken = require('../models/UserToken');
const { addSocket, removeSocket, getSockets } = require('./socketManager');
const { sendChatNotification } = require('../services/chatNotificationService');
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
            } else if (conversation.type === 'group') {
                const membership = await GroupUser.findOne({
                    where: {
                        group_id: conversation.groupId,
                        user_id: userId,
                        status: 1,
                        is_active: 1
                    }
                });

                if (membership) {
                    socket.join(`conv:${convId}`);
                    console.log(`User ${username} joined group room conv:${convId}`);
                }
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
        console.log(`[MESSAGE] Message Data:`, data);
        try {
          parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (err) {
          console.error('Invalid JSON:', data);
          return;
        }
        console.log(`[MESSAGE] Parsed Data:`, parsedData);
        const { conversationId, content, messageType = 'text', tempId, replyTo } = parsedData;

        if (!conversationId || !content) return;
       
        // Verify user is participant or has community access
        const conversation = await Conversation.findById(conversationId);

        if (!conversation) return;
        console.log(`[MESSAGE] Conversation:`, conversation);
        if (conversation.type === 'community') {
            const membership = await GroupUser.findOne({
                where: { group_id: conversation.communityId, user_id: userId }
            });

            if (!membership) {
                console.warn(`User ${username} attempted to send message to community ${conversation.communityId} without permission.`);
                return socket.emit('message:error', { error: 'You are not a member of this community.' });
            }
        } else if (conversation.type === 'group') {
            const membership = await GroupUser.findOne({
                where: {
                    group_id: conversation.groupId,
                    user_id: userId,
                    status: 1,
                    is_active: 1
                }
            });

            if (!membership) {
                console.warn(`User ${username} attempted to send message to group ${conversation.groupId} without permission.`);
                return socket.emit('message:error', { error: 'You are not a member of this group.' });
            }
        } else {
            const isParticipant = conversation.participants.some(p => p.userId === userId);
            if (!isParticipant) return;

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
        console.log(`[MESSAGE] Conversation is valid`);

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
        console.log(`[MESSAGE] Message saved to MongoDB`);

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
        console.log(`[MESSAGE] Conversation updated`);

        const messageData = message.toObject();
        messageData.tempId = tempId;
        console.log(`[MESSAGE] Message data:`, messageData);

        // Emit to sender
        socket.emit('message:delivered', { tempId, message: messageData });
        console.log(`[MESSAGE] Message delivered to sender`);

        // Broadcast to other participants in the room
        socket.to(`conv:${conversationId}`).emit('message:new', messageData);
        console.log(`[MESSAGE] Message broadcasted to room`);

        // Notify participants who might be online but not in the room (only for private/group)
        if (conversation.type !== 'community') {
            console.log(`[MESSAGE] Notifying participants who might be online but not in the room`)
            let recipientUserIds = [];

            if (conversation.type === 'group') {
                const members = await GroupUser.findAll({
                    where: {
                        group_id: conversation.groupId,
                        status: 1,
                        is_active: 1
                    }
                });
                recipientUserIds = members
                    .map((member) => member.user_id)
                    .filter((id) => id !== userId);
            } else {
                for (const participant of conversation.participants) {
                    if (participant.userId !== userId) {
                        recipientUserIds.push(participant.userId);
                    }
                }
            }
            console.log(`[MESSAGE] Recipient user ids:`, recipientUserIds);

            for (const recipientId of recipientUserIds) {
              const sockets = getSockets(recipientId);
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
                console.log(`test123`);
            // Send Firebase Push Notification
            if (recipientUserIds.length > 0) {
              try {
                console.log(`[NOTIFICATION] Starting push notification process for ${recipientUserIds.length} recipients`);
                // Fetch actual tokens from MySQL for the recipients
                const userTokensToNotify = [];
                console.log(`[NOTIFICATION] Fetching tokens from MySQL Database Start`);
                for (const id of recipientUserIds) {
                    try {
                        console.log(`[NOTIFICATION] Database Query Start: Fetching token for user ${id}`);
                        const tokenData = await UserToken.findOne({
                            where: {
                                user_id: id,
                                is_active: true
                            }
                        });
                        console.log(`[NOTIFICATION] Database Query Completed: Fetching token for user ${id}`);
                        
                        if (tokenData) {
                            userTokensToNotify.push({
                                user_id: id,
                                android_token: tokenData.android_token,
                                web_token: tokenData.web_token
                            });
                            console.log(`[NOTIFICATION] Token found for user ${id}`);
                        } else {
                            console.log(`[NOTIFICATION] No token document found for user ${id}`);
                        }
                    } catch (dbErr) {
                        console.error(`[NOTIFICATION] Error fetching token from MySQL for user ${id}:`, dbErr);
                        console.error(`[NOTIFICATION] Complete Error Stack Trace:`, dbErr.stack);
                    }
                }
                console.log(`[NOTIFICATION] Fetching tokens from MySQL Database Completed. Found tokens for ${userTokensToNotify.length} users`);

                // Only send if we found users with tokens (you'd filter this based on actual DB response)
                console.log(`[NOTIFICATION] API Call Start: sendChatNotification`);
                await sendChatNotification({
                  userIds: userTokensToNotify,
                  senderName: username,
                  chatData: {
                    chat_id: conversationId,
                    message_id: message._id.toString(),
                    sender_id: userId,
                    message_content: message.content,
                    message_type: message.messageType
                  }
                });
                console.log(`[NOTIFICATION] API Call Completed: sendChatNotification`);
              } catch (notifyErr) {
                console.error('[NOTIFICATION] Failed to trigger push notification:', notifyErr);
                console.error('[NOTIFICATION] Complete Error Stack Trace:', notifyErr.stack);
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

    // Delete Message
    socket.on('message:delete', async (data) => {
      try {
        let parsedData;
        try {
          parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (err) {
          console.error('Invalid JSON:', data);
          return;
        }

        const { messageId, deleteType } = parsedData; // deleteType: 1 for Me, 2 for Everyone
        if (!messageId || !deleteType) return;

        const message = await Message.findById(messageId);
        if (!message) return;

        const conversation = await Conversation.findById(message.conversationId);
        if (!conversation) return;

        if (deleteType === 2) {
            if (message.senderId !== userId) {
                return socket.emit('message:error', { error: 'You can only delete your own messages for everyone.' });
            }
            message.delete_type = 2;
            message.isDeleted = true;
        } else if (deleteType === 1) {
            if (!message.deleted_by.includes(userId)) {
                message.deleted_by.push(userId);
            }
            if (message.delete_type !== 2) {
                message.delete_type = 1;
            }
        } else {
            return;
        }

        await message.save();

        if (deleteType === 2) {
            socket.emit('message:deleted', { messageId, deleteType });
            socket.to(`conv:${message.conversationId}`).emit('message:deleted', { messageId, deleteType });
            
            if (conversation.type !== 'community') {
                for (const participant of conversation.participants) {
                    if (participant.userId !== userId) {
                        const sockets = getSockets(participant.userId);
                        if (sockets) {
                            for (const sid of sockets) {
                                io.to(sid).emit('message:deleted', { messageId, deleteType, conversationId: conversation._id });
                            }
                        }
                    }
                }
            }
        } else if (deleteType === 1) {
            socket.emit('message:deleted', { messageId, deleteType });
            const sockets = getSockets(userId);
            if (sockets) {
                for (const sid of sockets) {
                    if (sid !== socket.id) {
                        io.to(sid).emit('message:deleted', { messageId, deleteType, conversationId: conversation._id });
                    }
                }
            }
        }
      } catch (err) {
        console.error('Message delete error:', err);
        socket.emit('message:error', { error: 'Failed to delete message' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`❌ User disconnected: ${username}`);
      removeSocket(userId, socket.id);
    });
  });
}

module.exports = chatHandler;
