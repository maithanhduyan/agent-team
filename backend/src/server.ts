import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = buildApp({ logLevel: config.logLevel });

async function shutdown(signal: string) {
    app.log.info(`${signal} received, shutting down`);
    try {
        await app.close();
    }
    finally {
        process.exit(0);
    }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`backend service ready at http://${config.host}:${config.port}`);
}
catch (err) {
    app.log.error(err);
    process.exit(1);
}
