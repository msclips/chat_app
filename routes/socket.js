const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getSockets, addSocket } = require('../socket/socketManager');

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
 * POST /api/socket/connect
 */
router.post('/connect', (req, res) => {
  // Parse userId to a number if it is numeric (Map keys are type-sensitive: 1 !== "1")
  const userId = req.body.id ? (isNaN(req.body.id) ? req.body.id : Number(req.body.id)) : null;
  const username = req.body.user_name;
  
  console.log('Checking/generating socket connection for:', userId, username);
  
  if (!userId) {
    return res.status(400).json({
      error: 'User ID is missing.',
    });
  }

  const sockets = getSockets(userId);
  let socketId;

  if (sockets && sockets.size > 0) {
    // Pick the existing active socket ID
    socketId = [...sockets].at(-1);
    
    return res.json({
      connected: true,
      socketId,
      userId,
      username,
      message: 'Active socket session found. Use this socketId directly.',
    });
  }

  // Generate a unique 20-character socket ID on the fly, register it, and return it
  socketId = 'mock_socket_' + crypto.randomBytes(8).toString('hex');
  addSocket(userId, socketId);

  res.json({
    connected: true, // Mark as connected now that we generated and registered it!
    socketId,
    userId,
    username,
    message: 'New socket ID generated and registered successfully.',
  });
});

/**
 * GET /api/socket/status
 */
router.get('/status', (req, res) => {
  const currentUser = getRequestUser(req);
  const sockets = getSockets(currentUser.id);

  if (sockets && sockets.size > 0) {
    return res.json({
      online: true,
      socketIds: [...sockets],
      activeConnections: sockets.size,
    });
  }

  res.json({
    online: false,
    socketIds: [],
    activeConnections: 0,
  });
});

module.exports = router;
