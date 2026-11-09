const path = require('path');
const Redis = require('ioredis');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const logger = require('./logger');

const redis = new Redis(process.env.REDIS_URL);

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));

module.exports = redis;