const axios = require('axios');
const BaseProvider = require('./base.provider');
const { safeEqual } = require('../utils/safeEqual');

class TelegramProvider extends BaseProvider {
  name = 'telegram';

  /** @returns {string | undefined} */
  get wxccAssetId() {
    return process.env.TELEGRAM_WXCC_ASSET_ID;
  }

  /** @returns {string | undefined} */
  get wxccChannelName() {
    return process.env.TELEGRAM_WXCC_CHANNEL_NAME;
  }

  /**
   * Checks `x-telegram-bot-api-secret-token` when `TELEGRAM_WEBHOOK_SECRET` is set.
   * Unsigned webhooks are accepted when the secret is not configured.
   * @param {import('fastify').FastifyRequest} request
   * @returns {boolean}
   */
  validateSignature(request) {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected) return true;

    const header = request.headers['x-telegram-bot-api-secret-token'];
    if (!header || Array.isArray(header)) return false;
    return safeEqual(header, expected);
  }

  /**
   * @param {import('fastify').FastifyRequest} request
   * @returns {import('./base.provider').NormalizedMessage[]}
   */
  parseInbound(request) {
    const message = request.body?.message;
    if (message?.from?.id == null || message.text == null) return [];

    return [{
      customerId: String(message.from.id),
      text: String(message.text),
      rawEvent: message
    }];
  }

  /**
   * @param {string} recipientId
   * @param {string} text
   * @param {any[]} [attachments]
   * @returns {Promise<any>}
   */
  async sendOutbound(recipientId, text, attachments = []) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }

    const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;
    /** @type {any} */
    let response = null;

    if (text) {
      response = await axios.post(endpoint, {
        chat_id: recipientId,
        text: String(text)
      });
    }

    for (const attachment of attachments) {
      if (!attachment?.url) continue;
      const label = attachment.fileName ? `${attachment.fileName}\n${attachment.url}` : attachment.url;
      response = await axios.post(endpoint, {
        chat_id: recipientId,
        text: label
      });
    }

    if (!response) {
      throw new Error('Telegram outbound message has no text or attachments');
    }

    return response.data;
  }
}

module.exports = new TelegramProvider();
