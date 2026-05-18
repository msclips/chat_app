const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const User = require('../models/User');

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

/**
 * POST /api/users/login
 *
 * Passwordless join/registration endpoint.
 */
router.post('/login', async (req, res) => {
  const { user_name } = req.body;

  if (!user_name) {
    return res.status(400).json({ message: 'Username is required' });
  }

  try {
    let user = await User.findOne({ where: { user_name }, raw: true });

    if (!user) {
      user = await User.create({
        user_name,
        password: 'nopassword' // dummy password to satisfy database constraint
      });
      user = user.get({ plain: true });
    }

    res.json({
      user: { id: user.user_id, user_name: user.user_name }
    });
  } catch (err) {
    console.error('Passwordless login error:', err);
    res.status(500).send('Server Error');
  }
});

/**
 * GET /api/users
 *
 * Fetch all registered users except the current one.
 */
router.get('/', async (req, res) => {
  const currentUser = getRequestUser(req);
  try {
    const users = await User.findAll({
      where: {
        user_id: { [Op.ne]: currentUser.id }
      },
      attributes: [['user_id', 'id'], ['user_name', 'user_name']],
      raw: true
    });
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
