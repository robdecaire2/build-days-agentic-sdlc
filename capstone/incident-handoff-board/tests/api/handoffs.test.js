import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { MemoryHandoffStore } from '../../src/storage/memory.js';

const body = { service: 'checkout', summary: 'Latency elevated', nextAction: 'Watch p95' };

function harness() {
  let tick = 0;
  let ids = 0;
  const store = new MemoryHandoffStore();
  const app = createApp({
    store,
    now: () => new Date(Date.UTC(2026, 0, 1, 10, 0, tick++)),
    newId: () => `id-${++ids}`,
    publicDir: '/nonexistent',
  });
  return { app, store };
}

describe('handoff API', () => {
  let app;
  let store;
  beforeEach(() => ({ app, store } = harness()));

  it('creates a valid handoff as open', async () => {
    const res = await request(app).post('/api/handoffs').send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'id-1', ...body, state: 'open', acknowledgedAt: null });
    expect(res.body.createdAt).toBe(res.body.updatedAt);
  });

  it('lists an empty board', async () => {
    const res = await request(app).get('/api/handoffs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ handoffs: [] });
  });

  it('lists created handoffs newest first', async () => {
    await request(app).post('/api/handoffs').send(body);
    await request(app).post('/api/handoffs').send({ ...body, service: 'search' });
    const res = await request(app).get('/api/handoffs');
    expect(res.body.handoffs.map((h) => h.service)).toEqual(['search', 'checkout']);
  });

  it('rejects invalid input with field details and creates nothing', async () => {
    const res = await request(app).post('/api/handoffs').send({ service: '', summary: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details.map((d) => d.field)).toEqual(['service', 'summary', 'nextAction']);
    expect(await store.list()).toEqual([]);
  });

  it('rejects malformed JSON as a validation failure', async () => {
    const res = await request(app).post('/api/handoffs').set('Content-Type', 'application/json').send('{oops');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('rejects a request without a body', async () => {
    const res = await request(app).post('/api/handoffs');
    expect(res.status).toBe(400);
  });

  it('acknowledges an open handoff and persists it', async () => {
    const created = (await request(app).post('/api/handoffs').send(body)).body;
    const res = await request(app).post(`/api/handoffs/${created.id}/acknowledge`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('acknowledged');
    expect(res.body.acknowledgedAt).not.toBeNull();
    const list = (await request(app).get('/api/handoffs')).body.handoffs;
    expect(list[0]).toEqual(res.body);
  });

  it('regression #25: repeated acknowledgement returns 409 and keeps the original timestamps', async () => {
    const created = (await request(app).post('/api/handoffs').send(body)).body;
    const first = await request(app).post(`/api/handoffs/${created.id}/acknowledge`);
    expect(first.status).toBe(200);
    for (let attempt = 0; attempt < 2; attempt++) {
      const again = await request(app).post(`/api/handoffs/${created.id}/acknowledge`);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('already_acknowledged');
    }
    const stored = (await request(app).get('/api/handoffs')).body.handoffs[0];
    expect(stored.acknowledgedAt).toBe(first.body.acknowledgedAt);
    expect(stored.updatedAt).toBe(first.body.updatedAt);
  });
  it.each(['unknown-id', 'bad%2Fid', 'a'.repeat(65)])('returns 404 for unknown or malformed id %s without changes', async (id) => {
    const res = await request(app).post(`/api/handoffs/${id}/acknowledge`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
    expect(await store.list()).toEqual([]);
  });

  it('returns a JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('maps unavailable storage to 503', async () => {
    store.setAvailable(false);
    const res = await request(app).get('/api/handoffs');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('storage_unavailable');
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
