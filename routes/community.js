const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const GroupMaster = require('../models/GroupMaster');
const GroupUser = require('../models/GroupUser');
const Conversation = require('../models/Conversation');
const { authMiddleware } = require('../middleware/authMiddleware');

// Get all communities
router.get('/', authMiddleware, async (req, res) => {
    try {
        console.log('Fetching communities for user:', req.user.id);
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
router.post('/:groupId/init', authMiddleware, async (req, res) => {
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
            where: { group_id: groupId, user_id: req.user.id }
        });

        res.json({ 
            conversation, 
            isMember: !!membership 
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Check membership status
router.get('/:groupId/membership', authMiddleware, async (req, res) => {
    try {
        const membership = await GroupUser.findOne({
            where: {
                group_id: req.params.groupId,
                user_id: req.user.id
            }
        });
        res.json({ isMember: !!membership });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
