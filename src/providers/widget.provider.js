const crypto = require('crypto');
const axios = require('axios');
const BaseProvider = require('./base.provider');
const { safeEqual } = require('../utils/safeEqual');

const EVENTS = new Set(['conversation.started', 'message', 'conversation.ended']);
const DEFAULT_INITIATION_TEXT = 'Customer started a chat';
const CALLBACK_TIMEOUT_MS = 10000;
const CALLBACK_ATTEMPTS = 3;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Third-party chat widget. The widget backend posts events to `/channels/widget`,
 * and agent replies are pushed back to `WIDGET_CALLBACK_URL`.
 */
class WidgetProvider extends BaseProvider {
  name = 'widget';

  /** @returns {string | undefined} */
  get wxccAssetId() {
    return process.env.WIDGET_WXCC_ASSET_ID;
  }

  /** @returns {string | undefined} */
  get wxccChannelName() {
    return process.env.WIDGET_WXCC_CHANNEL_NAME;
  }

  /**
   * `Authorization: Bearer <WIDGET_API_KEY>`. Requests are rejected when the key is not configured.
   * @param {import('fastify').FastifyRequest} request
   * @returns {boolean}
   */
  validateSignature(request) {
    const apiKey = process.env.WIDGET_API_KEY;
    const header = request.headers.authorization;
    if (!apiKey || !header || Array.isArray(header)) return false;

    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return false;
    return safeEqual(token, apiKey);
  }

  /**
   * @param {import('fastify').FastifyRequest} request
   * @returns {string | null}
   */
  validateInbound(request) {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return 'Body must be a JSON object';
    }
    if (!EVENTS.has(body.event)) {
      return `event must be one of: ${[...EVENTS].join(', ')}`;
    }
    if (body.conversationId == null || String(body.conversationId).trim() === '') {
      return 'conversationId is required';
    }
    if (body.event === 'message' && !hasText(body.text)) {
      return 'text is required for message events';
    }
    return null;
  }

  /**
   * `conversation.started` opens the Webex task. Its text is optional because Webex
   * requires a first message, so a configurable placeholder is used when it is missing.
   * @param {import('fastify').FastifyRequest} request
   * @returns {import('./base.provider').NormalizedMessage[]}
   */
  parseInbound(request) {
    const body = request.body || {};
    const conversationId = String(body.conversationId).trim();
    const customerName = hasText(body.customer?.name) ? String(body.customer.name).trim() : undefined;

    if (body.event === 'conversation.started') {
      const text = hasText(body.text)
        ? String(body.text)
        : (process.env.WIDGET_INITIATION_TEXT || DEFAULT_INITIATION_TEXT);
      return [{ customerId: conversationId, customerName, text, rawEvent: body }];
    }

    if (body.event === 'message') {
      return [{ customerId: conversationId, customerName, text: String(body.text), rawEvent: body }];
    }

    return [];
  }

  /**
   * @param {string} recipientId Widget conversation id.
   * @param {string} text
   * @param {any[]} [attachments]
   * @param {import('./base.provider').OutboundContext} [context]
   * @returns {Promise<any>}
   */
  async sendOutbound(recipientId, text, attachments = [], context = {}) {
    return this.postCallback({
      event: 'message',
      conversationId: recipientId,
      taskId: context.taskId,
      sender: context.senderType === 'system' ? 'system' : 'agent',
      text: text || '',
      attachments: attachments
        .filter((attachment) => attachment?.url)
        .map((attachment) => ({
          url: attachment.url,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType
        })),
      timestamp: Date.now()
    });
  }

  /**
   * @param {string} recipientId
   * @param {import('./base.provider').EndedContext} context
   * @returns {Promise<any>}
   */
  async notifyConversationEnded(recipientId, context) {
    return this.postCallback({
      event: context.type === 'task:failed' ? 'conversation.failed' : 'conversation.ended',
      conversationId: recipientId,
      taskId: context.taskId,
      reason: context.reason || null,
      timestamp: Date.now()
    });
  }

  /**
   * POST to the widget backend. `x-signature: sha256=<hex>` is an HMAC of the exact body
   * with `WIDGET_CALLBACK_SECRET`. Retries network errors, 429 and 5xx.
   * @param {object} payload
   * @returns {Promise<any>}
   */
  async postCallback(payload) {
    const url = process.env.WIDGET_CALLBACK_URL;
    if (!url) {
      throw new Error('WIDGET_CALLBACK_URL is not configured');
    }

    const body = JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json' };
    const secret = process.env.WIDGET_CALLBACK_SECRET;
    if (secret) {
      headers['x-signature'] = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
    }

    let lastError;
    for (let attempt = 1; attempt <= CALLBACK_ATTEMPTS; attempt += 1) {
      try {
        const response = await axios.post(url, body, { headers, timeout: CALLBACK_TIMEOUT_MS });
        return response.data;
      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        const retryable = !status || status === 429 || status >= 500;
        if (!retryable || attempt === CALLBACK_ATTEMPTS) break;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
    }
    throw lastError;
  }
}

module.exports = new WidgetProvider();
