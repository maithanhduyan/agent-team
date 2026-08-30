export interface Config {
    /** Port the HTTP server listens on. */
    port: number;
    /** Host/interface to bind. */
    host: string;
    /** Fastify/pino log level. */
    logLevel: string;
}

/**
 * Load service configuration from the environment.
 *
 * The backend service is standalone (not wired into the compose stack yet),
 * so it prefers its own `BACKEND_PORT` variable and falls back to the
 * generic `PORT` convention used by the orchestrator.
 */
export function loadConfig(): Config {
    return {
        port: Number(process.env.BACKEND_PORT ?? process.env.PORT ?? 4000),
        host: process.env.HOST ?? '0.0.0.0',
        logLevel: process.env.LOG_LEVEL ?? 'info',
    };
}
