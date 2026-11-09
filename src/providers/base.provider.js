/**
 * @typedef {Object} NormalizedMessage
 * @property {string} customerId Provider-native customer id, without the channel prefix.
 * @property {string} text
 * @property {string} [customerName] Display name for the agent desktop.
 * @property {any} rawEvent
 */

/**
 * @typedef {Object} OutboundContext
 * @property {string} [taskId]
 * @property {string} [senderType] `agent` or `system` (flow-sent).
 */

/**
 * @typedef {Object} EndedContext
 * @property {'task:ended' | 'task:failed'} type
 * @property {string} [taskId]
 * @property {string} [reason]
 */

/**
 * Contract every messaging channel must implement.
 * Core Webex routing depends only on this shape.
 */
class BaseProvider {
  /** @type {string} */
  name = 'base';

  /**
   * Webex business address for this channel. The agent desktop uses it to pick the channel logo.
   * @returns {string}
   */
  get wxccAssetId() {
    throw new Error(`${this.name}: wxccAssetId is not implemented`);
  }

  /**
   * Webex Custom Channel name configured for this channel.
   * @returns {string}
   */
  get wxccChannelName() {
    throw new Error(`${this.name}: wxccChannelName is not implemented`);
  }

  /**
   * @param {import('fastify').FastifyRequest} request
   * @returns {boolean}
   */
  validateSignature(request) {
    throw new Error(`${this.name}: validateSignature() is not implemented`);
  }

  /**
   * Optional. Runs before the 200 so the caller gets a 400 for a malformed payload.
   * @param {import('fastify').FastifyRequest} request
   * @returns {string | null} Error message, or null when the payload is acceptable.
   */
  validateInbound(request) {
    return null;
  }

  /**
   * @param {import('fastify').FastifyRequest} request
   * @returns {NormalizedMessage[]}
   */
  parseInbound(request) {
    throw new Error(`${this.name}: parseInbound() is not implemented`);
  }

  /**
   * @param {string} recipientId
   * @param {string} text
   * @param {any[]} [attachments]
   * @param {OutboundContext} [context]
   * @returns {Promise<any>}
   */
  async sendOutbound(recipientId, text, attachments = [], context = {}) {
    throw new Error(`${this.name}: sendOutbound() is not implemented`);
  }

  /**
   * Optional. Tell the channel the Webex task ended or failed.
   * @param {string} recipientId
   * @param {EndedContext} context
   * @returns {Promise<any>} null when the channel has nothing to notify.
   */
  async notifyConversationEnded(recipientId, context) {
    return null;
  }
}

module.exports = BaseProvider;
