const providers = require('../providers');
const webexTaskService = require('../services/webexTaskService');
const { originToString, parseNamespacedOrigin } = require('../utils/origin');
const { checkWebexWebhook } = require('../utils/webexSignature');

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {string} type
 * @param {string} namespacedId
 * @param {string | undefined} taskId
 * @param {any} data
 */
async function notifyEnded(request, type, namespacedId, taskId, data) {
  const parsed = parseNamespacedOrigin(namespacedId);
  const provider = parsed && providers.get(parsed.provider);
  if (!provider) return;

  try {
    const notified = await provider.notifyConversationEnded(parsed.customerId, {
      type,
      taskId,
      reason: data.reason
    });
    if (notified !== null) {
      request.log.info({ provider: parsed.provider, recipientId: parsed.customerId, taskId, type }, 'Notified channel that the conversation ended');
    }
  } catch (error) {
    request.log.error({
      err: error.message,
      provider: parsed.provider,
      taskId,
      status: error.response?.status,
      response: error.response?.data
    }, 'Failed to notify channel that the conversation ended');
  }
}

/**
 * Webex accepts an append with 202 and reports failure later. NOT_FOUND means the task is
 * gone (for example ended without a lifecycle event reaching us), so the mapping is stale:
 * clear it and open a new task with the message that failed.
 * @param {import('fastify').FastifyRequest} request
 * @param {string} namespacedId
 * @param {string} taskId
 * @param {any} data
 */
async function handleAppendFailed(request, namespacedId, taskId, data) {
  request.log.error({
    taskId,
    origin: namespacedId,
    reason: data.reason,
    errorMessage: data.errorMessage
  }, 'Webex rejected an appended customer message');

  if (data.reason !== 'NOT_FOUND') return;

  const lastText = await webexTaskService.takeLastMessage(taskId);
  await webexTaskService.clearSession(namespacedId, taskId);
  request.log.warn({ origin: namespacedId, taskId }, 'Task no longer exists; cleared the stale Redis mapping');

  const parsed = parseNamespacedOrigin(namespacedId);
  const provider = parsed && providers.get(parsed.provider);
  if (!lastText || !provider) return;

  const newTaskId = await webexTaskService.handleCustomerMessage(
    namespacedId,
    lastText,
    provider.wxccAssetId,
    provider.wxccChannelName,
    request.log
  );
  request.log.info({ origin: namespacedId, oldTaskId: taskId, taskId: newTaskId }, 'Opened a new task with the message that failed');
}

module.exports = async function lifecycleRoutes(fastify) {
  fastify.post('/lifecycle', async (request, reply) => {
    if (!checkWebexWebhook(request, process.env.WXCC_SUBSCRIPTION_SECRET, '/lifecycle')) {
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    reply.code(200).send('OK');

    const { type, data } = request.body || {};
    if (!data) return;

    const taskId = data.taskId ? String(data.taskId) : undefined;
    let namespacedId = originToString(data.origin);
    if (!parseNamespacedOrigin(namespacedId) && taskId) {
      namespacedId = (await webexTaskService.customerForTask(taskId)) || namespacedId;
    }

    const parsed = parseNamespacedOrigin(namespacedId);
    const ours = Boolean(parsed && providers.has(parsed.provider));
    // The subscription is org-wide, so events for other channels arrive here too.
    if (!ours) {
      request.log.debug({ type, taskId, origin: namespacedId }, 'Ignored lifecycle event for another channel');
      return;
    }

    request.log.info({ type, taskId, origin: namespacedId, reason: data.reason }, 'Lifecycle event received');

    try {
      if (type === 'task:new') {
        if (taskId) await webexTaskService.deliverOpeningMessage(taskId, request.log);
        return;
      }

      if (type === 'task-message:append-failed') {
        if (taskId) await handleAppendFailed(request, namespacedId, taskId, data);
        return;
      }

      if (type !== 'task:ended' && type !== 'task:failed') return;

      if (type === 'task:failed') {
        request.log.error({
          reason: data.reason,
          errorMessage: data.errorMessage,
          taskId,
          origin: namespacedId
        }, 'Webex task failed');
      }

      const removed = await webexTaskService.clearSession(namespacedId, taskId);
      request.log.info({ origin: namespacedId, taskId, type, removed }, 'Cleared Redis task mapping');

      await notifyEnded(request, type, namespacedId, taskId, data);
    } catch (error) {
      request.log.error({
        err: error.message,
        type,
        taskId,
        origin: namespacedId,
        response: error.response?.data
      }, 'Failed to process lifecycle event');
    }
  });
};
