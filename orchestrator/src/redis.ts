import { Redis } from 'ioredis';
import type { Config } from './config.js';

/**
 * Redis is the **event bus** only: publishEvent fans rows out on the
 * `events:all` channel for realtime consumers. Task dispatch state
 * lives in PostgreSQL (source of truth), so the agent runner never
 * needs Redis credentials.
 *
 * Deliberately no blocking commands (BRPOP/BLPOP) on this client:
 * sharing one ioredis connection, a 25s BRPOP would serialize every
 * other command behind it.
 */
export function createRedis(config: Config): Redis {
    const redis = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
    });
    redis.on('error', (err) => {
        console.warn('[redis] error:', err.message);
    });
    return redis;
}
