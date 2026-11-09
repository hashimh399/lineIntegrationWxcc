const crypto = require('crypto');

/**
 * Constant-time string comparison. Returns false when lengths differ
 * instead of throwing from timingSafeEqual.
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { safeEqual };
