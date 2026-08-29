export interface Config {
    port: number;
    databaseUrl: string;
    redisUrl: string;
    githubToken: string;
    gitlabToken: string;
}

export function loadConfig(): Config {
    return {
        port: Number(process.env.PORT ?? 8000),
        databaseUrl: process.env.DATABASE_URL ??
            'postgresql://agent:agent_password@localhost:5432/agent_team',
        redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
        githubToken: process.env.GITHUB_TOKEN ?? '',
        gitlabToken: process.env.GITLAB_TOKEN ?? '',
    };
}
