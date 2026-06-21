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
 * @param {number|string} userId
 * @param {string} socketId
 */
function addSocket(userId, socketId) {
  if (!userId) return;
  const uid = userId.toString();
  if (!userSockets.has(uid)) {
    userSockets.set(uid, new Set());
  }
  userSockets.get(uid).add(socketId);
}

/**
 * Remove a socket for a user (on disconnect).
 * Cleans up the entry entirely if no sockets remain.
 * @param {number|string} userId
 * @param {string} socketId
 */
function removeSocket(userId, socketId) {
  if (!userId) return;
  const uid = userId.toString();
  if (!userSockets.has(uid)) return;
  userSockets.get(uid).delete(socketId);
  if (userSockets.get(uid).size === 0) {
    userSockets.delete(uid);
  }
}

/**
 * Get all socket IDs for a user.
 * @param {number|string} userId
 * @returns {Set<string> | undefined}
 */
function getSockets(userId) {
  if (!userId) return undefined;
  return userSockets.get(userId.toString());
}

/**
 * Check if a user has at least one active socket.
 * @param {number|string} userId
 * @returns {boolean}
 */
function isOnline(userId) {
  if (!userId) return false;
  const sockets = userSockets.get(userId.toString());
  return !!(sockets && sockets.size > 0);
}

module.exports = { userSockets, addSocket, removeSocket, getSockets, isOnline };
