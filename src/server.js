const path = require('path');

// A Windows service starts in C:\Windows\System32, so .env cannot rely on the working directory.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const logger = require('./config/logger');
const { checkEnv } = require('./config/checkEnv');

checkEnv();

const fastify = require('fastify')({ loggerInstance: logger });
const cors = require('@fastify/cors');
const redis = require('./config/redis');
const webexAuth = require('./services/webexAuth');

fastify.removeContentTypeParser('application/json');
fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
  // LINE and Webex HMACs must hash the exact bytes, not a re-serialized JSON object.
  request.rawBody = body;

  if (!body || body.length === 0) {
    const error = new Error("Body cannot be empty when content-type is set to 'application/json'");
    error.statusCode = 400;
    done(error, undefined);
    return;
  }

  try {
    done(null, JSON.parse(body.toString('utf8')));
  } catch (error) {
    error.statusCode = 400;
    done(error, undefined);
  }
});

fastify.register(cors, {
  origin: '*'
});

fastify.ready().then(async () => {
  try {
    await webexAuth.getValidToken();
    fastify.log.info('Retrieved valid Webex access token');
  } catch (err) {
    fastify.log.error({ err: err.message }, 'Error retrieving Webex access token');
  }
});

fastify.get('/health', async () => {
  const redisStatus = redis.status === 'ready' ? 'ok' : 'down';
  return { status: 'ok', redis: redisStatus, timestamp: new Date().toISOString() };
});

fastify.register(require('./routes/channels'));
fastify.register(require('./routes/webhook'));
fastify.register(require('./routes/lifecycle'));

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 4000;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info({ port }, 'Server listening');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
