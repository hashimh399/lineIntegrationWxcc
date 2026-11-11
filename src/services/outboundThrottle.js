const crypto = require('crypto');
const redis = require('../config/redis');
const logger = require('../config/logger');

const DEFAULT_WINDOW_SECONDS = 300;

function windowSeconds() {
  const raw = process.env.WXCC_SYSTEM_MESSAGE_DEDUPE_SECONDS;
  if (raw === undefined || raw === '') return DEFAULT_WINDOW_SECONDS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_WINDOW_SECONDS;
}

/**
 * Flow queue loops can resend the same system message every few seconds, and each send
 * costs channel quota (LINE push). Returns true when an identical system message already
 * went to this customer inside the window. Fails open if Redis is unavailable.
 * @param {string} namespacedId
 * @param {string} text
 * @param {any[]} attachments
 * @returns {Promise<boolean>}
 */
async function isDuplicateSystemMessage(namespacedId, text, attachments) {
  const ttl = windowSeconds();
  if (ttl === 0) return false;

  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify([text, attachments.map((a) => a?.url || '')]))
    .digest('hex');

  try {
    const stored = await redis.set(`wxcc:outbound:system:${namespacedId}:${fingerprint}`, '1', 'EX', ttl, 'NX');
    return stored === null;
  } catch (error) {
    logger.warn({ err: error.message }, 'System message throttle unavailable; sending anyway');
    return false;
  }
}

module.exports = { isDuplicateSystemMessage };
