import { describe, expect, it } from 'vitest';
import { StorageUnavailableError } from '../../src/storage/port.js';
import { TableHandoffStore } from '../../src/storage/table.js';
import { runStoreContract } from './store-contract.js';

const restError = (statusCode) => Object.assign(new Error(`status ${statusCode}`), { statusCode });

/** Minimal TableClient fake with ETag semantics. */
class FakeTableClient {
  rows = new Map();
  failWith = null;
  conflictsToInject = 0;
  #version = 0;

  async createEntity(entity) {
    this.#maybeFail();
    if (this.rows.has(entity.rowKey)) throw restError(409);
    this.rows.set(entity.rowKey, { ...entity, etag: `v${++this.#version}` });
  }

  async getEntity(_partition, rowKey) {
    this.#maybeFail();
    const row = this.rows.get(rowKey);
    if (!row) throw restError(404);
    return { ...row };
  }

  async updateEntity(entity, _mode, { etag }) {
    this.#maybeFail();
    if (this.conflictsToInject > 0) {
      this.conflictsToInject -= 1;
      this.rows.set(entity.rowKey, { ...this.rows.get(entity.rowKey), etag: `v${++this.#version}` });
      throw restError(412);
    }
    if (this.rows.get(entity.rowKey).etag !== etag) throw restError(412);
    this.rows.set(entity.rowKey, { ...entity, etag: `v${++this.#version}` });
  }

  async *listEntities() {
    this.#maybeFail();
    for (const row of this.rows.values()) yield { ...row };
  }

  #maybeFail() {
    if (this.failWith) throw this.failWith;
  }
}

runStoreContract('table', async () => {
  const client = new FakeTableClient();
  return { store: new TableHandoffStore(client), reopen: async () => new TableHandoffStore(client) };
});

describe('table adapter behaviour', () => {
  const sample = { id: 'a', service: 's', summary: 'x', nextAction: 'n', state: 'open', createdAt: 't', updatedAt: 't', acknowledgedAt: null };

  it('retries an ETag conflict and then succeeds', async () => {
    const client = new FakeTableClient();
    const store = new TableHandoffStore(client);
    await store.create(sample);
    client.conflictsToInject = 2;
    const updated = await store.update('a', (h) => ({ ...h, state: 'acknowledged', acknowledgedAt: 't2' }));
    expect(updated.state).toBe('acknowledged');
    expect((await store.get('a')).acknowledgedAt).toBe('t2');
  });

  it('gives up after repeated conflicts', async () => {
    const client = new FakeTableClient();
    const store = new TableHandoffStore(client);
    await store.create(sample);
    client.conflictsToInject = 99;
    await expect(store.update('a', (h) => h)).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it('maps service failures to StorageUnavailableError', async () => {
    const client = new FakeTableClient();
    const store = new TableHandoffStore(client);
    client.failWith = restError(503);
    await expect(store.ping()).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(store.list()).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(store.get('a')).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(store.create(sample)).rejects.toBeInstanceOf(StorageUnavailableError);
  });
});
