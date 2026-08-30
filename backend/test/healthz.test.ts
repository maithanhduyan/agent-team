import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

test('GET /healthz returns 200 with JSON body { ok: true }', async () => {
    const app = buildApp({ logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/healthz' });

    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type']), /^application\/json/);
    assert.deepEqual(res.json(), { ok: true });

    await app.close();
});

test('GET /healthz works for HEAD-style probing too (Fastify default)', async () => {
    const app = buildApp({ logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(res.statusCode, 200);
    await app.close();
});

test('GET / returns service metadata including the health endpoint', async () => {
    const app = buildApp({ logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/' });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
        service: 'backend',
        version: '0.1.0',
        status: 'ok',
        health: '/healthz',
    });

    await app.close();
});

test('unknown routes return 404', async () => {
    const app = buildApp({ logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/nope' });
    assert.equal(res.statusCode, 404);
    await app.close();
});
