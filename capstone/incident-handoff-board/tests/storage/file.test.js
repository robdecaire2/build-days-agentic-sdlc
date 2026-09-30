import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileHandoffStore } from '../../src/storage/file.js';
import { StorageUnavailableError } from '../../src/storage/port.js';
import { runStoreContract } from './store-contract.js';

async function tempFile() {
  return path.join(await mkdtemp(path.join(os.tmpdir(), 'handoffs-')), 'data', 'handoffs.json');
}

runStoreContract('file', async () => {
  const file = await tempFile();
  return { store: new FileHandoffStore(file), reopen: async () => new FileHandoffStore(file) };
});

describe('file adapter failures', () => {
  it('serializes concurrent updates without losing writes', async () => {
    const store = new FileHandoffStore(await tempFile());
    await store.create({ id: 'a', n: 0 });
    await Promise.all(Array.from({ length: 10 }, () => store.update('a', (h) => ({ ...h, n: h.n + 1 }))));
    expect((await store.get('a')).n).toBe(10);
  });

  it('reports a corrupt file as unavailable storage', async () => {
    const file = await tempFile();
    const store = new FileHandoffStore(file);
    await store.create({ id: 'a' });
    await writeFile(file, '{not json');
    await expect(store.ping()).rejects.toBeInstanceOf(StorageUnavailableError);
  });
});
