const lineProvider = require('./line.provider');
const telegramProvider = require('./telegram.provider');
const widgetProvider = require('./widget.provider');

/** @type {Map<string, import('./base.provider')>} */
const providers = new Map();

/**
 * @param {import('./base.provider')} provider
 */
function register(provider) {
  if (!provider?.name) {
    throw new Error('Provider is missing a name');
  }
  providers.set(provider.name, provider);
}

/**
 * @param {string} name
 * @returns {import('./base.provider') | null}
 */
function get(name) {
  return providers.get(name) || null;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function has(name) {
  return providers.has(name);
}

register(lineProvider);
register(telegramProvider);
register(widgetProvider);

module.exports = { register, get, has };
