const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const Message = require('../models/Message');
const GroupUser = require('../models/GroupUser');
const GroupMember = require('../models/GroupMember');
const Group = require('../models/Group');

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
    const communityMemberships = await GroupUser.findAll({
      where: {
        user_id: currentUser.id,
        status: 1,
        is_active: 1
      }
    });

    const communityIds = communityMemberships.map((m) => m.group_id);

    const groupMemberships = await GroupMember.find({
      userId: currentUser.id,
      status: { $in: ['approved', 'pending', 'blocked'] }
    });
    const mongoGroupIds = groupMemberships.map((m) => m.groupId);

    const filters = [
      {
        'participants.userId': currentUser.id
      }
    ];

    if (mongoGroupIds.length > 0) {
      filters.push({
        type: 'group',
        groupId: { $in: mongoGroupIds },
        status: { $ne: 'blocked' }
      });
    }

    if (communityIds.length > 0) {
      filters.push({
        type: 'community',
        communityId: { $in: communityIds },
        status: { $ne: 'blocked' }
      });
    }

    const conversations = await Conversation.find({ $or: filters }).populate('lastMessage').sort({ updatedAt: -1 }).lean();

    // ── Enrich group conversations with member data ──────────────────────────
    const groupConvs = conversations.filter(c => c.type === 'group' && c.groupId);

    if (groupConvs.length > 0) {
      const allGroupIds = groupConvs.map(c => c.groupId);

      // Batch fetch all GroupMember records (all statuses) for these groups
      const allMembers = await GroupMember.find({
        groupId: { $in: allGroupIds },
        status: { $in: ['approved', 'pending', 'blocked'] }
      }).lean();

      // Batch fetch Group documents for createdBy
      const groupDocs = await Group.find({ _id: { $in: allGroupIds } }).select('_id createdBy photoUrl').lean();
      const groupCreatedByMap = {};
      const groupPhotoMap = {};
      groupDocs.forEach(g => {
        groupCreatedByMap[g._id.toString()] = g.createdBy;
        groupPhotoMap[g._id.toString()] = g.photoUrl || null;
      });

      // Collect all unique member userIds for username lookup
      const memberUserIds = [...new Set(allMembers.map(m => m.userId))];
      const memberUsers = memberUserIds.length > 0
        ? await User.findAll({ where: { user_id: memberUserIds }, attributes: ['user_id', 'user_name'] })
        : [];
      const memberUserNameMap = {};
      memberUsers.forEach(u => { memberUserNameMap[u.user_id] = u.user_name; });

      // Build per-group member index
      const membersByGroup = {};
      allMembers.forEach(m => {
        const gId = m.groupId.toString();
        if (!membersByGroup[gId]) membersByGroup[gId] = [];
        membersByGroup[gId].push(m);
      });

      // Enrich each group conversation
      for (const conv of conversations) {
        if (conv.type === 'group' && conv.groupId) {
          const gId = conv.groupId.toString();
          const members = membersByGroup[gId] || [];

          // Current user's membership status
          const myMembership = groupMemberships.find(m => m.groupId.toString() === gId);
          if (myMembership) conv.groupMemberStatus = myMembership.status;

          // Full participant list with names, status, muteUntil
          conv.participants = members.map(m => ({
            userId: m.userId,
            username: memberUserNameMap[m.userId] || ('User ' + m.userId),
            status: m.status,
            muteUntil: m.muteUntil || null
          }));

          // Admins list (array of userId strings, matches what Flutter expects)
          conv.admins = members
            .filter(m => m.role === 'admin')
            .map(m => m.userId.toString());

          conv.createdBy = groupCreatedByMap[gId] ?? null;
          conv.photoUrl = groupPhotoMap[gId] ?? null;

          // Unread count for the current user: messages after their lastReadMessageId
          const myMember = members.find(m => m.userId === currentUser.id);
          
          let unreadQuery = {
            conversationId: conv._id,
            senderId: { $ne: currentUser.id }, // exclude own messages
            delete_type: { $ne: 2 },
            deleted_by: { $ne: currentUser.id }
          };

          if (myMember && myMember.lastReadMessageId) {
            const lastReadMsg = await Message.findById(myMember.lastReadMessageId).select('createdAt').lean();
            if (lastReadMsg) {
              unreadQuery.createdAt = { $gt: lastReadMsg.createdAt };
            }
          }

          const unread = await Message.countDocuments(unreadQuery);
          conv.unreadCounts = { [currentUser.id.toString()]: unread };
        }
      }
    }
    // ── End enrichment ───────────────────────────────────────────────────────

    // ── Calculate unread counts for private & community conversations ──────────
    const privateOrCommunityConvs = conversations.filter(c => c.type === 'private' || c.type === 'community');
    await Promise.all(privateOrCommunityConvs.map(async (conv) => {
      const unreadQuery = {
        conversationId: conv._id,
        senderId: { $ne: currentUser.id },   // exclude own messages
        delete_type: { $ne: 2 },
        deleted_by: { $ne: currentUser.id }
      };

      if (conv.type === 'private') {
        const myParticipant = conv.participants?.find(p => p.userId === currentUser.id);
        const otherParticipant = conv.participants?.find(p => p.userId !== currentUser.id);
        
        if (otherParticipant) {
          try {
            const otherUser = await User.findByPk(otherParticipant.userId, { attributes: ['file_path'] });
            if (otherUser && otherUser.file_path && otherUser.file_path !== 'null') {
              const baseUrl = process.env.GET_LIVE_CURRENT_URL || 'http://localhost:5000';
              conv.photoUrl = `${baseUrl}/resources/${otherUser.file_path}`;
            }
          } catch (e) {
            console.error('Failed to get other user photoUrl', e);
          }
        }
        
        if (myParticipant?.lastRead) {
          unreadQuery.createdAt = { $gt: myParticipant.lastRead };
        }
      } else if (conv.type === 'community') {
        try {
          const GroupMaster = require('../models/GroupMaster');
          const NgoMaster = require('../models/NgoMaster');
          const group = await GroupMaster.findByPk(conv.communityId, { attributes: ['ngo_id'] });
          if (group && group.ngo_id) {
            const ngo = await NgoMaster.findByPk(group.ngo_id, { attributes: ['ngo_logo_path'] });
            if (ngo && ngo.ngo_logo_path && ngo.ngo_logo_path !== 'null') {
              const baseUrl = process.env.GET_LIVE_CURRENT_URL || 'http://localhost:5000';
              conv.photoUrl = `${baseUrl}/resources/${ngo.ngo_logo_path}`;
            }
          }
        } catch (e) {
          console.error('Failed to get community ngo logo path', e);
        }

        // Use communityMemberships fetched at the top of the route
        const myMembership = communityMemberships.find(m => m.group_id === conv.communityId);
        if (myMembership?.last_seen_at) {
          unreadQuery.createdAt = { $gt: myMembership.last_seen_at };
        }
      }

      const unread = await Message.countDocuments(unreadQuery);
      if (!conv.unreadCounts) conv.unreadCounts = {};
      conv.unreadCounts[currentUser.id.toString()] = unread;
    }));
    // ─────────────────────────────────────────────────────────────────────────

    // ── Update lastMessage if it was deleted by this user ─────────────────────────
    for (const conv of conversations) {
      if (conv.lastMessage) {
        const isDeletedForEveryone = conv.lastMessage.delete_type === 2;
        const isDeletedForMe = conv.lastMessage.deleted_by && conv.lastMessage.deleted_by.includes(currentUser.id);
        
        if (isDeletedForEveryone || isDeletedForMe) {
          const actualLastMsg = await Message.findOne({
            conversationId: conv._id,
            isDeleted: false,
            deleted_by: { $ne: currentUser.id }
          }).sort({ createdAt: -1 }).lean();
          conv.lastMessage = actualLastMsg || null;
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

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

    let messageQuery = {
      conversationId: req.params.id,
      delete_type: { $ne: 2 },
      deleted_by: { $ne: currentUser.id }
    };

    if (conversation.type === 'group' && conversation.groupId) {
      const membership = await GroupMember.findOne({ groupId: conversation.groupId, userId: currentUser.id });
      if (membership && membership.status === 'blocked' && membership.blockedAt) {
        messageQuery.createdAt = { $lt: membership.blockedAt };
      }
    }

    const messages = await Message.find(messageQuery)
      .populate('replyTo', 'senderName content')
      .sort({ createdAt: -1 }) // Newest first to get the latest 50
      .limit(50);
    console.log(`Found ${messages.length} messages`);
    res.json(messages.reverse());
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

// Block an accepted conversation
router.post('/:id/block', async (req, res) => {
  const currentUser = getRequestUser(req);
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    if (conversation.type !== 'private') {
      return res.status(400).json({ message: 'Can only block private conversations directly' });
    }

    if (conversation.status === 'blocked' && conversation.blockedBy === currentUser.id) {
      return res.status(400).json({ message: 'Already blocked' });
    }

    conversation.status = 'blocked';
    conversation.blockedBy = currentUser.id;
    await conversation.save();

    res.json({ success: true, conversation });
  } catch (err) {
    console.error('Block error:', err);
    res.status(500).send('Server Error');
  }
});

// Unblock a conversation
router.post('/:id/unblock', async (req, res) => {
  const currentUser = getRequestUser(req);
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    if (conversation.type !== 'private') {
      return res.status(400).json({ message: 'Can only unblock private conversations directly' });
    }

    if (conversation.status !== 'blocked') {
      return res.status(400).json({ message: 'Conversation is not blocked' });
    }

    if (conversation.blockedBy !== currentUser.id) {
      return res.status(403).json({ message: 'You are not the one who blocked this conversation' });
    }

    conversation.status = 'accepted';
    conversation.blockedBy = null;
    await conversation.save();

    res.json({ success: true, conversation });
  } catch (err) {
    console.error('Unblock error:', err);
    res.status(500).send('Server Error');
  }
});

// Get group info and members for a conversation
router.get('/:id/groupInfo', async (req, res) => {
  const currentUser = getRequestUser(req);
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    let groupDetails = {};
    let members = [];
    
    // Fetch all user details to map names
    const allUsers = await User.findAll({ attributes: ['user_id', 'user_name'] });
    const userMap = {};
    allUsers.forEach(u => userMap[u.user_id] = u.user_name);

    if (conversation.type === 'group') {
      const Group = require('../models/Group');
      const group = await Group.findById(conversation.groupId);
      if (!group) return res.status(404).json({ message: 'Group not found' });
      
      groupDetails = {
        name: group.name,
        description: group.description,
        photoUrl: group.photoUrl || null,
        groupId: group._id,
        isCommunity: false
      };

      const memberships = await GroupMember.find({ groupId: group._id });
      members = memberships.map(m => ({
        userId: m.userId,
        username: userMap[m.userId] || 'User ' + m.userId,
        role: m.role,
        status: m.status
      }));

    } else if (conversation.type === 'community') {
      const GroupMaster = require('../models/GroupMaster');
      const NgoMaster = require('../models/NgoMaster');
      const group = await GroupMaster.findByPk(conversation.communityId);
      if (!group) return res.status(404).json({ message: 'Community not found' });
      
      let photoUrl = group.image_path || null;
      if (group.ngo_id) {
        try {
          const ngo = await NgoMaster.findByPk(group.ngo_id, { attributes: ['ngo_logo_path'] });
          if (ngo && ngo.ngo_logo_path && ngo.ngo_logo_path !== 'null') {
            const baseUrl = process.env.GET_LIVE_CURRENT_URL || 'http://localhost:5000';
            photoUrl = `${baseUrl}/resources/${ngo.ngo_logo_path}`;
          }
        } catch (e) {
          console.error('Failed to get community info ngo logo path', e);
        }
      }
      
      groupDetails = {
        name: group.group_name,
        description: group.description,
        photoUrl: photoUrl,
        groupId: group.group_id,
        isCommunity: true
      };

      const memberships = await GroupUser.findAll({ where: { group_id: group.group_id, is_active: 1 } });
      members = memberships.map(m => ({
        userId: m.user_id,
        username: userMap[m.user_id] || 'User ' + m.user_id,
        role: m.role === 1 ? 'admin' : 'member',
        status: m.status === 1 ? 'approved' : 'pending'
      }));
    } else {
      return res.status(400).json({ message: 'Not a group conversation' });
    }

    res.json({ group: groupDetails, members });
  } catch (err) {
    console.error('Group Info error:', err);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
