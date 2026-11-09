const providers = require('../providers');
const webexTaskService = require('../services/webexTaskService');
const { originToString, parseNamespacedOrigin } = require('../utils/origin');
const { checkWebexWebhook } = require('../utils/webexSignature');

module.exports = async function lifecycleRoutes(fastify) {
  fastify.post('/lifecycle', async (request, reply) => {
    if (!checkWebexWebhook(request, process.env.WXCC_SUBSCRIPTION_SECRET, '/lifecycle')) {
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    reply.code(200).send('OK');

    const { type, data } = request.body || {};
    if (!data) return;

    if (type === 'task:new') {
      const taskId = data.taskId ? String(data.taskId) : undefined;
      if (!taskId) return;

      try {
        await webexTaskService.deliverOpeningMessage(taskId, request.log);
      } catch (error) {
        request.log.error({
          err: error.message,
          taskId,
          response: error.response?.data
        }, 'Failed to append opening customer message after task:new');
      }
      return;
    }

    if (type !== 'task:ended' && type !== 'task:failed') return;

    const namespacedId = originToString(data.origin);
    const taskId = data.taskId ? String(data.taskId) : undefined;

    if (type === 'task:failed') {
      request.log.error({
        reason: data.reason,
        errorMessage: data.errorMessage,
        taskId,
        origin: namespacedId
      }, 'Webex task failed');
    }

    if (!namespacedId) {
      request.log.warn({ type, taskId }, 'Lifecycle event has no origin; Redis mapping was left in place');
      return;
    }

    try {
      await webexTaskService.clearSession(namespacedId, taskId);
      request.log.info({ origin: namespacedId, taskId, type }, 'Cleared Redis task mapping');
    } catch (error) {
      request.log.error({ err: error.message, origin: namespacedId, taskId }, 'Failed to clear Redis task mapping');
    }

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
  });
};
