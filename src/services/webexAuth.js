const axios = require('axios');
const redis = require('../config/redis');
const logger = require('../config/logger');

class WebexTokenManager {
  constructor() {
    this.clientId = process.env.WEBEX_CLIENT_ID;
    this.clientSecret = process.env.WEBEX_CLIENT_SECRET;
  }

  async getValidToken() {
    const cachedToken = await redis.get('wxcc:access_token');
    if (cachedToken) {
      return cachedToken;
    }
    return await this.refreshAccessToken();
  }

  async refreshAccessToken() {
    try {
      let currRefreshToken = await redis.get('wxcc:refresh_token');
      if (!currRefreshToken) {
        currRefreshToken = process.env.WEBEX_INITIAL_REFRESH_TOKEN;
        if (!currRefreshToken) throw new Error('No refresh token available');
      }

      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('client_id', this.clientId);
      params.append('client_secret', this.clientSecret);
      params.append('refresh_token', currRefreshToken);

      const response = await axios.post('https://webexapis.com/v1/access_token', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const { access_token, expires_in, refresh_token, refresh_token_expires_in } = response.data;

      // Cache access token with safety margin
      await redis.set('wxcc:access_token', access_token, 'EX', expires_in - 60);

      // Persist newly rotated refresh token
      if (refresh_token) {
        await redis.set('wxcc:refresh_token', refresh_token, 'EX', refresh_token_expires_in);
      }

      logger.info('Webex access token refreshed and cached');
      return access_token;
    } catch (error) {
      logger.error({ err: error.message, response: error.response?.data }, 'Error refreshing Webex access token');
      throw new Error('Webex Auth failed');
    }
  }
}

module.exports = new WebexTokenManager();