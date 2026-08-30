import Fastify, { type FastifyInstance } from 'fastify';

export const SERVICE_NAME = 'backend';
export const SERVICE_VERSION = '0.1.0';

/**
 * Build the Fastify application.
 *
 * A factory (rather than a module-level instance) so tests can create a
 * fresh instance per run without binding a port.
 */
export function buildApp(options: { logLevel?: string } = {}): FastifyInstance {
    const app = Fastify({
        logger: { level: options.logLevel ?? 'info' },
    });

    // Liveness probe: no dependencies, always answers once the process is up.
    app.get('/healthz', async () => ({ ok: true }));

    // Minimal service metadata for operators / discovery.
    app.get('/', async () => ({
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        status: 'ok',
        health: '/healthz',
    }));

    return app;
}
