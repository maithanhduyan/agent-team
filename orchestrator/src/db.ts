import pg from 'pg';
import type { Config } from './config.js';

export function createDb(config: Config): pg.Pool {
    const pool = new pg.Pool({
        connectionString: config.databaseUrl,
        max: 10,
        idleTimeoutMillis: 30_000,
    });
    pool.on('error', (err) => {
        console.error('[db] idle client error:', err.message);
    });
    return pool;
}
