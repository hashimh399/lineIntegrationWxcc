const crypto = require('crypto');
const axios = require('axios');
const BaseProvider = require('./base.provider');
const { safeEqual } = require('../utils/safeEqual');

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

class LineProvider extends BaseProvider {
  name = 'line';

  /** @returns {string | undefined} */
  get wxccAssetId() {
    return process.env.LINE_WXCC_ASSET_ID;
  }

  /** @returns {string | undefined} */
  get wxccChannelName() {
    return process.env.LINE_WXCC_CHANNEL_NAME;
  }

  /**
   * HMAC-SHA256 of the raw body, compared with `x-line-signature`.
   * @param {import('fastify').FastifyRequest & { rawBody?: Buffer }} request
   * @returns {boolean}
   */
  validateSignature(request) {
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    const signature = request.headers['x-line-signature'];
    const rawBody = request.rawBody;

    if (!channelSecret || !signature || !rawBody) return false;

    const digest = crypto
      .createHmac('sha256', channelSecret)
      .update(rawBody)
      .digest('base64');

    return safeEqual(signature, digest);
  }

  /**
   * @param {import('fastify').FastifyRequest} request
   * @returns {import('./base.provider').NormalizedMessage[]}
   */
  parseInbound(request) {
    const events = request.body?.events;
    if (!Array.isArray(events)) return [];

    return events
      .filter((event) => event?.type === 'message' && event.message?.type === 'text')
      .filter((event) => event.source?.userId && event.message?.text != null)
      .map((event) => ({
        customerId: String(event.source.userId),
        text: String(event.message.text),
        rawEvent: event
      }));
  }

  /**
   * @param {string} recipientId
   * @param {string} text
   * @param {any[]} [attachments]
   * @returns {Promise<any>}
   */
  async sendOutbound(recipientId, text, attachments = []) {
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
    }

    const messages = [];
    if (text) messages.push({ type: 'text', text: String(text) });

    for (const attachment of attachments) {
      if (!attachment?.url) continue;
      const mimeType = String(attachment.mimeType || '');
      if (mimeType.startsWith('image/')) {
        messages.push({
          type: 'image',
          originalContentUrl: attachment.url,
          previewImageUrl: attachment.url
        });
      } else {
        const label = attachment.fileName ? `${attachment.fileName}\n${attachment.url}` : attachment.url;
        messages.push({ type: 'text', text: label });
      }
    }

    if (messages.length === 0) {
      throw new Error('LINE outbound message has no text or attachments');
    }

    const response = await axios.post(
      LINE_PUSH_URL,
      { to: recipientId, messages: messages.slice(0, 5) },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  }
}

module.exports = new LineProvider();
