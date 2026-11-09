const redis = require('../config/redis');
const logger = require('../config/logger');
const webexApi = require('./webexApi');

/** Safety net if a lifecycle webhook never arrives. Webex queue limit is 14 days. */
const DEFAULT_TASK_TTL_SECONDS = 14 * 24 * 60 * 60;

function taskTtlSeconds() {
  const configured = Number(process.env.WXCC_TASK_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TASK_TTL_SECONDS;
}

/**
 * @param {string} namespacedId
 * @returns {string}
 */
function customerKey(namespacedId) {
  return `wxcc:customer:${namespacedId}:task`;
}

/**
 * @param {string} taskId
 * @returns {string}
 */
function taskKey(taskId) {
  return `wxcc:task:${taskId}:customer`;
}

/**
 * Opening customer text waiting to be appended after the task can accept messages.
 * Create Task carries the text, but that call does not render it on the agent transcript.
 * @param {string} taskId
 * @returns {string}
 */
function openingKey(taskId) {
  return `wxcc:task:${taskId}:opening`;
}

/**
 * Most recent appended text. Append failures arrive later via webhook without the text,
 * so this is what gets re-sent if the task turns out to be gone.
 * @param {string} taskId
 * @returns {string}
 */
function lastMessageKey(taskId) {
  return `wxcc:task:${taskId}:last`;
}

const LAST_MESSAGE_TTL_SECONDS = 10 * 60;

/**
 * Claim the pending opening text so only one caller appends it.
 * @param {string} taskId
 * @returns {Promise<string | null>}
 */
async function claimOpeningMessage(taskId) {
  const text = await redis.eval(
    "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v",
    1,
    openingKey(taskId)
  );
  return text ? String(text) : null;
}

class WebexTaskService {
  /**
   * Open a Webex task for a new customer, or append when one is already mapped.
   * Asset and channel are per provider so the agent desktop can show the matching logo.
   * @param {string} namespacedId Format `<provider>:<customerId>`, for example `line:U123`.
   * @param {string} text
   * @param {string} assetId Webex business address for this channel.
   * @param {string} channelName Webex Custom Channel name for this channel.
   * @param {import('pino').Logger} [log]
   * @param {{ customerName?: string }} [meta] Used only when a new task is created.
   * @returns {Promise<string>} taskId
   */
  async handleCustomerMessage(namespacedId, text, assetId, channelName, log = logger, meta = {}) {
    const key = customerKey(namespacedId);
    const existingTaskId = await redis.get(key);

    if (!existingTaskId) {
      if (!assetId || !channelName) {
        throw new Error(`Webex asset id and channel name are required to create a task for ${namespacedId}`);
      }

      log.info({ namespacedId, assetId, channelName }, 'Creating Webex CC task');
      const taskId = await webexApi.createTask(namespacedId, text, assetId, channelName, meta.customerName);
      const ttl = taskTtlSeconds();
      await redis.set(key, taskId, 'EX', ttl);
      await redis.set(taskKey(taskId), namespacedId, 'EX', ttl);
      await redis.set(openingKey(taskId), text, 'EX', ttl);
      log.info({ namespacedId, taskId }, 'Created Webex CC task');
      try {
        await this.deliverOpeningMessage(taskId, log);
      } catch (error) {
        log.warn({
          err: error.message,
          taskId,
          response: error.response?.data
        }, 'Opening message was not appended yet; it will be sent when the task is active');
      }
      return taskId;
    }

    log.info({ namespacedId, taskId: existingTaskId }, 'Appending message to Webex CC task');
    try {
      await this.deliverOpeningMessage(existingTaskId, log);
    } catch (error) {
      log.warn({
        err: error.message,
        taskId: existingTaskId,
        response: error.response?.data
      }, 'Opening message is still pending; appending the newer customer message');
    }
    await webexApi.appendMessage(existingTaskId, text);
    await redis.set(lastMessageKey(existingTaskId), text, 'EX', LAST_MESSAGE_TTL_SECONDS);
    const ttl = taskTtlSeconds();
    await redis.expire(key, ttl);
    await redis.expire(taskKey(existingTaskId), ttl);
    return existingTaskId;
  }

  /**
   * @param {string} taskId
   * @returns {Promise<string | null>} Namespaced customer id stored when the task was created.
   */
  async customerForTask(taskId) {
    return redis.get(taskKey(taskId));
  }

  /**
   * Read and remove the last appended text for a task.
   * @param {string} taskId
   * @returns {Promise<string | null>}
   */
  async takeLastMessage(taskId) {
    const text = await redis.eval(
      "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v",
      1,
      lastMessageKey(taskId)
    );
    return text ? String(text) : null;
  }

  /**
   * Append the customer text that created the task.
   * Safe to call from the create path and from `task:new`. A second call is a no-op.
   * @param {string} taskId
   * @param {import('pino').Logger} [log]
   * @returns {Promise<boolean>} True when a message was appended.
   */
  async deliverOpeningMessage(taskId, log = logger) {
    const text = await claimOpeningMessage(taskId);
    if (!text) return false;

    try {
      await webexApi.appendMessage(taskId, text);
      log.info({ taskId }, 'Appended opening customer message');
      return true;
    } catch (error) {
      await redis.set(openingKey(taskId), text, 'EX', taskTtlSeconds());
      throw error;
    }
  }

  /**
   * Drop the customer-to-task mapping and the task's own keys.
   * With a taskId, the customer mapping is removed only if it still points to that task,
   * so a late event for an old task cannot wipe a newer conversation.
   * @param {string} namespacedId
   * @param {string} [taskId]
   * @returns {Promise<boolean>} True when the customer mapping was removed.
   */
  async clearSession(namespacedId, taskId) {
    if (!taskId) {
      return (await redis.del(customerKey(namespacedId))) > 0;
    }

    const removed = await redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0",
      1,
      customerKey(namespacedId),
      taskId
    );
    await redis.del(taskKey(taskId), openingKey(taskId), lastMessageKey(taskId));
    return Number(removed) > 0;
  }
}

module.exports = new WebexTaskService();
