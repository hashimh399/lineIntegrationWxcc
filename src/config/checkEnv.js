const logger = require('./logger');
const { signatureMode } = require('../utils/webexSignature');

const CORE = [
  'WEBEX_CLIENT_ID',
  'WEBEX_CLIENT_SECRET',
  'WEBEX_INITIAL_REFRESH_TOKEN',
  'WXCC_API_BASE_URL',
  'REDIS_URL'
];

const CHANNELS = {
  line: ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_WXCC_ASSET_ID', 'LINE_WXCC_CHANNEL_NAME'],
  telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WXCC_ASSET_ID', 'TELEGRAM_WXCC_CHANNEL_NAME'],
  widget: ['WIDGET_API_KEY', 'WIDGET_CALLBACK_URL', 'WIDGET_WXCC_ASSET_ID', 'WIDGET_WXCC_CHANNEL_NAME']
};

/**
 * Log what is configured at startup. Never throws, so a missing optional channel
 * does not stop the others.
 */
function checkEnv() {
  const missingCore = CORE.filter((key) => !process.env[key]);
  if (missingCore.length) {
    logger.error({ missing: missingCore }, 'Required configuration is missing');
  }

  for (const [channel, keys] of Object.entries(CHANNELS)) {
    const missing = keys.filter((key) => !process.env[key]);
    if (missing.length === 0) {
      logger.info({ channel }, 'Channel configured');
    } else if (missing.length < keys.length) {
      logger.warn({ channel, missing }, 'Channel is partially configured');
    } else {
      logger.info({ channel }, 'Channel not configured');
    }
  }

  const mode = signatureMode();
  if (mode !== 'enforce') {
    logger.warn({ mode }, 'Webex webhook signatures are not enforced');
  }
  if (mode !== 'off' && !process.env.WXCC_WEBHOOK_SECRET) {
    logger.warn('WXCC_WEBHOOK_SECRET is not set; /webhook signatures cannot be verified');
  }
  if (mode !== 'off' && !process.env.WXCC_SUBSCRIPTION_SECRET) {
    logger.warn('WXCC_SUBSCRIPTION_SECRET is not set; /lifecycle signatures cannot be verified');
  }
}

module.exports = { checkEnv };
