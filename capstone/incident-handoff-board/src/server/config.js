import path from 'node:path';
import { FileHandoffStore } from '../storage/file.js';
import { MemoryHandoffStore } from '../storage/memory.js';

/** Select the storage adapter from environment variables. */
export async function createStoreFromEnv(env = process.env) {
  const backend = env.STORAGE_BACKEND ?? 'memory';
  switch (backend) {
    case 'memory':
      return new MemoryHandoffStore();
    case 'file':
      return new FileHandoffStore(path.resolve(env.DATA_FILE ?? 'data/handoffs.json'));
    case 'azure': {
      const url = env.AZURE_STORAGE_ACCOUNT_URL;
      const tableName = env.AZURE_STORAGE_TABLE_NAME ?? 'Handoffs';
      if (!url) {
        throw new Error('AZURE_STORAGE_ACCOUNT_URL is required when STORAGE_BACKEND=azure.');
      }
      const { createTableStore } = await import('../storage/table.js');
      return createTableStore({ url, tableName });
    }
    default:
      throw new Error(`Unknown STORAGE_BACKEND "${backend}". Use memory, file, or azure.`);
  }
}
