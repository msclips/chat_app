const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/authMiddleware');

// Login Route
router.post('/login', async (req, res) => {
  const { user_name, password } = req.body;

  try {
    const user = await User.findOne({ where:  { user_name },  raw: true });

    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    // Checking plain text password as per user requirements
    // In a real app, use bcrypt.compare()
    if (password !== user.password) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.user_id, user_name: user.user_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: { id: user.user_id, user_name: user.user_name }
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Get all users except current
router.get('/users', authMiddleware, async (req, res) => {
  try {
    const users = await User.findAll({
      where: {
        user_id: { [Op.ne]: req.user.id }
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

