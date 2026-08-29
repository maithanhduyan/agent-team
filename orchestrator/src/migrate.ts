/**
 * Minimal SQL migration runner: applies migrations/*.sql in
 * filename order, tracking applied versions in schema_migrations.
 * Idempotent — safe to run on every boot.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { loadConfig } from './config.js';

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), 'migrations');

async function main() {
    const config = loadConfig();
    const pool = new pg.Pool({ connectionString: config.databaseUrl });

    await pool.query(`create table if not exists schema_migrations (
       version text primary key,
       applied_at timestamptz not null default now()
     )`);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const { rows: appliedRows } = await pool.query('select version from schema_migrations');
    const applied = new Set(appliedRows.map((r) => r.version));

    for (const file of files) {
        if (applied.has(file)) {
            console.log(`[migrate] skip ${file} (already applied)`);
            continue;
        }
        const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
        const client = await pool.connect();
        try {
            await client.query('begin');
            await client.query(sql);
            await client.query('insert into schema_migrations (version) values ($1)', [file]);
            await client.query('commit');
            console.log(`[migrate] applied ${file}`);
        }
        catch (err) {
            await client.query('rollback');
            throw new Error(`migration ${file} failed: ${(err as Error).message}`);
        }
        finally {
            client.release();
        }
    }

    await pool.end();
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[migrate] failed:', err);
        process.exit(1);
    });
