const crypto = require('crypto');
const axios = require('axios');
const webexAuth = require('./webexAuth');

const WXCC_API_BASE_URL = process.env.WXCC_API_BASE_URL;

class WebexApiService {
  async authHeaders() {
    const token = await webexAuth.getValidToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Custom Messaging BYOC create. Webex echoes `origin.id` as `data.origin` on webhooks.
   * The live contract is POST /v2/tasks (origin is an object, not a bare string).
   * @param {string} namespacedId
   * @param {string} text
   * @param {string} assetId Provider business address. Selects the agent desktop logo.
   * @param {string} channelName Provider Custom Channel name.
   * @param {string} [customerName] Shown on the agent desktop. Defaults to the namespaced id.
   * @returns {Promise<string>}
   */
  async createTask(namespacedId, text, assetId, channelName, customerName) {
    if (!channelName || !assetId) {
      throw new Error('A provider Webex asset id and channel name are required');
    }

    const payload = {
      channelType: 'customMessaging',
      channel: channelName,
      origin: { id: String(namespacedId), name: String(customerName || namespacedId) },
      destination: { id: assetId, type: 'businessAddress' },
      channelParams: {
        type: 'text',
        message: {
          aliasId: crypto.randomUUID(),
          text,
          timestamp: Date.now()
        }
      }
    };

    const response = await axios.post(`${WXCC_API_BASE_URL}/v2/tasks`, payload, {
      headers: await this.authHeaders()
    });

    const taskId = response.data?.data?.id;
    if (!taskId) {
      throw new Error('Webex create task response did not include a task id');
    }
    return taskId;
  }

  /**
   * Append an inbound customer message.
   * `timestamp` is required; Webex returns 400 without it. The agent desktop sorts
   * on it, so the host clock must be NTP-synced.
   * @param {string} taskId
   * @param {string} text
   * @returns {Promise<string>}
   */
  async appendMessage(taskId, text) {
    const payload = {
      mediaType: 'customMessaging',
      channelParams: {
        type: 'text',
        message: {
          aliasId: crypto.randomUUID(),
          text,
          timestamp: Date.now()
        }
      }
    };

    const response = await axios.post(
      `${WXCC_API_BASE_URL}/v2/tasks/${taskId}/messages`,
      payload,
      { headers: await this.authHeaders() }
    );

    return response.data.data.id;
  }
}

module.exports = new WebexApiService();
