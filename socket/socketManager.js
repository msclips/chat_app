/**
 * socketManager.js
 *
 * Shared in-memory store for tracking active user socket connections.
 * Imported by both chatHandler (to register/remove sockets on connect/disconnect)
 * and the socket REST route (to look up socket IDs for a given user).
 *
 * Structure:
 *   userSockets: Map<userId (number), Set<socketId (string)>>
 */

const userSockets = new Map();

/**
 * Register a socket for a user.
 * @param {number} userId
 * @param {string} socketId
 */
function addSocket(userId, socketId) {
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId).add(socketId);
}

/**
 * Remove a socket for a user (on disconnect).
 * Cleans up the entry entirely if no sockets remain.
 * @param {number} userId
 * @param {string} socketId
 */
function removeSocket(userId, socketId) {
  if (!userSockets.has(userId)) return;
  userSockets.get(userId).delete(socketId);
  if (userSockets.get(userId).size === 0) {
    userSockets.delete(userId);
  }
}

/**
 * Get all socket IDs for a user.
 * @param {number} userId
 * @returns {Set<string> | undefined}
 */
function getSockets(userId) {
  return userSockets.get(userId);
}

/**
 * Check if a user has at least one active socket.
 * @param {number} userId
 * @returns {boolean}
 */
function isOnline(userId) {
  const sockets = userSockets.get(userId);
  return !!(sockets && sockets.size > 0);
}

module.exports = { userSockets, addSocket, removeSocket, getSockets, isOnline };
