const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const GroupUser = require('../models/GroupUser');
const Group = require('../models/Group');
const GroupMember = require('../models/GroupMember');
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
                const membership = await GroupMember.findOne({
                    groupId: conversation.groupId,
                    userId: userId,
                    status: 'approved'
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
        const { conversationId, content, messageType = 'text', tempId, replyTo, pollData } = parsedData;

        // For poll messages, content might be empty or same as question.
        if (!conversationId || (!content && messageType !== 'poll')) return;
       
        // Verify user is participant or has community access
        const conversation = await Conversation.findById(conversationId);

        if (!conversation) return;
        console.log(`[MESSAGE] Conversation:`, conversation);
        if (conversation.type === 'community') {
            const membership = await GroupUser.findOne({
                where: { group_id: conversation.communityId, user_id: userId, status: 1, is_active: 1 }
            });

            if (!membership) {
                console.warn(`User ${username} attempted to send message to community ${conversation.communityId} without permission.`);
                return socket.emit('message:error', { error: 'You are not a member of this community.' });
            }
        } else if (conversation.type === 'group') {
            const membership = await GroupMember.findOne({
                groupId: conversation.groupId,
                userId: userId,
                status: 'approved'
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
          content: content || (messageType === 'poll' ? 'Poll: ' + pollData?.question : ''),
          pollData: messageType === 'poll' ? pollData : undefined,
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

        // Notify participants who might be online but not in the room
        console.log(`[MESSAGE] Notifying participants who might be online but not in the room`);
        let recipientUserIds = [];

        if (conversation.type === 'group') {
            const members = await GroupMember.find({
                groupId: conversation.groupId,
                status: 'approved'
            });
            recipientUserIds = members
                .map((member) => member.userId)
                .filter((id) => id.toString() !== userId.toString());
        } else if (conversation.type === 'community') {
            const communityMemberships = await GroupUser.findAll({
                where: {
                    group_id: conversation.communityId,
                    status: 1,
                    is_active: 1
                }
            });
            recipientUserIds = communityMemberships
                .map((m) => m.user_id)
                .filter((id) => id.toString() !== userId.toString());
        } else {
            for (const participant of conversation.participants) {
                if (participant.userId.toString() !== userId.toString()) {
                    recipientUserIds.push(participant.userId);
                }
            }
        }
        console.log(`[MESSAGE] Recipient user ids before mute filter:`, recipientUserIds);

            // Filter out muted users from notification recipients
            const now = new Date();
            const mutedUserIds = new Set();
            
            if (conversation.type === 'group') {
                const members = await GroupMember.find({
                    groupId: conversation.groupId,
                    status: 'approved',
                    muteUntil: { $gt: now }
                });
                members.forEach(m => mutedUserIds.add(m.userId));
            } else if (conversation.participants && conversation.participants.length > 0) {
                conversation.participants.forEach(p => {
                    if (p.muteUntil && p.muteUntil > now) {
                        mutedUserIds.add(p.userId);
                    }
                });
            }

            recipientUserIds = recipientUserIds.filter(id => !mutedUserIds.has(id));
            console.log(`[MESSAGE] Recipient user ids after mute filter:`, recipientUserIds);

            // ── DIAGNOSTIC BLOCK ─────────────────────────────────────────────
            console.log(`[DIAG] typeof recipientUserIds        :`, typeof recipientUserIds);
            console.log(`[DIAG] Array.isArray(recipientUserIds):`, Array.isArray(recipientUserIds));
            console.log(`[DIAG] recipientUserIds.length        :`, recipientUserIds.length);
            console.log(`[DIAG] recipientUserIds constructor   :`, recipientUserIds?.constructor?.name);
            // Check for Promise (would display as object in console but .length === undefined)
            if (recipientUserIds instanceof Promise) {
              console.error(`[DIAG] recipientUserIds is a Promise! Forgot await somewhere above.`);
            }
            // Check for Set / Map (iterable but no .length, only .size)
            if (recipientUserIds instanceof Set || recipientUserIds instanceof Map) {
              console.error(`[DIAG] recipientUserIds is a ${recipientUserIds.constructor.name} — use Array.from() to convert!`);
            }
            // Verify each element's type (ObjectId vs string matters for Set.has() lookups)
            if (Array.isArray(recipientUserIds) && recipientUserIds.length > 0) {
              console.log(`[DIAG] First element value :`, recipientUserIds[0]);
              console.log(`[DIAG] First element type  :`, typeof recipientUserIds[0]);
              console.log(`[DIAG] First element is ObjectId:`, recipientUserIds[0]?.constructor?.name);
            }
            // ── END DIAGNOSTIC BLOCK ──────────────────────────────────────────

            // Isolate the socket-emit loop in its own try/catch so any error here
            // does NOT silently skip the push-notification block below.
            try {
              console.log(`[MESSAGE] Starting conversation:updated emit loop for ${recipientUserIds.length} recipients`);
              for (const recipientId of recipientUserIds) {
                const recipientIdStr = recipientId?.toString();
                console.log(`[MESSAGE] Looking up sockets for recipientId: ${recipientIdStr} (type: ${typeof recipientId})`);
                const sockets = getSockets(recipientIdStr);
                console.log(`[MESSAGE] getSockets result for ${recipientIdStr}:`, sockets, `| truthy:`, !!sockets);
                if (sockets) {
                  console.log(`[MESSAGE] sockets type: ${typeof sockets}, isArray: ${Array.isArray(sockets)}, constructor: ${sockets?.constructor?.name}`);
                  for (const sid of sockets) {
                    console.log(`[MESSAGE] Emitting conversation:updated to socket ${sid}`);
                    io.to(sid).emit('conversation:updated', {
                      conversationId,
                      lastMessage: messageData,
                      incrementUnread: true
                    });
                  }
                }
              }
              console.log(`[MESSAGE] conversation:updated emit loop completed`);
            } catch (emitLoopErr) {
              // Log the error but DO NOT re-throw — allow execution to continue
              // to the push notification block below.
              console.error(`[MESSAGE] Error inside conversation:updated emit loop:`, emitLoopErr);
              console.error(`[MESSAGE] Error stack:`, emitLoopErr.stack);
            }

            console.log(`[MESSAGE] Reached push notification gate. recipientUserIds.length = ${recipientUserIds.length}`);
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
                  conversationName: conversation.groupName || conversation.communityName || username,
                  chatData: {
                    chat_id: conversationId,
                    chat_type: conversation.type,
                    group_id: conversation.groupId ? conversation.groupId.toString() : (conversation.communityId ? conversation.communityId.toString() : ''),
                    message_id: message._id.toString(),
                    sender_id: userId,
                    sender_name: username,
                    message_content: message.content,
                    msg_type: message.messageType
                  }
                });
                console.log(`[NOTIFICATION] API Call Completed: sendChatNotification`);
              } catch (notifyErr) {
                console.error('[NOTIFICATION] Failed to trigger push notification:', notifyErr);
                console.error('[NOTIFICATION] Complete Error Stack Trace:', notifyErr.stack);
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

        // Find the new last message for the conversation globally
        const globalLastMessage = await Message.findOne({
            conversationId: conversation._id,
            isDeleted: false
        }).sort({ createdAt: -1 });

        if (globalLastMessage) {
            conversation.lastMessage = globalLastMessage._id;
            conversation.lastMessageTime = globalLastMessage.createdAt;
        } else {
            conversation.lastMessage = null;
        }
        await conversation.save();

        if (deleteType === 2) {
            socket.emit('message:deleted', { messageId, deleteType });
            socket.to(`conv:${message.conversationId}`).emit('message:deleted', { messageId, deleteType });

            const lastMsgData = globalLastMessage ? globalLastMessage.toObject() : null;
            socket.emit('conversation:updated', { conversationId: conversation._id.toString(), lastMessage: lastMsgData });
            socket.to(`conv:${conversation._id}`).emit('conversation:updated', { conversationId: conversation._id.toString(), lastMessage: lastMsgData });
            
            if (conversation.type !== 'community') {
                for (const participant of conversation.participants) {
                    if (participant.userId.toString() !== userId.toString()) {
                        const sockets = getSockets(participant.userId.toString());
                        if (sockets) {
                            for (const sid of sockets) {
                                io.to(sid).emit('message:deleted', { messageId, deleteType, conversationId: conversation._id });
                                io.to(sid).emit('conversation:updated', { conversationId: conversation._id.toString(), lastMessage: lastMsgData });
                            }
                        }
                    }
                }
            }
        } else if (deleteType === 1) {
            socket.emit('message:deleted', { messageId, deleteType });
            
            // For deleteType 1, find the last message visible specifically to this user
            const myLastMessage = await Message.findOne({
                conversationId: conversation._id,
                isDeleted: false,
                deleted_by: { $ne: userId }
            }).sort({ createdAt: -1 });
            const myLastMsgData = myLastMessage ? myLastMessage.toObject() : null;
            socket.emit('conversation:updated', { conversationId: conversation._id.toString(), lastMessage: myLastMsgData });

            const sockets = getSockets(userId);
            if (sockets) {
                for (const sid of sockets) {
                    if (sid !== socket.id) {
                        io.to(sid).emit('message:deleted', { messageId, deleteType, conversationId: conversation._id });
                        io.to(sid).emit('conversation:updated', { conversationId: conversation._id.toString(), lastMessage: myLastMsgData });
                    }
                }
            }
        }
      } catch (err) {
        console.error('Message delete error:', err);
        socket.emit('message:error', { error: 'Failed to delete message' });
      }
    });

    // React to Message
    socket.on('message:react', async (data) => {
      try {
        let parsedData;
        try {
          parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (err) {
          console.error('Invalid JSON:', data);
          return;
        }

        const { messageId, emoji } = parsedData;
        if (!messageId) return;

        const message = await Message.findById(messageId);
        if (!message) return;

        if (!message.reactions) message.reactions = {};

        if (emoji && emoji.trim() !== '') {
          message.reactions[userId.toString()] = emoji;
        } else {
          delete message.reactions[userId.toString()];
        }
        message.markModified('reactions');
        await message.save();

        const messageData = message.toObject();
        socket.emit('message:updated', messageData);
        socket.to(`conv:${message.conversationId}`).emit('message:updated', messageData);
      } catch (err) {
        console.error('Message react error:', err);
        socket.emit('message:error', { error: 'Failed to react to message' });
      }
    });

    // Poll Vote
    socket.on('message:poll_vote', async (data) => {
      try {
        let parsedData;
        try {
          parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (err) {
          console.error('Invalid JSON:', data);
          return;
        }

        const { messageId, optionIds } = parsedData; // optionIds is an array of option _id strings or indices, let's assume indices or option text
        if (!messageId || !optionIds || !Array.isArray(optionIds)) return;

        const message = await Message.findById(messageId);
        if (!message || message.messageType !== 'poll') return;

        const { pollData } = message;

        // Remove user's previous votes
        pollData.options.forEach(opt => {
          opt.votes = opt.votes.filter(id => id !== userId);
        });

        // Add new votes
        let votesAdded = 0;
        for (const optId of optionIds) {
           const option = pollData.options.find(o => (o._id && o._id.toString() === optId.toString()) || o.option === optId);
           if (option) {
              option.votes.push(userId);
              votesAdded++;
           }
           if (!pollData.allowMultiple && votesAdded >= 1) {
              break; // Only allow one vote if allowMultiple is false
           }
        }

        await message.save();

        const messageData = message.toObject();

        socket.emit('message:updated', messageData);
        socket.to(`conv:${message.conversationId}`).emit('message:updated', messageData);
        
      } catch (err) {
        console.error('Poll vote error:', err);
        socket.emit('message:error', { error: 'Failed to vote on poll' });
      }
    });

    // Mute Conversation
    socket.on('conversation:mute', async (data) => {
      try {
        let parsedData;
        try {
          parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (err) {
          console.error('Invalid JSON:', data);
          return;
        }

        const { conversationId, duration } = parsedData;
        if (!conversationId || !duration) return;

        let muteUntil;
        switch (duration) {
          case '1day':   muteUntil = new Date(Date.now() + 24*60*60*1000); break;
          case '1week':  muteUntil = new Date(Date.now() + 7*24*60*60*1000); break;
          case 'always': muteUntil = new Date('9999-12-31'); break;
          default: return;
        }

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return;

        if (conversation.type === 'group') {
            await GroupMember.updateOne(
                { groupId: conversation.groupId, userId },
                { $set: { muteUntil } }
            );
        } else {
            await Conversation.updateOne(
                { _id: conversationId, 'participants.userId': userId },
                { $set: { 'participants.$.muteUntil': muteUntil } }
            );
        }

        socket.emit('conversation:mute_updated', { conversationId, muteUntil });
      } catch (err) {
        console.error('Mute error:', err);
        socket.emit('message:error', { error: 'Failed to mute conversation' });
      }
    });

    // Unmute Conversation
    socket.on('conversation:unmute', async (data) => {
      try {
        let parsedData;
        try {
          parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (err) {
          console.error('Invalid JSON:', data);
          return;
        }

        const { conversationId } = parsedData;
        if (!conversationId) return;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return;

        if (conversation.type === 'group') {
            await GroupMember.updateOne(
                { groupId: conversation.groupId, userId },
                { $set: { muteUntil: null } }
            );
        } else {
            await Conversation.updateOne(
                { _id: conversationId, 'participants.userId': userId },
                { $set: { 'participants.$.muteUntil': null } }
            );
        }

        socket.emit('conversation:mute_updated', { conversationId, muteUntil: null });
      } catch (err) {
        console.error('Unmute error:', err);
        socket.emit('message:error', { error: 'Failed to unmute conversation' });
      }
    });

    // Group Chat Socket Events
    socket.on('group:create', async (data) => {
        try {
            let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { name, description, photoUrl, initialMembers } = parsedData;
            
            if (!name) return socket.emit('group:error', { error: 'Group name is required' });
            
            if (photoUrl && !photoUrl.startsWith('data:image/')) {
                return socket.emit('group:error', { error: 'Invalid image format. Must be a base64 string.' });
            }

            const conversation = new Conversation({ 
                type: 'group', 
                groupName: name, 
                photoUrl: photoUrl || null,
                participants: [], 
                status: 'accepted' 
            });
            await conversation.save();

            const group = new Group({
                name,
                description,
                photoUrl,
                createdBy: userId,
                conversationId: conversation._id
            });
            await group.save();

            conversation.groupId = group._id;
            await conversation.save();

            const members = [{
                groupId: group._id,
                userId: userId,
                role: 'admin',
                status: 'approved'
            }];

            if (Array.isArray(initialMembers)) {
                initialMembers.forEach(id => {
                    if (id !== userId) {
                        members.push({
                            groupId: group._id,
                            userId: id,
                            role: 'member',
                            status: 'pending'
                        });
                    }
                });
            }

            await GroupMember.insertMany(members);

            socket.join(`conv:${conversation._id}`);
            
            // Format the response to match Flutter frontend expectations
            const formattedConversation = {
                _id: conversation._id,
                type: 'group',
                groupName: group.name,
                photoUrl: group.photoUrl,
                participants: members.map(m => ({ userId: m.userId, status: m.status })),
                admins: members.filter(m => m.role === 'admin').map(m => m.userId),
                createdBy: userId,
                createdAt: conversation.createdAt || new Date()
            };
            
            socket.emit('group:created', { conversation: formattedConversation });

            // Notify invited members
            members.forEach(m => {
                if (m.status === 'pending') {
                    const sockets = getSockets(m.userId);
                    if (sockets) sockets.forEach(sid => io.to(sid).emit('group:invitation_received', { group }));
                }
            });
        } catch (err) {
            console.error('Group create error:', err);
            socket.emit('group:error', { error: 'Failed to create group' });
        }
    });

    socket.on('group:approve_request', async (data) => {
        try {
            let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { groupId, status } = parsedData; // 'approved' or 'rejected'

            if (!['approved', 'rejected'].includes(status)) return;

            const membership = await GroupMember.findOneAndUpdate(
                { groupId, userId, status: 'pending' },
                { status },
                { new: true }
            );

            if (!membership) return socket.emit('group:error', { error: 'Invitation not found' });

            if (status === 'approved') {
                const group = await Group.findById(groupId);
                if (group) {
                    socket.join(`conv:${group.conversationId}`);
                    io.to(`conv:${group.conversationId}`).emit('group:member_joined', { groupId, userId, username });
                }
            }
        } catch (err) {
            console.error('Group approve error:', err);
        }
    });

    socket.on('group:admin_add_members', async (data) => {
        try {
            let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { groupId, userIds } = parsedData;

            const adminCheck = await GroupMember.findOne({ groupId, userId, role: 'admin', status: 'approved' });
            if (!adminCheck) return socket.emit('group:error', { error: 'Only admins can add members' });

            const group = await Group.findById(groupId);
            if (!group) return;

            if (Array.isArray(userIds)) {
                const members = userIds.map(id => ({
                    groupId,
                    userId: id,
                    role: 'member',
                    status: 'pending'
                }));
                
                // Use insertMany with ordered: false to ignore duplicates
                try {
                    await GroupMember.insertMany(members, { ordered: false });
                } catch (e) {
                    // Ignore duplicate key errors
                }

                userIds.forEach(id => {
                    const sockets = getSockets(id);
                    if (sockets) sockets.forEach(sid => io.to(sid).emit('group:invitation_received', { group }));
                });
            }
        } catch (err) {
            console.error('Group add members error:', err);
        }
    });

    socket.on('group:admin_remove_member', async (data) => {
        try {
            let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { groupId, targetUserId } = parsedData;

            const adminCheck = await GroupMember.findOne({ groupId, userId, role: 'admin', status: 'approved' });
            if (!adminCheck) return socket.emit('group:error', { error: 'Only admins can remove members' });

            await GroupMember.deleteOne({ groupId, userId: targetUserId });
            
            const group = await Group.findById(groupId);
            if (group) {
                io.to(`conv:${group.conversationId}`).emit('group:member_removed', { groupId, userId: targetUserId });
                
                const sockets = getSockets(targetUserId);
                if (sockets) sockets.forEach(sid => {
                    io.sockets.sockets.get(sid)?.leave(`conv:${group.conversationId}`);
                });
            }
        } catch (err) {
            console.error('Group remove member error:', err);
        }
    });

    socket.on('group:admin_make_admin', async (data) => {
        try {
            let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { groupId, targetUserId } = parsedData;

            const adminCheck = await GroupMember.findOne({ groupId, userId, role: 'admin', status: 'approved' });
            if (!adminCheck) return socket.emit('group:error', { error: 'Only admins can make other members admin' });

            await GroupMember.updateOne({ groupId, userId: targetUserId }, { $set: { role: 'admin' } });
            
            const group = await Group.findById(groupId);
            if (group) {
                io.to(`conv:${group.conversationId}`).emit('group:member_updated', { groupId, userId: targetUserId, role: 'admin' });
            }
        } catch (err) {
            console.error('Group make admin error:', err);
        }
    });

    socket.on('group:admin_remove_admin', async (data) => {
        try {
            let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { groupId, targetUserId } = parsedData;

            const adminCheck = await GroupMember.findOne({ groupId, userId, role: 'admin', status: 'approved' });
            if (!adminCheck) return socket.emit('group:error', { error: 'Only admins can remove admin status' });

            await GroupMember.updateOne({ groupId, userId: targetUserId }, { $set: { role: 'member' } });

            const group = await Group.findById(groupId);
            if (group) {
                io.to(`conv:${group.conversationId}`).emit('group:member_updated', { groupId, userId: targetUserId, role: 'member' });
            }
        } catch (err) {
            console.error('Group remove admin error:', err);
        }
    });

    socket.on('group:admin_block_member', async (data) => {
        try {
            let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { groupId, targetUserId } = parsedData;

            const adminCheck = await GroupMember.findOne({ groupId, userId, role: 'admin', status: 'approved' });
            if (!adminCheck) return socket.emit('group:error', { error: 'Only admins can block members' });

            await GroupMember.updateOne(
                { groupId, userId: targetUserId }, 
                { status: 'blocked', blockedAt: new Date() }
            );
            
            const group = await Group.findById(groupId);
            if (group) {
                io.to(`conv:${group.conversationId}`).emit('group:member_updated', { groupId, userId: targetUserId, status: 'blocked' });
                
                // Optionally remove from room so they don't get live new messages
                const sockets = getSockets(targetUserId);
                if (sockets) sockets.forEach(sid => {
                    io.sockets.sockets.get(sid)?.leave(`conv:${group.conversationId}`);
                });
            }
        } catch (err) {
            console.error('Group block member error:', err);
        }
    });

    socket.on('group:leave', async (data) => {
        try {
            let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { groupId } = parsedData;

            await GroupMember.deleteOne({ groupId, userId });
            
            const group = await Group.findById(groupId);
            if (group) {
                io.to(`conv:${group.conversationId}`).emit('group:member_removed', { groupId, userId });
                socket.leave(`conv:${group.conversationId}`);
            }
        } catch (err) {
            console.error('Group leave error:', err);
        }
    });

    socket.on('group:edit', async (data) => {
        try {
            let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { groupId, name } = parsedData;

            const adminCheck = await GroupMember.findOne({ groupId, userId, role: 'admin', status: 'approved' });
            if (!adminCheck) return socket.emit('group:error', { error: 'Only admins can edit group details' });

            const group = await Group.findByIdAndUpdate(groupId, { name }, { returnDocument: 'after' });
            if (group) {
                await Conversation.updateOne({ _id: group.conversationId }, { $set: { groupName: name } });
                io.to(`conv:${group.conversationId}`).emit('group:updated', { groupId, name, conversationId: group.conversationId });
                
                // Force a conversation update for all members so the chat list updates in real-time
                const members = await GroupMember.find({ groupId: group._id, status: 'approved' });
                for (const member of members) {
                    const sockets = getSockets(member.userId);
                    if (sockets) {
                        for (const sid of sockets) {
                            io.to(sid).emit('conversation:updated', {
                                conversationId: group.conversationId,
                                groupName: name,
                                incrementUnread: false
                            });
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Group edit error:', err);
        }
    });

    socket.on('group:editImage', async (data) => {
        try {
            let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { groupId, base64Image } = parsedData;
             console.log('entery point 1');   
            if (!base64Image || !base64Image.startsWith('data:image/')) {
                return socket.emit('group:error', { error: 'Invalid image format. Must be a base64 string.' });
            }
 console.log('entery point 2');
            const adminCheck = await GroupMember.findOne({ groupId, userId, role: 'admin', status: 'approved' });
            if (!adminCheck) return socket.emit('group:error', { error: 'Only admins can update the group image' });
 console.log('entery point 3');
            const group = await Group.findByIdAndUpdate(groupId, { photoUrl: base64Image }, { returnDocument: 'after' });
            if (group) {
                await Conversation.updateOne({ _id: group.conversationId }, { $set: { photoUrl: base64Image } });
                 console.log('entery point 4');
                // Emit to the conversation room
                io.to(`conv:${group.conversationId}`).emit('group:updated', { 
                    groupId, 
                    name: group.name, 
                    photoUrl: base64Image, 
                    conversationId: group.conversationId 
                });
                 console.log('entery point 5');
                // Force a conversation update for all members so the chat list updates in real-time
                const members = await GroupMember.find({ groupId: group._id, status: 'approved' });
                for (const member of members) {
                    const sockets = getSockets(member.userId);
                    if (sockets) {
                        for (const sid of sockets) {
                            io.to(sid).emit('conversation:updated', {
                                conversationId: group.conversationId,
                                groupName: group.name,
                                photoUrl: base64Image,
                                incrementUnread: false
                            });
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Group editImage error:', err);
            socket.emit('group:error', { error: 'Failed to update group image' });
        }
    });

    // Mark all messages in a conversation as read for this user.
    // Private: updates participants[].lastRead timestamp.
    // Group:   updates GroupMember.lastReadMessageId to the latest message.
    socket.on('messages:read', async (data) => {
        try {
            let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { conversationId } = parsedData;
            if (!conversationId) return;

            const conversation = await Conversation.findById(conversationId);
            if (!conversation) return;

            if (conversation.type === 'private') {
                await Conversation.updateOne(
                    { _id: conversationId, 'participants.userId': userId },
                    { $set: { 'participants.$.lastRead': new Date() } }
                );
                console.log(`✅ messages:read — private conv ${conversationId}, user ${userId}`);
            } else if (conversation.type === 'group' && conversation.groupId) {
                const latestMsg = await Message.findOne(
                    { conversationId },
                    { _id: 1 },
                    { sort: { createdAt: -1 } }
                ).lean();
                if (latestMsg) {
                    await GroupMember.updateOne(
                        { groupId: conversation.groupId, userId },
                        { $set: { lastReadMessageId: latestMsg._id } }
                    );
                    console.log(`✅ messages:read — group conv ${conversationId}, user ${userId}, lastMsg ${latestMsg._id}`);
                }
            } else if (conversation.type === 'community' && conversation.communityId) {
                await GroupUser.update(
                    { last_seen_at: new Date() },
                    { where: { group_id: conversation.communityId, user_id: userId } }
                );
                console.log(`✅ messages:read — community conv ${conversationId}, user ${userId}`);
            }
        } catch (err) {
            console.error('messages:read error:', err);
        }

        // Emit read receipt to the conversation room so other users' clients can update the UI (e.g., turn ticks blue)
        try {
            socket.to(`conv:${parsedData?.conversationId}`).emit('messages:read_receipt', {
                conversationId: parsedData?.conversationId,
                userId: userId,
                readAt: new Date()
            });
        } catch (err) {
            console.error('messages:read_receipt emit error:', err);
        }
    });

    // ─── Group Request Flow ────────────────────────────────────────────────────

    // User submits a group creation request (goes for admin approval)
    socket.on('group:request_create', async (data, callback) => {
        try {
            let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { group_name, description } = parsedData;

            if (!group_name || !group_name.trim()) {
                if (typeof callback === 'function') return callback({ success: false, message: 'Group name is required' });
                return socket.emit('group:error', { error: 'Group name is required' });
            }

            const GroupRequest = require('../models/GroupRequest');

            const request = await GroupRequest.create({
                group_name: group_name.trim(),
                description: description || null,
                requested_by: userId,
                requested_by_name: username,
                status: 'pending',
            });

            // Notify the requester that the request was submitted
            socket.emit('group:request_submitted', {
                requestId: request.id,
                group_name: request.group_name,
                status: 'pending',
            });

            // Broadcast to all connected admin sockets (role_id passed via handshake auth)
            // The admin client should join room 'admin:group_requests' on connect.
            io.to('admin:group_requests').emit('group:request_received', {
                requestId: request.id,
                group_name: request.group_name,
                description: request.description,
                requested_by: userId,
                requested_by_name: username,
                status: 'pending',
                created_at: request.created_at,
            });

            if (typeof callback === 'function') {
                callback({ success: true, message: 'Group request submitted for approval', requestId: request.id });
            }
        } catch (err) {
            console.error('group:request_create error:', err);
            if (typeof callback === 'function') callback({ success: false, message: err.message });
            else socket.emit('group:error', { error: 'Failed to submit group request' });
        }
    });

    // Admin joins the admin notification room to receive new request notifications
    socket.on('admin:join_requests_room', () => {
        socket.join('admin:group_requests');
        console.log(`✅ Admin ${userId} joined admin:group_requests room`);
    });

    // Admin approves or rejects a group creation request
    socket.on('updateGroupRequestStatus', async (data, callback) => {
        try {
            let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { requestId, status, reason } = parsedData;

            if (!requestId || !['approved', 'rejected'].includes(status)) {
                if (typeof callback === 'function') return callback({ success: false, message: 'Invalid request data' });
                return;
            }

            const GroupRequest = require('../models/GroupRequest');
            const groupRequest = await GroupRequest.findByPk(requestId);
            if (!groupRequest) {
                if (typeof callback === 'function') return callback({ success: false, message: 'Request not found' });
                return;
            }

            if (groupRequest.status !== 'pending') {
                if (typeof callback === 'function') return callback({ success: false, message: 'Request already processed' });
                return;
            }

            groupRequest.status = status;
            groupRequest.updated_by = userId;
            groupRequest.updated_at = new Date();
            if (status === 'rejected' && reason) groupRequest.rejection_reason = reason;

            let createdGroupMasterId = null;

            if (status === 'approved') {
                // Create entry in MySQL GroupMaster
                const GroupMasterModel = require('../models/GroupMaster');
                const GroupUserModel = require('../models/GroupUser');

                const newGroup = await GroupMasterModel.create({
                    group_name: groupRequest.group_name,
                    description: groupRequest.description,
                    is_active: 1,
                    created_by: groupRequest.requested_by,
                    created_by_name: groupRequest.requested_by_name,
                    created_at: new Date(),
                });

                createdGroupMasterId = newGroup.group_id;

                // Add requester as admin of the new group
                await GroupUserModel.create({
                    group_id: newGroup.group_id,
                    user_id: groupRequest.requested_by,
                    role: 1, // admin
                    status: 1, // approved
                    joined_at: new Date(),
                    is_active: 1,
                    created_by: userId,
                    created_at: new Date(),
                });

                groupRequest.group_id = newGroup.group_id;
            }

            await groupRequest.save();

            // Notify the original requester via their socket(s)
            const requesterSockets = getSockets(groupRequest.requested_by);
            if (requesterSockets) {
                const notifyPayload = {
                    requestId: groupRequest.id,
                    group_name: groupRequest.group_name,
                    status,
                    rejection_reason: status === 'rejected' ? reason : null,
                    group_id: createdGroupMasterId,
                    approved_by: username,
                };
                for (const sid of requesterSockets) {
                    io.to(sid).emit('group:request_status_updated', notifyPayload);
                }
            }

            // Acknowledge to admin
            if (typeof callback === 'function') {
                callback({
                    success: true,
                    message: `Group request successfully ${status}`,
                    data: {
                        requestId: groupRequest.id,
                        group_name: groupRequest.group_name,
                        status,
                        group_id: createdGroupMasterId,
                    },
                });
            }
        } catch (err) {
            console.error('updateGroupRequestStatus error:', err);
            if (typeof callback === 'function') callback({ success: false, message: err.message });
        }
    });

    // ──────────────────────────────────────────────────────────────────────────

    socket.on('disconnect', () => {
      console.log(`❌ User disconnected: ${username}`);
      removeSocket(userId, socket.id);
    });
  });
}

module.exports = chatHandler;
