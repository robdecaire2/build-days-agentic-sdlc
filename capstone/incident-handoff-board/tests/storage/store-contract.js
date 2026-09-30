import { describe, expect, it } from 'vitest';

/**
 * Shared behavioural contract for every HandoffStore adapter.
 * @param {string} name
 * @param {() => Promise<{store: import('../../src/storage/port.js').HandoffStore,
 *   reopen?: () => Promise<any>}>} factory
 */
export function runStoreContract(name, factory) {
  const sample = (id, createdAt = '2026-01-01T00:00:00.000Z') => ({
    id,
    service: 'checkout',
    summary: 'Latency elevated',
    nextAction: 'Watch p95',
    state: 'open',
    createdAt,
    updatedAt: createdAt,
    acknowledgedAt: null,
  });

  describe(`${name} store contract`, () => {
    it('creates, gets and lists records', async () => {
      const { store } = await factory();
      await store.create(sample('a'));
      await store.create(sample('b'));
      expect(await store.get('a')).toEqual(sample('a'));
      expect((await store.list()).map((h) => h.id).sort()).toEqual(['a', 'b']);
    });

    it('returns null for unknown ids without creating data', async () => {
      const { store } = await factory();
      expect(await store.get('missing')).toBeNull();
      expect(await store.update('missing', (h) => h)).toBeNull();
      expect(await store.list()).toEqual([]);
    });

    it('applies update mutators and persists the result', async () => {
      const { store } = await factory();
      await store.create(sample('a'));
      const updated = await store.update('a', (h) => ({ ...h, state: 'acknowledged' }));
      expect(updated.state).toBe('acknowledged');
      expect((await store.get('a')).state).toBe('acknowledged');
    });

    it('leaves the record unchanged when the mutator throws', async () => {
      const { store } = await factory();
      await store.create(sample('a'));
      await expect(
        store.update('a', () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect((await store.get('a')).state).toBe('open');
    });

    it('does not expose internal references', async () => {
      const { store } = await factory();
      const created = await store.create(sample('a'));
      created.summary = 'tampered';
      expect((await store.get('a')).summary).toBe('Latency elevated');
    });

    it('pings when usable', async () => {
      const { store } = await factory();
      await expect(store.ping()).resolves.toBeUndefined();
    });

    it('keeps records visible to a new adapter instance over the same backing store', async () => {
      const { store, reopen } = await factory();
      if (!reopen) return;
      await store.create(sample('a'));
      const second = await reopen();
      expect(await second.get('a')).toEqual(sample('a'));
    });
  });
}
