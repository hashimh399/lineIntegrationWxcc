const crypto = require('crypto');
const { safeEqual } = require('./safeEqual');

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;
const MODES = new Set(['off', 'log', 'enforce']);

/**
 * `off` skips the check, `log` reports failures but accepts the request, `enforce` rejects it.
 * @returns {'off' | 'log' | 'enforce'}
 */
function signatureMode() {
  const mode = String(process.env.WXCC_WEBHOOK_SIGNATURE_MODE || 'log').toLowerCase();
  return /** @type {'off' | 'log' | 'enforce'} */ (MODES.has(mode) ? mode : 'log');
}

/**
 * `X-WebexCC-Signature` is the hex HMAC-SHA256 of the raw body with the webhook secret.
 * V2 deliveries also send `X-WebExCC-Timestamp`, which must equal `comciscotimestamp`.
 * @param {import('fastify').FastifyRequest & { rawBody?: Buffer }} request
 * @param {string | undefined} secret
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyWebexSignature(request, secret) {
  if (!secret) return { valid: false, reason: 'secret not configured' };

  const signature = request.headers['x-webexcc-signature'];
  if (!signature || Array.isArray(signature)) return { valid: false, reason: 'missing X-WebexCC-Signature' };
  if (!request.rawBody) return { valid: false, reason: 'raw body unavailable' };

  const digest = crypto.createHmac('sha256', secret).update(request.rawBody).digest('hex');
  if (!safeEqual(signature.toLowerCase(), digest)) return { valid: false, reason: 'signature mismatch' };

  const headerTs = request.headers['x-webexcc-timestamp'];
  if (headerTs && !Array.isArray(headerTs)) {
    const bodyTs = request.body?.comciscotimestamp;
    if (bodyTs != null && String(bodyTs) !== String(headerTs)) {
      return { valid: false, reason: 'timestamp header does not match body' };
    }
    const skew = Math.abs(Date.now() - Number(headerTs));
    if (!Number.isFinite(skew) || skew > MAX_TIMESTAMP_SKEW_MS) {
      return { valid: false, reason: 'timestamp outside the 5 minute window' };
    }
  }

  return { valid: true };
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {string | undefined} secret
 * @param {string} endpoint Used in log output.
 * @returns {boolean} False when the request must be rejected.
 */
function checkWebexWebhook(request, secret, endpoint) {
  const mode = signatureMode();
  if (mode === 'off') return true;

  const result = verifyWebexSignature(request, secret);
  if (result.valid) {
    if (mode === 'log') request.log.info({ endpoint }, 'Webex webhook signature valid');
    return true;
  }

  if (mode === 'enforce') {
    request.log.warn({ endpoint, reason: result.reason }, 'Rejected Webex webhook with invalid signature');
    return false;
  }

  request.log.warn({ endpoint, reason: result.reason }, 'Webex webhook signature check failed; accepted because mode is log');
  return true;
}

module.exports = { checkWebexWebhook, verifyWebexSignature, signatureMode };
