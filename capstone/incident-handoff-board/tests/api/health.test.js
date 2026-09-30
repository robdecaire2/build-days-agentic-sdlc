import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { MemoryHandoffStore } from '../../src/storage/memory.js';

describe('liveness and readiness', () => {
  it('reports liveness and readiness when storage is usable', async () => {
    const app = createApp({ store: new MemoryHandoffStore(), publicDir: '/nonexistent' });
    expect((await request(app).get('/health')).body).toEqual({ status: 'ok' });
    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ready', checks: { storage: 'ok' } });
  });

  it('stays live but is not ready when storage is unavailable', async () => {
    const store = new MemoryHandoffStore();
    store.setAvailable(false);
    const app = createApp({ store, publicDir: '/nonexistent' });
    expect((await request(app).get('/health')).status).toBe(200);
    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.checks.storage).toBe('unavailable');
  });

  it('recovers readiness when storage returns', async () => {
    const store = new MemoryHandoffStore();
    const app = createApp({ store, publicDir: '/nonexistent' });
    store.setAvailable(false);
    expect((await request(app).get('/ready')).status).toBe(503);
    store.setAvailable(true);
    expect((await request(app).get('/ready')).status).toBe(200);
  });
});
