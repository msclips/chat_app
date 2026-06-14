const express = require('express');
const router = express.Router();
const GroupMaster = require('../models/GroupMaster');
const GroupUser = require('../models/GroupUser');
const Conversation = require('../models/Conversation');

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

// Get all communities
router.get('/', async (req, res) => {
    const currentUser = getRequestUser(req);
    try {
        console.log('Fetching communities for user:', currentUser.id);
        const communities = await GroupMaster.findAll({
            where: { category: 'community' }
        });
        
        console.log('Filtered communities found:', communities.length);
        res.json(communities);
    } catch (err) {
        console.error('Error fetching communities:', err);
        res.status(500).json({ message: err.message });
    }
});

// Get or Create Community Conversation
router.post('/:groupId/init', async (req, res) => {
    const currentUser = getRequestUser(req);
    try {
        const { groupId } = req.params;
        const group = await GroupMaster.findByPk(groupId);
        
        if (!group) {
            return res.status(404).json({ message: 'Community not found' });
        }

        let conversation = await Conversation.findOne({
            type: 'community',
            communityId: groupId
        });

        if (!conversation) {
            conversation = new Conversation({
                type: 'community',
                communityId: groupId,
                communityName: group.group_name,
                participants: [] 
            });
            await conversation.save();
        }

        // Check membership
        const membership = await GroupUser.findOne({
            where: { group_id: groupId, user_id: currentUser.id }
        });

        // Add user to participants with default mute if not already there and is a member
        const userParticipant = conversation.participants.find(p => p.userId === currentUser.id);
        if (!userParticipant && membership) {
            conversation.participants.push({
                userId: currentUser.id,
                username: currentUser.user_name,
                muteUntil: new Date('9999-12-31') // Muted by default
            });
            await conversation.save();
        }

        res.json({ 
            conversation, 
            isMember: !!membership 
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Check membership status
router.get('/:groupId/membership', async (req, res) => {
    const currentUser = getRequestUser(req);
    try {
        const membership = await GroupUser.findOne({
            where: {
                group_id: req.params.groupId,
                user_id: currentUser.id
            }
        });
        res.json({ isMember: !!membership });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
