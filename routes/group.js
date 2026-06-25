const express = require('express');
const router = express.Router();
const GroupMaster = require('../models/GroupMaster');
const GroupUser = require('../models/GroupUser');
const Conversation = require('../models/Conversation');
const GroupRequest = require('../models/GroupRequest');
const { Op } = require('sequelize');

function getRequestUser(req) {
  const userId = req.headers['x-user-id'] || req.body.userId || req.query.userId || req.body.id || req.query.id;
  const username = req.headers['x-user-name'] || req.body.username || req.query.username || req.body.user_name || req.query.user_name;

  return {
    id: userId ? (isNaN(userId) ? userId : Number(userId)) : 1,
    user_name: username || 'Guest'
  };
}

// Get all groups the current user belongs to
router.get('/', async (req, res) => {
  const currentUser = getRequestUser(req);
  try {
    const memberships = await GroupUser.findAll({
      where: {
        user_id: currentUser.id,
        status: 1,
        is_active: 1
      }
    });

    const groupIds = memberships.map(m => m.group_id);
    if (groupIds.length === 0) {
      return res.json([]);
    }

    const groups = await GroupMaster.findAll({
      where: { group_id: groupIds }
    });

    res.json(groups);
  } catch (err) {
    console.error('Error fetching groups:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get group details and membership
router.get('/:groupId', async (req, res) => {
  const currentUser = getRequestUser(req);
  try {
    const group = await GroupMaster.findByPk(req.params.groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const membership = await GroupUser.findOne({
      where: {
        group_id: req.params.groupId,
        user_id: currentUser.id
      }
    });

    res.json({ group, isMember: !!membership });
  } catch (err) {
    console.error('Error fetching group details:', err);
    res.status(500).json({ message: err.message });
  }
});

// Create or get a group conversation for the current user
router.post('/:groupId/conversation', async (req, res) => {
  const currentUser = getRequestUser(req);
  try {
    const { groupId } = req.params;
    const group = await GroupMaster.findByPk(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const membership = await GroupUser.findOne({
      where: {
        group_id: groupId,
        user_id: currentUser.id,
        status: 1,
        is_active: 1
      }
    });

    if (!membership) {
      return res.status(403).json({ message: 'You are not a member of this group.' });
    }

    let conversation = await Conversation.findOne({
      type: 'group',
      groupId: Number(groupId)
    });

    if (!conversation) {
      conversation = new Conversation({
        type: 'group',
        groupId: Number(groupId),
        groupName: group.group_name,
        participants: [
          { userId: currentUser.id, username: currentUser.user_name }
        ]
      });
      await conversation.save();
    }

    res.json({ conversation, isMember: true });
  } catch (err) {
    console.error('Error creating group conversation:', err);
    res.status(500).json({ message: err.message });
  }
});

// Check membership status for a group
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
    console.error('Error checking group membership:', err);
    res.status(500).json({ message: err.message });
  }
});

// ─── Group Request Endpoints ──────────────────────────────────────────────────

// GET /api/groups/requests?status=pending  (admin use)
router.get('/requests', async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const where = ['pending', 'approved', 'rejected'].includes(status)
      ? { status }
      : {};

    const requests = await GroupRequest.findAll({
      where,
      order: [['created_at', 'DESC']],
    });

    res.json(requests);
  } catch (err) {
    console.error('Error fetching group requests:', err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/groups/requests/my  — requests by the current user
router.get('/requests/my', async (req, res) => {
  const currentUser = getRequestUser(req);
  try {
    const requests = await GroupRequest.findAll({
      where: { requested_by: currentUser.id },
      order: [['created_at', 'DESC']],
    });
    res.json(requests);
  } catch (err) {
    console.error('Error fetching user group requests:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
