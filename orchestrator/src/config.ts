export interface Config {
    port: number;
    databaseUrl: string;
    redisUrl: string;
    githubToken: string;
    gitlabToken: string;
    redmineUrl: string;
    redmineApiKey: string;
    /**
     * Auto-dispatch imported Redmine tasks. Default true — a Redmine
     * issue in `[<agent>] <title>` form is dispatched to that agent as
     * soon as it is imported (and on boot for any previously imported
     * tasks still in `todo`). Set REDMINE_AUTO_DISPATCH=false to keep
     * dispatch a human/PM/owner decision.
     */
    redmineAutoDispatch: boolean;
    /** Shared API key for /api/* (empty = auth disabled, local dev). */
    apiKey: string;
}

export function loadConfig(): Config {
    return {
        port: Number(process.env.PORT ?? 8000),
        databaseUrl: process.env.DATABASE_URL ??
            'postgresql://agent:agent_password@localhost:5432/agent_team',
        redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
        githubToken: process.env.GITHUB_TOKEN ?? '',
        gitlabToken: process.env.GITLAB_TOKEN ?? '',
        redmineUrl: process.env.REDMINE_URL ?? 'http://redmine:3000',
        redmineApiKey: process.env.REDMINE_API_KEY ?? '',
        redmineAutoDispatch: process.env.REDMINE_AUTO_DISPATCH !== 'false',
        apiKey: process.env.API_KEY ?? '',
    };
}
