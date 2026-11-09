const providers = require('../providers');
const webexTaskService = require('../services/webexTaskService');

module.exports = async function channelsRoutes(fastify) {
  fastify.post('/channels/:provider', async (request, reply) => {
    const providerName = String(request.params.provider || '').toLowerCase();
    const provider = providers.get(providerName);

    if (!provider) {
      return reply.code(404).send({ error: 'Unknown provider' });
    }

    if (!provider.validateSignature(request)) {
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const payloadError = provider.validateInbound(request);
    if (payloadError) {
      return reply.code(400).send({ error: payloadError });
    }

    reply.code(200).send({ ok: true });

    try {
      const messages = provider.parseInbound(request);
      for (const message of messages) {
        const namespacedId = `${provider.name}:${message.customerId}`;
        try {
          await webexTaskService.handleCustomerMessage(
            namespacedId,
            message.text,
            provider.wxccAssetId,
            provider.wxccChannelName,
            request.log,
            { customerName: message.customerName }
          );
        } catch (error) {
          request.log.error({
            err: error.message,
            namespacedId,
            response: error.response?.data
          }, 'Failed to route inbound message to Webex');
        }
      }
    } catch (error) {
      request.log.error({ err: error.message, provider: provider.name }, 'Failed to parse inbound provider payload');
    }
  });
};
