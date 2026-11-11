const providers = require('../providers');
const { parseNamespacedOrigin } = require('../utils/origin');
const { checkWebexWebhook } = require('../utils/webexSignature');
const { isDuplicateSystemMessage } = require('../services/outboundThrottle');

module.exports = async function webhookRoutes(fastify) {
  fastify.post('/webhook', async (request, reply) => {
    if (!checkWebexWebhook(request, process.env.WXCC_WEBHOOK_SECRET, '/webhook')) {
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const body = request.body || {};
    reply.code(200).send({ status: 'delivered' });

    try {
      if (body.type !== 'task-message:appended' || body.data?.messageDirection !== 'OUTBOUND') {
        return;
      }

      const data = body.data;
      const agentText = data.channelParams?.message?.text || '';
      const attachments = Array.isArray(data.channelParams?.message?.attachments)
        ? data.channelParams.message.attachments
        : [];
      const parsed = parseNamespacedOrigin(data.origin);

      if (!parsed) {
        request.log.warn({ origin: data.origin }, 'Outbound origin is not namespaced as provider:customerId');
        return;
      }

      if (!agentText && attachments.length === 0) {
        request.log.warn({ origin: parsed.namespacedId }, 'Outbound event has no text or attachments');
        return;
      }

      const provider = providers.get(parsed.provider);
      if (!provider) {
        request.log.error({ provider: parsed.provider, origin: parsed.namespacedId }, 'No provider registered for outbound origin');
        return;
      }

      if (data.senderType === 'system' && await isDuplicateSystemMessage(parsed.namespacedId, agentText, attachments)) {
        request.log.info({
          provider: parsed.provider,
          recipientId: parsed.customerId,
          taskId: data.taskId
        }, 'Skipped repeated system message');
        return;
      }

      await provider.sendOutbound(parsed.customerId, agentText, attachments, {
        taskId: data.taskId,
        senderType: data.senderType
      });
      request.log.info({
        provider: parsed.provider,
        recipientId: parsed.customerId,
        taskId: data.taskId,
        senderType: data.senderType
      }, 'Delivered outbound agent message');
    } catch (error) {
      request.log.error({
        err: error.message,
        status: error.response?.status,
        response: error.response?.data
      }, 'Failed to deliver outbound message');
    }
  });
};
