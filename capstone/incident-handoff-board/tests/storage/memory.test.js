import { describe, expect, it } from 'vitest';
import { MemoryHandoffStore } from '../../src/storage/memory.js';
import { StorageUnavailableError } from '../../src/storage/port.js';
import { runStoreContract } from './store-contract.js';

runStoreContract('memory', async () => {
  const store = new MemoryHandoffStore();
  return { store };
});

describe('memory adapter availability', () => {
  it('rejects every operation with StorageUnavailableError while unavailable', async () => {
    const store = new MemoryHandoffStore();
    store.setAvailable(false);
    await expect(store.ping()).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(store.list()).rejects.toBeInstanceOf(StorageUnavailableError);
    store.setAvailable(true);
    await expect(store.ping()).resolves.toBeUndefined();
  });
});
